import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { quoteChangesQuerySchema } from '../../data/validators'
import { buildVersionChains, diffQuotes, pickPreviousVersion, versionDay } from '../../lib/quoteChanges'
import {
  loadPurchasePricesBySku,
  loadQuoteLineFacts,
  loadQuoteVersionFacts,
  loadSupplierLibraryIndex,
  loadSupplierVersionFacts,
} from '../../lib/quoteChangeReads'
import { sourcingErrorSchema, sourcingTag } from '../openapi'

/**
 * What changed between two versions of one supplier's quotation.
 *
 * Read-only by construction: it compares two stored quotations and returns the four decisions plus
 * the three honest "cannot tell" states. The rules (key normalization, the exact decimal
 * comparison, the version chain) live in `lib/quoteChanges.ts`; this route only resolves scope,
 * picks the default base version and decorates each row with the supplier-library and product
 * projections the buyer needs to act on it.
 */
const MAX_LINES_PER_VERSION = 2000

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['sourcing.quotes.view'] },
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const parsed = quoteChangesQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query', code: 'quote_changes_invalid_query', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    return NextResponse.json(
      { error: 'Select an organization to access this resource', code: 'organization_scope_required' },
      { status: 400 },
    )
  }

  const scope = { tenantId: auth.tenantId, organizationId }
  const em = container.resolve('em') as EntityManager

  const target = await loadQuoteVersionFacts(em, scope, parsed.data.quoteId)
  if (!target) return NextResponse.json({ error: 'Supplier quotation not found' }, { status: 404 })

  const supplierVersions = target.supplierId
    ? await loadSupplierVersionFacts(em, scope, target.supplierId)
    : []
  const chain = buildVersionChains(supplierVersions)

  let base = null
  if (parsed.data.baseQuoteId) {
    // An explicit base may be any quotation of the same organization, not just a chain member:
    // comparing a manual quotation against a workbook import is a legitimate question.
    base = await loadQuoteVersionFacts(em, scope, parsed.data.baseQuoteId)
    if (!base) return NextResponse.json({ error: 'Base quotation not found' }, { status: 404 })
  } else {
    base = pickPreviousVersion(chain, target.quoteId)
  }

  const [targetLines, baseLines] = await Promise.all([
    loadQuoteLineFacts(em, scope, target.quoteId),
    base ? loadQuoteLineFacts(em, scope, base.quoteId) : Promise.resolve([]),
  ])
  if (targetLines.length > MAX_LINES_PER_VERSION || baseLines.length > MAX_LINES_PER_VERSION) {
    return NextResponse.json(
      { error: 'This version is too large to compare', code: 'quote_lines_unavailable' },
      { status: 422 },
    )
  }

  const { rows, summary } = diffQuotes(baseLines, targetLines, {
    onlyChanged: parsed.data.onlyChanged === true,
  })

  const rawSkus = [...targetLines, ...baseLines]
    .map((line) => (line.derivedSku ?? line.itemNo ?? '').trim())
    .filter((sku) => sku.length > 0)
  const [library, prices] = await Promise.all([
    target.supplierId
      ? loadSupplierLibraryIndex(em, scope, target.supplierId)
      : Promise.resolve(new Map()),
    loadPurchasePricesBySku(em, scope, rawSkus),
  ])

  const items = rows.map((row) => {
    const entry = row.key ? library.get(row.key) ?? null : null
    const price = row.key ? prices.get(row.key) ?? null : null
    return {
      ...row,
      library: entry
        ? { supplierProductId: entry.supplierProductId, supplierSku: entry.supplierSku, catalogProductId: entry.catalogProductId }
        : null,
      purchase: price
        ? {
            catalogProductId: price.catalogProductId,
            productSku: price.productSku,
            unitPrice: price.unitPrice,
            currencyCode: price.currencyCode,
          }
        : null,
    }
  })

  const page = parsed.data.page
  const pageSize = parsed.data.pageSize
  const start = (page - 1) * pageSize
  // The default base comes from the collapsed chain (one entry per layout per day), but the manual
  // selector offers every decided version of this layout — a second revision imported the same day
  // still has to be comparable, and a retired (archived) version is history, not noise.
  const candidates = supplierVersions
    .filter(
      (version) =>
        version.signature !== null &&
        version.signature === target.signature &&
        version.quoteId !== target.quoteId &&
        (version.status === 'approved' || version.status === 'archived'),
    )
    .sort((left, right) => {
      const leftDay = versionDay(left)
      const rightDay = versionDay(right)
      return leftDay === rightDay ? right.createdAt.localeCompare(left.createdAt) : rightDay.localeCompare(leftDay)
    })
    .map((version) => ({ ...version, day: versionDay(version) }))

  return NextResponse.json({
    target: { ...target, day: versionDay(target) },
    base: base ? { ...base, day: versionDay(base) } : null,
    candidates,
    summary,
    items: items.slice(start, start + pageSize),
    totalCount: items.length,
    page,
    pageSize,
  })
}

const versionSchema = z.object({
  quoteId: z.string().uuid(),
  number: z.string().nullable(),
  status: z.string(),
  signature: z.string().nullable(),
  supplierId: z.string().uuid().nullable(),
  quoteDate: z.string().nullable(),
  createdAt: z.string(),
  fileName: z.string().nullable(),
  lineCount: z.number(),
  promotedCount: z.number(),
  day: z.string().optional(),
  collapsedCount: z.number().optional(),
})

const changeRowSchema = z.object({
  key: z.string().nullable(),
  itemNo: z.string().nullable(),
  name: z.string().nullable(),
  kind: z.enum(['added', 'removed', 'up', 'down', 'currency_mismatch', 'no_price', 'same']),
  baseLineId: z.string().uuid().nullable(),
  targetLineId: z.string().uuid().nullable(),
  baseUnitCost: z.string().nullable(),
  targetUnitCost: z.string().nullable(),
  baseCurrencyCode: z.string().nullable(),
  targetCurrencyCode: z.string().nullable(),
  deltaAmount: z.string().nullable(),
  deltaPercent: z.number().nullable(),
  library: z
    .object({
      supplierProductId: z.string().uuid(),
      supplierSku: z.string(),
      catalogProductId: z.string().uuid().nullable(),
    })
    .nullable(),
  purchase: z
    .object({
      catalogProductId: z.string().uuid(),
      productSku: z.string(),
      unitPrice: z.string(),
      currencyCode: z.string(),
    })
    .nullable(),
})

const responseSchema = z.object({
  target: versionSchema,
  base: versionSchema.nullable(),
  candidates: z.array(versionSchema),
  summary: z.object({
    added: z.number(),
    removed: z.number(),
    up: z.number(),
    down: z.number(),
    same: z.number(),
    currencyMismatch: z.number(),
    noPrice: z.number(),
    total: z.number(),
    unmatched: z.number(),
    duplicateKeys: z.number(),
  }),
  items: z.array(changeRowSchema),
  totalCount: z.number(),
  page: z.number(),
  pageSize: z.number(),
})

export const openApi: OpenApiRouteDoc = {
  tag: sourcingTag,
  summary: 'Quotation change analysis',
  methods: {
    GET: {
      summary: 'Compare two quotation versions',
      description:
        'Compares one quotation with a base version — the previous version of the same layout by default, or an explicit `baseQuoteId` — and returns the four decisions (added / removed / price up / price down) plus the rows that cannot be decided (currency mismatch, missing price). Read-only; each version is capped at 2000 lines. Rows are keyed by the normalized derived SKU, so variants sharing one Item No. never pair with each other.',
      responses: [{ status: 200, description: 'The comparison', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid query or missing organization scope', schema: sourcingErrorSchema },
        { status: 401, description: 'Not authenticated', schema: sourcingErrorSchema },
        { status: 403, description: 'Missing feature', schema: sourcingErrorSchema },
        { status: 404, description: 'Quotation not found in this organization', schema: sourcingErrorSchema },
        { status: 422, description: 'A version is too large to compare', schema: sourcingErrorSchema },
      ],
    },
  },
}
