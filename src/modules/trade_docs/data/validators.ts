import { z } from 'zod'
// One-way dependency on the product master's vocabulary: `trade_docs` lines always come from a
// `products` product and quote one of its tiers, so the three codes stay defined in exactly one
// place. The dependency never points back — `products` knows nothing about contracts.
import { PRODUCT_PRICE_TIERS } from '../../products/lib/tiers'
// The money engine owns the system-wide caliber, so the input schemas quote its constants instead
// of repeating the numbers: an amount is 2 decimals, a unit price 4, and both are compared as
// scaled integers (never through a float).
import { AMOUNT_SCALE, PRICE_SCALE, toScaledUnits } from '../lib/money'

/**
 * Input contracts for contracts, invoices and PI/CI documents.
 *
 * Decimal columns arrive as strings and keep every digit the column holds: a value with more
 * decimals than its column is rejected (a 400 at the API) instead of silently rounded, because the
 * line amount is derived from exactly the quantity and the unit price. The calibers are the
 * deployment-wide money caliber — quantity `numeric(18,6)`, unit price `numeric(18,4)`
 * (`PRICE_SCALE`), amount `numeric(18,2)` (`AMOUNT_SCALE`), tax rate `numeric(6,3)`, exchange rate
 * `numeric(18,8)`. Values within their caliber are zero-padded to the column scale, so the command
 * and the entity never disagree about formatting.
 *
 * Imported/integrated data does not come through here; those paths quantize explicitly with the
 * engine and log a warning (see the module's import paths).
 *
 * All amount columns on the head (`contract_total`, `finance_total`, `difference_total`, `total`)
 * are **derived server-side** and are deliberately absent from every input schema — a client
 * cannot post a total.
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
      // The bound is compared as scaled integers: the value already carries at most `scale`
      // decimals at this point, so the comparison is exact and never at the mercy of a float.
      if (options.min !== undefined && toScaledUnits(value, scale) < toScaledUnits(options.min, scale)) {
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
/**
 * Tax invoice kinds: `vat_special` (增值税专用发票) | `vat_general` (增值税普通发票) | `export`
 * (出口发票, 0% for a tax refund). The column is nullable on purpose — a `null` kind is a
 * historical/uncategorized ledger row and is never numbered.
 */
export const INVOICE_KINDS = ['vat_special', 'vat_general', 'export'] as const
/**
 * What an invoice was registered against. `shipment` anchors an export invoice to a container, the
 * key the per-container tax-refund file (`export_finance`) cross-links on (F-304).
 */
export const INVOICE_SOURCE_KINDS = ['purchase_order', 'sales_order', 'shipment', 'trade_document', 'manual'] as const
export const TRADE_DOCUMENT_KINDS = ['proforma', 'commercial'] as const
export const TRADE_DOCUMENT_DIRECTIONS = ['sales', 'purchase'] as const
export const TRADE_DOCUMENT_STATUSES = ['draft', 'issued', 'void'] as const
export const TRADE_DOCUMENT_TRANSITIONS = ['issue', 'void'] as const
export const TRADE_DOCUMENT_SOURCE_KINDS = ['sales_order', 'purchase_order', 'shipment', 'trade_document', 'manual'] as const

/**
 * The direction decides what the counterparty can be: we buy from a supplier and we sell to a
 * customer (a group branch's printable record is a `customer` too — Q-P-006 keeps the stored
 * vocabulary `supplier | customer` for reads, printing and filters).
 *
 * The kind stays a column rather than being derived on read so historical rows and their list
 * filters keep working; the pairing is enforced on every write, in the schema when both fields
 * travel together and in the command against the merged entity (partial updates send one half).
 */
export const COUNTERPARTY_KIND_BY_DIRECTION: Record<
  (typeof CONTRACT_DIRECTIONS)[number],
  (typeof COUNTERPARTY_KINDS)[number]
> = {
  purchase: 'supplier',
  sales: 'customer',
}

export const COUNTERPARTY_KIND_BY_INVOICE_DIRECTION: Record<
  (typeof INVOICE_DIRECTIONS)[number],
  (typeof COUNTERPARTY_KINDS)[number]
> = {
  inbound: 'supplier',
  outbound: 'customer',
}

/**
 * The message both layers share, or `null` when the pair is consistent. An absent half never fails
 * here: only the command sees the merged entity and is the authority for partial updates.
 */
export function counterpartyKindDirectionIssue(
  value: { direction?: unknown; counterpartyKind?: unknown },
  kindByDirection: Record<string, (typeof COUNTERPARTY_KINDS)[number]>,
): string | null {
  const direction = typeof value.direction === 'string' ? value.direction : undefined
  const kind = typeof value.counterpartyKind === 'string' ? value.counterpartyKind : undefined
  if (!direction || !kind) return null
  const expected = kindByDirection[direction]
  if (!expected || kind === expected) return null
  return `counterpartyKind must be "${expected}" when direction is "${direction}"`
}

function withCounterpartyKindRule<T extends z.ZodObject<z.ZodRawShape>>(
  schema: T,
  kindByDirection: Record<string, (typeof COUNTERPARTY_KINDS)[number]>,
) {
  return schema.superRefine((value, ctx) => {
    const message = counterpartyKindDirectionIssue(value as { direction?: unknown; counterpartyKind?: unknown }, kindByDirection)
    if (!message) return
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['counterpartyKind'], message })
  })
}

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
  unitPrice: decimalSchema(PRICE_SCALE, { min: '0' }),
  note: nullableText(500),
})

/**
 * Shared field list of a contract head. `counterpartyKind` is **derived from the direction** by the
 * command (`resolveCounterpartyKind`) and only accepted when the caller spells out the same value —
 * so it carries no default here.
 *
 * Defaults live on the create schema alone: `z.object(...).partial()` keeps them, and an update that
 * silently re-injected them would rewrite `direction`/`counterpartyKind`/`currencyCode` on every
 * partial PUT and — because `lines` defaulted to `[]`, which is truthy — wipe every line.
 */
const contractBase = {
  direction: z.enum(CONTRACT_DIRECTIONS),
  counterpartyKind: z.enum(COUNTERPARTY_KINDS).optional(),
  counterpartyId: z.string().uuid().nullable().optional(),
  counterpartySnapshot: snapshotSchema,
  ourPartySnapshot: snapshotSchema,
  priceTier: z.enum(PRODUCT_PRICE_TIERS).nullable().optional(),
  currencyCode: currencyCodeSchema,
  exchangeRate: nullableDecimalSchema(8, { min: '0' }),
  sourceKind: z.enum(['purchase_order', 'sales_order', 'manual']).nullable().optional(),
  sourceId: z.string().uuid().nullable().optional(),
  sourceSnapshot: snapshotSchema,
  signedAt: dateOnlySchema,
  deliveryDate: dateOnlySchema,
  paymentTerms: nullableText(500),
  shippingMethod: nullableText(200),
  incoterms: nullableText(200),
  destination: nullableText(200),
  marks: nullableText(500),
  notes: nullableText(2000),
  lines: z.array(contractLineInputSchema).max(500),
}

export const contractCreateSchema = withCounterpartyKindRule(
  z.object({
    ...contractBase,
    direction: contractBase.direction.default('purchase'),
    currencyCode: contractBase.currencyCode.default('CNY'),
    lines: contractBase.lines.default([]),
  }),
  COUNTERPARTY_KIND_BY_DIRECTION,
)

export const contractUpdateSchema = withCounterpartyKindRule(
  z.object(contractBase).partial().extend({
    id: z.string().uuid(),
  }),
  COUNTERPARTY_KIND_BY_DIRECTION,
)

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
  unitPrice: decimalSchema(PRICE_SCALE, { min: '0' }),
  /** The figure printed on the invoice; may differ from `quantity × unitPrice`. */
  amount: decimalSchema(AMOUNT_SCALE, { min: '0' }),
  /** Percentage (`13` = 13%); the tax **amount** is never posted — the server computes it. */
  taxRate: decimalSchema(3, { min: '0' }).default('0'),
  /** Whether the printed `amount` already includes tax; the server derives `taxAmount` from it. */
  priceIncludesTax: z.boolean().default(true),
  contractLineId: z.string().uuid().nullable().optional(),
})

const invoiceBase = {
  number: nullableText(64),
  invoiceKind: z.enum(INVOICE_KINDS).nullable().optional(),
  direction: z.enum(INVOICE_DIRECTIONS),
  counterpartyKind: z.enum(COUNTERPARTY_KINDS).optional(),
  counterpartyId: z.string().uuid().nullable().optional(),
  counterpartySnapshot: snapshotSchema,
  contractId: z.string().uuid().nullable().optional(),
  sourceKind: z.enum(INVOICE_SOURCE_KINDS).nullable().optional(),
  sourceId: z.string().uuid().nullable().optional(),
  sourceSnapshot: snapshotSchema,
  currencyCode: currencyCodeSchema,
  issuedAt: dateOnlySchema,
  notes: nullableText(2000),
  lines: z.array(invoiceLineInputSchema).max(500),
}

export const invoiceCreateSchema = withCounterpartyKindRule(
  z.object({
    ...invoiceBase,
    direction: invoiceBase.direction.default('inbound'),
    currencyCode: invoiceBase.currencyCode.default('CNY'),
    lines: invoiceBase.lines.default([]),
  }),
  COUNTERPARTY_KIND_BY_INVOICE_DIRECTION,
)

export const invoiceUpdateSchema = withCounterpartyKindRule(
  z.object(invoiceBase).partial().extend({
    id: z.string().uuid(),
  }),
  COUNTERPARTY_KIND_BY_INVOICE_DIRECTION,
)

export const invoiceTransitionSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(INVOICE_TRANSITIONS),
  reason: z.string().trim().max(500).optional(),
})

export const invoiceAttachSchema = z.object({
  id: z.string().uuid(),
  attachmentId: z.string().uuid().nullable(),
})

/**
 * One-shot copy of a PI/CI into a draft invoice. The source is named explicitly rather than read
 * off the invoice's own `sourceId`, so the operator can cross-copy (e.g. CI → invoice) without the
 * link having to pre-exist.
 */
export const invoiceCopySchema = z.object({
  id: z.string().uuid(),
  sourceDocumentId: z.string().uuid(),
})

export const invoiceListSchema = z.object({
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  /** Narrows a picker to the selected organization; see `contractListSchema`. */
  organizationId: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  direction: z.enum(INVOICE_DIRECTIONS).optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
  invoiceKind: z.enum(INVOICE_KINDS).optional(),
  contractId: z.string().uuid().optional(),
  counterpartyId: z.string().uuid().optional(),
  sourceKind: z.enum(INVOICE_SOURCE_KINDS).optional(),
  sourceId: z.string().uuid().optional(),
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

// ---------------------------------------------------------------------------------------
// Documents (PI / CI) — one family, discriminated by `kind`
// ---------------------------------------------------------------------------------------

export const documentLineInputSchema = z.object({
  productId: z.string().uuid().nullable().optional(),
  productSnapshot: snapshotSchema,
  name: nullableText(300),
  sku: nullableText(64),
  model: nullableText(120),
  spec: nullableText(500),
  unit: nullableText(24),
  quantity: decimalSchema(6, { min: '0' }),
  unitPrice: decimalSchema(PRICE_SCALE, { min: '0' }),
  /** The face amount; defaults to `quantity × unitPrice` server-side but may be overridden. */
  amount: decimalSchema(AMOUNT_SCALE, { min: '0' }).optional(),
  /** What the line was copied/raised from (product, shipment allocation, …), frozen at write time. */
  sourceSnapshot: snapshotSchema,
  note: nullableText(500),
})

const documentBase = {
  kind: z.enum(TRADE_DOCUMENT_KINDS),
  direction: z.enum(TRADE_DOCUMENT_DIRECTIONS),
  counterpartyKind: z.enum(COUNTERPARTY_KINDS).optional(),
  counterpartyId: z.string().uuid().nullable().optional(),
  counterpartySnapshot: snapshotSchema,
  ourPartySnapshot: snapshotSchema,
  consigneeSnapshot: snapshotSchema,
  notifyPartySnapshot: snapshotSchema,
  currencyCode: currencyCodeSchema,
  exchangeRate: nullableDecimalSchema(8, { min: '0' }),
  paymentTerms: nullableText(500),
  incoterms: nullableText(200),
  validUntil: dateOnlySchema,
  deliveryDate: dateOnlySchema,
  marks: nullableText(500),
  sourceKind: z.enum(TRADE_DOCUMENT_SOURCE_KINDS).nullable().optional(),
  sourceId: z.string().uuid().nullable().optional(),
  sourceSnapshot: snapshotSchema,
  notes: nullableText(2000),
  lines: z.array(documentLineInputSchema).max(500),
}

export const documentCreateSchema = withCounterpartyKindRule(
  z.object({
    ...documentBase,
    kind: documentBase.kind.default('proforma'),
    direction: documentBase.direction.default('sales'),
    currencyCode: documentBase.currencyCode.default('CNY'),
    lines: documentBase.lines.default([]),
  }),
  COUNTERPARTY_KIND_BY_DIRECTION,
)

export const documentUpdateSchema = withCounterpartyKindRule(
  z.object(documentBase).partial().extend({
    id: z.string().uuid(),
  }),
  COUNTERPARTY_KIND_BY_DIRECTION,
)

export const documentTransitionSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(TRADE_DOCUMENT_TRANSITIONS),
  reason: z.string().trim().max(500).optional(),
})

export const documentDocumentSchema = z.object({
  id: z.string().uuid(),
})

/**
 * One-shot roll-up of a shipment's allocations into a draft CI. `sourceId` overrides the anchor the
 * document already carries; when neither is present the caller has to name the shipment.
 */
export const documentAggregateSchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid().optional(),
})

/**
 * One-shot copy of a PI into a draft CI (or PI → PI). The source may be in any status — copying an
 * issued proforma into a new draft commercial invoice is the point of the flow — while the target
 * has to be a draft. The copy is never a live sync.
 */
export const documentCopySchema = z.object({
  id: z.string().uuid(),
  sourceDocumentId: z.string().uuid(),
})

/**
 * Binds (or clears) the uploaded replacement of a PI/CI (stamped/re-signed/customs copy).
 * `attachmentId: null` unbinds it; the generated XLSX keeps `generated_attachment_id`.
 */
export const documentAttachSchema = z.object({
  id: z.string().uuid(),
  attachmentId: z.string().uuid().nullable(),
})

export const documentLinesReplaceSchema = z.object({
  documentId: z.string().uuid(),
  lines: z.array(documentLineInputSchema).max(500),
})

export const documentListSchema = z.object({
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  /** Narrows a picker to the selected organization; see `contractListSchema`. */
  organizationId: z.string().uuid().optional(),
  kind: z.enum(TRADE_DOCUMENT_KINDS).optional(),
  status: z.enum(TRADE_DOCUMENT_STATUSES).optional(),
  direction: z.enum(TRADE_DOCUMENT_DIRECTIONS).optional(),
  counterpartyId: z.string().uuid().optional(),
  sourceKind: z.enum(TRADE_DOCUMENT_SOURCE_KINDS).optional(),
  sourceId: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(50),
  sortField: z.enum(['id', 'number', 'kind', 'status', 'total', 'issued_at', 'created_at', 'updated_at']).optional().default('created_at'),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
})

/** Read-only query for a document's lines (the detail page's lines surface). */
export const documentLineListSchema = z
  .object({
    id: z.string().uuid().optional(),
    documentId: z.string().uuid().optional(),
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
  })
  .passthrough()

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
export type DocumentCreateInput = z.infer<typeof documentCreateSchema>
export type DocumentUpdateInput = z.infer<typeof documentUpdateSchema>
export type DocumentLineInput = z.infer<typeof documentLineInputSchema>
export type DocumentTransitionInput = z.infer<typeof documentTransitionSchema>
export type DocumentListQuery = z.infer<typeof documentListSchema>
