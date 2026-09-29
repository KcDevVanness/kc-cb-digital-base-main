import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { CrossBorderShipmentSalesAllocation } from '../../../data/entities'
import { salesAllocationListSchema } from '../../../data/validators'
import { createCrossBorderCrudOpenApi } from '../../openapi'

const ENTITY_ID = 'cross_border:cross_border_shipment_sales_allocation' as const

const salesAllocationItemSchema = z
  .object({
    id: z.string().uuid(),
    salesOrderId: z.string().uuid(),
    salesOrderNumber: z.string().nullable().optional(),
    salesOrderLineId: z.string().uuid(),
    catalogProductId: z.string().uuid(),
    productTitle: z.string().nullable().optional(),
    productSku: z.string().nullable().optional(),
    quantity: z.string(),
    unitPrice: z.string().nullable().optional(),
    currencyCode: z.string().nullable().optional(),
  })
  .passthrough()

type SalesAllocationListQuery = z.infer<typeof salesAllocationListSchema>

function snapshotValue(snapshot: unknown, key: string): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const value = (snapshot as Record<string, unknown>)[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * The projection may hand the FK either as the related object or as the raw uuid column
 * (`shipment_id`) depending on how the query engine flattens the relation — both mean the same id.
 */
function relationId(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value
  if (!value || typeof value !== 'object') return null
  const id = (value as { id?: unknown }).id
  return typeof id === 'string' ? id : null
}

/**
 * Read-only: the sales allocations are written exclusively through the shipment create/update
 * commands, which is where the line/scope validation lives. Exposing a write path here would let a
 * caller allocate against a line the shipment command would refuse.
 */
export const { metadata, GET } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['cross_border.shipments.view'] },
  },
  orm: {
    entity: CrossBorderShipmentSalesAllocation,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: salesAllocationListSchema,
    entityId: ENTITY_ID,
    fields: [
      'id',
      'shipment_id',
      'sales_order_id',
      'sales_order_line_id',
      'sales_order_number',
      'catalog_product_id',
      'product_snapshot',
      'quantity',
      'unit_price',
      'currency_code',
      'tenant_id',
      'organization_id',
    ],
    buildFilters: async (query: SalesAllocationListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.shipmentId) filters.shipment_id = query.shipmentId
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      salesOrderId: String(item.sales_order_id),
      salesOrderNumber: (item.sales_order_number ?? null) as string | null,
      salesOrderLineId: String(item.sales_order_line_id),
      catalogProductId: String(item.catalog_product_id),
      productTitle: snapshotValue(item.product_snapshot, 'title') ?? snapshotValue(item.product_snapshot, 'name'),
      productSku: snapshotValue(item.product_snapshot, 'sku'),
      quantity: String(item.quantity ?? '0'),
      unitPrice: item.unit_price === null || item.unit_price === undefined ? null : String(item.unit_price),
      currencyCode: (item.currency_code ?? null) as string | null,
      shipmentId: relationId(item.shipment_id),
    }),
  },
})

export const openApi = createCrossBorderCrudOpenApi({
  resourceName: 'Shipment Sales Allocation',
  pluralName: 'Shipment Sales Allocations',
  querySchema: salesAllocationListSchema,
  listResponseSchema: createPagedListResponseSchema(salesAllocationItemSchema, { paginationMetaOptional: true }),
})
