import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { PurchasingPurchaseOrderLine } from '../../../data/entities'
import { createPurchasingCrudOpenApi } from '../../openapi'

const ENTITY_ID = 'purchasing:purchasing_purchase_order_line' as const

const orderLineItemSchema = z
  .object({
    id: z.string().uuid(),
    orderId: z.string().uuid(),
    lineNumber: z.number(),
    productId: z.string().uuid().nullable().optional(),
    catalogProductId: z.string().uuid().nullable().optional(),
    /** The supplier product library row the line was ordered from, when it came from one. */
    supplierProductId: z.string().uuid().nullable().optional(),
    productTitle: z.string().nullable().optional(),
    productSku: z.string().nullable().optional(),
    productUnit: z.string().nullable().optional(),
    /** The supplier's own item number, frozen in the snapshot; null on master-only lines. */
    supplierSku: z.string().nullable().optional(),
    quantity: z.string(),
    receivedQuantity: z.string(),
    unitPrice: z.string(),
    taxRate: z.string(),
    priceIncludesTax: z.boolean(),
    netTotal: z.string(),
    taxAmount: z.string(),
    lineTotal: z.string(),
    note: z.string().nullable().optional(),
  })
  .passthrough()

const orderLineListSchema = z.object({
  id: z.string().uuid().optional(),
  orderId: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(100),
  sortField: z.enum(['id', 'line_number']).optional().default('line_number'),
  sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
})

type OrderLineListQuery = z.infer<typeof orderLineListSchema>

function snapshotValue(snapshot: unknown, key: string): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const value = (snapshot as Record<string, unknown>)[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function orderIdFrom(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const id = (value as { id?: unknown }).id
  return typeof id === 'string' ? id : null
}

/**
 * Read-only line surface for the order detail page. Lines are written exclusively through the
 * order commands (create/update), which is why this route exposes no POST/PUT/DELETE: the
 * order is the aggregate root, and its totals are computed from these rows in the same
 * transaction that rewrites them.
 */
export const { metadata, GET } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['purchasing.orders.view'] },
  },
  orm: {
    entity: PurchasingPurchaseOrderLine,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: orderLineListSchema,
    entityId: ENTITY_ID,
    fields: [
      'id',
      'order_id',
      'line_number',
      'product_id',
      'supplier_product_id',
      'catalog_product_id',
      'product_snapshot',
      'quantity',
      'received_quantity',
      'unit_price',
      'tax_rate',
      'price_includes_tax',
      'net_total',
      'tax_amount',
      'line_total',
      'note',
      'tenant_id',
      'organization_id',
    ],
    sortFieldMap: { id: 'id', line_number: 'line_number', lineNumber: 'line_number' },
    buildFilters: async (query: OrderLineListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.orderId) filters.order_id = query.orderId
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      orderId: orderIdFrom(item.order_id) ?? String(item.order_id ?? ''),
      lineNumber: Number(item.line_number ?? 0),
      // New lines carry `productId`; rows written before the switch carry the catalog reference.
      productId: (item.product_id ?? null) as string | null,
      catalogProductId: (item.catalog_product_id ?? null) as string | null,
      // The library row is the supplier-facing identity of the line; both it and the frozen
      // supplier code are additive keys, so a master-only line just reads null.
      supplierProductId: (item.supplier_product_id ?? null) as string | null,
      productTitle: snapshotValue(item.product_snapshot, 'title'),
      productSku: snapshotValue(item.product_snapshot, 'sku'),
      productUnit: snapshotValue(item.product_snapshot, 'unit'),
      supplierSku: snapshotValue(item.product_snapshot, 'supplierSku'),
      quantity: String(item.quantity ?? '0'),
      receivedQuantity: String(item.received_quantity ?? '0'),
      unitPrice: String(item.unit_price ?? '0'),
      taxRate: String(item.tax_rate ?? '0'),
      priceIncludesTax: item.price_includes_tax === true,
      netTotal: String(item.net_total ?? '0'),
      taxAmount: String(item.tax_amount ?? '0'),
      lineTotal: String(item.line_total ?? '0'),
      note: (item.note ?? null) as string | null,
    }),
  },
})

export const openApi = createPurchasingCrudOpenApi({
  resourceName: 'Purchase Order Line',
  pluralName: 'Purchase Order Lines',
  querySchema: orderLineListSchema,
  listResponseSchema: createPagedListResponseSchema(orderLineItemSchema, { paginationMetaOptional: true }),
})
