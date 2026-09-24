import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { PurchasingPurchaseOrder } from '../../../data/entities'
import { purchaseOrderTransitionSchema, ORDER_STATUSES } from '../../../commands/orders'
import { createPurchasingCrudOpenApi, purchasingOkSchema } from '../../openapi'

const ENTITY_ID = 'purchasing:purchasing_purchase_order' as const

/**
 * Status transitions live on their own path so the command's allowed-transition table is the
 * only thing that decides what is legal. The route carries a POST action only; the list
 * surface exists because the CRUD factory always needs an ORM binding for scope resolution,
 * and it is not part of the UI contract.
 */
const transitionListSchema = z.object({
  id: z.string().uuid().optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
})

export const { metadata, GET, POST } = makeCrudRoute({
  metadata: {
    POST: { requireAuth: true, requireFeatures: ['purchasing.orders.manage'] },
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
    schema: transitionListSchema,
    entityId: ENTITY_ID,
    fields: ['id', 'number', 'status', 'tenant_id', 'organization_id'],
  },
  actions: {
    create: {
      commandId: 'purchasing.purchase-orders.transition',
      schema: purchaseOrderTransitionSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ ok: true, status: (result as { status: string }).status }),
    },
  },
})

export const openApi = createPurchasingCrudOpenApi({
  resourceName: 'Purchase Order Transition',
  pluralName: 'Purchase Order Transitions',
  querySchema: transitionListSchema,
  listResponseSchema: z.object({ items: z.array(z.object({ id: z.string().uuid(), status: z.string() })) }),
  create: {
    schema: purchaseOrderTransitionSchema,
    responseSchema: purchasingOkSchema,
    description: 'Applies one allowed status transition to a purchase order.',
  },
})
