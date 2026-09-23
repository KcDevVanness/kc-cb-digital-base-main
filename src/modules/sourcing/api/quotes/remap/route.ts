import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { SourcingQuote } from '../../../data/entities'
import { quoteRemapSchema } from '../../../data/validators'
import { sourcingCommandErrors, sourcingTag } from '../../openapi'

const ENTITY_ID = 'sourcing:sourcing_quote' as const

const remapListSchema = z.object({
  id: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(50).default(20),
})

const remapResponseSchema = z
  .object({
    quote: z.object({ id: z.string().uuid(), status: z.string() }).passthrough(),
    sheetName: z.string(),
    headerRowIndex: z.number(),
    columns: z.array(z.unknown()),
    lineCount: z.number(),
    matchedProfileId: z.string().uuid().nullable(),
    layoutSignature: z.string(),
  })
  .passthrough()

export const { metadata, POST } = makeCrudRoute({
  metadata: {
    POST: { requireAuth: true, requireFeatures: ['sourcing.import.run'] },
  },
  orm: {
    entity: SourcingQuote,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: { schema: remapListSchema, entityId: ENTITY_ID, fields: ['id', 'status'] },
  actions: {
    create: {
      commandId: 'sourcing.quotes.remap',
      schema: quoteRemapSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => result as Record<string, unknown>,
      status: 200,
    },
  },
})

export const openApi: OpenApiRouteDoc = {
  tag: sourcingTag,
  summary: 'Re-map a parsed quotation workbook',
  methods: {
    POST: {
      summary: 'Re-map a parsed quotation workbook',
      description:
        'Re-reads the stored workbook with the mapping the operator confirmed in the wizard (header row, per-column target fields, section rules) and rebuilds the staged lines. Optionally saves the mapping as a reusable profile for this layout.',
      requestBody: { schema: quoteRemapSchema },
      responses: [{ status: 200, description: 'Lines rebuilt', schema: remapResponseSchema }],
      errors: [...sourcingCommandErrors],
    },
  },
}
