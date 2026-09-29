import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveRequestScope } from '../../lib/requestScope'
import { loadSkuMargin } from '../../lib/skuMargin'
import { financeTag } from '../openapi'

const logger = createLogger('finance').child({ component: 'sku-margin-route' })

export const skuMarginQuerySchema = z.object({
  periodStart: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'periodStart must be an ISO date'),
  periodEnd: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'periodEnd must be an ISO date'),
})

const skuMarginRowSchema = z.object({
  sku: z.string(),
  quantity: z.string(),
  revenue: z.string().nullable(),
  currency: z.string(),
  platformCosts: z.string().nullable(),
  adSpend: z.string().nullable(),
  ruMarginPercent: z.string().nullable(),
  ruMarginAmount: z.string().nullable(),
  cnLandedUnitCostCny: z.string().nullable(),
  cnCostCny: z.string().nullable(),
  cnSource: z.enum(['landed', 'price_tier', 'missing']),
  cnMarginAmount: z.string().nullable(),
  cnMarginPercent: z.string().nullable(),
  rateRuPerCny: z.string().nullable(),
  rateMissing: z.boolean(),
  discrepancy: z.object({ percentPoints: z.string().nullable(), amount: z.string().nullable() }).nullable(),
  outsideTolerance: z.boolean(),
})

const skuMarginResultSchema = z.object({
  periodStart: z.string(),
  periodEnd: z.string(),
  asOf: z.string().nullable(),
  rows: z.array(skuMarginRowSchema),
  reconciliation: z.array(z.object({ sku: z.string(), reason: z.string() })),
  notes: z.array(z.string()),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['finance.profit.view'] },
}

/**
 * SKU 毛利 — the RU sales snapshot beside the CN landed cost, per SKU. Rows whose margin differs
 * from the RU page beyond the tolerance (0.2 п.п. / 20 ₽) are listed as reconciliation candidates: a
 * difference is reported, never silently corrected.
 */
export async function GET(request: Request) {
  const scope = await resolveRequestScope(request)
  if (!scope.ok) return scope.response

  try {
    const query = skuMarginQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const result = await loadSkuMargin(
      scope.em,
      { tenantId: scope.tenantId, organizationIds: scope.organizationIds },
      { periodStart: query.periodStart, periodEnd: query.periodEnd },
    )
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid query', details: error.issues }, { status: 400 })
    }
    logger.error('Failed to derive the SKU margin', { err: error })
    return NextResponse.json({ error: 'Failed to derive the SKU margin' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: financeTag,
  methods: {
    GET: {
      summary: 'Derive the per-SKU margin: the RU sales snapshot beside the CN landed cost',
      tags: [financeTag],
      query: skuMarginQuerySchema,
      responses: [
        {
          status: 200,
          description:
            'One row per SKU; the mixed-caliber margin is computed only when an FX rate exists, and rows outside the tolerance are listed in `reconciliation`.',
          schema: skuMarginResultSchema,
        },
        { status: 400, description: 'Invalid query or unresolvable organization scope' },
        { status: 403, description: 'Missing finance.profit.view' },
      ],
    },
  },
}
