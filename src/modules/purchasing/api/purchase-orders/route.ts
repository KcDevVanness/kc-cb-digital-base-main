import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { PurchasingPurchaseOrder } from '../../data/entities'
import { purchaseOrderCreateSchema, purchaseOrderUpdateSchema, ORDER_STATUSES } from '../../commands/orders'
import { createPurchasingCrudOpenApi, purchasingCreatedSchema, purchasingOkSchema } from '../openapi'

const ENTITY_ID = 'purchasing:purchasing_purchase_order' as const

const purchaseOrderListItemSchema = z
  .object({
    id: z.string().uuid(),
    number: z.string().nullable().optional(),
    supplierId: z.string().uuid(),
    supplierName: z.string().nullable().optional(),
    status: z.enum(ORDER_STATUSES),
    currencyCode: z.string(),
    subtotal: z.string(),
    taxTotal: z.string(),
    total: z.string(),
    expectedShipAt: z.string().nullable().optional(),
    placedAt: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
  })
  .passthrough()

export const purchaseOrderListSchema = z.object({
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  search: z.string().max(200).optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  supplierId: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  sortField: z.enum(['id', 'number', 'status', 'total', 'created_at', 'updated_at']).optional().default('created_at'),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
})

type PurchaseOrderListQuery = z.infer<typeof purchaseOrderListSchema>

function toIsoTimestamp(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

function supplierNameFrom(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const name = (snapshot as { name?: unknown }).name
  return typeof name === 'string' && name.length > 0 ? name : null
}

const listFields = [
  'id',
  'number',
  'supplier_id',
  'supplier_snapshot',
  'status',
  'currency_code',
  'subtotal',
  'tax_total',
  'total',
  'expected_ship_at',
  'placed_at',
  'tenant_id',
  'organization_id',
  'created_at',
  'updated_at',
]

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['purchasing.orders.view'] },
    POST: { requireAuth: true, requireFeatures: ['purchasing.orders.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['purchasing.orders.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['purchasing.orders.manage'] },
  },
  orm: {
    entity: PurchasingPurchaseOrder,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: purchaseOrderListSchema,
    entityId: ENTITY_ID,
    fields: listFields,
    sortFieldMap: {
      id: 'id',
      number: 'number',
      status: 'status',
      total: 'total',
      created_at: 'created_at',
      updated_at: 'updated_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: PurchaseOrderListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.status) filters.status = query.status
      if (query.supplierId) filters.supplier_id = query.supplierId
      if (query.search && query.search.trim().length > 0) {
        // `number` is a plaintext column; the escape keeps a typed `%` from widening the filter.
        filters.number = { $ilike: `%${escapeLikePattern(query.search.trim())}%` }
      }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      number: (item.number ?? null) as string | null,
      supplierId: String(item.supplier_id),
      supplierName: supplierNameFrom(item.supplier_snapshot),
      status: String(item.status ?? 'draft'),
      currencyCode: String(item.currency_code ?? 'CNY'),
      subtotal: String(item.subtotal ?? '0'),
      taxTotal: String(item.tax_total ?? '0'),
      total: String(item.total ?? '0'),
      expectedShipAt: toIsoTimestamp(item.expected_ship_at),
      placedAt: toIsoTimestamp(item.placed_at),
      created_at: toIsoTimestamp(item.created_at),
      updated_at: toIsoTimestamp(item.updated_at),
      updatedAt: toIsoTimestamp(item.updated_at),
    }),
  },
  actions: {
    create: {
      commandId: 'purchasing.purchase-orders.create',
      schema: purchaseOrderCreateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { id: string }).id) }),
      status: 201,
    },
    update: {
      commandId: 'purchasing.purchase-orders.update',
      schema: purchaseOrderUpdateSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'purchasing.purchase-orders.delete',
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createPurchasingCrudOpenApi({
  resourceName: 'Purchase Order',
  pluralName: 'Purchase Orders',
  querySchema: purchaseOrderListSchema,
  listResponseSchema: createPagedListResponseSchema(purchaseOrderListItemSchema, { paginationMetaOptional: true }),
  create: {
    schema: purchaseOrderCreateSchema,
    responseSchema: purchasingCreatedSchema,
    description: 'Creates a draft purchase order with its lines in the caller’s organization.',
  },
  update: {
    schema: purchaseOrderUpdateSchema,
    responseSchema: purchasingOkSchema,
    description: 'Updates a draft purchase order; requires the expected version for optimistic locking.',
  },
  del: {
    responseSchema: purchasingOkSchema,
    description: 'Soft-deletes a draft or cancelled purchase order.',
  },
})
