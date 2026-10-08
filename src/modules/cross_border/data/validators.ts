import { z } from 'zod'
import { PRICE_SCALE, toScaledUnits } from '../../trade_docs/lib/money'

/**
 * Allocation quantities live on a `numeric(18,4)` column, and both quantity paths (purchase-order
 * lines and internal-sales-order lines) share this one caliber: at most 4 decimals, compared and
 * stored as exact decimals — never re-read through a float.
 */
export const ALLOCATION_QUANTITY_SCALE = 4

export const SHIPMENT_STATUSES = ['draft', 'in_transit', 'received', 'closed', 'cancelled'] as const
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number]

/** Ordered transit stages: a lower stage may never follow a higher one. */
export const SHIPMENT_MILESTONES = ['picked_up', 'export_customs', 'in_transit', 'arrived', 'cleared', 'warehoused'] as const
export type ShipmentMilestone = (typeof SHIPMENT_MILESTONES)[number]

/**
 * Export paperwork kinds. `so` and `telex_release` are the booking and release documents — their
 * number lives on the shipment's `booking_number`, never on the row — and the two receipt kinds
 * are recorded as several rows when one shipment collects more than one file.
 */
export const EXPORT_DOC_TYPES = [
  'customs_declaration',
  'packing_list',
  'commercial_invoice',
  'bill_of_lading',
  'so',
  'telex_release',
  'domestic_freight_receipt',
  'booking_charges_receipt',
  'other',
] as const
export type ExportDocType = (typeof EXPORT_DOC_TYPES)[number]

const uuid = () => z.string().uuid()
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional()
const optionalDate = () => z.string().min(1).nullable().optional()

/**
 * Decimal columns keep every digit they are given: a quantity or unit price with more decimals
 * than the column holds is rejected instead of silently rounded, because the value is a frozen
 * snapshot of an internal sales price. Arithmetic follows the same decimal-string convention as
 * the trade documents module, and the lower bound is compared as scaled integers (`toScaledUnits`)
 * so a value a ten-thousandth over the bound is not judged by float noise.
 */
const DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/

function decimalSchema(scale: number, options: { min?: string; minExclusive?: boolean } = {}) {
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
      if (value.startsWith('-') && value !== '-0') {
        ctx.addIssue({ code: 'custom', message: 'value must not be negative' })
        return
      }
      if (options.min !== undefined) {
        const valueUnits = toScaledUnits(value, scale)
        const minUnits = toScaledUnits(options.min, scale)
        if (options.minExclusive ? valueUnits <= minUnits : valueUnits < minUnits) {
          ctx.addIssue({
            code: 'custom',
            message: options.minExclusive ? `value must be greater than ${options.min}` : `value must be at least ${options.min}`,
          })
        }
      }
    })
    .transform((value) => {
      const negative = value.startsWith('-')
      const digits = negative ? value.slice(1) : value
      const [integerPart, fractionPart = ''] = digits.split('.')
      const padded = fractionPart.padEnd(scale, '0')
      // Whole-number columns (箱数 / 体积) render bare: `3`, never `3.` — the same formulation the
      // products module uses for its scale-0 decimals.
      return `${negative && !/^0*$/.test(integerPart + padded) ? '-' : ''}${integerPart}${scale > 0 ? `.${padded}` : ''}`
    })
}

const nullableDecimalSchema = (scale: number, options: { min?: string } = {}) =>
  z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((value) => (value === null || value === undefined ? null : value))
    .pipe(z.union([decimalSchema(scale, options), z.null()]))

const allocationInputSchema = z.object({
  purchaseOrderLineId: uuid(),
  // Normalized to the column's scale and compared as scaled integers: a value with a fifth
  // decimal, an exponent string (`1e-7`) or a float artifact (`0.30000000000000004`) is a 400
  // instead of being rounded onto the column, and zero is not an allocation.
  quantity: decimalSchema(ALLOCATION_QUANTITY_SCALE, { min: '0', minExclusive: true }),
})

/**
 * One shipment ↔ internal-sales-order-line allocation, as the form submits it. The sales order id
 * and number are server-resolved from the line where possible; the price/currency are the frozen
 * snapshot the operator may adjust before saving. ISO-4217-shaped codes are uppercased rather
 * than rejected, mirroring the trade documents module.
 */
export const salesAllocationInputSchema = z.object({
  salesOrderId: uuid(),
  salesOrderLineId: uuid(),
  salesOrderNumber: optionalText(200),
  catalogProductId: uuid(),
  productSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  quantity: decimalSchema(ALLOCATION_QUANTITY_SCALE, { min: '0' }),
  unitPrice: nullableDecimalSchema(PRICE_SCALE, { min: '0' }),
  currencyCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, 'currency code must be a three-letter ISO code')
    .transform((value) => value.toUpperCase())
    .nullable()
    .optional(),
})

/**
 * One shipment ↔ purchase/sales-contract link, as the form submits it.
 *
 * Only the contract id travels: the number and direction are resolved server-side from
 * `trade_docs_contracts` and frozen on the row, so a tampered label cannot change what is stored.
 * The set is replaced wholesale, exactly like the allocations.
 */
export const shipmentContractInputSchema = z.object({
  contractId: uuid(),
})

/**
 * One packing-list line, as the form submits it.
 *
 * Every measurement is optional and editable — a line can be registered before the packing is
 * finished. Quantities and weights allow at most 4 decimals (the module's allocation caliber),
 * cartons and volume are whole numbers (箱数 / cm³), matching the product master's own columns.
 */
export const exportDocumentLineInputSchema = z.object({
  productId: uuid().nullable().optional(),
  productSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  name: optionalText(300),
  sku: optionalText(100),
  unit: optionalText(32),
  quantity: nullableDecimalSchema(ALLOCATION_QUANTITY_SCALE, { min: '0' }),
  cartons: nullableDecimalSchema(0, { min: '0' }),
  grossWeight: nullableDecimalSchema(4, { min: '0' }),
  netWeight: nullableDecimalSchema(4, { min: '0' }),
  volume: nullableDecimalSchema(0, { min: '0' }),
  sourceSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  note: optionalText(500),
})

/** Read-only list queries for the two child collections the detail pages read. */
export const shipmentContractListSchema = z.object({
  id: uuid().optional(),
  shipmentId: uuid().optional(),
  contractId: uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(100),
})

export const exportDocumentLineListSchema = z.object({
  id: uuid().optional(),
  documentId: uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(500).default(200),
  sortField: z.enum(['id', 'line_number']).optional().default('line_number'),
  sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
})

export const shipmentCreateSchema = z.object({
  carrierName: optionalText(200),
  forwarderContact: optionalText(200),
  departurePort: optionalText(200),
  containerType: optionalText(64),
  containerNumber: optionalText(64),
  sealNumber: optionalText(64),
  bookingNumber: optionalText(64),
  destinationWarehouseId: uuid().nullable().optional(),
  destinationLocationId: uuid().nullable().optional(),
  etd: optionalDate(),
  eta: optionalDate(),
  notes: optionalText(2000),
  allocations: z.array(allocationInputSchema).min(1),
  salesAllocations: z.array(salesAllocationInputSchema).max(500).default([]),
  contracts: z.array(shipmentContractInputSchema).max(50).default([]),
})

export const shipmentUpdateSchema = shipmentCreateSchema.partial().extend({
  id: uuid(),
  allocations: z.array(allocationInputSchema).min(1).optional(),
  // Absent = leave the stored set untouched; an explicit list (including `[]`) replaces it wholesale.
  salesAllocations: z.array(salesAllocationInputSchema).max(500).optional(),
  contracts: z.array(shipmentContractInputSchema).max(50).optional(),
})

export const shipmentListSchema = z.object({
  id: uuid().optional(),
  ids: z.string().optional(),
  search: z.string().max(200).optional(),
  containerNumber: z.string().max(64).optional(),
  status: z.enum(SHIPMENT_STATUSES).optional(),
  /** Only shipments linked to this purchase/sales contract. */
  contractId: uuid().optional(),
  /** Only shipments carrying goods from this sales order — the order hub's 发运单 section. */
  salesOrderId: uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  sortField: z.enum(['id', 'number', 'status', 'eta', 'created_at', 'updated_at']).optional().default('created_at'),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
})

export const shipmentDepartSchema = z.object({ id: uuid() })

/** Archival: a received shipment is closed once its paperwork and settlement are done. */
export const shipmentCloseSchema = z.object({ id: uuid() })

export const shipmentReceiveSchema = z.object({
  id: uuid(),
  warehouseId: uuid(),
  locationId: uuid(),
})

export const shipmentCancelSchema = z.object({
  id: uuid(),
  reason: z.string().trim().min(1).max(500),
})

export const milestoneAdvanceSchema = z.object({
  shipmentId: uuid(),
  milestone: z.enum(SHIPMENT_MILESTONES),
  occurredAt: optionalDate(),
  note: optionalText(500),
})

export const milestoneListSchema = z.object({
  id: uuid().optional(),
  shipmentId: uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(100),
})

export const allocationListSchema = z.object({
  id: uuid().optional(),
  shipmentId: uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(100),
})

export const salesAllocationListSchema = z.object({
  id: uuid().optional(),
  shipmentId: uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(100),
})

export const documentCreateSchema = z.object({
  shipmentId: uuid(),
  docType: z.enum(EXPORT_DOC_TYPES),
  documentNumber: optionalText(200),
  issuedAt: optionalDate(),
  purchaseOrderId: uuid().nullable().optional(),
  attachmentId: uuid().nullable().optional(),
  note: optionalText(1000),
  // Detailed lines are a packing-list feature; the command refuses them on any other doc type.
  lines: z.array(exportDocumentLineInputSchema).max(500).default([]),
})

export const documentUpdateSchema = documentCreateSchema.partial().extend({
  id: uuid(),
  // Absent = leave the stored lines untouched; an explicit list (including `[]`) replaces them
  // wholesale.
  lines: z.array(exportDocumentLineInputSchema).max(500).optional(),
})

export const documentListSchema = z.object({
  id: uuid().optional(),
  shipmentId: uuid().optional(),
  docType: z.enum(EXPORT_DOC_TYPES).optional(),
  /** Only documents whose shipment is linked to this purchase/sales contract. */
  contractId: uuid().optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(100),
})

export type ShipmentCreateInput = z.infer<typeof shipmentCreateSchema>
export type ShipmentUpdateInput = z.infer<typeof shipmentUpdateSchema>
export type ShipmentListQuery = z.infer<typeof shipmentListSchema>
export type ShipmentReceiveInput = z.infer<typeof shipmentReceiveSchema>
export type MilestoneAdvanceInput = z.infer<typeof milestoneAdvanceSchema>
export type DocumentCreateInput = z.infer<typeof documentCreateSchema>
export type DocumentUpdateInput = z.infer<typeof documentUpdateSchema>
export type ShipmentContractInput = z.infer<typeof shipmentContractInputSchema>
export type ExportDocumentLineInput = z.infer<typeof exportDocumentLineInputSchema>
export type ShipmentContractListQuery = z.infer<typeof shipmentContractListSchema>
export type ExportDocumentLineListQuery = z.infer<typeof exportDocumentLineListSchema>
