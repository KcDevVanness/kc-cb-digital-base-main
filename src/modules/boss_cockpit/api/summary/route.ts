import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveRequestScope } from '../../../ru_sync/lib/requestScope'
import { loadCockpitSummary } from '../../lib/summary'

const logger = createLogger('boss_cockpit').child({ component: 'summary-route' })

const moneySchema = z.object({ currencyCode: z.string(), amount: z.string() })

const groupSchema = <T extends z.ZodTypeAny>(values: T) =>
  z.object({ asOf: z.string().nullable(), dataMissing: z.boolean(), values })

export const summaryQuerySchema = z.object({
  asOf: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'asOf must be an ISO date')
    .optional(),
})

const summarySchema = z.object({
  asOf: z.string().nullable(),
  suppliers: z.array(z.string()),
  stale: z.boolean(),
  staleAfterHours: z.number(),
  supply: z.object({
    gap: groupSchema(z.array(moneySchema)),
    inTransitAmount: groupSchema(z.array(moneySchema)),
    inTransitQuantity: groupSchema(z.string().nullable()),
    overstock: groupSchema(z.array(moneySchema)),
    unrecognizedInbound: groupSchema(z.object({ rows: z.number(), quantity: z.string() })),
    planSkus: groupSchema(z.number()),
  }),
  cash: z
    .object({
      payablesOutstanding: z.array(moneySchema),
      receivablesOutstanding: z.array(moneySchema),
      inventoryValue: z.string(),
      inventoryValueAsOf: z.string(),
      inventoryUnpriced: z.string(),
    })
    .nullable(),
  sku: z.object({
    mapped: z.number(),
    unmapped: z.number(),
    ignored: z.number(),
    total: z.number(),
    coveragePercent: z.number().nullable(),
  }),
  profitLoss: z.object({ status: z.literal('not_connected'), note: z.string() }),
  sources: z.array(
    z.object({ key: z.string(), label: z.string(), asOf: z.string().nullable(), status: z.string() }),
  ),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['boss_cockpit.view'] },
}

/**
 * The cockpit's one read: the RU supply numbers and the CN cash numbers, each with the snapshot date
 * it came from. No writes, no caching of its own — a cached cockpit is a cockpit that lies about
 * `asOf`.
 */
export async function GET(request: Request) {
  const scope = await resolveRequestScope(request)
  if (!scope.ok) return scope.response

  try {
    summaryQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const summary = await loadCockpitSummary(scope.em, {
      tenantId: scope.tenantId,
      organizationIds: scope.organizationIds,
    })
    return NextResponse.json(summary)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid query', details: error.issues }, { status: 400 })
    }
    logger.error('Failed to assemble the cockpit summary', { err: error })
    return NextResponse.json({ error: 'Failed to assemble the cockpit summary' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Boss Cockpit',
  methods: {
    GET: {
      summary: 'Assemble the boss cockpit summary (RU supply numbers and CN cash numbers)',
      tags: ['Boss Cockpit'],
      query: summaryQuerySchema,
      responses: [
        {
          status: 200,
          description:
            'Every figure carries the snapshot date it came from; money stays per currency and a missing input is reported as missing, never as zero.',
          schema: summarySchema,
        },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing boss_cockpit.view' },
      ],
    },
  },
}
