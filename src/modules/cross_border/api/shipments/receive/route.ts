import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrossBorderShipment } from '../../../data/entities'
import { shipmentReceiveSchema, SHIPMENT_STATUSES } from '../../../data/validators'
import { createCrossBorderCrudOpenApi, crossBorderOkSchema } from '../../openapi'

const ENTITY_ID = 'cross_border:cross_border_shipment' as const

const receiveListSchema = z.object({
  id: z.string().uuid().optional(),
  status: z.enum(SHIPMENT_STATUSES).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
})

export const { metadata, GET, POST } = makeCrudRoute({
  metadata: {
    POST: { requireAuth: true, requireFeatures: ['cross_border.shipments.receive'] },
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
    schema: receiveListSchema,
    entityId: ENTITY_ID,
    fields: ['id', 'number', 'status', 'tenant_id', 'organization_id'],
  },
  actions: {
    create: {
      commandId: 'cross_border.shipments.receive',
      schema: shipmentReceiveSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => {
        const outcome = result as { status?: string; received?: Array<{ allocationId: string; quantity: string }> }
        return { ok: true, status: outcome.status ?? 'received', received: outcome.received ?? [] }
      },
    },
  },
})

export const openApi = createCrossBorderCrudOpenApi({
  resourceName: 'Shipment Receipt',
  pluralName: 'Shipment Receipts',
  querySchema: receiveListSchema,
  listResponseSchema: z.object({ items: z.array(z.object({ id: z.string().uuid(), status: z.string() })) }),
  create: {
    schema: shipmentReceiveSchema,
    responseSchema: crossBorderOkSchema,
    description: 'Receives an in-transit shipment: books stock in wms and raises the received quantity of each allocated purchase-order line.',
  },
})
