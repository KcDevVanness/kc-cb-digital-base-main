import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { PurchasingPurchasePayment } from '../../../data/entities'
import { purchasePaymentAttachSchema, purchasePaymentCreateSchema } from '../../../commands/orders'
import { createPurchasingCrudOpenApi, purchasingCreatedSchema, purchasingOkSchema } from '../../openapi'

const ENTITY_ID = 'purchasing:purchasing_purchase_payment' as const

const paymentListItemSchema = z
  .object({
    id: z.string().uuid(),
    orderId: z.string().uuid(),
    stage: z.enum(['deposit', 'balance', 'other']),
    amount: z.string(),
    currencyCode: z.string(),
    paidAt: z.string().nullable().optional(),
    reference: z.string().nullable().optional(),
    methodNote: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
  })
  .passthrough()

const paymentListSchema = z.object({
  id: z.string().uuid().optional(),
  orderId: z.string().uuid().optional(),
  stage: z.enum(['deposit', 'balance', 'other']).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  sortField: z.enum(['id', 'paid_at', 'created_at']).optional().default('paid_at'),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
})

type PaymentListQuery = z.infer<typeof paymentListSchema>

function toIsoTimestamp(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

function orderIdFrom(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const id = (value as { id?: unknown }).id
  return typeof id === 'string' ? id : null
}

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['purchasing.orders.view'] },
    POST: { requireAuth: true, requireFeatures: ['purchasing.payments.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['purchasing.payments.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['purchasing.payments.manage'] },
  },
  orm: {
    entity: PurchasingPurchasePayment,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: paymentListSchema,
    entityId: ENTITY_ID,
    fields: ['id', 'order_id', 'stage', 'amount', 'currency_code', 'paid_at', 'reference', 'method_note', 'attachment_id', 'tenant_id', 'organization_id', 'created_at'],
    sortFieldMap: {
      id: 'id',
      paid_at: 'paid_at',
      created_at: 'created_at',
      paidAt: 'paid_at',
    },
    buildFilters: async (query: PaymentListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.orderId) filters.order_id = query.orderId
      if (query.stage) filters.stage = query.stage
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      orderId: orderIdFrom(item.order_id) ?? String(item.order_id ?? ''),
      stage: String(item.stage ?? 'other'),
      amount: String(item.amount ?? '0'),
      currencyCode: String(item.currency_code ?? 'CNY'),
      paidAt: toIsoTimestamp(item.paid_at),
      reference: (item.reference ?? null) as string | null,
      methodNote: (item.method_note ?? null) as string | null,
      attachmentId: (item.attachment_id ?? null) as string | null,
      created_at: toIsoTimestamp(item.created_at),
    }),
  },
  actions: {
    create: {
      commandId: 'purchasing.purchase-payments.record',
      schema: purchasePaymentCreateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { id: string }).id) }),
      status: 201,
    },
    update: {
      commandId: 'purchasing.purchase-payments.attach',
      schema: purchasePaymentAttachSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'purchasing.purchase-payments.delete',
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createPurchasingCrudOpenApi({
  resourceName: 'Purchase Payment',
  pluralName: 'Purchase Payments',
  querySchema: paymentListSchema,
  listResponseSchema: createPagedListResponseSchema(paymentListItemSchema, { paginationMetaOptional: true }),
  create: {
    schema: purchasePaymentCreateSchema,
    responseSchema: purchasingCreatedSchema,
    description: 'Records a stage payment (deposit/balance/other) against a purchase order.',
  },
  del: {
    responseSchema: purchasingOkSchema,
    description: 'Removes a recorded payment while the order is not closed.',
  },
})
