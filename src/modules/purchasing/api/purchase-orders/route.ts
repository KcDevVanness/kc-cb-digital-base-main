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
    businessNumber: z.string().nullable().optional(),
    productCategory: z.string().nullable().optional(),
    supplierId: z.string().uuid(),
    supplierName: z.string().nullable().optional(),
    ownerUserId: z.string().uuid().nullable().optional(),
    ownerName: z.string().nullable().optional(),
    customerId: z.string().uuid().nullable().optional(),
    customerName: z.string().nullable().optional(),
    status: z.enum(ORDER_STATUSES),
    currencyCode: z.string(),
    subtotal: z.string(),
    taxTotal: z.string(),
    total: z.string(),
    depositPercent: z.string().nullable().optional(),
    depositAmount: z.string().nullable().optional(),
    expectedShipAt: z.string().nullable().optional(),
    placedAt: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
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
  businessNumber: z.string().max(64).optional(),
  ownerUserId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
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

function snapshotNameFrom(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object' || !('name' in snapshot)) return null
  const name = snapshot.name
  return typeof name === 'string' && name.length > 0 ? name : null
}

const listFields = [
  'id',
  'number',
  'business_number',
  'product_category',
  'supplier_id',
  'supplier_snapshot',
  'owner_user_id',
  'owner_snapshot',
  'customer_id',
  'customer_snapshot',
  'status',
  'currency_code',
  'subtotal',
  'tax_total',
  'total',
  'deposit_percent',
  'deposit_amount',
  'expected_ship_at',
  'placed_at',
  'notes',
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
      if (query.ownerUserId) filters.owner_user_id = query.ownerUserId
      if (query.customerId) filters.customer_id = query.customerId
      if (query.businessNumber) {
        filters.business_number = { $ilike: `%${escapeLikePattern(query.businessNumber.trim())}%` }
      }
      if (query.search && query.search.trim().length > 0) {
        // Both numbers are plaintext columns: the operator searches with whichever one the supplier
        // quoted, so the two are OR-ed. The escape keeps a typed `%` from widening the filter.
        const term = `%${escapeLikePattern(query.search.trim())}%`
        filters.$or = [{ number: { $ilike: term } }, { business_number: { $ilike: term } }]
      }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      number: (item.number ?? null) as string | null,
      businessNumber: (item.business_number ?? null) as string | null,
      productCategory: (item.product_category ?? null) as string | null,
      supplierId: String(item.supplier_id),
      supplierName: snapshotNameFrom(item.supplier_snapshot),
      ownerUserId: (item.owner_user_id ?? null) as string | null,
      ownerName: snapshotNameFrom(item.owner_snapshot),
      customerId: (item.customer_id ?? null) as string | null,
      customerName: snapshotNameFrom(item.customer_snapshot),
      status: String(item.status ?? 'draft'),
      currencyCode: String(item.currency_code ?? 'CNY'),
      subtotal: String(item.subtotal ?? '0'),
      taxTotal: String(item.tax_total ?? '0'),
      total: String(item.total ?? '0'),
      depositPercent: (item.deposit_percent ?? null) as string | null,
      depositAmount: (item.deposit_amount ?? null) as string | null,
      expectedShipAt: toIsoTimestamp(item.expected_ship_at),
      placedAt: toIsoTimestamp(item.placed_at),
      notes: (item.notes ?? null) as string | null,
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
