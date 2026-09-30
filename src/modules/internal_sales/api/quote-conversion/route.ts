import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { sql } from 'kysely'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  buildQuoteConversionReport,
  type QuoteConversionOrderRow,
  type QuoteConversionQuoteRow,
} from '../../lib/quoteConversion'

const logger = createLogger('internal_sales')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['sales.quotes.view'] },
}

const DEFAULT_PERIOD_DAYS = 90
const MAX_PERIOD_DAYS = 365

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(MAX_PERIOD_DAYS).default(DEFAULT_PERIOD_DAYS),
})

/** The row shape the report reads from the installed tables — kept local so the read stays explicit. */
type QuoteRow = {
  id: string
  quote_number: string | null
  status: string | null
  sent_at: Date | string | null
  valid_until: Date | string | null
  channel_id: string | null
}

type OrderRow = {
  id: string
  order_number: string | null
  status: string | null
  source_quote_id: string | null
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null
  const parsed = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

/**
 * 报价转化 — read-only aggregate over the quotes of a period and the orders that name them.
 *
 * Both tables are installed peers of this module, so the read is a scoped Kysely projection (the
 * same pattern as the trade-type channel lookup) rather than a cross-module ORM relation. Orders are
 * matched on `metadata.internalSales.sourceQuote.id`, the key the app's own order writer freezes;
 * orders are **not** time-filtered, because a quote from the period that became an order later is a
 * conversion, and the period belongs to the quote.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid query', details: parsed.error.issues }, { status: 400 })
    }

    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(request)
    if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
    const organizationId = scope?.selectedId ?? scope?.filterIds?.[0] ?? auth.orgId ?? null
    if (!organizationId) {
      return NextResponse.json(
        { error: 'Select an organization to access this resource', code: 'organization_scope_required' },
        { status: 400 },
      )
    }

    const em = container.resolve('em') as EntityManager
    const db = em.fork().getKysely<any>()
    const since = new Date(Date.now() - parsed.data.days * 24 * 60 * 60 * 1000)

    const quoteRows = (await db
      .selectFrom('sales_quotes')
      .select(['id', 'quote_number', 'status', 'sent_at', 'valid_until', 'channel_id'])
      .where('tenant_id', '=', auth.tenantId)
      .where('organization_id', '=', organizationId)
      .where('deleted_at', 'is', null)
      .where('created_at', '>=', since)
      .orderBy('created_at', 'desc')
      .execute()) as QuoteRow[]

    const orderRows = (await db
      .selectFrom('sales_orders')
      .select(['id', 'order_number', 'status'])
      .select(sql<string | null>`metadata #>> '{internalSales,sourceQuote,id}'`.as('source_quote_id'))
      .where('tenant_id', '=', auth.tenantId)
      .where('organization_id', '=', organizationId)
      .where('deleted_at', 'is', null)
      .where(sql<boolean>`metadata #>> '{internalSales,sourceQuote,id}' is not null`)
      .execute()) as OrderRow[]

    const quotes: QuoteConversionQuoteRow[] = quoteRows.map((row) => ({
      id: String(row.id),
      number: row.quote_number ?? null,
      status: row.status ?? null,
      sentAt: toIso(row.sent_at),
      validUntil: toIso(row.valid_until),
      channelId: row.channel_id ? String(row.channel_id) : null,
    }))
    const orders: QuoteConversionOrderRow[] = orderRows
      .filter((row) => typeof row.source_quote_id === 'string' && row.source_quote_id.length > 0)
      .map((row) => ({
        id: String(row.id),
        number: row.order_number ?? null,
        status: row.status ?? null,
        sourceQuoteId: String(row.source_quote_id),
      }))

    const report = buildQuoteConversionReport(quotes, orders)
    return NextResponse.json({
      period: { days: parsed.data.days, from: since.toISOString() },
      ...report,
    })
  } catch (error) {
    logger.error('Failed to build the quote conversion report', { err: error })
    return NextResponse.json({ error: 'Could not build the quote conversion report' }, { status: 500 })
  }
}

const quoteFactSchema = z.object({
  id: z.string(),
  number: z.string().nullable(),
  status: z.string().nullable(),
  sentAt: z.string().nullable(),
  validUntil: z.string().nullable(),
  channelId: z.string().nullable(),
  converted: z.boolean(),
  orderCount: z.number(),
  orderNumbers: z.array(z.string()),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Internal sales',
  summary: 'Quote → order conversion',
  methods: {
    GET: {
      summary: 'Report how many quotes of a period became orders',
      description:
        'Read-only. Counts the quotes created in the period, how many carry a sent timestamp (the 「已发出」 denominator), and how many are referenced by an order through `metadata.internalSales.sourceQuote.id` (the marker the app\'s order writer freezes). Returns **both** rates — over every quote and over the sent ones — plus the counts behind them, because which denominator a management number should use is a business statement, not a technical one. Orders whose source quote falls outside the period are reported as `ordersWithoutQuoteInPeriod` and never as conversions.',
      tags: ['Internal sales'],
      query: querySchema,
      responses: [
        {
          status: 200,
          description: 'Per-quote facts plus the period summary',
          schema: z.object({
            period: z.object({ days: z.number(), from: z.string() }),
            quotes: z.array(quoteFactSchema),
            summary: z.object({
              quotes: z.number(),
              sent: z.number(),
              converted: z.number(),
              rateOverQuotes: z.number().nullable(),
              rateOverSent: z.number().nullable(),
            }),
            ordersWithoutQuoteInPeriod: z.number(),
          }),
        },
        { status: 400, description: 'Invalid query or no organization selected', schema: z.object({ error: z.string() }).passthrough() },
        { status: 401, description: 'Not authenticated', schema: z.object({ error: z.string() }).passthrough() },
        { status: 403, description: 'Missing sales.quotes.view', schema: z.object({ error: z.string() }).passthrough() },
      ],
    },
  },
}
