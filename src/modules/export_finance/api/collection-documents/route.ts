import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { ExportFinanceCollectionDocument } from '../../data/entities'
import {
  collectionDocumentCreateSchema,
  collectionDocumentListSchema,
  collectionDocumentUpdateSchema,
  COLLECTION_DOC_TYPES,
} from '../../data/validators'
import { createExportFinanceCrudOpenApi, exportFinanceCreatedSchema, exportFinanceOkSchema } from '../openapi'

const ENTITY_ID = 'export_finance:export_finance_collection_document' as const

const documentItemSchema = z
  .object({
    id: z.string().uuid(),
    collectionId: z.string().uuid(),
    docType: z.enum(COLLECTION_DOC_TYPES),
    issuedAt: z.string().nullable().optional(),
    attachmentId: z.string().uuid().nullable().optional(),
    note: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
  })
  .passthrough()

type DocumentListQuery = z.infer<typeof collectionDocumentListSchema>

function toIsoTimestamp(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

function relationId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const id = (value as { id?: unknown }).id
  return typeof id === 'string' ? id : null
}

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['export_finance.orders.view'] },
    POST: { requireAuth: true, requireFeatures: ['export_finance.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['export_finance.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['export_finance.manage'] },
  },
  orm: {
    entity: ExportFinanceCollectionDocument,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: collectionDocumentListSchema,
    entityId: ENTITY_ID,
    fields: [
      'id',
      'collection_id',
      'doc_type',
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
      if (query.collectionId) filters.collection_id = query.collectionId
      if (query.docType) filters.doc_type = query.docType
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      collectionId: relationId(item.collection_id) ?? String(item.collection_id ?? ''),
      docType: String(item.doc_type),
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
      commandId: 'export_finance.collection-documents.create',
      schema: collectionDocumentCreateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { id: string }).id) }),
      status: 201,
    },
    update: {
      commandId: 'export_finance.collection-documents.update',
      schema: collectionDocumentUpdateSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'export_finance.collection-documents.delete',
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createExportFinanceCrudOpenApi({
  resourceName: 'Collection Document',
  pluralName: 'Collection Documents',
  querySchema: collectionDocumentListSchema,
  listResponseSchema: createPagedListResponseSchema(documentItemSchema, { paginationMetaOptional: true }),
  create: {
    schema: collectionDocumentCreateSchema,
    responseSchema: exportFinanceCreatedSchema,
    description: 'Records one 涉外收入证明 (or other file) on an order-level collection record.',
  },
  update: {
    schema: collectionDocumentUpdateSchema,
    responseSchema: exportFinanceOkSchema,
    description: 'Updates a collection document.',
  },
  del: {
    responseSchema: exportFinanceOkSchema,
    description: 'Soft-deletes a collection document.',
  },
})
