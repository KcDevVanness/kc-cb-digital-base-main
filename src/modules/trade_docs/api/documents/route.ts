import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { TradeDocsDocument } from '../../data/entities'
import {
  TRADE_DOCUMENT_DIRECTIONS,
  TRADE_DOCUMENT_KINDS,
  TRADE_DOCUMENT_STATUSES,
  documentCreateSchema,
  documentListSchema,
  documentUpdateSchema,
} from '../../data/validators'
import { createTradeDocsCrudOpenApi, tradeDocsCreatedSchema, tradeDocsOkSchema } from '../openapi'

const ENTITY_ID = 'trade_docs:trade_docs_documents' as const

const documentListItemSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(TRADE_DOCUMENT_KINDS),
    direction: z.enum(TRADE_DOCUMENT_DIRECTIONS),
    number: z.string().nullable().optional(),
    status: z.enum(TRADE_DOCUMENT_STATUSES),
    counterpartyKind: z.string(),
    counterpartyId: z.string().uuid().nullable().optional(),
    counterpartyName: z.string().nullable().optional(),
    currencyCode: z.string(),
    subtotal: z.string(),
    total: z.string(),
    exchangeRate: z.string().nullable().optional(),
    paymentTerms: z.string().nullable().optional(),
    incoterms: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    issuedAt: z.string().nullable().optional(),
    validUntil: z.string().nullable().optional(),
    deliveryDate: z.string().nullable().optional(),
    sourceKind: z.string().nullable().optional(),
    sourceId: z.string().uuid().nullable().optional(),
    generatedAttachmentId: z.string().uuid().nullable().optional(),
    attachmentId: z.string().uuid().nullable().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
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

function toDateOnly(value: unknown): string | null {
  const iso = toIsoTimestamp(value)
  return iso ? iso.slice(0, 10) : null
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value)
  return text.length > 0 ? text : null
}

/**
 * The counterparty's display name comes from the frozen snapshot, not from the peer module: a
 * rename after signing must not change what the document list shows for an issued document.
 */
export function counterpartyNameFrom(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const source = snapshot as Record<string, unknown>
  for (const key of ['name', 'title', 'companyName', 'label']) {
    const value = source[key]
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return null
}

export const documentListFields = [
  'id',
  'kind',
  'direction',
  'number',
  'status',
  'counterparty_kind',
  'counterparty_id',
  'counterparty_snapshot',
  'our_party_snapshot',
  'consignee_snapshot',
  'notify_party_snapshot',
  'currency_code',
  'exchange_rate',
  'subtotal',
  'total',
  'payment_terms',
  'incoterms',
  'notes',
  'issued_at',
  'valid_until',
  'delivery_date',
  'source_kind',
  'source_id',
  'source_snapshot',
  'generated_attachment_id',
  'attachment_id',
  'updated_at',
  'tenant_id',
  'organization_id',
]

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['trade_docs.documents.view'] },
    POST: { requireAuth: true, requireFeatures: ['trade_docs.documents.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['trade_docs.documents.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['trade_docs.documents.manage'] },
  },
  orm: {
    entity: TradeDocsDocument,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: documentListSchema,
    entityId: ENTITY_ID,
    fields: documentListFields,
    sortFieldMap: {
      id: 'id',
      number: 'number',
      kind: 'kind',
      status: 'status',
      total: 'total',
      issued_at: 'issued_at',
      created_at: 'created_at',
      updated_at: 'updated_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: DocumentListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.organizationId) filters.organization_id = query.organizationId
      if (query.kind) filters.kind = query.kind
      if (query.direction) filters.direction = query.direction
      if (query.status) filters.status = query.status
      if (query.counterpartyId) filters.counterparty_id = query.counterpartyId
      if (query.sourceKind) filters.source_kind = query.sourceKind
      if (query.sourceId) filters.source_id = query.sourceId
      if (query.search && query.search.trim().length > 0) {
        filters.number = { $ilike: `%${escapeLikePattern(query.search.trim())}%` }
      }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      kind: String(item.kind ?? 'proforma'),
      direction: String(item.direction ?? 'sales'),
      number: asNullableString(item.number),
      status: String(item.status ?? 'draft'),
      counterpartyKind: String(item.counterparty_kind ?? 'customer'),
      counterpartyId: asNullableString(item.counterparty_id),
      counterpartyName: counterpartyNameFrom(item.counterparty_snapshot),
      // Both snapshots travel with the head payload: the detail page prints the party blocks from
      // them, and a rename of the master record must not change an issued document's copy.
      counterpartySnapshot: item.counterparty_snapshot ?? null,
      ourPartySnapshot: item.our_party_snapshot ?? null,
      consigneeSnapshot: item.consignee_snapshot ?? null,
      notifyPartySnapshot: item.notify_party_snapshot ?? null,
      currencyCode: String(item.currency_code ?? 'CNY'),
      exchangeRate: asNullableString(item.exchange_rate),
      subtotal: String(item.subtotal ?? '0'),
      total: String(item.total ?? '0'),
      paymentTerms: asNullableString(item.payment_terms),
      incoterms: asNullableString(item.incoterms),
      notes: asNullableString(item.notes),
      sourceKind: asNullableString(item.source_kind),
      sourceId: asNullableString(item.source_id),
      sourceSnapshot: item.source_snapshot ?? null,
      issuedAt: toDateOnly(item.issued_at),
      validUntil: toDateOnly(item.valid_until),
      deliveryDate: toDateOnly(item.delivery_date),
      generatedAttachmentId: asNullableString(item.generated_attachment_id),
      attachmentId: asNullableString(item.attachment_id),
      tenant_id: asNullableString(item.tenant_id),
      organization_id: asNullableString(item.organization_id),
      created_at: toIsoTimestamp(item.created_at),
      updated_at: toIsoTimestamp(item.updated_at),
      updatedAt: toIsoTimestamp(item.updated_at),
    }),
  },
  actions: {
    create: {
      commandId: 'trade_docs.documents.create',
      schema: documentCreateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { id: string }).id) }),
      status: 201,
    },
    update: {
      commandId: 'trade_docs.documents.update',
      schema: documentUpdateSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'trade_docs.documents.delete',
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createTradeDocsCrudOpenApi({
  resourceName: 'Document',
  pluralName: 'Documents',
  querySchema: documentListSchema,
  listResponseSchema: createPagedListResponseSchema(documentListItemSchema, { paginationMetaOptional: true }),
  create: {
    schema: documentCreateSchema,
    responseSchema: tradeDocsCreatedSchema,
    description: 'Creates a draft PI/CI document (kind discriminates the family) with its lines in the caller’s organization.',
  },
  update: {
    schema: documentUpdateSchema,
    responseSchema: tradeDocsOkSchema,
    description: 'Updates a draft document (and replaces its lines when provided); requires the expected version.',
  },
  del: {
    responseSchema: tradeDocsOkSchema,
    description: 'Soft-deletes a draft document; an issued document can only be voided.',
  },
})
