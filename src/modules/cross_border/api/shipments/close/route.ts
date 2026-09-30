import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrossBorderShipment } from '../../../data/entities'
import { shipmentCloseSchema, SHIPMENT_STATUSES } from '../../../data/validators'
import { createCrossBorderCrudOpenApi, crossBorderOkSchema } from '../../openapi'

const ENTITY_ID = 'cross_border:cross_border_shipment' as const

const closeListSchema = z.object({
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
    schema: closeListSchema,
    entityId: ENTITY_ID,
    fields: ['id', 'number', 'status', 'tenant_id', 'organization_id'],
  },
  actions: {
    create: {
      commandId: 'cross_border.shipments.close',
      schema: shipmentCloseSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => {
        const shipment = result as { status?: string }
        return { ok: true, status: shipment.status ?? 'closed' }
      },
    },
  },
})

export const openApi = createCrossBorderCrudOpenApi({
  resourceName: 'Shipment Closure',
  pluralName: 'Shipment Closures',
  querySchema: closeListSchema,
  listResponseSchema: z.object({ items: z.array(z.object({ id: z.string().uuid(), status: z.string() })) }),
  create: {
    schema: shipmentCloseSchema,
    responseSchema: crossBorderOkSchema,
    description: 'Closes a received shipment: the archival stage after its paperwork and settlement are done. Terminal — a closed shipment cannot be edited, cancelled or re-opened.',
  },
})
