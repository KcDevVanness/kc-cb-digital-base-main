import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { TradeDocsOrderDocument } from '../../../data/entities'
import {
  ORDER_DOCUMENT_KINDS,
  orderDocumentListSchema,
  orderDocumentsReplaceSchema,
} from '../../../data/validators'
import { createTradeDocsCrudOpenApi, tradeDocsOkSchema } from '../../openapi'

const ENTITY_ID = 'trade_docs:trade_docs_order_document' as const

const orderDocumentItemSchema = z
  .object({
    id: z.string().uuid(),
    orderKind: z.string(),
    orderId: z.string().uuid(),
    orderNumber: z.string().nullable().optional(),
    documentKind: z.enum(ORDER_DOCUMENT_KINDS),
    documentId: z.string().uuid(),
    documentNumber: z.string().nullable().optional(),
    documentSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
    created_at: z.string().nullable().optional(),
  })
  .passthrough()

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value)
  return text.length > 0 ? text : null
}

function asIso(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  return null
}

/**
 * The sales-order ↔ document links.
 *
 * Read and write live together because they are one aggregate: `GET` answers the order hub's
 * Documents block (by order) and "which orders carry this document" (by document), and the
 * **replace** action is the single writer (`trade_docs.orders.documents.replace`) — a `POST` on this
 * path rather than a per-row CRUD update, because the dialog edits the set as a whole and the
 * command owns the uniqueness, scope and optimistic-lock rules.
 *
 * The link is polymorphic (`proforma`/`commercial` are rows of `trade_docs_documents`, `tax_invoice`
 * is a row of `trade_docs_invoices`), so the item carries the kind and the frozen snapshot on top of
 * the ids: a reader can render the row without a second call, and the hub re-reads the live document
 * by id to show the current status.
 */
export const { metadata, GET, POST } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['trade_docs.documents.view'] },
    POST: { requireAuth: true, requireFeatures: ['trade_docs.documents.manage'] },
  },
  orm: {
    entity: TradeDocsOrderDocument,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
  },
  list: {
    schema: orderDocumentListSchema,
    entityId: ENTITY_ID,
    fields: [
      'id',
      'order_kind',
      'order_id',
      'order_number',
      'document_kind',
      'document_id',
      'document_number',
      'document_snapshot',
      'created_at',
      'tenant_id',
      'organization_id',
    ],
    defaultSort: { field: 'created_at', dir: 'asc' },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.orderKind) filters.order_kind = query.orderKind
      if (query.orderId) filters.order_id = query.orderId
      if (query.documentKind) filters.document_kind = query.documentKind
      if (query.documentId) filters.document_id = query.documentId
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      orderKind: String(item.order_kind),
      orderId: String(item.order_id),
      orderNumber: asNullableString(item.order_number),
      documentKind: String(item.document_kind),
      documentId: String(item.document_id),
      documentNumber: asNullableString(item.document_number),
      documentSnapshot:
        item.document_snapshot && typeof item.document_snapshot === 'object'
          ? (item.document_snapshot as Record<string, unknown>)
          : null,
      created_at: asIso(item.created_at),
    }),
  },
  actions: {
    create: {
      commandId: 'trade_docs.orders.documents.replace',
      schema: orderDocumentsReplaceSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({
        ok: true,
        orderId: (result as { orderId: string }).orderId,
        count: (result as { count: number }).count,
      }),
    },
  },
})

export const openApi = createTradeDocsCrudOpenApi({
  resourceName: 'Order Document',
  pluralName: 'Order Documents',
  querySchema: orderDocumentListSchema,
  listResponseSchema: createPagedListResponseSchema(orderDocumentItemSchema),
  create: {
    schema: orderDocumentsReplaceSchema,
    responseSchema: tradeDocsOkSchema,
    description:
      'Replaces the documents a sales order carries (proforma / commercial invoices and tax invoices), freezing each document\'s number and head snapshot.',
  },
})
