import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { TradeDocsContract } from '../../../data/entities'
import { CONTRACT_STATUSES, contractTransitionSchema } from '../../../data/validators'
import { createTradeDocsCrudOpenApi, tradeDocsOkSchema } from '../../openapi'

const ENTITY_ID = 'trade_docs:trade_docs_contract' as const

/**
 * Status transitions live on their own path so the command's allowed-transition table is the only
 * thing that decides what is legal. The route carries a POST action only; the list surface exists
 * because the CRUD factory always needs an ORM binding for scope resolution, and it is not part
 * of the UI contract.
 */
const transitionListSchema = z.object({
  id: z.string().uuid().optional(),
  status: z.enum(CONTRACT_STATUSES).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
})

export const { metadata, GET, POST } = makeCrudRoute({
  metadata: {
    POST: { requireAuth: true, requireFeatures: ['trade_docs.contracts.manage'] },
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
    schema: transitionListSchema,
    entityId: ENTITY_ID,
    fields: ['id', 'number', 'status', 'tenant_id', 'organization_id'],
  },
  actions: {
    create: {
      commandId: 'trade_docs.contracts.transition',
      schema: contractTransitionSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({
        ok: true,
        status: (result as { status: string }).status,
        number: (result as { number?: string | null }).number ?? null,
      }),
    },
  },
})

export const openApi = createTradeDocsCrudOpenApi({
  resourceName: 'Contract Transition',
  pluralName: 'Contract Transitions',
  querySchema: transitionListSchema,
  listResponseSchema: z.object({
    items: z.array(z.object({ id: z.string().uuid(), status: z.string() })),
  }),
  create: {
    schema: contractTransitionSchema,
    responseSchema: tradeDocsOkSchema,
    description: 'Applies one allowed status transition (issue/sign/close/cancel) to a contract.',
  },
})
