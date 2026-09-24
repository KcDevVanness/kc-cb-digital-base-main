import { z } from 'zod'
// One-way dependency on the product master's vocabulary: `trade_docs` lines always come from a
// `products` product and quote one of its tiers, so the three codes stay defined in exactly one
// place. The dependency never points back — `products` knows nothing about contracts.
import { PRODUCT_PRICE_TIERS } from '../../products/lib/tiers'

/**
 * Input contracts for contracts and invoices.
 *
 * Decimal columns arrive as strings and keep every digit the column holds: a quantity or unit
 * price with more decimals than `numeric(18,6)` is rejected instead of silently rounded, because
 * the amount calibers are derived from exactly these two numbers. All amount columns on the head
 * (`contract_total`, `finance_total`, `difference_total`, `total`) are **derived server-side** and
 * are deliberately absent from every input schema — a client cannot post a total.
 */

const DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/

function decimalSchema(scale: number, options: { min?: string; allowNegative?: boolean } = {}) {
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
      if (!options.allowNegative && value.startsWith('-') && value !== '-0') {
        ctx.addIssue({ code: 'custom', message: 'value must not be negative' })
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
      return `${negative && !/^0*$/.test(integerPart + padded) ? '-' : ''}${integerPart}${scale > 0 ? `.${padded}` : ''}`
    })
}

const nullableDecimalSchema = (scale: number, options: { min?: string } = {}) =>
  z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((value) => (value === null || value === undefined ? null : value))
    .pipe(z.union([decimalSchema(scale, options), z.null()]))

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional()

const dateOnlySchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
  .nullable()
  .optional()
  .transform((value) => value ?? null)

/**
 * Currencies here are uppercased rather than rejected: unlike a product price row, a contract
 * carries one currency and it is not part of a uniqueness key, so normalizing `cny` cannot create
 * a duplicate. The value still has to look like an ISO code.
 */
const currencyCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, 'currency code must be a three-letter ISO code')
  .transform((value) => value.toUpperCase())

const snapshotSchema = z
  .record(z.string(), z.unknown())
  .nullable()
  .optional()
  .transform((value) => value ?? null)

export const CONTRACT_DIRECTIONS = ['purchase', 'sales'] as const
export const CONTRACT_STATUSES = ['draft', 'issued', 'signed', 'closed', 'cancelled'] as const
export const CONTRACT_TRANSITIONS = ['issue', 'sign', 'close', 'cancel'] as const
export const COUNTERPARTY_KINDS = ['supplier', 'customer'] as const
export const INVOICE_DIRECTIONS = ['inbound', 'outbound'] as const
export const INVOICE_STATUSES = ['draft', 'confirmed', 'void'] as const
export const INVOICE_TRANSITIONS = ['confirm', 'void'] as const

// ---------------------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------------------

export const contractLineInputSchema = z.object({
  productId: z.string().uuid().nullable().optional(),
  productSnapshot: snapshotSchema,
  name: nullableText(300),
  sku: nullableText(64),
  model: nullableText(120),
  spec: nullableText(500),
  unit: nullableText(24),
  quantity: decimalSchema(6, { min: '0' }),
  unitPrice: decimalSchema(6, { min: '0' }),
  note: nullableText(500),
})

export const contractCreateSchema = z.object({
  direction: z.enum(CONTRACT_DIRECTIONS).default('purchase'),
  counterpartyKind: z.enum(COUNTERPARTY_KINDS).default('supplier'),
  counterpartyId: z.string().uuid().nullable().optional(),
  counterpartySnapshot: snapshotSchema,
  ourPartySnapshot: snapshotSchema,
  priceTier: z.enum(PRODUCT_PRICE_TIERS).nullable().optional(),
  currencyCode: currencyCodeSchema.default('CNY'),
  exchangeRate: nullableDecimalSchema(8, { min: '0' }),
  sourceKind: z.enum(['purchase_order', 'sales_order', 'manual']).nullable().optional(),
  sourceId: z.string().uuid().nullable().optional(),
  sourceSnapshot: snapshotSchema,
  signedAt: dateOnlySchema,
  deliveryDate: dateOnlySchema,
  paymentTerms: nullableText(500),
  shippingMethod: nullableText(200),
  destination: nullableText(200),
  marks: nullableText(500),
  notes: nullableText(2000),
  lines: z.array(contractLineInputSchema).max(500).default([]),
})

export const contractUpdateSchema = contractCreateSchema.partial().extend({
  id: z.string().uuid(),
})

export const contractTransitionSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(CONTRACT_TRANSITIONS),
  reason: z.string().trim().max(500).optional(),
})

export const contractDocumentSchema = z.object({
  id: z.string().uuid(),
})

/**
 * Binds (or clears) the counterparty-signed/stamped scan of the contract. `attachmentId: null`
 * unbinds it; the generated XLSX keeps `generated_attachment_id` and is never touched here.
 */
export const contractAttachSchema = z.object({
  id: z.string().uuid(),
  attachmentId: z.string().uuid().nullable(),
})

export const contractListSchema = z.object({
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  /**
   * Narrows a picker to the selected organization.
   *
   * Documents reference a contract/supplier/product from the organization they belong to, and the
   * write commands reject another organization's record even when the caller may see it (HQ sees
   * its subsidiaries), so a picker that offered those rows would only produce a 400.
   */
  organizationId: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  direction: z.enum(CONTRACT_DIRECTIONS).optional(),
  status: z.enum(CONTRACT_STATUSES).optional(),
  counterpartyId: z.string().uuid().optional(),
  priceTier: z.enum(PRODUCT_PRICE_TIERS).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(50),
  sortField: z.enum(['id', 'number', 'status', 'contract_total', 'finance_total', 'created_at', 'updated_at']).optional().default('created_at'),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
})

export const contractLineListSchema = z.object({
  id: z.string().uuid().optional(),
  contractId: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(500).default(200),
  sortField: z.enum(['id', 'line_number']).optional().default('line_number'),
  sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
})

// ---------------------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------------------

export const invoiceLineInputSchema = z.object({
  productId: z.string().uuid().nullable().optional(),
  productSnapshot: snapshotSchema,
  description: nullableText(500),
  sku: nullableText(64),
  unit: nullableText(24),
  quantity: decimalSchema(6, { min: '0' }),
  unitPrice: decimalSchema(6, { min: '0' }),
  /** The figure printed on the invoice; may differ from `quantity × unitPrice`. */
  amount: decimalSchema(4, { min: '0' }),
  contractLineId: z.string().uuid().nullable().optional(),
})

export const invoiceCreateSchema = z.object({
  number: nullableText(64),
  direction: z.enum(INVOICE_DIRECTIONS).default('inbound'),
  counterpartyKind: z.enum(COUNTERPARTY_KINDS).default('supplier'),
  counterpartyId: z.string().uuid().nullable().optional(),
  counterpartySnapshot: snapshotSchema,
  contractId: z.string().uuid().nullable().optional(),
  sourceKind: z.enum(['purchase_order', 'sales_order', 'manual']).nullable().optional(),
  sourceId: z.string().uuid().nullable().optional(),
  sourceSnapshot: snapshotSchema,
  currencyCode: currencyCodeSchema.default('CNY'),
  issuedAt: dateOnlySchema,
  notes: nullableText(2000),
  lines: z.array(invoiceLineInputSchema).max(500).default([]),
})

export const invoiceUpdateSchema = invoiceCreateSchema.partial().extend({
  id: z.string().uuid(),
})

export const invoiceTransitionSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(INVOICE_TRANSITIONS),
  reason: z.string().trim().max(500).optional(),
})

export const invoiceAttachSchema = z.object({
  id: z.string().uuid(),
  attachmentId: z.string().uuid().nullable(),
})

export const invoiceListSchema = z.object({
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  /** Narrows a picker to the selected organization; see `contractListSchema`. */
  organizationId: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  direction: z.enum(INVOICE_DIRECTIONS).optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
  contractId: z.string().uuid().optional(),
  counterpartyId: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(50),
  sortField: z.enum(['id', 'number', 'status', 'total', 'issued_at', 'created_at', 'updated_at']).optional().default('created_at'),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
})

export const invoiceLineListSchema = z.object({
  id: z.string().uuid().optional(),
  invoiceId: z.string().uuid().optional(),
  contractLineId: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(500).default(200),
  sortField: z.enum(['id', 'line_number']).optional().default('line_number'),
  sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
})

export type ContractCreateInput = z.infer<typeof contractCreateSchema>
export type ContractUpdateInput = z.infer<typeof contractUpdateSchema>
export type ContractLineInput = z.infer<typeof contractLineInputSchema>
export type ContractTransitionInput = z.infer<typeof contractTransitionSchema>
export type ContractListQuery = z.infer<typeof contractListSchema>
export type InvoiceCreateInput = z.infer<typeof invoiceCreateSchema>
export type InvoiceUpdateInput = z.infer<typeof invoiceUpdateSchema>
export type InvoiceLineInput = z.infer<typeof invoiceLineInputSchema>
export type InvoiceTransitionInput = z.infer<typeof invoiceTransitionSchema>
export type InvoiceListQuery = z.infer<typeof invoiceListSchema>
