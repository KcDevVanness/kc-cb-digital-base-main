import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { SourcingQuote } from '../../../data/entities'
import { promoteSchema } from '../../../data/validators'
import { sourcingCommandErrors, sourcingTag } from '../../openapi'

const ENTITY_ID = 'sourcing:sourcing_quote' as const

const promoteListSchema = z.object({
  id: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(50).default(20),
})

const promoteResponseSchema = z.object({
  created: z.number(),
  updated: z.number(),
  skipped: z.number(),
  failed: z.array(
    z.object({
      lineId: z.string().uuid(),
      lineNumber: z.number(),
      message: z.string(),
    }),
  ),
})

export const { metadata, POST } = makeCrudRoute({
  metadata: {
    POST: { requireAuth: true, requireFeatures: ['sourcing.promote.run'] },
  },
  orm: {
    entity: SourcingQuote,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: { schema: promoteListSchema, entityId: ENTITY_ID, fields: ['id', 'status'] },
  actions: {
    create: {
      commandId: 'sourcing.quotes.promote',
      schema: promoteSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => result as Record<string, unknown>,
      status: 200,
    },
  },
})

export const openApi: OpenApiRouteDoc = {
  tag: sourcingTag,
  summary: 'Promote quotation lines into the product master',
  methods: {
    POST: {
      summary: 'Promote quotation lines into the product master',
      description:
        'Creates or updates products by SKU for the selected lines and merges their `purchase` price row (currency and MOQ from the line) without touching the other price tiers. Missing product categories are created from the line’s section banner. Per-line failures are reported and do not stop the remaining lines; a second run skips what it already promoted.',
      requestBody: { schema: promoteSchema },
      responses: [{ status: 200, description: 'Promotion finished', schema: promoteResponseSchema }],
      errors: [...sourcingCommandErrors],
    },
  },
}
