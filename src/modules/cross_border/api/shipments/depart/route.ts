import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrossBorderShipment } from '../../../data/entities'
import { shipmentDepartSchema, SHIPMENT_STATUSES } from '../../../data/validators'
import { createCrossBorderCrudOpenApi, crossBorderOkSchema } from '../../openapi'

const ENTITY_ID = 'cross_border:cross_border_shipment' as const

/**
 * Departure gets its own path so the operation is one command with one meaning. The list surface
 * exists only because the CRUD factory needs an ORM binding for scope resolution; it is not part
 * of the UI contract.
 */
const departListSchema = z.object({
  id: z.string().uuid().optional(),
  status: z.enum(SHIPMENT_STATUSES).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
})

export const { metadata, GET, POST } = makeCrudRoute({
  metadata: {
    POST: { requireAuth: true, requireFeatures: ['cross_border.shipments.manage'] },
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
    schema: departListSchema,
    entityId: ENTITY_ID,
    fields: ['id', 'number', 'status', 'tenant_id', 'organization_id'],
  },
  actions: {
    create: {
      commandId: 'cross_border.shipments.depart',
      schema: shipmentDepartSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => {
        const shipment = result as { status?: string; number?: string | null }
        return { ok: true, status: shipment.status ?? 'in_transit', number: shipment.number ?? null }
      },
    },
  },
})

export const openApi = createCrossBorderCrudOpenApi({
  resourceName: 'Shipment Departure',
  pluralName: 'Shipment Departures',
  querySchema: departListSchema,
  listResponseSchema: z.object({ items: z.array(z.object({ id: z.string().uuid(), status: z.string() })) }),
  create: {
    schema: shipmentDepartSchema,
    responseSchema: crossBorderOkSchema,
    description: 'Departs a draft shipment: assigns its number, records the first milestone and advances allocated purchase orders to shipped.',
  },
})
