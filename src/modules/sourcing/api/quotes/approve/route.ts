import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { SourcingQuote } from '../../../data/entities'
import { quoteApproveSchema } from '../../../data/validators'
import { sourcingCommandErrors, sourcingTag } from '../../openapi'

const ENTITY_ID = 'sourcing:sourcing_quote' as const

const approveListSchema = z.object({
  id: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(50).default(20),
})

const approveResponseSchema = z
  .object({
    id: z.string().uuid(),
    number: z.string().nullable(),
    status: z.string(),
    approvedAt: z.string().nullable(),
  })
  .passthrough()

export const { metadata, POST } = makeCrudRoute({
  metadata: {
    POST: { requireAuth: true, requireFeatures: ['sourcing.quotes.manage'] },
  },
  orm: {
    entity: SourcingQuote,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: { schema: approveListSchema, entityId: ENTITY_ID, fields: ['id', 'status'] },
  actions: {
    create: {
      commandId: 'sourcing.quotes.approve',
      schema: quoteApproveSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => result as Record<string, unknown>,
      status: 200,
    },
  },
})

export const openApi: OpenApiRouteDoc = {
  tag: sourcingTag,
  summary: 'Approve a supplier quotation',
  methods: {
    POST: {
      summary: 'Approve a supplier quotation',
      description:
        'Freezes the quotation: assigns the organization-unique number `SQ-<year>-<4 digits>`, snapshots the supplier name, and requires at least one selected ready line and a currency present in the currency dictionary. Only a draft can be approved, and only once.',
      requestBody: { schema: quoteApproveSchema },
      responses: [{ status: 200, description: 'Quotation approved', schema: approveResponseSchema }],
      errors: [...sourcingCommandErrors],
    },
  },
}
