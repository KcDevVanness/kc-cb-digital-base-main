import { z } from 'zod'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { PRODUCT_PRICE_TIERS } from '../lib/tiers'

/**
 * Input contracts for the products module.
 *
 * Decimal columns are submitted as strings so no value ever passes through a binary float:
 * a numeric(18,6) price typed as `26.500001` must reach the database unchanged. More decimals
 * than the column holds are rejected instead of silently rounded, because a silently rounded
 * price is indistinguishable from an operator's typo.
 */

const DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/

function decimalSchema(scale: number, options: { min?: string } = {}) {
  return z
    .union([z.string(), z.number()])
    .transform((value) => (typeof value === 'number' ? String(value) : value.trim()))
    .superRefine((value, ctx) => {
      if (!DECIMAL_PATTERN.test(value)) {
        ctx.addIssue({ code: 'custom', message: 'value must be a plain decimal number' })
        return
      }
      const fraction = value.split('.')[1] ?? ''
      if (fraction.length > scale) {
        ctx.addIssue({ code: 'custom', message: `value allows at most ${scale} decimal places` })
        return
      }
      if (options.min !== undefined && Number(value) < Number(options.min)) {
        ctx.addIssue({ code: 'custom', message: `value must be at least ${options.min}` })
      }
    })
    .transform((value) => {
      const negative = value.startsWith('-')
      const digits = negative ? value.slice(1) : value
      const [integerPart, fractionPart = ''] = digits.split('.')
      const padded = fractionPart.padEnd(scale, '0')
      return `${negative ? '-' : ''}${integerPart}${scale > 0 ? `.${padded}` : ''}`
    })
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

const ISO_CODE_PATTERN = /^[A-Za-z]{2,4}$/
const SKU_PATTERN = /^[A-Za-z0-9._\-/]{1,64}$/

/**
 * ISO-4217-shaped currency code, **uppercase only**.
 *
 * Deliberately stricter than the purchasing module's normalizing validator: a price row's
 * uniqueness key is `(product, tier, currency, min quantity)`, so accepting both `cny` and `CNY`
 * would let the same tier be quoted twice under two spellings of one currency, and the contract
 * line that reads the tier could pick either. Membership in the seeded currency dictionary is
 * enforced separately in the command layer (`assertCurrencyInDictionary`).
 */
export const productCurrencyCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/, 'currency code must be a three-letter uppercase ISO code')

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional()

/** Boolean query keys arrive either pre-parsed by the factory or as strings. */
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
// Product types
// ---------------------------------------------------------------------------------------

export const productTypeCreateSchema = z.object({
  code: z.string().trim().regex(/^[a-z0-9_]+$/, 'code must be lowercase letters, digits, or underscores').max(64),
  name: z.string().trim().min(1).max(200),
  nameEn: nullableText(200),
  sortOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
})

export const productTypeUpdateSchema = productTypeCreateSchema.partial().extend({
  id: z.string().uuid(),
})

export const productTypeListSchema = z.object({
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  /** Narrows a picker to the selected organization; see `productListSchema`. */
  organizationId: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  isActive: triStateBooleanFilter,
  page: pageSchema,
  pageSize: pageSizeSchema,
  sortField: z.enum(['id', 'code', 'name', 'sort_order', 'created_at', 'updated_at']).optional().default('sort_order'),
  sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
})

// ---------------------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------------------

export const productCategoryCreateSchema = z.object({
  code: z.string().trim().regex(/^[a-z0-9_]+$/, 'code must be lowercase letters, digits, or underscores').max(64),
  name: z.string().trim().min(1).max(200),
  nameEn: nullableText(200),
  parentId: z.string().uuid().nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
})

export const productCategoryUpdateSchema = productCategoryCreateSchema.partial().extend({
  id: z.string().uuid(),
})

export const productCategoryListSchema = z.object({
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  /** Narrows a picker to the selected organization; see `productListSchema`. */
  organizationId: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  parentId: z.string().uuid().optional(),
  rootId: z.string().uuid().optional(),
  isActive: triStateBooleanFilter,
  page: pageSchema,
  pageSize: pageSizeSchema,
  sortField: z.enum(['id', 'code', 'name', 'tree_path', 'sort_order', 'created_at', 'updated_at']).optional().default('tree_path'),
  sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
})

// ---------------------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------------------

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

export const productStatuses = ['active', 'inactive'] as const

// ---------------------------------------------------------------------------------------
// Product variants (SKU)
// ---------------------------------------------------------------------------------------

export const PRODUCT_VARIANT_STATUSES = ['active', 'inactive'] as const

/**
 * One SKU row of a product.
 *
 * `id` is optional because a variant is submitted inside the product aggregate: the form sends the
 * id of rows that already exist and omits it for rows the operator just added, which is how the
 * command tells an update from an insert (the same shape the price rows use).
 *
 * A row's `code` is the operational key an operator quotes and searches by, so it is required and
 * length-bounded here; uniqueness per organization is enforced by the command (which must also see
 * soft-deleted rows, something a validator cannot) and by the database constraint behind it.
 *
 * `attributes` stays free-form: the owner will name the real SKU fields at review (Q-V-001), and
 * until then anything extra is carried there rather than forcing a migration per guess.
 */
export const productVariantSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  barcode: z.string().trim().max(64).nullable().optional(),
  status: z.enum(PRODUCT_VARIANT_STATUSES).default('active'),
  isDefault: z.boolean().default(false),
  attributes: z.record(z.string(), z.unknown()).nullable().optional(),
})

/**
 * The whole variant set of one product. The bound keeps a payload the size of a wholesale catalogue
 * from being accepted silently: 200 SKUs is far above anything this business sells per product, and
 * a larger submission is far more likely to be a mistake than an intent.
 */
const productVariantsSchema = z.array(productVariantSchema).max(200)

export const productCreateSchema = z.object({
  sku: z.string().trim().regex(SKU_PATTERN, 'sku must be letters, digits, dot, dash, slash or underscore').max(64),
  name: z.string().trim().min(1).max(300),
  nameEn: nullableText(300),
  brand: z.string().trim().max(120).default(''),
  series: nullableText(120),
  manufacturerModel: nullableText(120),
  typeId: z.string().uuid().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  specSummary: nullableText(500),
  barcode: z.string().trim().max(64).nullable().optional(),
  unit: z.string().trim().max(24).default('PCS'),
  hsCode: z.string().trim().max(32).nullable().optional(),
  cnCode: z.string().trim().max(32).nullable().optional(),
  countryOfOriginCode: z
    .string()
    .trim()
    .regex(ISO_CODE_PATTERN, 'country code must be 2-4 letters')
    .transform((value) => value.toUpperCase())
    .nullable()
    .optional(),
  netWeight: nullableDecimalSchema(4, { min: '0' }),
  grossWeight: nullableDecimalSchema(4, { min: '0' }),
  dimensions: dimensionsSchema,
  cartonQuantity: nullableNonNegativeIntegerSchema,
  batteryCapacityMah: nullableNonNegativeIntegerSchema,
  batteryWh: nullableDecimalSchema(2, { min: '0' }),
  containsLithiumBattery: z.boolean().default(false),
  certifications: z.array(z.string().trim().min(1).max(120)).max(50).nullable().optional(),
  status: z.enum(productStatuses).default('active'),
  catalogProductId: z.string().uuid().nullable().optional(),
  notes: nullableText(2000),
  /**
   * The product's whole variant set: the submitted rows are the new truth, so a row the payload does
   * not name is soft-deleted. Omitted means "leave the variants untouched" — an explicit empty array
   * is the way to remove them all — which keeps every existing client that predates this field
   * working unchanged.
   */
  variants: productVariantsSchema.optional(),
})

export const productUpdateSchema = productCreateSchema.partial().extend({
  id: z.string().uuid(),
})

export const productListSchema = z.object({
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  /**
   * Restricts the list to one organization inside the caller's visible scope.
   *
   * Pickers use it so an option can only ever be a record the write commands accept: master data
   * is organization-private, and a reference validation rejects another organization's row even
   * when the caller may *see* it (HQ sees its subsidiaries).
   */
  organizationId: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  typeId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  /** `all` is the explicit opt-out; the default list shows active products only. */
  status: z.enum(['active', 'inactive', 'all']).optional().default('active'),
  containsLithiumBattery: triStateBooleanFilter,
  page: pageSchema,
  pageSize: pageSizeSchema,
  sortField: z.enum(['id', 'sku', 'name', 'status', 'created_at', 'updated_at']).optional().default('created_at'),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
})

// ---------------------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------------------

export const productPriceRowSchema = z
  .object({
    id: z.string().uuid().nullable().optional(),
    priceTier: z.enum(PRODUCT_PRICE_TIERS),
    currencyCode: productCurrencyCodeSchema,
    minQuantity: z.coerce.number().int().min(1).default(1),
    unitPrice: decimalSchema(6, { min: '0' }),
    startsAt: z.string().min(1).nullable().optional(),
    endsAt: z.string().min(1).nullable().optional(),
    isActive: z.boolean().default(true),
  })
  .refine((row) => !row.startsAt || !row.endsAt || row.startsAt <= row.endsAt, {
    message: 'startsAt must not be after endsAt',
    path: ['endsAt'],
  })

export const productPricesReplaceSchema = z.object({
  productId: z.string().uuid(),
  rows: z.array(productPriceRowSchema).max(100),
})

export const productPricesDeleteSchema = z.object({
  id: z.string().uuid(),
})

export const productPriceListSchema = z.object({
  id: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  priceTier: z.enum(PRODUCT_PRICE_TIERS).optional(),
  currencyCode: z.string().max(3).optional(),
  isActive: triStateBooleanFilter,
  page: pageSchema,
  pageSize: pageSizeSchema,
  sortField: z.enum(['id', 'price_tier', 'currency_code', 'min_quantity', 'created_at']).optional().default('price_tier'),
  sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
})

export type ProductTypeCreateInput = z.infer<typeof productTypeCreateSchema>
export type ProductTypeUpdateInput = z.infer<typeof productTypeUpdateSchema>
export type ProductCategoryCreateInput = z.infer<typeof productCategoryCreateSchema>
export type ProductCategoryUpdateInput = z.infer<typeof productCategoryUpdateSchema>
export type ProductCreateInput = z.infer<typeof productCreateSchema>
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>
export type ProductPriceRowInput = z.infer<typeof productPriceRowSchema>
export type ProductVariantInput = z.infer<typeof productVariantSchema>
export type ProductPricesReplaceInput = z.infer<typeof productPricesReplaceSchema>
export type ProductListQuery = z.infer<typeof productListSchema>
