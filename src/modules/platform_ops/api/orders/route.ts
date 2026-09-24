import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { PlatformOpsOrderMirror } from '../../data/entities'
import { orderListSchema } from '../../data/validators'
import { createPlatformOpsCrudOpenApi } from '../openapi'

const ENTITY_ID = 'platform_ops:platform_ops_order_mirror' as const

const orderListItemSchema = z
  .object({
    id: z.string().uuid(),
    channelId: z.string().uuid(),
    externalOrderId: z.string(),
    status: z.string().nullable().optional(),
    currencyCode: z.string(),
    grossAmount: z.string(),
    feeAmount: z.string(),
    netAmount: z.string(),
    placedAt: z.string().nullable().optional(),
    shipmentNumber: z.string().nullable().optional(),
    syncedAt: z.string().nullable().optional(),
  })
  .passthrough()

type OrderListQuery = z.infer<typeof orderListSchema>

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
 * Read-only: mirrors are written exclusively through `platform_ops.orders.ingest`,
 * which owns the idempotent upsert. A write path here would let a caller overwrite
 * the platform's own numbers, which are the evidence reconciliation compares against.
 *
 * `raw` is deliberately not selected — it is the payload as received, kept as
 * evidence, and never rendered in a list.
 */
export const { metadata, GET } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['platform_ops.channels.view'] },
  },
  orm: {
    entity: PlatformOpsOrderMirror,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: null,
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: orderListSchema,
    entityId: ENTITY_ID,
    fields: [
      'id',
      'channel_id',
      'external_order_id',
      'status',
      'currency_code',
      'gross_amount',
      'fee_amount',
      'net_amount',
      'placed_at',
      'shipment_id',
      'shipment_number',
      'synced_at',
      'tenant_id',
      'organization_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      id: 'id',
      external_order_id: 'external_order_id',
      placed_at: 'placed_at',
      created_at: 'created_at',
      updated_at: 'updated_at',
      synced_at: 'synced_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: OrderListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.channelId) filters.channel_id = query.channelId
      if (query.status) filters.status = query.status
      if (query.search && query.search.trim().length > 0) {
        // Both columns are plaintext; the escape keeps a typed `%` from widening the filter.
        const term = `%${escapeLikePattern(query.search.trim())}%`
        filters.$or = [{ external_order_id: { $ilike: term } }, { shipment_number: { $ilike: term } }]
      }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      channelId: relationId(item.channel_id) ?? '',
      externalOrderId: String(item.external_order_id ?? ''),
      status: (item.status ?? null) as string | null,
      currencyCode: String(item.currency_code ?? 'USD'),
      grossAmount: String(item.gross_amount ?? '0'),
      feeAmount: String(item.fee_amount ?? '0'),
      netAmount: String(item.net_amount ?? '0'),
      placedAt: toIsoTimestamp(item.placed_at),
      shipmentNumber: (item.shipment_number ?? null) as string | null,
      syncedAt: toIsoTimestamp(item.synced_at),
      created_at: toIsoTimestamp(item.created_at),
      updated_at: toIsoTimestamp(item.updated_at),
      updatedAt: toIsoTimestamp(item.updated_at),
    }),
  },
})

export const openApi = createPlatformOpsCrudOpenApi({
  resourceName: 'Order Mirror',
  pluralName: 'Order Mirrors',
  querySchema: orderListSchema,
  listResponseSchema: createPagedListResponseSchema(orderListItemSchema, { paginationMetaOptional: true }),
  description:
    'The platform’s own view of its orders, stored verbatim. Amounts and status are reported, not recomputed, so a mismatch stays visible to reconciliation.',
})
