import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { CrossBorderShipment } from '../../data/entities'
import { shipmentCreateSchema, shipmentListSchema, shipmentUpdateSchema, SHIPMENT_STATUSES, SHIPMENT_MILESTONES } from '../../data/validators'
import { createCrossBorderCrudOpenApi, crossBorderCreatedSchema, crossBorderOkSchema } from '../openapi'

const ENTITY_ID = 'cross_border:cross_border_shipment' as const

const shipmentListItemSchema = z
  .object({
    id: z.string().uuid(),
    number: z.string().nullable().optional(),
    status: z.enum(SHIPMENT_STATUSES),
    carrierName: z.string().nullable().optional(),
    departurePort: z.string().nullable().optional(),
    currentMilestone: z.enum(SHIPMENT_MILESTONES).nullable().optional(),
    etd: z.string().nullable().optional(),
    eta: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
  })
  .passthrough()

type ShipmentListQuery = z.infer<typeof shipmentListSchema>

function toIsoTimestamp(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

const listFields = [
  'id',
  'number',
  'status',
  'carrier_name',
  'departure_port',
  'destination_warehouse_id',
  'destination_location_id',
  'current_milestone',
  'etd',
  'eta',
  'tenant_id',
  'organization_id',
  'created_at',
  'updated_at',
]

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['cross_border.shipments.view'] },
    POST: { requireAuth: true, requireFeatures: ['cross_border.shipments.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['cross_border.shipments.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['cross_border.shipments.manage'] },
  },
  orm: {
    entity: CrossBorderShipment,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: shipmentListSchema,
    entityId: ENTITY_ID,
    fields: listFields,
    sortFieldMap: {
      id: 'id',
      number: 'number',
      status: 'status',
      eta: 'eta',
      created_at: 'created_at',
      updated_at: 'updated_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: ShipmentListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.status) filters.status = query.status
      if (query.search && query.search.trim().length > 0) {
        // `number` and `carrier_name` are plaintext; the escape keeps a typed `%` literal.
        const term = `%${escapeLikePattern(query.search.trim())}%`
        filters.$or = [{ number: { $ilike: term } }, { carrier_name: { $ilike: term } }]
      }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      number: (item.number ?? null) as string | null,
      status: String(item.status ?? 'draft'),
      carrierName: (item.carrier_name ?? null) as string | null,
      departurePort: (item.departure_port ?? null) as string | null,
      // Projected so the receive dialog can default the destination the logistics team
      // already chose when the shipment was created.
      destinationWarehouseId: (item.destination_warehouse_id ?? null) as string | null,
      destinationLocationId: (item.destination_location_id ?? null) as string | null,
      currentMilestone: (item.current_milestone ?? null) as string | null,
      etd: toIsoTimestamp(item.etd),
      eta: toIsoTimestamp(item.eta),
      created_at: toIsoTimestamp(item.created_at),
      updated_at: toIsoTimestamp(item.updated_at),
      updatedAt: toIsoTimestamp(item.updated_at),
    }),
  },
  actions: {
    create: {
      commandId: 'cross_border.shipments.create',
      schema: shipmentCreateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { id: string }).id) }),
      status: 201,
    },
    update: {
      commandId: 'cross_border.shipments.update',
      schema: shipmentUpdateSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'cross_border.shipments.delete',
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createCrossBorderCrudOpenApi({
  resourceName: 'Shipment',
  pluralName: 'Shipments',
  querySchema: shipmentListSchema,
  listResponseSchema: createPagedListResponseSchema(shipmentListItemSchema, { paginationMetaOptional: true }),
  create: {
    schema: shipmentCreateSchema,
    responseSchema: crossBorderCreatedSchema,
    description: 'Creates a draft shipment with its purchase-order allocations.',
  },
  update: {
    schema: shipmentUpdateSchema,
    responseSchema: crossBorderOkSchema,
    description: 'Updates a draft shipment; requires the expected version for optimistic locking.',
  },
  del: {
    responseSchema: crossBorderOkSchema,
    description: 'Soft-deletes a draft or cancelled shipment.',
  },
})
