import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { TradeDocsDocumentLine } from '../../../data/entities'
import { documentLineListSchema, documentLinesReplaceSchema } from '../../../data/validators'
import { createTradeDocsCrudOpenApi, tradeDocsOkSchema } from '../../openapi'

const ENTITY_ID = 'trade_docs:trade_docs_document_lines' as const

const documentLineItemSchema = z
  .object({
    id: z.string().uuid(),
    documentId: z.string().uuid(),
    lineNumber: z.number(),
    productId: z.string().uuid().nullable().optional(),
    productSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
    name: z.string().nullable().optional(),
    sku: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    spec: z.string().nullable().optional(),
    unit: z.string().nullable().optional(),
    quantity: z.string(),
    unitPrice: z.string(),
    amount: z.string(),
    sourceSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
    note: z.string().nullable().optional(),
  })
  .passthrough()

type DocumentLineListQuery = z.infer<typeof documentLineListSchema>

function snapshotValue(snapshot: unknown, key: string): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const value = (snapshot as Record<string, unknown>)[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function documentIdFrom(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const id = (value as { id?: unknown }).id
  return typeof id === 'string' ? id : null
}

/**
 * Line surface for a PI/CI document. Reading is open to the document viewer; the only write verb is
 * the whole-set PUT, because the head totals are recomputed from these rows in the same transaction
 * that rewrites them — a per-row PATCH would let the head drift from its own lines.
 */
export const { metadata, GET, PUT } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['trade_docs.documents.view'] },
    PUT: { requireAuth: true, requireFeatures: ['trade_docs.documents.manage'] },
  },
  orm: {
    entity: TradeDocsDocumentLine,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: documentLineListSchema,
    entityId: ENTITY_ID,
    fields: [
      'id',
      'document_id',
      'line_number',
      'product_id',
      'product_snapshot',
      'name',
      'sku',
      'model',
      'spec',
      'unit',
      'quantity',
      'unit_price',
      'amount',
      'source_snapshot',
      'note',
      'tenant_id',
      'organization_id',
    ],
    sortFieldMap: { id: 'id', line_number: 'line_number', lineNumber: 'line_number' },
    buildFilters: async (query: DocumentLineListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.documentId) filters.document_id = query.documentId
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      documentId: documentIdFrom(item.document_id) ?? String(item.document_id ?? ''),
      lineNumber: Number(item.line_number ?? 0),
      productId: (item.product_id ?? null) as string | null,
      // The frozen product copy travels with the row so an edit keeps the printing data the line
      // was written with, even if the product master changed afterwards.
      productSnapshot: item.product_snapshot ?? null,
      name: (item.name ?? null) as string | null,
      sku: (item.sku ?? snapshotValue(item.product_snapshot, 'sku')) as string | null,
      model: (item.model ?? snapshotValue(item.product_snapshot, 'model')) as string | null,
      spec: (item.spec ?? snapshotValue(item.product_snapshot, 'spec')) as string | null,
      unit: (item.unit ?? snapshotValue(item.product_snapshot, 'unit')) as string | null,
      quantity: String(item.quantity ?? '0'),
      unitPrice: String(item.unit_price ?? '0'),
      amount: String(item.amount ?? '0'),
      sourceSnapshot: item.source_snapshot ?? null,
      note: (item.note ?? null) as string | null,
    }),
  },
  actions: {
    update: {
      commandId: 'trade_docs.documents.lines.replace',
      schema: documentLinesReplaceSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createTradeDocsCrudOpenApi({
  resourceName: 'Document Line',
  pluralName: 'Document Lines',
  querySchema: documentLineListSchema,
  listResponseSchema: createPagedListResponseSchema(documentLineItemSchema, { paginationMetaOptional: true }),
  update: {
    schema: documentLinesReplaceSchema,
    responseSchema: tradeDocsOkSchema,
    description:
      'Replaces the whole line set of a draft document and recomputes its head totals in the same transaction.',
  },
})
