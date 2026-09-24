import { z } from 'zod'

/**
 * The module's input contracts.
 *
 * Segment shapes are validated structurally here and *semantically* by `validateRuleShape`, which
 * needs the current dictionary values: zod can say "this is a segment", only the rule model can say
 * "this segment can never produce a legal code".
 */

const segmentKeySchema = z.string().trim().regex(/^[a-z][a-z0-9_]*$/, 'segment key must be snake_case')
const dictionaryKeySchema = z.string().trim().regex(/^[a-z][a-z0-9_]*$/, 'dictionary key must be snake_case')

export const codeSegmentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('dictionary'),
    key: segmentKeySchema,
    dictionaryKey: dictionaryKeySchema,
    length: z.coerce.number().int().min(1).max(64),
    upper: z.boolean().default(true),
    /** `true` glues this segment to the previous one with no separator — `SP-CL001`, not `SP-CL-001`. */
    join: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal('serial'),
    key: z.literal('serial'),
    length: z.coerce.number().int().min(1).max(8),
    join: z.boolean().default(false),
  }),
])

const ruleFields = {
  name: z.string().trim().min(1).max(120),
  mode: z.enum(['generate', 'carry_over']).default('generate'),
  segments: z.array(codeSegmentSchema).min(1).max(8),
  separator: z.string().max(1).default('-'),
  serialLength: z.coerce.number().int().min(1).max(8).default(3),
  serialScope: z.enum(['brand_category', 'brand', 'global']).default('brand_category'),
  enforce: z.enum(['warn', 'strict']).default('warn'),
  isActive: z.boolean().default(true),
}

export const productCodeRuleCreateSchema = z.object(ruleFields)

export const productCodeRuleUpdateSchema = z.object({
  ...ruleFields,
  name: ruleFields.name.optional(),
  segments: ruleFields.segments.optional(),
  id: z.string().uuid(),
})

export const productCodeRuleListSchema = z.object({
  search: z.string().max(200).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  sortField: z.enum(['name', 'created_at', 'updated_at']).optional().default('created_at'),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
})

export const productCodeGenerateSchema = z.object({
  ruleId: z.string().uuid().optional(),
  brandValue: z.string().trim().min(1).max(64),
  categoryValue: z.string().trim().min(1).max(64).optional(),
  /** `true` previews the next code without consuming a serial — the rule editor's preview uses it. */
  dryRun: z.boolean().default(false),
})

export const productCodeParseSchema = z.object({
  code: z.string().trim().min(1).max(120),
})

export const productCodeAliasCreateSchema = z.object({
  aliasCode: z.string().trim().min(1).max(120),
  targetKind: z.enum(['product', 'supplier_product']),
  targetId: z.string().uuid(),
  note: z.string().trim().max(500).nullable().optional(),
})

export const productCodeSequencesQuerySchema = z.object({
  ruleId: z.string().uuid(),
  brandValue: z.string().trim().max(64).optional(),
})

export type CodeSegmentInput = z.infer<typeof codeSegmentSchema>
export type ProductCodeRuleCreateInput = z.infer<typeof productCodeRuleCreateSchema>
export type ProductCodeRuleUpdateInput = z.infer<typeof productCodeRuleUpdateSchema>
export type ProductCodeGenerateInput = z.infer<typeof productCodeGenerateSchema>
export type ProductCodeAliasCreateInput = z.infer<typeof productCodeAliasCreateSchema>
