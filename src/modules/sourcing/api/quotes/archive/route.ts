import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { SourcingQuote } from '../../../data/entities'
import { quoteArchiveSchema } from '../../../data/validators'
import { sourcingCommandErrors, sourcingTag } from '../../openapi'

const ENTITY_ID = 'sourcing:sourcing_quote' as const

const archiveListSchema = z.object({
  id: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(50).default(20),
})

const archiveResponseSchema = z
  .object({
    id: z.string().uuid(),
    status: z.string(),
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
  list: { schema: archiveListSchema, entityId: ENTITY_ID, fields: ['id', 'status'] },
  actions: {
    create: {
      commandId: 'sourcing.quotes.archive',
      schema: quoteArchiveSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => result as Record<string, unknown>,
      status: 200,
    },
  },
})

export const openApi: OpenApiRouteDoc = {
  tag: sourcingTag,
  summary: 'Archive a supplier quotation',
  methods: {
    POST: {
      summary: 'Archive a supplier quotation',
      description:
        'Retires an approved quotation from the working list without deleting it or its promoted lines. A draft is deleted rather than archived.',
      requestBody: { schema: quoteArchiveSchema },
      responses: [{ status: 200, description: 'Quotation archived', schema: archiveResponseSchema }],
      errors: [...sourcingCommandErrors],
    },
  },
}
