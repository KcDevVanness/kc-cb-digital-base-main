import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { PlatformOpsSettlementLine } from '../../../data/entities'
import { settlementLineListSchema } from '../../../data/validators'
import { createPlatformOpsCrudOpenApi } from '../../openapi'

const ENTITY_ID = 'platform_ops:platform_ops_settlement_line' as const

const settlementLineItemSchema = z
  .object({
    id: z.string().uuid(),
    settlementId: z.string().uuid(),
    externalOrderId: z.string(),
    orderMirrorId: z.string().uuid().nullable().optional(),
    grossAmount: z.string(),
    feeAmount: z.string(),
    netAmount: z.string(),
  })
  .passthrough()

type SettlementLineListQuery = z.infer<typeof settlementLineListSchema>

function toIsoTimestamp(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

// The relation selects as an object through the query engine and as a bare id
// through the ORM fallback, so both shapes are accepted here.
function relationId(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return null
  const id = (value as { id?: unknown }).id
  return typeof id === 'string' ? id : null
}

/**
 * Read-only: lines are written exclusively through `platform_ops.settlements.import`,
 * which also decides whether each line matched an order mirror. `orderMirrorId` being
 * null is meaningful — it is the `missing_in_erp` evidence, not a missing projection.
 */
export const { metadata, GET } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['platform_ops.settlements.view'] },
  },
  orm: {
    entity: PlatformOpsSettlementLine,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: null,
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: settlementLineListSchema,
    entityId: ENTITY_ID,
    fields: [
      'id',
      'settlement_id',
      'external_order_id',
      'order_mirror_id',
      'gross_amount',
      'fee_amount',
      'net_amount',
      'tenant_id',
      'organization_id',
      'created_at',
    ],
    sortFieldMap: {
      id: 'id',
      created_at: 'created_at',
    },
    // Lines are shown inside one settlement's detail view, in the order the
    // statement listed them — insertion order, not the arbitrary order of UUIDs.
    defaultSort: { field: 'created_at', dir: 'asc' },
    tiebreakSortField: 'id',
    buildFilters: async (query: SettlementLineListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.settlementId) filters.settlement_id = query.settlementId
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      settlementId: relationId(item.settlement_id) ?? '',
      externalOrderId: String(item.external_order_id ?? ''),
      orderMirrorId: (item.order_mirror_id ?? null) as string | null,
      grossAmount: String(item.gross_amount ?? '0'),
      feeAmount: String(item.fee_amount ?? '0'),
      netAmount: String(item.net_amount ?? '0'),
      createdAt: toIsoTimestamp(item.created_at),
    }),
  },
})

export const openApi = createPlatformOpsCrudOpenApi({
  resourceName: 'Settlement Line',
  pluralName: 'Settlement Lines',
  querySchema: settlementLineListSchema,
  listResponseSchema: createPagedListResponseSchema(settlementLineItemSchema, { paginationMetaOptional: true }),
  description:
    'One order’s contribution to a payout. A line whose `orderMirrorId` is null never matched an order mirror — that is what raises a `missing_in_erp` reconciliation item.',
})
