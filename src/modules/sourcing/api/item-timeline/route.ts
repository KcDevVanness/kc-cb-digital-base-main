import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { itemTimelineQuerySchema } from '../../data/validators'
import { buildItemTimeline, buildVersionChains, normalizeItemKey } from '../../lib/quoteChanges'
import {
  loadPurchasePricesBySku,
  loadSupplierItemPoints,
  loadSupplierLibraryIndex,
  loadSupplierVersionFacts,
} from '../../lib/quoteChangeReads'
import { sourcingErrorSchema, sourcingTag } from '../openapi'

/**
 * One item's price over every version of one supplier.
 *
 * The question this answers is the one a two-version diff cannot: "how did this item's price get
 * here, and is it still quoted at all?". The item is addressed by the supplier's own code
 * (normalized), and the answer carries both the movement between consecutive versions and the
 * current library/product state, so the buyer sees the price and its consequences together.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['sourcing.quotes.view'] },
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const parsed = itemTimelineQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query', code: 'item_timeline_invalid_query', details: parsed.error.flatten() },
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
  const key = normalizeItemKey(null, parsed.data.sku)
  if (!key) {
    return NextResponse.json({ error: 'Invalid item code', code: 'item_timeline_invalid_sku' }, { status: 400 })
  }

  const [versions, { points }] = await Promise.all([
    loadSupplierVersionFacts(em, scope, parsed.data.supplierId),
    loadSupplierItemPoints(em, scope, parsed.data.supplierId, key),
  ])
  const chain = buildVersionChains(versions)
  const timeline = buildItemTimeline(points)
  // "Still quoted?" is a question about the item's *own* layout: a supplier's newest workbook of a
  // different layout is not evidence that this item was dropped.
  const itemSignature = timeline[timeline.length - 1]?.signature ?? null
  const latestVersionDay = chain
    .filter((version) => (itemSignature ? version.signature === itemSignature : true))
    .reduce<string | null>(
      (latest, version) => (latest === null || version.day > latest ? version.day : latest),
      null,
    )
  const library = await loadSupplierLibraryIndex(em, scope, parsed.data.supplierId)
  const entry = library.get(key) ?? null
  const skuForProduct = entry?.supplierSku ?? parsed.data.sku
  const prices = await loadPurchasePricesBySku(em, scope, [skuForProduct])
  const purchase = prices.get(key) ?? null

  return NextResponse.json({
    item: {
      key,
      itemNo: timeline[timeline.length - 1]?.itemNo ?? null,
      name: timeline[timeline.length - 1]?.name ?? null,
      library: entry
        ? { supplierProductId: entry.supplierProductId, supplierSku: entry.supplierSku, productId: entry.productId }
        : null,
      purchase,
    },
    points: timeline,
    versionCount: chain.length,
    latestVersionDay,
    reportedInLatestVersion:
      latestVersionDay !== null && timeline.length > 0 && timeline[timeline.length - 1]?.day === latestVersionDay,
  })
}

const pointSchema = z.object({
  quoteId: z.string().uuid(),
  number: z.string().nullable(),
  day: z.string(),
  signature: z.string().nullable(),
  itemNo: z.string().nullable(),
  name: z.string().nullable(),
  unitCost: z.string().nullable(),
  currencyCode: z.string().nullable(),
  moqQuantity: z.number().nullable(),
  promotedProductId: z.string().uuid().nullable(),
  kind: z.enum(['added', 'removed', 'up', 'down', 'currency_mismatch', 'no_price', 'same']),
  deltaAmount: z.string().nullable(),
  deltaPercent: z.number().nullable(),
  first: z.boolean(),
})

export const openApi: OpenApiRouteDoc = {
  tag: sourcingTag,
  summary: 'Item price history',
  methods: {
    GET: {
      summary: 'One item across the versions of a supplier',
      description:
        'Returns every decided quotation of one supplier that quoted the given item code, oldest first, with the movement against the previous version. `reportedInLatestVersion` says whether the newest version still quotes it — the "it disappeared" case a two-version diff shows only once. Read-only.',
      responses: [
        {
          status: 200,
          description: 'The price history',
          schema: z.object({
            item: z.object({
              key: z.string(),
              itemNo: z.string().nullable(),
              name: z.string().nullable(),
              library: z
                .object({
                  supplierProductId: z.string().uuid(),
                  supplierSku: z.string(),
                  productId: z.string().uuid().nullable(),
                })
                .nullable(),
              purchase: z
                .object({
                  productId: z.string().uuid(),
                  productSku: z.string(),
                  unitPrice: z.string(),
                  currencyCode: z.string(),
                })
                .nullable(),
            }),
            points: z.array(pointSchema),
            versionCount: z.number(),
            latestVersionDay: z.string().nullable(),
            reportedInLatestVersion: z.boolean(),
          }),
        },
      ],
      errors: [
        { status: 400, description: 'Invalid query or missing organization scope', schema: sourcingErrorSchema },
        { status: 401, description: 'Not authenticated', schema: sourcingErrorSchema },
        { status: 403, description: 'Missing feature', schema: sourcingErrorSchema },
      ],
    },
  },
}
