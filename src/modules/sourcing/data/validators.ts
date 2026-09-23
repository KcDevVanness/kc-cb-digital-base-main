import { z } from 'zod'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { SOURCE_FIELD_BY_KEY, type SourceFieldKey } from '../lib/fieldAliases'

/**
 * Input contracts for the sourcing module.
 *
 * Money and weight columns follow the products module's decimal convention (a decimal string
 * with a fixed scale is validated and passed through untouched, so no float rounding happens
 * on the way to Postgres). Optimistic locking is **not** part of these schemas for the
 * single-record routes: the version travels in the
 * `x-om-ext-optimistic-lock-expected-updated-at` header that `enforceCommandOptimisticLock`
 * reads. The batch line edit is the exception — one header cannot carry 200 versions, so each
 * row carries its own `updatedAt` and the command passes it as the typed `expected` token.
 */

const DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/

function decimalSchema(scale: number, options: { min?: string } = {}) {
  return z
    .string()
    .trim()
    .regex(DECIMAL_PATTERN, 'value must be a decimal number')
    .refine((value) => {
      const fraction = value.split('.')[1] ?? ''
      return fraction.length <= scale
    }, `value must have at most ${scale} decimal places`)
    .refine((value) => (options.min === undefined ? true : Number(value) >= Number(options.min)), `value must be >= ${options.min}`)
}

const nullableDecimalSchema = (scale: number, options: { min?: string } = {}) =>
  z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((value) => (value === null || value === undefined ? null : value))
    .pipe(z.union([decimalSchema(scale, options), z.null()]))

const nullableNonNegativeIntegerSchema = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((value) => (value === null || value === undefined ? null : Number(value)))
  .refine((value) => value === null || (Number.isInteger(value) && value >= 0), 'value must be a non-negative integer')

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional()

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const nullableDateSchema = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => (value === null || value === undefined || value === '' ? null : value))
  .refine((value) => value === null || ISO_DATE_PATTERN.test(value), 'date must be YYYY-MM-DD')

export const quoteStatuses = ['draft', 'approved', 'archived', 'cancelled'] as const
export const quoteSourceKinds = ['excel_import', 'manual'] as const
export const quoteLineStatuses = ['staged', 'ready', 'invalid', 'skipped', 'promoted'] as const

export const quoteCurrencyCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/, 'currency code must be a three-letter uppercase ISO code')

const SKU_PATTERN = /^[A-Za-z0-9._\-/]{1,64}$/

const dimensionsSchema = z
  .object({
    length: z.union([z.string(), z.number()]).nullable().optional(),
    width: z.union([z.string(), z.number()]).nullable().optional(),
    height: z.union([z.string(), z.number()]).nullable().optional(),
    unit: z.string().trim().max(16).nullable().optional(),
  })
  .nullable()
  .optional()
  .transform((value) => {
    if (!value) return null
    const entries = Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined && entry !== '')
    return entries.length > 0 ? Object.fromEntries(entries) : null
  })

const triStateBooleanFilter = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined
    if (typeof value === 'boolean') return value
    return parseBooleanToken(value) ?? undefined
  })

const pageSchema = z.coerce.number().min(1).default(1)
const pageSizeSchema = z.coerce.number().min(1).max(200).default(50)

// ---------------------------------------------------------------------------------------
// Quotations
// ---------------------------------------------------------------------------------------

export const quoteCreateSchema = z.object({
  supplierId: z.string().uuid().nullable().optional(),
  supplierNameSnapshot: nullableText(200),
  quoteDate: nullableDateSchema,
  validUntil: nullableDateSchema,
  currencyCode: quoteCurrencyCodeSchema.default('CNY'),
  sourceKind: z.enum(quoteSourceKinds).default('manual'),
  sourceFileName: nullableText(255),
  notes: nullableText(2000),
})

export const quoteUpdateSchema = quoteCreateSchema.partial().extend({
  id: z.string().uuid(),
})

export const quoteListSchema = z.object({
  id: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  status: z.enum(quoteStatuses).optional(),
  supplierId: z.string().uuid().optional(),
  page: pageSchema,
  pageSize: pageSizeSchema,
  sortField: z.enum(['number', 'quote_date', 'created_at', 'updated_at']).optional().default('created_at'),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
})

export const quoteApproveSchema = z.object({ id: z.string().uuid() })
export const quoteArchiveSchema = z.object({ id: z.string().uuid() })
export const quoteDeleteSchema = z.object({ id: z.string().uuid() })

// ---------------------------------------------------------------------------------------
// Quotation lines
// ---------------------------------------------------------------------------------------

export const quoteLineCreateSchema = z.object({
  quoteId: z.string().uuid(),
  sectionLabel: nullableText(120),
  itemNo: nullableText(120),
  productName: nullableText(300),
  derivedSku: z.string().trim().regex(SKU_PATTERN, 'sku must be letters, digits, dot, dash, slash or underscore').nullable().optional(),
  hsCode: nullableText(32),
  description: nullableText(2000),
  unit: z.string().trim().max(24).default('PCS'),
  unitCost: nullableDecimalSchema(6, { min: '0' }),
  suggestedRsp: nullableDecimalSchema(6, { min: '0' }),
  moqRaw: nullableText(64),
  moqQuantity: nullableNonNegativeIntegerSchema,
  cartonQuantity: nullableNonNegativeIntegerSchema,
  cartons: nullableNonNegativeIntegerSchema,
  unitNetWeight: nullableDecimalSchema(4, { min: '0' }),
  cartonGrossWeight: nullableDecimalSchema(4, { min: '0' }),
  cartonNetWeight: nullableDecimalSchema(4, { min: '0' }),
  innerPacking: dimensionsSchema,
  outerPacking: dimensionsSchema,
  cartonVolume: nullableDecimalSchema(6, { min: '0' }),
  selected: z.boolean().default(true),
})

export const quoteLineDeleteSchema = z.object({ id: z.string().uuid() })

export const quoteLineListSchema = z.object({
  quoteId: z.string().uuid(),
  rowStatus: z.enum(quoteLineStatuses).optional(),
  selected: triStateBooleanFilter,
  search: z.string().max(200).optional(),
  page: pageSchema,
  pageSize: pageSizeSchema.default(200),
  sortField: z.enum(['line_number', 'unit_cost', 'created_at', 'updated_at']).optional().default('line_number'),
  sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
})

/**
 * The review grid saves what the operator changed in one request. Each row carries the
 * `updatedAt` it was rendered with, which the command passes to the optimistic-lock helper as
 * the typed `expected` token, so a concurrent edit conflicts instead of being overwritten.
 */
export const quoteLinesBatchUpdateSchema = z.object({
  quoteId: z.string().uuid(),
  rows: z
    .array(
      z.object({
        id: z.string().uuid(),
        updatedAt: z.string().trim().min(1),
        selected: z.boolean().optional(),
        derivedSku: z
          .union([z.string().trim().regex(SKU_PATTERN, 'sku must be letters, digits, dot, dash, slash or underscore'), z.null()])
          .optional(),
        productName: nullableText(300),
        moqQuantity: nullableNonNegativeIntegerSchema,
        unitCost: nullableDecimalSchema(6, { min: '0' }),
        sectionLabel: nullableText(120),
      }),
    )
    .min(1)
    .max(200),
})

// ---------------------------------------------------------------------------------------
// Parsing, mapping and profiles
// ---------------------------------------------------------------------------------------

const sourceFieldKeys = Object.keys(SOURCE_FIELD_BY_KEY) as [SourceFieldKey, ...SourceFieldKey[]]

export const columnMapEntrySchema = z.object({
  sourceIndex: z.coerce.number().int().min(0).max(255),
  sourceHeader: z.string().max(200),
})

// A partial record on purpose: the wizard only sends the fields the operator kept, and a
// `z.record` over an enum key would demand every target field to be present.
export const columnMapSchema = z
  .partialRecord(z.enum(sourceFieldKeys), columnMapEntrySchema)
  .refine((value) => Object.keys(value).length > 0, 'column map must map at least one field')

export const sectionRulesSchema = z
  .object({
    useSections: z.boolean().default(true),
    categoryFromSection: z.boolean().default(true),
    detectedCurrency: z.string().max(3).nullable().optional(),
  })
  .default({ useSections: true, categoryFromSection: true })

export const quoteParseSchema = z.object({
  quoteId: z.string().uuid(),
  attachmentId: z.string().uuid(),
  sheetName: z.string().max(120).optional(),
  headerRowIndex: z.coerce.number().int().min(0).max(5000).optional(),
  profileId: z.string().uuid().optional(),
})

export const quoteRemapSchema = z.object({
  quoteId: z.string().uuid(),
  sheetName: z.string().max(120),
  headerRowIndex: z.coerce.number().int().min(0).max(5000),
  columnMap: columnMapSchema,
  sectionRules: sectionRulesSchema.optional(),
  saveProfile: z.boolean().default(false),
  profileName: z.string().trim().max(200).optional(),
})

/**
 * Promotion payload. `lineIds` is optional so the UI can promote "everything selected"; the cap
 * keeps one request bounded, and the command isolates per-line failures regardless.
 */
export const promoteSchema = z.object({
  quoteId: z.string().uuid(),
  lineIds: z.array(z.string().uuid()).max(500).optional(),
  force: z.boolean().default(false),
})

export const importProfileListSchema = z.object({
  search: z.string().max(200).optional(),
  page: pageSchema,
  pageSize: pageSizeSchema,
  sortField: z.enum(['name', 'usage_count', 'updated_at']).optional().default('updated_at'),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
})

export const importProfileDeleteSchema = z.object({ id: z.string().uuid() })

export const quoteDeleteSourceFileSchema = z.object({ quoteId: z.string().uuid() })

// ---------------------------------------------------------------------------------------
// Supplier product library
// ---------------------------------------------------------------------------------------

export const supplierProductStatuses = ['active', 'inactive'] as const
export const supplierProductSources = ['manual', 'quote'] as const

/**
 * The supplier library's write contract.
 *
 * Weights are decimal strings and MOQ/packing counts are integers, exactly like the quotation
 * line columns they are fed from, so an import can copy a value across without a conversion
 * step. `supplierId` is part of the create contract only: a code is unique *per supplier*, so
 * moving a row to another supplier would silently collide — the update schema omits it and the
 * form renders it read-only.
 */
export const supplierProductCreateSchema = z.object({
  supplierId: z.string().uuid(),
  supplierSku: z.string().trim().min(1).max(120),
  itemNo: nullableText(120),
  name: z.string().trim().min(1).max(300),
  description: nullableText(2000),
  unit: z.string().trim().max(24).default('PCS'),
  hsCode: nullableText(32),
  moqQuantity: nullableNonNegativeIntegerSchema,
  cartonQuantity: nullableNonNegativeIntegerSchema,
  unitNetWeight: nullableDecimalSchema(4, { min: '0' }),
  cartonGrossWeight: nullableDecimalSchema(4, { min: '0' }),
  cartonNetWeight: nullableDecimalSchema(4, { min: '0' }),
  innerPacking: dimensionsSchema,
  outerPacking: dimensionsSchema,
  status: z.enum(supplierProductStatuses).default('active'),
  notes: nullableText(2000),
})

export const supplierProductUpdateSchema = supplierProductCreateSchema.omit({ supplierId: true }).extend({
  id: z.string().uuid(),
})

export const supplierProductListSchema = z.object({
  id: z.string().uuid().optional(),
  ids: z.string().max(4000).optional(),
  supplierId: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  status: z.enum([...supplierProductStatuses, 'all']).default('active'),
  page: pageSchema,
  pageSize: pageSizeSchema,
  sortField: z
    .enum(['id', 'supplier_sku', 'name', 'created_at', 'updated_at'])
    .optional()
    .default('created_at'),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
})

/**
 * Feed selected quotation lines into the supplier's library. Bounded like the promotion payload,
 * and per-line failures are reported without stopping the rest — a quotation is a document, not a
 * transaction.
 */
export const supplierProductImportSchema = z.object({
  quoteId: z.string().uuid(),
  lineIds: z.array(z.string().uuid()).min(1).max(200),
})

export const supplierProductPromoteSchema = z.object({ id: z.string().uuid() })

export const supplierProductDeleteSchema = z.object({ id: z.string().uuid() })

export type SupplierProductCreateInput = z.infer<typeof supplierProductCreateSchema>
export type SupplierProductUpdateInput = z.infer<typeof supplierProductUpdateSchema>
export type SupplierProductListQuery = z.infer<typeof supplierProductListSchema>
export type SupplierProductImportInput = z.infer<typeof supplierProductImportSchema>
export type SupplierProductPromoteInput = z.infer<typeof supplierProductPromoteSchema>

export type QuoteCreateInput = z.infer<typeof quoteCreateSchema>
export type QuoteUpdateInput = z.infer<typeof quoteUpdateSchema>
export type QuoteListQuery = z.infer<typeof quoteListSchema>
export type QuoteLineCreateInput = z.infer<typeof quoteLineCreateSchema>
export type QuoteLineListQuery = z.infer<typeof quoteLineListSchema>
export type QuoteLinesBatchUpdateInput = z.infer<typeof quoteLinesBatchUpdateSchema>
export type QuoteParseInput = z.infer<typeof quoteParseSchema>
export type QuoteRemapInput = z.infer<typeof quoteRemapSchema>
export type ImportProfileListQuery = z.infer<typeof importProfileListSchema>
export type PromoteInput = z.infer<typeof promoteSchema>
