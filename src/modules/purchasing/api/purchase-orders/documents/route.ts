import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { PurchasingPurchaseOrderDocument } from '../../../data/entities'
import {
  purchaseOrderDocumentCreateSchema,
  purchaseOrderDocumentListSchema,
  purchaseOrderDocumentUpdateSchema,
  PURCHASE_ORDER_DOC_TYPES,
} from '../../../data/validators'
import { createPurchasingCrudOpenApi, purchasingCreatedSchema, purchasingOkSchema } from '../../openapi'

const ENTITY_ID = 'purchasing:purchasing_purchase_order_document' as const

const documentItemSchema = z
  .object({
    id: z.string().uuid(),
    orderId: z.string().uuid(),
    docType: z.enum(PURCHASE_ORDER_DOC_TYPES),
    documentNumber: z.string().nullable().optional(),
    issuedAt: z.string().nullable().optional(),
    attachmentId: z.string().uuid().nullable().optional(),
    note: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
  })
  .passthrough()

type DocumentListQuery = z.infer<typeof purchaseOrderDocumentListSchema>

function toIsoTimestamp(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

function relationId(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('id' in value)) return null
  const id = value.id
  return typeof id === 'string' ? id : null
}

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['purchasing.orders.view'] },
    POST: { requireAuth: true, requireFeatures: ['purchasing.orders.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['purchasing.orders.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['purchasing.orders.manage'] },
  },
  orm: {
    entity: PurchasingPurchaseOrderDocument,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: purchaseOrderDocumentListSchema,
    entityId: ENTITY_ID,
    fields: [
      'id',
      'order_id',
      'doc_type',
      'document_number',
      'issued_at',
      'attachment_id',
      'note',
      'tenant_id',
      'organization_id',
      'created_at',
      'updated_at',
    ],
    buildFilters: async (query: DocumentListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.orderId) filters.order_id = query.orderId
      if (query.docType) filters.doc_type = query.docType
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      orderId: relationId(item.order_id) ?? String(item.order_id ?? ''),
      docType: String(item.doc_type),
      documentNumber: (item.document_number ?? null) as string | null,
      issuedAt: toIsoTimestamp(item.issued_at),
      attachmentId: (item.attachment_id ?? null) as string | null,
      note: (item.note ?? null) as string | null,
      created_at: toIsoTimestamp(item.created_at),
      updated_at: toIsoTimestamp(item.updated_at),
      updatedAt: toIsoTimestamp(item.updated_at),
    }),
  },
  actions: {
    create: {
      commandId: 'purchasing.order-documents.create',
      schema: purchaseOrderDocumentCreateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { id: string }).id) }),
      status: 201,
    },
    update: {
      commandId: 'purchasing.order-documents.update',
      schema: purchaseOrderDocumentUpdateSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'purchasing.order-documents.delete',
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createPurchasingCrudOpenApi({
  resourceName: 'Purchase Order Document',
  pluralName: 'Purchase Order Documents',
  querySchema: purchaseOrderDocumentListSchema,
  listResponseSchema: createPagedListResponseSchema(documentItemSchema, { paginationMetaOptional: true }),
  create: {
    schema: purchaseOrderDocumentCreateSchema,
    responseSchema: purchasingCreatedSchema,
    description: 'Records a document on a purchase order; the file itself lives in attachments.',
  },
  update: {
    schema: purchaseOrderDocumentUpdateSchema,
    responseSchema: purchasingOkSchema,
    description: 'Updates a purchase order document.',
  },
  del: {
    responseSchema: purchasingOkSchema,
    description: 'Soft-deletes a purchase order document.',
  },
})
