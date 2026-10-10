import { z } from 'zod'
import { PRICE_SCALE } from '../../trade_docs/lib/money'
import { PRODUCT_PRICE_TIERS } from '../lib/tiers'
import type { StoreDimensions } from '../lib/store'

/**
 * Input contracts for the products module.
 *
 * The module stores nothing itself: every product, variant and price lands in the installed
 * `catalog` module through `lib/store.ts`, so these schemas describe the **catalog write payload**
 * the frontends and the peer commands already send — the same field names as before the cutover,
 * minus the retired taxonomy (`typeId` / `categoryId`) and the old mirror link (`catalogProductId`
 * / `catalogSnapshot`): a product *is* the catalog product now.
 *
 * Decimal columns are submitted as strings so no value ever passes through a binary float:
 * a numeric(18,4) price typed as `26.5001` must reach catalog unchanged. More decimals than the
 * column holds are rejected instead of silently rounded, because a silently rounded price is
 * indistinguishable from an operator's typo.
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

/**
 * A nullable decimal: an explicit value is normalized to the column's scale, `null` clears it, and
 * an **absent** key stays `undefined`.
 *
 * That last part is load-bearing. `productUpdateSchema` is `.partial()`, and the update command
 * fills the catalog write payload for the columns it did not receive from the product the store
 * read back; a helper that turned `undefined` into `null` made every partial update (the supplier
 * sync sends changed fields only) silently erase the decimal columns it did not mention — measured
 * 2026-09-24: a `sync-fields` payload carrying only `volume` wiped `net_weight` and `gross_weight`,
 * and the reverse. `z.undefined()` inside the pipeline is what keeps "not sent" distinguishable
 * from "cleared".
 */
const nullableDecimalSchema = (scale: number, options: { min?: string } = {}) =>
  z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === null ? null : value))
    .pipe(z.union([decimalSchema(scale, options), z.null(), z.undefined()]))

const nullableNonNegativeIntegerSchema = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((value) => (value === null || value === undefined ? null : Number(value)))
  .refine((value) => value === null || (Number.isInteger(value) && value >= 0), 'value must be a non-negative integer')

const ISO_CODE_PATTERN = /^[A-Za-z]{2,4}$/

/**
 * The one charset/length rule a SKU accepts, exported because two call sites need it in two
 * different shapes: the create schema applies it through zod, while `products.items.update` applies
 * it only to a **changed** SKU — an unchanged legacy code is deliberately not re-validated
 * (see `.ai/specs/2026-09-24-supplier-product-code-rules.md`, REQ-PC-009).
 */
export const SKU_PATTERN = /^[A-Za-z0-9._\-/]{1,64}$/

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

const pageSchema = z.coerce.number().min(1).default(1)
const pageSizeSchema = z.coerce.number().min(1).max(200).default(50)

export const productStatuses = ['active', 'inactive'] as const

export const PRODUCT_VARIANT_STATUSES = ['active', 'inactive'] as const

const dimensionsSchema = z
  .object({
    length: z.union([z.string(), z.number()]).nullable().optional(),
    width: z.union([z.string(), z.number()]).nullable().optional(),
    height: z.union([z.string(), z.number()]).nullable().optional(),
    unit: z.string().trim().max(16).nullable().optional(),
  })
  .nullable()
  .optional()
  .transform((value): StoreDimensions | null => {
    if (!value) return null
    const toNumber = (raw: string | number | null | undefined): number | null => {
      if (raw === null || raw === undefined || raw === '') return null
      const parsed = Number(raw)
      return Number.isFinite(parsed) ? parsed : null
    }
    const dimensions: StoreDimensions = {
      length: toNumber(value.length),
      width: toNumber(value.width),
      height: toNumber(value.height),
      unit: typeof value.unit === 'string' && value.unit.length > 0 ? value.unit : null,
    }
    const empty =
      dimensions.length === null && dimensions.width === null && dimensions.height === null && dimensions.unit === null
    return empty ? null : dimensions
  })

/**
 * One SKU row of a product.
 *
 * `id` is optional because a variant is submitted inside the product aggregate: the form sends the
 * id of rows that already exist and omits it for rows the operator just added, which is how the
 * command tells an update from an insert (the same shape the price rows use, minus the id — the
 * store matches a price row by its `(tier, currency, min quantity)` key).
 *
 * A row's `code` is the operational key an operator quotes and searches by, so it is required and
 * length-bounded here; uniqueness is enforced by the catalog variant commands behind the store.
 */
export const productVariantSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  barcode: z.string().trim().max(64).nullable().optional(),
  status: z.enum(PRODUCT_VARIANT_STATUSES).default('active'),
  isDefault: z.boolean().default(false),
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
  volume: nullableDecimalSchema(0, { min: '0' }),
  dimensions: dimensionsSchema,
  cartonQuantity: nullableNonNegativeIntegerSchema,
  batteryCapacityMah: nullableNonNegativeIntegerSchema,
  batteryWh: nullableDecimalSchema(2, { min: '0' }),
  containsLithiumBattery: z.boolean().default(false),
  certifications: z.array(z.string().trim().min(1).max(120)).max(50).nullable().optional(),
  status: z.enum(productStatuses).default('active'),
  notes: nullableText(2000),
  /**
   * Provenance of a distributed copy: the catalog product this row was copied from. Written by
   * `products.items.distribute` through the store; no form sends it, and an ordinary create/update
   * leaves it alone (the store omits absent values).
   */
  sourceProductId: z.string().uuid().nullable().optional(),
  /**
   * The product's whole variant set: the submitted rows are the new truth, so a row the payload does
   * not name is deleted by the store's replace semantics. Omitted means "leave the variants
   * untouched" — an explicit empty array is the way to remove them all — which keeps every existing
   * client that predates this field working unchanged.
   */
  variants: productVariantsSchema.optional(),
})

/**
 * The update contract widens `sku` on purpose: the charset/length rule moved into the update
 * **command**, which applies it only when the value actually changes. A product migrated with a
 * legacy code (a PetKit-era item number, a code carrying a space) must stay editable — its name,
 * spec and prices — while every *new* SKU still has to pass `SKU_PATTERN`. Create keeps the strict
 * schema above, so nothing can be created outside the rule.
 */
export const productUpdateSchema = productCreateSchema.partial().extend({
  id: z.string().uuid(),
  sku: z.string().trim().min(1).max(200).optional(),
})

export const productListSchema = z.object({
  search: z.string().max(200).optional(),
  /** `all` is the explicit opt-out; the default list shows active products only. */
  status: z.enum(['active', 'inactive', 'all']).optional().default('active'),
  page: pageSchema,
  pageSize: pageSizeSchema,
  /** Comma-separated catalog product ids, as the pickers and the by-id reads send them. */
  ids: z.string().max(8000).optional(),
  /** Comma-separated SKUs, as the distribution and sync callers resolve their rows. */
  skus: z.string().max(8000).optional(),
  sortField: z.enum(['id', 'sku', 'name', 'status', 'created_at', 'updated_at']).optional().default('created_at'),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
})

/**
 * One row of a product's price set.
 *
 * The tier is catalog's price-kind code (`purchase` / `internal` / `export`), and there is no row
 * id: the store replaces a product's whole set, matching a submitted row to the stored one by
 * `(tier, currency, min quantity)` and closing the rows the payload no longer names.
 */
const productPriceRowSchema = z
  .object({
    tier: z.enum(PRODUCT_PRICE_TIERS),
    currencyCode: productCurrencyCodeSchema,
    minQuantity: z.coerce.number().int().min(1).default(1),
    unitPrice: decimalSchema(PRICE_SCALE, { min: '0' }),
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

/**
 * Product distribution to other organizations
 * (`.ai/specs/2026-09-28-product-distribution-to-branches.md`): copies the listed products — or
 * every product of the current organization when `productIds` is omitted — into the target
 * organizations as catalog products. The caps bound one request; repeating it is an idempotent
 * update.
 */
export const productDistributeSchema = z.object({
  productIds: z.array(z.string().uuid()).max(200).optional(),
  organizationIds: z.array(z.string().uuid()).min(1).max(50),
})

export type ProductCreateInput = z.infer<typeof productCreateSchema>
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>
export type ProductPriceRowInput = z.infer<typeof productPriceRowSchema>
export type ProductVariantInput = z.infer<typeof productVariantSchema>
export type ProductPricesReplaceInput = z.infer<typeof productPricesReplaceSchema>
export type ProductListQuery = z.infer<typeof productListSchema>
export type ProductDistributeInput = z.infer<typeof productDistributeSchema>
