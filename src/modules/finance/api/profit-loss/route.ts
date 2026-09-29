import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveRequestScope } from '../../lib/requestScope'
import { loadProfitLoss } from '../../lib/profitLoss'
import { financeTag } from '../openapi'

const logger = createLogger('finance').child({ component: 'profit-loss-route' })

export const profitLossQuerySchema = z.object({
  periodStart: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'periodStart must be an ISO date'),
  periodEnd: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'periodEnd must be an ISO date'),
  channel: z.enum(['ozon', 'yandex_market', 'kit', 'total']).optional(),
  basis: z.enum(['fact', 'forecast']).default('fact'),
})

const profitLossLineSchema = z.object({
  line: z.enum(['sales', 'coinvest', 'platformFees', 'adSpend', 'cost', 'marginalProfit', 'roi']),
  label: z.string(),
  amount: z.string().nullable(),
  percent: z.string().nullable(),
  currency: z.string().nullable(),
  source: z.enum(['ru_snapshot', 'cn_landed', 'cn_price_tier', 'cn_missing', 'not_connected']),
  caliber: z.enum(['fact', 'forecast']),
  months: z.array(z.string()),
})

const profitLossResultSchema = z.object({
  periodStart: z.string(),
  periodEnd: z.string(),
  channel: z.string(),
  basis: z.enum(['fact', 'forecast']),
  asOf: z.string().nullable(),
  rows: z.array(profitLossLineSchema),
  totalsByCurrency: z.array(z.object({ currencyCode: z.string(), amount: z.string() })),
  notes: z.array(z.string()),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['finance.profit.view'] },
}

/**
 * 月损益（ОПИУ 行项） — read-only. The RU lines come from the ads summary snapshot, the cost line
 * from the CN landed-cost resolution, and the two keep their own currencies: a combined margin would
 * need a rate and a date and is deliberately not invented here.
 */
export async function GET(request: Request) {
  const scope = await resolveRequestScope(request)
  if (!scope.ok) return scope.response

  try {
    const query = profitLossQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const result = await loadProfitLoss(
      scope.em,
      { tenantId: scope.tenantId, organizationIds: scope.organizationIds },
      { periodStart: query.periodStart, periodEnd: query.periodEnd, channel: query.channel, basis: query.basis },
    )
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid query', details: error.issues }, { status: 400 })
    }
    logger.error('Failed to derive the profit and loss ledger', { err: error })
    return NextResponse.json({ error: 'Failed to derive the profit and loss ledger' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: financeTag,
  methods: {
    GET: {
      summary: 'Derive the monthly ОПИУ lines (fact or forecast) with the CN cost line beside them',
      tags: [financeTag],
      query: profitLossQuerySchema,
      responses: [
        {
          status: 200,
          description:
            'One row per ОПИУ line, each carrying its caliber, its source and the months it was summed over; the CN cost row keeps its own currency.',
          schema: profitLossResultSchema,
        },
        { status: 400, description: 'Invalid query or unresolvable organization scope' },
        { status: 403, description: 'Missing finance.profit.view' },
      ],
    },
  },
}
