import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { TradeDocsDocument } from '../../../data/entities'
import { TRADE_DOCUMENT_STATUSES, documentAttachSchema } from '../../../data/validators'
import { createTradeDocsCrudOpenApi, tradeDocsOkSchema } from '../../openapi'

const ENTITY_ID = 'trade_docs:trade_docs_documents' as const

/**
 * Binds the uploaded replacement of a PI/CI (stamped/re-signed/customs copy) to the document.
 *
 * The upload itself goes through the platform's multipart route (`POST /api/attachments` with
 * `entityId=trade_docs:trade_docs_documents` and the record id), exactly like the contract scan:
 * the document exists first, the file is uploaded second, and this PUT only records the pointer —
 * so a failed upload never loses the document, and the operator can retry the binding from the
 * detail page. The generated XLSX keeps its own `generated_attachment_id`; this route never
 * touches it.
 */
const attachListSchema = z.object({
  id: z.string().uuid().optional(),
  status: z.enum(TRADE_DOCUMENT_STATUSES).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
})

export const { metadata, GET, PUT } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['trade_docs.documents.view'] },
    PUT: { requireAuth: true, requireFeatures: ['trade_docs.documents.manage'] },
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
    schema: attachListSchema,
    entityId: ENTITY_ID,
    fields: ['id', 'number', 'kind', 'status', 'attachment_id', 'generated_attachment_id', 'tenant_id', 'organization_id'],
  },
  actions: {
    update: {
      commandId: 'trade_docs.documents.attach',
      schema: documentAttachSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createTradeDocsCrudOpenApi({
  resourceName: 'Document Attachment',
  pluralName: 'Document Attachments',
  querySchema: attachListSchema,
  listResponseSchema: z.object({
    items: z.array(z.object({ id: z.string().uuid(), attachmentId: z.string().uuid().nullable() })),
  }),
  update: {
    schema: documentAttachSchema,
    responseSchema: tradeDocsOkSchema,
    description:
      'Binds an uploaded stamped/signed/customs copy to a PI/CI document, or clears it with `attachmentId: null` (archive + download only; the generated XLSX is untouched).',
  },
})
