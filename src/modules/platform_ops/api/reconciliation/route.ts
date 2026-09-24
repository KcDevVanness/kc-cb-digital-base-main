import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { PlatformOpsReconciliationItem } from '../../data/entities'
import {
  RECONCILIATION_KINDS,
  RECONCILIATION_STATUSES,
  reconciliationListSchema,
} from '../../data/validators'
import { createPlatformOpsCrudOpenApi } from '../openapi'

const ENTITY_ID = 'platform_ops:platform_ops_reconciliation_item' as const

const reconciliationListItemSchema = z
  .object({
    id: z.string().uuid(),
    channelId: z.string().uuid(),
    kind: z.enum(RECONCILIATION_KINDS),
    externalRef: z.string(),
    settlementId: z.string().uuid().nullable().optional(),
    orderMirrorId: z.string().uuid().nullable().optional(),
    expectedAmount: z.string().nullable().optional(),
    actualAmount: z.string().nullable().optional(),
    currencyCode: z.string().nullable().optional(),
    status: z.enum(RECONCILIATION_STATUSES),
    note: z.string().nullable().optional(),
    resolvedAt: z.string().nullable().optional(),
  })
  .passthrough()

type ReconciliationListQuery = z.infer<typeof reconciliationListSchema>

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
 * Read-only: the queue is written by the settlement import (which raises items) and by the
 * resolve/ignore commands (which close them). `status` defaults to `open` so the queue opens on
 * the work that is actually outstanding.
 */
export const { metadata, GET } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['platform_ops.reconciliation.view'] },
  },
  orm: {
    entity: PlatformOpsReconciliationItem,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: null,
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: reconciliationListSchema,
    entityId: ENTITY_ID,
    fields: [
      'id',
      'channel_id',
      'kind',
      'external_ref',
      'settlement_id',
      'order_mirror_id',
      'expected_amount',
      'actual_amount',
      'currency_code',
      'status',
      'note',
      'resolved_at',
      'resolved_by',
      'tenant_id',
      'organization_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      id: 'id',
      kind: 'kind',
      created_at: 'created_at',
      updated_at: 'updated_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: ReconciliationListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.channelId) filters.channel_id = query.channelId
      if (query.kind) filters.kind = query.kind
      if (query.status) filters.status = query.status
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      channelId: relationId(item.channel_id) ?? '',
      kind: String(item.kind ?? ''),
      externalRef: String(item.external_ref ?? ''),
      settlementId: (item.settlement_id ?? null) as string | null,
      orderMirrorId: (item.order_mirror_id ?? null) as string | null,
      expectedAmount:
        item.expected_amount === null || item.expected_amount === undefined ? null : String(item.expected_amount),
      actualAmount:
        item.actual_amount === null || item.actual_amount === undefined ? null : String(item.actual_amount),
      currencyCode: (item.currency_code ?? null) as string | null,
      status: String(item.status ?? 'open'),
      note: (item.note ?? null) as string | null,
      resolvedAt: toIsoTimestamp(item.resolved_at),
      created_at: toIsoTimestamp(item.created_at),
      updated_at: toIsoTimestamp(item.updated_at),
      updatedAt: toIsoTimestamp(item.updated_at),
    }),
  },
})

export const openApi = createPlatformOpsCrudOpenApi({
  resourceName: 'Reconciliation Item',
  pluralName: 'Reconciliation Items',
  querySchema: reconciliationListSchema,
  listResponseSchema: createPagedListResponseSchema(reconciliationListItemSchema, { paginationMetaOptional: true }),
  description:
    'One disagreement per `(channel, external ref, kind)`, awaiting an operator decision. A resolved item never reopens: a problem that comes back raises a fresh item, so the original problem and its resolution both stay in the trail.',
})
