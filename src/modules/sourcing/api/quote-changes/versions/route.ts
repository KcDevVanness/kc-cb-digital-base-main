import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { quoteVersionsQuerySchema } from '../../../data/validators'
import { buildVersionChains, diffQuotes, type QuoteLineFacts } from '../../../lib/quoteChanges'
import { loadQuoteLineFacts, loadSupplierVersionFacts } from '../../../lib/quoteChangeReads'
import { sourcingErrorSchema, sourcingTag } from '../../openapi'

/**
 * A supplier's version chain, newest first, each version measured against the one before it.
 *
 * This is the "what has this supplier been doing lately?" view: one request answers it for the whole
 * chain instead of the operator opening every quotation. Summaries are computed only for the page
 * that is returned (a chain can be long, and nobody reads the middle of it first), and the loaded
 * lines are shared between neighbouring versions because a version's predecessor is the next row's
 * subject.
 */
const MAX_LINES_PER_VERSION = 2000
const MAX_CHAIN_LENGTH = 50

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['sourcing.quotes.view'] },
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const parsed = quoteVersionsQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query', code: 'quote_versions_invalid_query', details: parsed.error.flatten() },
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

  const versions = await loadSupplierVersionFacts(em, scope, parsed.data.supplierId)
  const chain = buildVersionChains(versions).filter(
    (version) => !parsed.data.signature || version.signature === parsed.data.signature,
  )
  const ordered = [...chain].sort((left, right) =>
    left.day === right.day ? right.createdAt.localeCompare(left.createdAt) : right.day.localeCompare(left.day),
  )
  const truncated = ordered.length > MAX_CHAIN_LENGTH
  const newest = ordered.slice(0, MAX_CHAIN_LENGTH)
  const page = parsed.data.page
  const pageSize = parsed.data.pageSize
  const pageItems = newest.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize)

  const linesByQuote = new Map<string, QuoteLineFacts[]>()
  const loadLines = async (quoteId: string): Promise<QuoteLineFacts[]> => {
    const cached = linesByQuote.get(quoteId)
    if (cached) return cached
    const lines = await loadQuoteLineFacts(em, scope, quoteId)
    linesByQuote.set(quoteId, lines)
    return lines
  }

  // A version's predecessor is the previous version *of its own layout* — walking the combined list
  // would compare a Petkit sheet against an EXW invoice and report every row as changed.
  const previousByQuote = new Map<string, string>()
  const newestSeenBySignature = new Map<string, string>()
  for (const version of newest) {
    const signature = version.signature ?? ''
    const newer = newestSeenBySignature.get(signature)
    if (newer) previousByQuote.set(newer, version.quoteId)
    newestSeenBySignature.set(signature, version.quoteId)
  }

  const items = []
  for (const version of pageItems) {
    const baseQuoteId = previousByQuote.get(version.quoteId) ?? null
    const targetLines = await loadLines(version.quoteId)
    if (targetLines.length > MAX_LINES_PER_VERSION) {
      items.push({ ...version, baseQuoteId, summary: null })
      continue
    }
    if (!baseQuoteId) {
      items.push({ ...version, baseQuoteId: null, summary: null })
      continue
    }
    const baseLines = await loadLines(baseQuoteId)
    if (baseLines.length > MAX_LINES_PER_VERSION) {
      items.push({ ...version, baseQuoteId, summary: null })
      continue
    }
    const { summary } = diffQuotes(baseLines, targetLines)
    items.push({ ...version, baseQuoteId, summary })
  }

  return NextResponse.json({
    supplierId: parsed.data.supplierId,
    items,
    totalCount: newest.length,
    truncated,
    page,
    pageSize,
  })
}

const summarySchema = z.object({
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
})

const versionRowSchema = z.object({
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
  day: z.string(),
  collapsedCount: z.number(),
  baseQuoteId: z.string().uuid().nullable(),
  summary: summarySchema.nullable(),
})

export const openApi: OpenApiRouteDoc = {
  tag: sourcingTag,
  summary: 'Supplier quotation versions',
  methods: {
    GET: {
      summary: 'A supplier’s quotation version chain',
      description:
        'Lists the supplier’s decided quotations, one entry per layout per calendar day (repeated imports of the same workbook are one version), newest first. Each returned version carries its change summary against the version before it — or null when it is the first, too large, or has no predecessor. Read-only.',
      responses: [
        {
          status: 200,
          description: 'The version chain page',
          schema: z.object({
            supplierId: z.string().uuid(),
            items: z.array(versionRowSchema),
            totalCount: z.number(),
            truncated: z.boolean(),
            page: z.number(),
            pageSize: z.number(),
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
