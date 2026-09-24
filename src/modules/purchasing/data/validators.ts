import { z } from 'zod'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { SUPPLIER_PRODUCT_PRICE_KINDS } from '../lib/priceKinds'

/**
 * ISO-4217 shape only. Membership in the seeded currency dictionary is enforced in the
 * command layer (`assertCurrencyInDictionary`), because that check needs a scoped read.
 */
export const currencyCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, 'currency code must be a three-letter ISO code')
  .transform((value) => value.toUpperCase())

// ---------------------------------------------------------------------------------------
// Shared field shapes for the supplier product library (this module's own copies — an app
// module never imports another module's validators)
// ---------------------------------------------------------------------------------------

const DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/

function decimalSchema(scale: number, options: { min?: string; max?: string } = {}) {
  return z
    .string()
    .trim()
    .regex(DECIMAL_PATTERN, 'value must be a decimal number')
    .refine((value) => {
      const fraction = value.split('.')[1] ?? ''
      return fraction.length <= scale
    }, `value must have at most ${scale} decimal places`)
    .refine((value) => (options.min === undefined ? true : Number(value) >= Number(options.min)), `value must be >= ${options.min}`)
    .refine((value) => (options.max === undefined ? true : Number(value) <= Number(options.max)), `value must be <= ${options.max}`)
}

/**
 * A nullable decimal: an explicit value is normalized to the column's scale, `null` clears it, and an
 * **absent** key stays `undefined`.
 *
 * The absent case is load-bearing, exactly as in `products/data/validators.ts`: the update schema is
 * `.partial()` and the update command writes a field only when it is `!== undefined`, while the
 * quotation import submits only the columns it actually changed. A helper that folded `undefined`
 * into `null` therefore erased the decimal columns a partial write did not mention (measured
 * 2026-09-24 on the master's weights; the same shape lived here for `unit_net_weight`).
 */
const nullableDecimalSchema = (scale: number, options: { min?: string; max?: string } = {}) =>
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

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional()

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

/**
 * Supplier input contracts.
 *
 * `nullable().optional()` on the free-text fields is deliberate: `undefined` means
 * "leave unchanged" on update, `null` means "clear the field". The entity, the
 * command, the API projection, and the form all keep that distinction so clearing a
 * value round-trips instead of silently reverting to the previous one.
 */
export const supplierCreateSchema = z.object({
  name: z.string().min(1).max(200),
  /**
   * Our own supplier number. Omitted or blank → `purchasing.suppliers.create` issues the next
   * `SUP-####` for the organization (see `.ai/specs/2026-09-24-supplier-code-issuance.md`); an
   * explicit value is stored as typed, which keeps imports and integrations on the old contract.
   */
  code: z.string().trim().max(64).optional(),
  contactName: z.string().max(200).nullable().optional(),
  phone: z.string().max(64).nullable().optional(),
  email: z.string().max(200).nullable().optional(),
  address: z.string().max(1000).nullable().optional(),
  defaultCurrencyCode: currencyCodeSchema.default('CNY'),
  /** Default brand for this supplier's library rows; see `PurchasingSupplier.brandValue`. */
  brandValue: z.string().trim().max(64).nullable().optional(),
  isActive: z.boolean().default(true),
  notes: z.string().max(2000).nullable().optional(),
})

export const supplierUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  code: z.string().min(1).max(64).optional(),
  contactName: z.string().max(200).nullable().optional(),
  phone: z.string().max(64).nullable().optional(),
  email: z.string().max(200).nullable().optional(),
  address: z.string().max(1000).nullable().optional(),
  defaultCurrencyCode: currencyCodeSchema.optional(),
  brandValue: z.string().trim().max(64).nullable().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
})

export const supplierListSchema = z.object({
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  search: z.string().max(200).optional(),
  // `z.coerce.boolean()` would read the string "false" as `true`, silently turning an
  // "inactive only" filter into "active only". The factory may hand this key through as a
  // real boolean (it pre-parses recognized boolean query keys), so accept both shapes and
  // normalize with the platform token parser.
  isActive: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined
      if (typeof value === 'boolean') return value
      return parseBooleanToken(value) ?? undefined
    }),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  sortField: z.enum(['id', 'name', 'code', 'created_at', 'updated_at']).optional().default('created_at'),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
})

export type SupplierCreateInput = z.infer<typeof supplierCreateSchema>
export type SupplierUpdateInput = z.infer<typeof supplierUpdateSchema>
export type SupplierListQuery = z.infer<typeof supplierListSchema>

/**
 * Document types a purchase order can carry. `other` stays last as the catch-all, so the literal
 * order is also the order a picker shows.
 */
export const PURCHASE_ORDER_DOC_TYPES = [
  'supplier_invoice',
  'packing_list',
  'purchase_payment_receipt',
  'other',
] as const
export type PurchaseOrderDocType = (typeof PURCHASE_ORDER_DOC_TYPES)[number]

/**
 * One row is one file, and the file itself lives in the installed `attachments` module — only its
 * id is stored here, so a document can be listed, replaced, or removed without touching the file.
 * `nullable().optional()` keeps the create/update distinction: `undefined` leaves the field alone,
 * `null` clears it.
 */
export const purchaseOrderDocumentCreateSchema = z.object({
  orderId: z.string().uuid(),
  docType: z.enum(PURCHASE_ORDER_DOC_TYPES),
  documentNumber: z.string().trim().max(120).nullable().optional(),
  issuedAt: z.string().min(1).nullable().optional(),
  attachmentId: z.string().uuid().nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
})

/** `orderId` is intentionally not required on update: a document never moves between orders. */
export const purchaseOrderDocumentUpdateSchema = purchaseOrderDocumentCreateSchema.partial().extend({
  id: z.string().uuid(),
})

export const purchaseOrderDocumentListSchema = z.object({
  id: z.string().uuid().optional(),
  orderId: z.string().uuid().optional(),
  docType: z.enum(PURCHASE_ORDER_DOC_TYPES).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(100),
})

export type PurchaseOrderDocumentCreateInput = z.infer<typeof purchaseOrderDocumentCreateSchema>
export type PurchaseOrderDocumentUpdateInput = z.infer<typeof purchaseOrderDocumentUpdateSchema>
export type PurchaseOrderDocumentListQuery = z.infer<typeof purchaseOrderDocumentListSchema>

// ---------------------------------------------------------------------------------------
// Supplier product library (owned here since 2026-09-23: the pages live at
// /backend/purchasing/supplier-products and `sourcing` reaches it through these commands)
// ---------------------------------------------------------------------------------------

export const supplierProductStatuses = ['active', 'inactive'] as const
export const supplierProductSources = ['manual', 'quote'] as const

/**
 * The supplier library's write contract.
 *
 * The unit weights and the unit volume are decimal strings and MOQ/packing counts are integers,
 * exactly like the quotation line columns they are fed from, so an import can copy a value across
 * without a conversion step. `supplierId` is part of the create contract only: a code is unique *per
 * supplier*, so moving a row to another supplier would silently collide — the update schema omits
 * it and the form renders it read-only.
 */
export const supplierProductCreateSchema = z.object({
  supplierId: z.string().uuid(),
  supplierSku: z.string().trim().min(1).max(120),
  itemNo: nullableText(120),
  /** Code-generation brand override; blank falls back to the supplier's `brandValue`. */
  brandValue: z.string().trim().max(64).nullable().optional(),
  name: z.string().trim().min(1).max(300),
  nameZh: nullableText(300),
  nameEn: nullableText(300),
  description: nullableText(2000),
  declarationElements: nullableText(2000),
  unit: z.string().trim().max(24).default('PCS'),
  hsCode: nullableText(32),
  moqQuantity: nullableNonNegativeIntegerSchema,
  cartonQuantity: nullableNonNegativeIntegerSchema,
  unitNetWeight: nullableDecimalSchema(4, { min: '0' }),
  unitGrossWeight: nullableDecimalSchema(4, { min: '0' }),
  unitVolume: nullableDecimalSchema(0, { min: '0' }),
  /**
   * The supplier's discount off this item's supply price, as a whole-number percentage — a
   * **product-level** term (the same supplier discounts different items differently), never a
   * per-row or per-currency one. `scale: 0` (owner rule 2026-09-24): the rate a supplier quotes is a
   * whole percent, so a fraction is a typo rather than a term, and the field must not carry one in.
   * Blank means no discount; `100` means the goods are free, which is a legitimate (if odd) contract
   * value, so only the range is enforced. The 折后价 is derived, never stored: `netUnitPrice()` in
   * `lib/priceKinds.ts` is the single implementation the form, the list and the promotion share.
   */
  discountPercent: nullableDecimalSchema(0, { min: '0', max: '100' }),
  innerPacking: dimensionsSchema,
  /**
   * The product photos, as `attachments` ids. Replace-set semantics: the submitted array is the
   * new list, `[]` clears it, and omitting the key leaves the current list alone. Ids are not
   * verified against the attachments table on purpose — the file may have been uploaded in another
   * request and the row must stay editable even if a file was cleaned up later.
   */
  imageAttachmentIds: z.array(z.string().uuid()).max(12).optional(),
  status: z.enum(supplierProductStatuses).default('active'),
  notes: nullableText(2000),
})

export const supplierProductUpdateSchema = supplierProductCreateSchema.omit({ supplierId: true }).extend({
  id: z.string().uuid(),
})

/**
 * 建档状态 — the list's link-state filter.
 *
 * The filter reads the row's **stored** `product_id`, not the live-resolved label: a row whose
 * product was deleted afterwards still owns its link and must not silently fall out of the
 * 已建档 bucket (the list marks it separately instead).
 */
export const supplierProductLinkedFilters = ['all', 'linked', 'unlinked'] as const

export const supplierProductListSchema = z.object({
  id: z.string().uuid().optional(),
  ids: z.string().max(4000).optional(),
  supplierId: z.string().uuid().optional(),
  /** 建档状态 (Phase 8): filters the stored `product_id` server-side. */
  linked: z.enum(supplierProductLinkedFilters).optional().default('all'),
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

/**
 * Promote several rows in one request.
 *
 * Bounded like the import payload. Duplicates are collapsed to their first occurrence by the
 * command, so the reported counts always describe distinct rows.
 */
export const supplierProductPromoteBatchSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
})

/**
 * Link / 换绑 / 解除关联 a library row to a product that already exists.
 *
 * `productId: null` is the unlink action, so the key is required — an omitted field cannot be told
 * apart from an explicit clear, and the two mean different things here.
 */
export const supplierProductLinkSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid().nullable(),
})

/** Push the row's current values onto the product it is already linked to. */
export const supplierProductSyncFieldsSchema = z.object({ id: z.string().uuid() })

export const supplierProductDeleteSchema = z.object({ id: z.string().uuid() })

// ---------------------------------------------------------------------------------------
// Supplier product prices
// ---------------------------------------------------------------------------------------

/**
 * One price row of a library item.
 *
 * `priceKind` names who prices the item (see `lib/priceKinds.ts`); the currency is a separate
 * dimension, so 供应商供货价 in CNY and in USD are two rows of the same kind, not two fields. A row
 * has no `id` in the payload: the upsert key is `(kind, currency, minQuantity)`, which is what
 * makes the whole-set submit idempotent.
 */
export const supplierProductPriceRowSchema = z.object({
  priceKind: z.enum(SUPPLIER_PRODUCT_PRICE_KINDS),
  currencyCode: currencyCodeSchema,
  minQuantity: z.coerce.number().int().min(1).default(1),
  unitPrice: decimalSchema(6, { min: '0' }),
  isActive: z.boolean().default(true),
})

/**
 * The whole price set of one library item, in one request — rows missing from `rows` are
 * deactivated, never deleted (`products.prices.replace` semantics). Bounded so one request cannot
 * write an unbounded set.
 */
export const supplierProductPricesReplaceSchema = z.object({
  supplierProductId: z.string().uuid(),
  rows: z.array(supplierProductPriceRowSchema).max(24),
})

export const supplierProductPriceListSchema = z.object({
  id: z.string().uuid().optional(),
  supplierProductId: z.string().uuid().optional(),
  supplierProductIds: z.string().max(4000).optional(),
  priceKind: z.enum(SUPPLIER_PRODUCT_PRICE_KINDS).optional(),
  currencyCode: z.string().max(3).optional(),
  isActive: triStateBooleanFilter,
  page: pageSchema,
  pageSize: pageSizeSchema,
  sortField: z
    .enum(['id', 'price_kind', 'currency_code', 'min_quantity', 'created_at'])
    .optional()
    .default('price_kind'),
  sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
})

export type SupplierProductCreateInput = z.infer<typeof supplierProductCreateSchema>
export type SupplierProductUpdateInput = z.infer<typeof supplierProductUpdateSchema>
export type SupplierProductListQuery = z.infer<typeof supplierProductListSchema>
export type SupplierProductImportInput = z.infer<typeof supplierProductImportSchema>
export type SupplierProductPromoteInput = z.infer<typeof supplierProductPromoteSchema>
export type SupplierProductPromoteBatchInput = z.infer<typeof supplierProductPromoteBatchSchema>
export type SupplierProductLinkInput = z.infer<typeof supplierProductLinkSchema>
export type SupplierProductSyncFieldsInput = z.infer<typeof supplierProductSyncFieldsSchema>
export type SupplierProductPriceRowInput = z.infer<typeof supplierProductPriceRowSchema>
export type SupplierProductPricesReplaceInput = z.infer<typeof supplierProductPricesReplaceSchema>
export type SupplierProductPriceListQuery = z.infer<typeof supplierProductPriceListSchema>
