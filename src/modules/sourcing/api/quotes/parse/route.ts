import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { SourcingQuote } from '../../../data/entities'
import { quoteParseSchema } from '../../../data/validators'
import { sourcingCommandErrors, sourcingTag } from '../../openapi'

const ENTITY_ID = 'sourcing:sourcing_quote' as const

/** The CRUD factory always needs an ORM binding for scope resolution; this list is not a UI contract. */
const parseListSchema = z.object({
  id: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(50).default(20),
})

const parseResponseSchema = z
  .object({
    quote: z.object({ id: z.string().uuid(), status: z.string() }).passthrough(),
    sheetName: z.string(),
    headerRowIndex: z.number(),
    unitRowIndex: z.number().nullable(),
    headerCells: z.array(z.string()),
    dataRowCount: z.number(),
    lineCount: z.number(),
    templateMatched: z.boolean(),
    matchedProfileId: z.string().uuid().nullable(),
    layoutSignature: z.string(),
    detectedCurrency: z.string().nullable(),
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
  list: { schema: parseListSchema, entityId: ENTITY_ID, fields: ['id', 'status'] },
  actions: {
    create: {
      commandId: 'sourcing.quotes.parse',
      schema: quoteParseSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => result as Record<string, unknown>,
      status: 200,
    },
  },
})

export const openApi: OpenApiRouteDoc = {
  tag: sourcingTag,
  summary: 'Parse an uploaded quotation workbook',
  methods: {
    POST: {
      summary: 'Parse an uploaded quotation workbook',
      description:
        'Reads the attachment bound to the quotation, detects its header row, section banners and footer, maps every column (saved profile → standard template → alias dictionary) and replaces the quotation’s staged lines. Refused once any line has been promoted.',
      requestBody: { schema: quoteParseSchema },
      responses: [{ status: 200, description: 'Workbook parsed', schema: parseResponseSchema }],
      errors: [...sourcingCommandErrors],
    },
  },
}
