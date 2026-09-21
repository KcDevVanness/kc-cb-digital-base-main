import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { CrossBorderShipmentAllocation } from '../../../data/entities'
import { allocationListSchema } from '../../../data/validators'
import { createCrossBorderCrudOpenApi } from '../../openapi'

const ENTITY_ID = 'cross_border:cross_border_shipment_allocation' as const

const allocationItemSchema = z
  .object({
    id: z.string().uuid(),
    purchaseOrderId: z.string().uuid(),
    purchaseOrderNumber: z.string().nullable().optional(),
    purchaseOrderLineId: z.string().uuid(),
    catalogProductId: z.string().uuid(),
    productTitle: z.string().nullable().optional(),
    productSku: z.string().nullable().optional(),
    quantity: z.string(),
    receivedQuantity: z.string().nullable().optional(),
  })
  .passthrough()

type AllocationListQuery = z.infer<typeof allocationListSchema>

function snapshotValue(snapshot: unknown, key: string): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const value = (snapshot as Record<string, unknown>)[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function relationId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const id = (value as { id?: unknown }).id
  return typeof id === 'string' ? id : null
}

/**
 * Read-only: allocations are written exclusively through the shipment create/update commands,
 * which is where the over-allocation guard lives. Exposing a write path here would let a caller
 * bypass that guard.
 */
export const { metadata, GET } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['cross_border.shipments.view'] },
  },
  orm: {
    entity: CrossBorderShipmentAllocation,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: allocationListSchema,
    entityId: ENTITY_ID,
    fields: [
      'id',
      'shipment_id',
      'purchase_order_id',
      'purchase_order_line_id',
      'purchase_order_number',
      'catalog_product_id',
      'product_snapshot',
      'quantity',
      'received_quantity',
      'tenant_id',
      'organization_id',
    ],
    buildFilters: async (query: AllocationListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.shipmentId) filters.shipment_id = query.shipmentId
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      purchaseOrderId: String(item.purchase_order_id),
      purchaseOrderNumber: (item.purchase_order_number ?? null) as string | null,
      purchaseOrderLineId: String(item.purchase_order_line_id),
      catalogProductId: String(item.catalog_product_id),
      productTitle: snapshotValue(item.product_snapshot, 'title'),
      productSku: snapshotValue(item.product_snapshot, 'sku'),
      quantity: String(item.quantity ?? '0'),
      receivedQuantity: item.received_quantity === null || item.received_quantity === undefined ? null : String(item.received_quantity),
      shipmentId: relationId(item.shipment_id),
    }),
  },
})

export const openApi = createCrossBorderCrudOpenApi({
  resourceName: 'Shipment Allocation',
  pluralName: 'Shipment Allocations',
  querySchema: allocationListSchema,
  listResponseSchema: createPagedListResponseSchema(allocationItemSchema, { paginationMetaOptional: true }),
})
