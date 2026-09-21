import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { PlatformOpsSettlement } from '../../data/entities'
import { settlementListSchema } from '../../data/validators'
import { createPlatformOpsCrudOpenApi } from '../openapi'

const ENTITY_ID = 'platform_ops:platform_ops_settlement' as const

const settlementListItemSchema = z
  .object({
    id: z.string().uuid(),
    channelId: z.string().uuid(),
    externalSettlementId: z.string(),
    periodStart: z.string().nullable().optional(),
    periodEnd: z.string().nullable().optional(),
    currencyCode: z.string(),
    grossAmount: z.string(),
    feeAmount: z.string(),
    netAmount: z.string(),
    status: z.string(),
    receivedAt: z.string().nullable().optional(),
  })
  .passthrough()

type SettlementListQuery = z.infer<typeof settlementListSchema>

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
 * Read-only: settlements are written exclusively through
 * `platform_ops.settlements.import`, which owns the idempotent upsert and the
 * comparison pass. `raw` is not selected — it is the payload as received, kept as
 * evidence for reconciliation, never rendered in a list.
 */
export const { metadata, GET } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['platform_ops.settlements.view'] },
  },
  orm: {
    entity: PlatformOpsSettlement,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: null,
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: settlementListSchema,
    entityId: ENTITY_ID,
    fields: [
      'id',
      'channel_id',
      'external_settlement_id',
      'period_start',
      'period_end',
      'currency_code',
      'gross_amount',
      'fee_amount',
      'net_amount',
      'status',
      'received_at',
      'tenant_id',
      'organization_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      id: 'id',
      period_end: 'period_end',
      created_at: 'created_at',
      updated_at: 'updated_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: SettlementListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.channelId) filters.channel_id = query.channelId
      if (query.status) filters.status = query.status
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      channelId: relationId(item.channel_id) ?? '',
      externalSettlementId: String(item.external_settlement_id ?? ''),
      periodStart: toIsoTimestamp(item.period_start),
      periodEnd: toIsoTimestamp(item.period_end),
      currencyCode: String(item.currency_code ?? 'USD'),
      grossAmount: String(item.gross_amount ?? '0'),
      feeAmount: String(item.fee_amount ?? '0'),
      netAmount: String(item.net_amount ?? '0'),
      status: String(item.status ?? 'imported'),
      receivedAt: toIsoTimestamp(item.received_at),
      created_at: toIsoTimestamp(item.created_at),
      updated_at: toIsoTimestamp(item.updated_at),
      updatedAt: toIsoTimestamp(item.updated_at),
    }),
  },
})

export const openApi = createPlatformOpsCrudOpenApi({
  resourceName: 'Settlement',
  pluralName: 'Settlements',
  querySchema: settlementListSchema,
  listResponseSchema: createPagedListResponseSchema(settlementListItemSchema, { paginationMetaOptional: true }),
  description:
    'The platform’s payout statements. `imported` until the settlement has been reconciled; amounts are what the platform paid out, not a recomputation of our books.',
})
