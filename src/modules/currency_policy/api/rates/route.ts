import type { EntityManager } from '@mikro-orm/postgresql'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CNY_DISPLAY_CURRENCY, loadRateRows, resolveCnyRate } from '../../lib/rateLookup'

const logger = createLogger('currency_policy')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['currencies.view'] },
}

/** A bounded, comma-separated ISO-code list — a page asks for the currencies it actually renders. */
const MAX_SYMBOLS = 32
const SYMBOL_PATTERN = /^[A-Za-z]{3}$/

/**
 * The display rates for money amounts: how much CNY one unit of each requested currency is worth.
 *
 * Read-only and stored-rates-only on purpose (see `.ai/specs/2026-09-24-cny-equivalent-amounts.md`):
 * the fetch belongs to the feed (`POST /api/currencies/fetch-rates`, the 汇率抓取配置 page, the CLI),
 * never to a table cell. A pair with no stored rate is simply absent from `items`, which is what lets
 * the client render the original amount alone instead of inventing a figure.
 *
 * `symbols` is optional: without it the route answers for every currency the caller's organization
 * knows, which is the one-request-per-page case the client hook uses.
 */
export async function GET(request: Request) {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const readableIds = organizationScope?.filterIds?.length
    ? organizationScope.filterIds
    : organizationScope?.selectedId
      ? [organizationScope.selectedId]
      : auth.orgId
        ? [auth.orgId]
        : []
  if (readableIds.length === 0) {
    return NextResponse.json(
      { error: 'Select an organization to access this resource', code: 'organization_scope_required' },
      { status: 400 },
    )
  }

  const url = new URL(request.url)
  const rawSymbols = (url.searchParams.get('symbols') ?? '')
    .split(',')
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry) => entry.length > 0)
  if (rawSymbols.length > MAX_SYMBOLS) {
    return NextResponse.json({ error: `At most ${MAX_SYMBOLS} symbols per request` }, { status: 400 })
  }
  const malformed = rawSymbols.find((entry) => !SYMBOL_PATTERN.test(entry))
  if (malformed) {
    return NextResponse.json({ error: `Not a three-letter currency code: ${malformed}` }, { status: 400 })
  }

  try {
    const em = container.resolve('em') as EntityManager
    const organizationId = readableIds[0]
    const codes = rawSymbols.length > 0 ? rawSymbols : await loadKnownCurrencyCodes(em, auth.tenantId, organizationId)

    const rows = await loadRateRows(em, { tenantId: auth.tenantId, organizationId }, codes)
    const items = codes
      .map((code) => resolveCnyRate(code, rows))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .map((entry) => ({
        currencyCode: entry.currencyCode,
        rate: entry.rate,
        date: entry.date.toISOString(),
        source: entry.source,
      }))

    return NextResponse.json({ base: CNY_DISPLAY_CURRENCY, items })
  } catch (err) {
    logger.error('Failed to resolve display rates', { err })
    return NextResponse.json({ error: 'Could not load exchange rates' }, { status: 500 })
  }
}

/**
 * Every currency the organization knows, so an unparameterized request can answer for all of them.
 * `is_active` is deliberately ignored: a record denominated in a currency the operator stopped offering
 * still has to be readable in CNY.
 */
async function loadKnownCurrencyCodes(
  em: EntityManager,
  tenantId: string,
  organizationId: string,
): Promise<string[]> {
  const rows = await em.fork().getConnection().execute<Array<{ code: string }>>(
    `select distinct code from currencies
      where tenant_id = ? and organization_id = ? and deleted_at is null`,
    [tenantId, organizationId],
  )
  return rows.map((row) => String(row.code).toUpperCase())
}

const rateItemSchema = z.object({
  currencyCode: z.string(),
  rate: z.string(),
  date: z.string(),
  source: z.string(),
})
const ratesResponseSchema = z.object({
  base: z.string(),
  items: z.array(rateItemSchema),
})
const ratesErrorSchema = z.object({ error: z.string(), code: z.string().optional() }).passthrough()

export const openApi: OpenApiRouteDoc = {
  tag: 'Currency policy',
  summary: 'CNY display rates',
  methods: {
    GET: {
      summary: 'List CNY rates for display',
      description:
        'The latest stored rate per requested currency, expressed as CNY per one unit of that currency. Read-only: the fetch is the installed `currencies` module’s.',
      tags: ['Currency policy'],
      query: z.object({
        symbols: z
          .string()
          .optional()
          .describe('Comma-separated ISO codes (max 32); omitted = every currency of the organization'),
      }),
      responses: [
        { status: 200, description: 'Rates found', schema: ratesResponseSchema },
        { status: 400, description: 'Malformed symbols or no organization selected', schema: ratesErrorSchema },
        { status: 401, description: 'Not authenticated', schema: ratesErrorSchema },
        { status: 403, description: 'Missing currencies.view', schema: ratesErrorSchema },
        { status: 500, description: 'Read failed', schema: ratesErrorSchema },
      ],
    },
  },
}
