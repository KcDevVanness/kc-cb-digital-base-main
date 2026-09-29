import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { TradeDocsContractOrder } from '../../../data/entities'
import { CONTRACT_ORDER_KINDS, contractOrderListSchema, contractOrdersReplaceSchema } from '../../../data/validators'
import { createTradeDocsCrudOpenApi, tradeDocsOkSchema } from '../../openapi'

const ENTITY_ID = 'trade_docs:trade_docs_contract_order' as const

const contractOrderItemSchema = z
  .object({
    id: z.string().uuid(),
    contractId: z.string().uuid(),
    orderKind: z.enum(CONTRACT_ORDER_KINDS),
    orderId: z.string().uuid(),
    orderNumber: z.string().nullable().optional(),
    counterpartyName: z.string().nullable().optional(),
    orderedAt: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
  })
  .passthrough()

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value)
  return text.length > 0 ? text : null
}

function asIso(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

function snapshotField(snapshot: unknown, key: string): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const value = (snapshot as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/**
 * The contract ↔ order links.
 *
 * Read and write live together because they are one aggregate: `GET` answers the contract detail
 * hub and the "which contract covers this order" compatibility read, and the **replace** action is
 * the single writer (`trade_docs.contracts.orders.replace`) — a `POST` on this path, not a
 * per-row CRUD update, because the dialog edits the set as a whole and the command owns the
 * uniqueness, scope and optimistic-lock rules.
 */
export const { metadata, GET, POST } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['trade_docs.contracts.view'] },
    POST: { requireAuth: true, requireFeatures: ['trade_docs.contracts.manage'] },
  },
  orm: {
    entity: TradeDocsContractOrder,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
  },
  list: {
    schema: contractOrderListSchema,
    entityId: ENTITY_ID,
    fields: [
      'id',
      'contract_id',
      'order_kind',
      'order_id',
      'order_number',
      'order_snapshot',
      'created_at',
      'tenant_id',
      'organization_id',
    ],
    defaultSort: { field: 'created_at', dir: 'asc' },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.contractId) filters.contract_id = query.contractId
      if (query.orderKind) filters.order_kind = query.orderKind
      if (query.orderId) filters.order_id = query.orderId
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      contractId: asNullableString(item.contract_id),
      orderKind: String(item.order_kind),
      orderId: String(item.order_id),
      orderNumber: asNullableString(item.order_number) ?? snapshotField(item.order_snapshot, 'number'),
      counterpartyName: snapshotField(item.order_snapshot, 'counterpartyName'),
      orderedAt: snapshotField(item.order_snapshot, 'orderedAt'),
      status: snapshotField(item.order_snapshot, 'status'),
      created_at: asIso(item.created_at),
    }),
  },
  actions: {
    create: {
      commandId: 'trade_docs.contracts.orders.replace',
      schema: contractOrdersReplaceSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({
        ok: true,
        contractId: (result as { contractId: string }).contractId,
        count: (result as { count: number }).count,
      }),
    },
  },
})

export const openApi = createTradeDocsCrudOpenApi({
  resourceName: 'Contract Order',
  pluralName: 'Contract Orders',
  querySchema: contractOrderListSchema,
  listResponseSchema: createPagedListResponseSchema(contractOrderItemSchema),
  create: {
    schema: contractOrdersReplaceSchema,
    responseSchema: tradeDocsOkSchema,
    description:
      'Replaces the orders a contract covers (purchase orders and sales orders), freezing each order\'s number, counterparty and date snapshot.',
  },
})
