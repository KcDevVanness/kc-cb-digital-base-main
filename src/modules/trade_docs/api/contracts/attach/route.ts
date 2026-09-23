import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { TradeDocsContract } from '../../../data/entities'
import { CONTRACT_STATUSES, contractAttachSchema } from '../../../data/validators'
import { createTradeDocsCrudOpenApi, tradeDocsOkSchema } from '../../openapi'

const ENTITY_ID = 'trade_docs:trade_docs_contract' as const

/**
 * Binds the counterparty-signed/stamped scan to the contract.
 *
 * The upload itself goes through the platform's multipart route (`POST /api/attachments` with
 * `entityId=trade_docs:trade_docs_contract` and the record id), exactly like the invoice scan and
 * the purchasing module's payment vouchers: the contract exists first, the file is uploaded second,
 * and this PUT only records the pointer — so a failed upload never loses the contract, and the
 * operator can retry the binding from the detail page. The generated XLSX keeps its own
 * `generated_attachment_id`; this route never touches it.
 */
const attachListSchema = z.object({
  id: z.string().uuid().optional(),
  status: z.enum(CONTRACT_STATUSES).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
})

export const { metadata, GET, PUT } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['trade_docs.contracts.view'] },
    PUT: { requireAuth: true, requireFeatures: ['trade_docs.contracts.manage'] },
  },
  orm: {
    entity: TradeDocsContract,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: attachListSchema,
    entityId: ENTITY_ID,
    fields: ['id', 'number', 'status', 'attachment_id', 'generated_attachment_id', 'tenant_id', 'organization_id'],
  },
  actions: {
    update: {
      commandId: 'trade_docs.contracts.attach',
      schema: contractAttachSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createTradeDocsCrudOpenApi({
  resourceName: 'Contract Attachment',
  pluralName: 'Contract Attachments',
  querySchema: attachListSchema,
  listResponseSchema: z.object({
    items: z.array(z.object({ id: z.string().uuid(), attachmentId: z.string().uuid().nullable() })),
  }),
  update: {
    schema: contractAttachSchema,
    responseSchema: tradeDocsOkSchema,
    description:
      'Binds an uploaded stamped/signed scan to the contract, or clears it with `attachmentId: null` (archive + download only; the generated XLSX is untouched).',
  },
})
