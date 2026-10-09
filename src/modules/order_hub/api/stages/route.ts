import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { loadCompanyOrderSummaries, type CompanyOrderStageSummary } from '../../lib/orderStages'
import { resolveOrderHubRequestScope } from '../../lib/requestScope'

/**
 * The workbench's one read: the fill progress of the company orders it is about to list.
 *
 * The `ids` are **company order ids** (the URL and the response field names are unchanged; the
 * additive `counterparty`/`childNumbers`/`kinds` fields carry the link facts). Batched on purpose —
 * the workbench lists up to a few hundred rows and a per-row projection would turn one screen into
 * hundreds of round trips. Ids the caller may not see simply produce no entry (the projection is
 * scoped), so the response never confirms that a foreign id exists.
 */

const logger = createLogger('order_hub').child({ component: 'stages-route' })

/** One request serves one screen; beyond this the caller should narrow its list first. */
const MAX_IDS = 200

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['order_hub.view'] },
}

const stagesQuerySchema = z.object({
  ids: z.string().min(1),
})

const stageItemSchema = z.object({
  id: z.string().uuid(),
  source: z.enum(['sales_order', 'purchase_order']),
  procurementCount: z.number().int().nonnegative(),
  shipmentCount: z.number().int().nonnegative(),
  documentCount: z.number().int().nonnegative(),
  collected: z.boolean(),
  refunded: z.boolean(),
  counterparty: z.string().nullable().optional(),
  childNumbers: z.array(z.string()).optional(),
  kinds: z.array(z.string()).optional(),
})

const stagesResponseSchema = z.object({ items: z.array(stageItemSchema) })

export async function GET(request: Request) {
  const scope = await resolveOrderHubRequestScope(request)
  if (!scope.ok) return scope.response

  const url = new URL(request.url)
  const parsed = stagesQuerySchema.safeParse({ ids: url.searchParams.get('ids') ?? '' })
  if (!parsed.success) {
    return NextResponse.json({ error: 'The ids parameter is required' }, { status: 400 })
  }

  const ids = parsed.data.ids
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
  if (ids.length === 0) {
    return NextResponse.json({ error: 'The ids parameter is required' }, { status: 400 })
  }
  if (ids.length > MAX_IDS) {
    return NextResponse.json(
      { error: `At most ${MAX_IDS} ids per request — narrow the list before asking for stages` },
      { status: 400 },
    )
  }
  const invalid = ids.filter((id) => !z.string().uuid().safeParse(id).success)
  if (invalid.length > 0) {
    return NextResponse.json({ error: 'Every id must be a uuid' }, { status: 400 })
  }

  try {
    const items: CompanyOrderStageSummary[] = await loadCompanyOrderSummaries(
      scope.em,
      { tenantId: scope.tenantId, organizationIds: scope.organizationIds },
      ids,
    )
    return NextResponse.json({ items })
  } catch (error) {
    logger.error('Failed to project the company order stages', { err: error })
    return NextResponse.json({ error: 'Failed to project the company order stages' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Order Hub',
  summary: 'Company order fill progress',
  methods: {
    GET: {
      summary: 'Project the fill progress of a batch of company orders',
      description:
        'Returns one entry per company order the caller may see, for the requested company order ids (at most 200, comma-separated). Ids outside the caller’s organization produce no entry. Each count is the union of the company order’s linked children.',
      query: stagesQuerySchema,
      responses: [
        { status: 200, description: 'One entry per visible company order', schema: stagesResponseSchema },
        { status: 400, description: 'Missing, malformed or too many ids' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing order_hub.view' },
      ],
    },
  },
}
