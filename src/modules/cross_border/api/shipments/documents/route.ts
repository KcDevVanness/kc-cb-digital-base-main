import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { CrossBorderExportDocument } from '../../../data/entities'
import { documentCreateSchema, documentListSchema, documentUpdateSchema, EXPORT_DOC_TYPES } from '../../../data/validators'
import { loadShipmentIdsForContract } from '../../../lib/contractReads'
import { linkIdFilter } from '../../../lib/linkIdFilter'
import { createCrossBorderCrudOpenApi, crossBorderCreatedSchema, crossBorderOkSchema } from '../../openapi'

const ENTITY_ID = 'cross_border:cross_border_export_document' as const

const documentItemSchema = z
  .object({
    id: z.string().uuid(),
    shipmentId: z.string().uuid(),
    purchaseOrderId: z.string().uuid().nullable().optional(),
    docType: z.enum(EXPORT_DOC_TYPES),
    documentNumber: z.string().nullable().optional(),
    issuedAt: z.string().nullable().optional(),
    attachmentId: z.string().uuid().nullable().optional(),
    note: z.string().nullable().optional(),
  })
  .passthrough()

type DocumentListQuery = z.infer<typeof documentListSchema>

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
    GET: { requireAuth: true, requireFeatures: ['cross_border.shipments.view'] },
    POST: { requireAuth: true, requireFeatures: ['cross_border.documents.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['cross_border.documents.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['cross_border.documents.manage'] },
  },
  orm: {
    entity: CrossBorderExportDocument,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: documentListSchema,
    entityId: ENTITY_ID,
    // Newest first, so the shipment's document section and the packing-list ledger both show the
    // document just registered on top; `id` (the platform's fallback) is a random uuid.
    defaultSort: { field: 'created_at', dir: 'desc' },
    fields: [
      'id',
      'shipment_id',
      'purchase_order_id',
      'doc_type',
      'document_number',
      'issued_at',
      'attachment_id',
      'note',
      'tenant_id',
      'organization_id',
      'created_at',
    ],
    buildFilters: async (query: DocumentListQuery, ctx) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.shipmentId) filters.shipment_id = query.shipmentId
      if (query.docType) filters.doc_type = query.docType
      if (query.contractId) {
        // A packing list belongs to a contract through its shipment: resolve the linked shipment
        // ids, then narrow the page. An unknown contract resolves to no ids — `linkIdFilter` turns
        // that into a filter matching nothing (an empty `$in` is a SQL syntax error, not an empty page).
        const em = ctx.container.resolve('em') as EntityManager
        const linked = await loadShipmentIdsForContract(
          em,
          { tenantId: ctx.auth?.tenantId ?? '', organizationIds: ctx.organizationIds ?? [] },
          query.contractId,
        )
        filters.shipment_id = linkIdFilter(linked)
      }
      if (query.search && query.search.trim().length > 0) {
        // `document_number` and `note` are plaintext columns; the escape keeps a typed `%` literal.
        const term = `%${escapeLikePattern(query.search.trim())}%`
        filters.$or = [
          { document_number: { $ilike: term } },
          { note: { $ilike: term } },
        ]
      }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      shipmentId: relationId(item.shipment_id) ?? String(item.shipment_id ?? ''),
      purchaseOrderId: (item.purchase_order_id ?? null) as string | null,
      docType: String(item.doc_type),
      documentNumber: (item.document_number ?? null) as string | null,
      issuedAt: toIsoTimestamp(item.issued_at),
      attachmentId: (item.attachment_id ?? null) as string | null,
      note: (item.note ?? null) as string | null,
    }),
  },
  actions: {
    create: {
      commandId: 'cross_border.documents.create',
      schema: documentCreateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { id: string }).id) }),
      status: 201,
    },
    update: {
      commandId: 'cross_border.documents.update',
      schema: documentUpdateSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'cross_border.documents.delete',
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createCrossBorderCrudOpenApi({
  resourceName: 'Export Document',
  pluralName: 'Export Documents',
  querySchema: documentListSchema,
  listResponseSchema: createPagedListResponseSchema(documentItemSchema, { paginationMetaOptional: true }),
  create: {
    schema: documentCreateSchema,
    responseSchema: crossBorderCreatedSchema,
    description: 'Records an export document on a shipment; the file itself lives in attachments.',
  },
  update: {
    schema: documentUpdateSchema,
    responseSchema: crossBorderOkSchema,
    description: 'Updates an export document.',
  },
  del: {
    responseSchema: crossBorderOkSchema,
    description: 'Soft-deletes an export document.',
  },
})
