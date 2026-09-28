import { z } from 'zod'
// The money engine owns the system-wide caliber: an amount is 2 decimals, a unit price 4, and
// every bound is compared as scaled integers rather than through a float.
import { AMOUNT_SCALE, toScaledUnits } from '../../trade_docs/lib/money'

/**
 * Input contracts for the finance module.
 *
 * Money is carried as decimal strings and normalized to the column's scale by the validators, so
 * neither the command nor the UI has to agree on formatting. A cost type is a dictionary value,
 * not an enum — the vocabulary lives in the `shipment_cost_type` / `finance_expense_type`
 * dictionaries and is checked against them by the commands.
 */

const uuid = () => z.string().uuid()

/** Plain decimal, optional sign; the scale check below is the real rule. */
const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/

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
      // The bound is compared as scaled integers: the value carries at most `scale` decimals by
      // this point, so `0.01` is respected exactly and a float artifact cannot slip past it.
      if (options.min !== undefined && toScaledUnits(value, scale) < toScaledUnits(options.min, scale)) {
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

/** A nullable decimal: an explicit value is normalized to the column's scale, `null` clears it. */
function nullableDecimalSchema(scale: number, options: { min?: string } = {}) {
  return z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((value) => (value === undefined || value === null || value === '' ? null : value))
    .pipe(z.union([decimalSchema(scale, options), z.null()]))
}

/**
 * A cost amount must be strictly positive — a zero-cost freight bill is a data-entry mistake — and
 * carries at most two decimals: the column is `numeric(18,2)` after the deployment-wide money-scale
 * normalization, so a third decimal would be silently rounded by the database instead of rejected
 * here. Derived figures (allocations, unit costs) keep four decimals; they are computed, not stored.
 */
const amountSchema = decimalSchema(AMOUNT_SCALE, { min: '0.01' })

/**
 * ISO-4217 shape only, exactly like the sibling contracts: membership in the currency master is a
 * business rule checked by the owning module, not by this schema.
 */
export const currencyCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, 'currency code must be a three-letter ISO code')
  .transform((value) => value.toUpperCase())

/** How one fee is spread over the container's purchase lines. */
export const SHIPMENT_COST_BASES = ['amount', 'quantity'] as const
export type ShipmentCostBasis = (typeof SHIPMENT_COST_BASES)[number]

/**
 * Sort fields the list accepts. Both spellings are listed for every column: the DataTable sends the
 * column's `accessorKey` (camelCase) and API clients may use the column name (snake_case); the
 * route's `sortFieldMap` resolves either to the database column.
 */
export const SHIPMENT_COST_SORT_FIELDS = [
  'id',
  'cost_type',
  'costType',
  'amount',
  'incurred_at',
  'incurredAt',
  'created_at',
  'createdAt',
  'updated_at',
  'updatedAt',
] as const
export const EXPENSE_SORT_FIELDS = [
  'period_start',
  'periodStart',
  'period_end',
  'periodEnd',
  'amount',
  'created_at',
  'createdAt',
] as const

const shipmentCostBody = {
  shipmentId: uuid(),
  shipmentNumber: z.string().trim().max(64).nullable().optional(),
  costType: z.string().trim().min(1).max(64),
  allocationBasis: z.enum(SHIPMENT_COST_BASES).default('amount'),
  amount: amountSchema,
  currencyCode: currencyCodeSchema.default('CNY'),
  exchangeRate: nullableDecimalSchema(8, { min: '0.00000001' }),
  incurredAt: z.string().min(1).nullable().optional(),
  partyId: uuid().nullable().optional(),
  partySnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  attachmentId: uuid().nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
}

export const shipmentCostCreateSchema = z.object(shipmentCostBody)

/** Update carries the record id plus the optimistic-lock version the client last read. */
export const shipmentCostUpdateSchema = z.object({
  id: uuid(),
  ...shipmentCostBody,
  updatedAt: z.string().min(1).nullable().optional(),
})

export const shipmentCostDeleteSchema = z.object({
  id: uuid(),
  updatedAt: z.string().min(1).nullable().optional(),
})

export const shipmentCostListSchema = z.object({
  id: uuid().optional(),
  ids: z.string().trim().max(2000).optional(),
  shipmentId: uuid().optional(),
  costType: z.string().trim().max(64).optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  sortField: z.enum(SHIPMENT_COST_SORT_FIELDS).default('created_at'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  format: z.enum(['json', 'csv']).optional(),
})

/** Read query of the landed-cost projection: exactly one of the two keys is required. */
export const landedCostQuerySchema = z.object({
  shipmentId: uuid().optional(),
  sku: z.string().trim().min(1).max(64).optional(),
  format: z.enum(['json', 'csv']).optional(),
})

/** Read query of the inventory-value projection. */
export const inventoryValueQuerySchema = z.object({
  warehouseId: uuid().optional(),
  asOf: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'asOf must be an ISO date')
    .optional(),
  format: z.enum(['json', 'csv']).optional(),
})

/** ISO date, normalized to `YYYY-MM-DD`; the columns are `date`, not timestamps. */
const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be an ISO date (YYYY-MM-DD)')

const expenseBody = {
  expenseType: z.string().trim().min(1).max(64),
  periodStart: isoDateSchema,
  periodEnd: isoDateSchema,
  amount: amountSchema,
  currencyCode: currencyCodeSchema.default('CNY'),
  exchangeRate: nullableDecimalSchema(8, { min: '0.00000001' }),
  channelId: uuid().nullable().optional(),
  channelSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  partyId: uuid().nullable().optional(),
  partySnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  attachmentId: uuid().nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
}

/**
 * A period is inclusive at both ends. An inverted period is a data-entry mistake, not a negative
 * span, so it is rejected instead of being normalized behind the operator's back.
 */
export const expenseCreateSchema = z
  .object(expenseBody)
  .refine((value) => value.periodEnd >= value.periodStart, {
    message: 'periodEnd must not be earlier than periodStart',
    path: ['periodEnd'],
  })

export const expenseUpdateSchema = z
  .object({ id: uuid(), ...expenseBody, updatedAt: z.string().min(1).nullable().optional() })
  .refine((value) => value.periodEnd >= value.periodStart, {
    message: 'periodEnd must not be earlier than periodStart',
    path: ['periodEnd'],
  })

export const expenseDeleteSchema = z.object({
  id: uuid(),
  updatedAt: z.string().min(1).nullable().optional(),
})

export const expenseListSchema = z.object({
  id: uuid().optional(),
  ids: z.string().trim().max(2000).optional(),
  expenseType: z.string().trim().max(64).optional(),
  channelId: uuid().optional(),
  periodStart: isoDateSchema.optional(),
  periodEnd: isoDateSchema.optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  sortField: z.enum(EXPENSE_SORT_FIELDS).default('period_start'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  format: z.enum(['json', 'csv']).optional(),
})

export type ExpenseCreateInput = z.infer<typeof expenseCreateSchema>
export type ExpenseUpdateInput = z.infer<typeof expenseUpdateSchema>
export type ExpenseListQuery = z.infer<typeof expenseListSchema>

export type ShipmentCostCreateInput = z.infer<typeof shipmentCostCreateSchema>
export type ShipmentCostUpdateInput = z.infer<typeof shipmentCostUpdateSchema>
export type ShipmentCostDeleteInput = z.infer<typeof shipmentCostDeleteSchema>
export type ShipmentCostListQuery = z.infer<typeof shipmentCostListSchema>
export type LandedCostQuery = z.infer<typeof landedCostQuerySchema>
export type InventoryValueQuery = z.infer<typeof inventoryValueQuerySchema>
