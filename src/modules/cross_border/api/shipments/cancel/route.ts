import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrossBorderShipment } from '../../../data/entities'
import { shipmentCancelSchema, SHIPMENT_STATUSES } from '../../../data/validators'
import { createCrossBorderCrudOpenApi, crossBorderOkSchema } from '../../openapi'

const ENTITY_ID = 'cross_border:cross_border_shipment' as const

const cancelListSchema = z.object({
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
    schema: cancelListSchema,
    entityId: ENTITY_ID,
    fields: ['id', 'number', 'status', 'tenant_id', 'organization_id'],
  },
  actions: {
    create: {
      commandId: 'cross_border.shipments.cancel',
      schema: shipmentCancelSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ ok: true, status: (result as { status?: string }).status ?? 'cancelled' }),
    },
  },
})

export const openApi = createCrossBorderCrudOpenApi({
  resourceName: 'Shipment Cancellation',
  pluralName: 'Shipment Cancellations',
  querySchema: cancelListSchema,
  listResponseSchema: z.object({ items: z.array(z.object({ id: z.string().uuid(), status: z.string() })) }),
  create: {
    schema: shipmentCancelSchema,
    responseSchema: crossBorderOkSchema,
    description: 'Cancels a draft or in-transit shipment; a reason is required. Cancelled shipments release their allocations.',
  },
})
