import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { ProductCodeLedgerEntry } from '../../data/entities'
import { productCodeGenerateSchema } from '../../data/validators'
import { productCodesCommandErrors, productCodesTag } from '../openapi'

const ENTITY_ID = 'product_codes:product_code_ledger' as const

const generateListSchema = z.object({
  id: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(50).default(20),
})

const generatedPartSchema = z.object({
  key: z.string(),
  kind: z.string(),
  value: z.string(),
  label: z.string().nullable(),
  known: z.boolean(),
})

const generateResponseSchema = z.object({
  code: z.string(),
  ruleId: z.string().uuid(),
  ruleName: z.string(),
  dryRun: z.boolean(),
  ledgerId: z.string().uuid().nullable(),
  nextSerial: z.number(),
  parts: z.array(generatedPartSchema),
})

/**
 * Issue a code (or preview the next one).
 *
 * `dryRun` is the rule editor's preview: it formats the code the next serial *would* produce and
 * writes nothing. A real issuance consumes the serial and records it in the ledger — that is why this
 * is a command route and not a read: the number is spent even if the caller never saves the row.
 */
export const { metadata, POST } = makeCrudRoute({
  metadata: {
    POST: { requireAuth: true, requireFeatures: ['product_codes.codes.generate'] },
  },
  orm: {
    entity: ProductCodeLedgerEntry,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: null,
  },
  indexer: { entityType: ENTITY_ID },
  list: { schema: generateListSchema, entityId: ENTITY_ID, fields: ['id', 'code', 'serial'] },
  actions: {
    create: {
      commandId: 'product_codes.codes.issue',
      schema: productCodeGenerateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => result as Record<string, unknown>,
      status: 200,
    },
  },
})

export const openApi: OpenApiRouteDoc = {
  tag: productCodesTag,
  summary: 'Generate a product code',
  methods: {
    POST: {
      summary: 'Generate a product code',
      description:
        'Formats the next code for the rule and code-list values given. `dryRun: true` returns the code the next serial would produce without consuming it; `dryRun: false` writes the number into the issuance ledger, where it stays spent even if the row is never saved — a serial is never reused. The rule is the explicit `ruleId`, else the single active `generate` rule (several active rules are a 400 `rule_ambiguous`, none a 404 `rule_not_found`).',
      requestBody: { schema: productCodeGenerateSchema },
      responses: [{ status: 200, description: 'Code issued (or previewed)', schema: generateResponseSchema }],
      errors: [...productCodesCommandErrors],
    },
  },
}
