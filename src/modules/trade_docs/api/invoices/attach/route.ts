import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { TradeDocsInvoice } from '../../../data/entities'
import { INVOICE_STATUSES, invoiceAttachSchema } from '../../../data/validators'
import { createTradeDocsCrudOpenApi, tradeDocsOkSchema } from '../../openapi'

const ENTITY_ID = 'trade_docs:trade_docs_invoice' as const

/**
 * Binds an already-uploaded attachment to the invoice.
 *
 * The upload itself goes through the platform's multipart route (`POST /api/attachments` with
 * `entityId=trade_docs:trade_docs_invoice` and the record id), exactly like the purchasing
 * module's payment vouchers: the invoice is created first, the file is uploaded second, and this
 * PUT only records the pointer — so a failed upload never loses the invoice, and the operator can
 * retry the binding from the row.
 */
const attachListSchema = z.object({
  id: z.string().uuid().optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
})

export const { metadata, GET, PUT } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['trade_docs.invoices.view'] },
    PUT: { requireAuth: true, requireFeatures: ['trade_docs.invoices.manage'] },
  },
  orm: {
    entity: TradeDocsInvoice,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: attachListSchema,
    entityId: ENTITY_ID,
    fields: ['id', 'number', 'status', 'attachment_id', 'tenant_id', 'organization_id'],
  },
  actions: {
    update: {
      commandId: 'trade_docs.invoices.attach',
      schema: invoiceAttachSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createTradeDocsCrudOpenApi({
  resourceName: 'Invoice Attachment',
  pluralName: 'Invoice Attachments',
  querySchema: attachListSchema,
  listResponseSchema: z.object({
    items: z.array(z.object({ id: z.string().uuid(), attachmentId: z.string().uuid().nullable() })),
  }),
  update: {
    schema: invoiceAttachSchema,
    responseSchema: tradeDocsOkSchema,
    description: 'Binds an uploaded attachment to the invoice (archive + download only).',
  },
})
