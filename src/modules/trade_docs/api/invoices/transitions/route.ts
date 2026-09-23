import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { TradeDocsInvoice } from '../../../data/entities'
import { INVOICE_STATUSES, invoiceTransitionSchema } from '../../../data/validators'
import { createTradeDocsCrudOpenApi, tradeDocsOkSchema } from '../../openapi'

const ENTITY_ID = 'trade_docs:trade_docs_invoice' as const

/**
 * Confirm/void on their own path so the command's allowed-transition table is the only decider.
 * Confirming puts the invoice's printed amounts into the bound contract lines' financial caliber;
 * voiding releases them.
 */
const transitionListSchema = z.object({
  id: z.string().uuid().optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
})

export const { metadata, GET, POST } = makeCrudRoute({
  metadata: {
    POST: { requireAuth: true, requireFeatures: ['trade_docs.invoices.manage'] },
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
    schema: transitionListSchema,
    entityId: ENTITY_ID,
    fields: ['id', 'number', 'status', 'tenant_id', 'organization_id'],
  },
  actions: {
    create: {
      commandId: 'trade_docs.invoices.transition',
      schema: invoiceTransitionSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ ok: true, status: (result as { status: string }).status }),
    },
  },
})

export const openApi = createTradeDocsCrudOpenApi({
  resourceName: 'Invoice Transition',
  pluralName: 'Invoice Transitions',
  querySchema: transitionListSchema,
  listResponseSchema: z.object({
    items: z.array(z.object({ id: z.string().uuid(), status: z.string() })),
  }),
  create: {
    schema: invoiceTransitionSchema,
    responseSchema: tradeDocsOkSchema,
    description: 'Confirms or voids an invoice and recomputes the bound contract’s totals.',
  },
})
