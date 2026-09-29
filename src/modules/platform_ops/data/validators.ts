import { z } from 'zod'
import { exactDecimalToString, parseExactDecimal } from '@open-mercato/core/modules/dashboards/lib/exactDecimal'

export const RECONCILIATION_KINDS = ['missing_in_erp', 'amount_mismatch', 'duplicate_line'] as const
export type ReconciliationKind = (typeof RECONCILIATION_KINDS)[number]

export const RECONCILIATION_STATUSES = ['open', 'resolved', 'ignored'] as const

const uuid = () => z.string().uuid()
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional()
const optionalDate = () => z.string().min(1).nullable().optional()

/**
 * Amounts arrive from marketplaces either as JSON numbers or as decimal strings; both are accepted
 * and normalized to a decimal string.
 *
 * The value is **never rounded here**: platform data is external integration traffic, so a payload
 * carrying more than the amount caliber's 2 decimals is quantized explicitly — and warned about —
 * by the ingest command, where the extra precision stays visible instead of being silently
 * truncated by the validator.
 */
const amount = (label: string, options: { nonNegative?: boolean } = {}) =>
  z.union([z.string(), z.number()]).transform((value, ctx) => {
    const parsed = parseExactDecimal(value)
    if (!parsed) {
      ctx.addIssue({ code: 'custom', message: `${label} must be a finite decimal` })
      return z.NEVER
    }
    if (options.nonNegative && parsed.units < 0n) {
      ctx.addIssue({ code: 'custom', message: `${label} must not be negative` })
      return z.NEVER
    }
    return exactDecimalToString(parsed)
  })

export const channelCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().min(1).max(64),
  platform: z.string().trim().min(1).max(80),
  externalAccountId: optionalText(200),
  currencyCode: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()),
  isActive: z.boolean().optional(),
  notes: optionalText(1000),
})

export const channelUpdateSchema = channelCreateSchema.partial().extend({ id: uuid() })

export const channelListSchema = z.object({
  id: uuid().optional(),
  ids: z.string().optional(),
  search: z.string().max(200).optional(),
  platform: z.string().max(80).optional(),
  isActive: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined
      if (typeof value === 'boolean') return value
      const normalized = value.trim().toLowerCase()
      if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
      if (['0', 'false', 'no', 'off'].includes(normalized)) return false
      return undefined
    }),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  sortField: z.enum(['id', 'name', 'code', 'platform', 'created_at']).optional().default('created_at'),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
})

/** One platform order as received; the transport maps its payload into this shape. */
export const platformOrderInputSchema = z.object({
  externalOrderId: z.string().trim().min(1).max(200),
  status: optionalText(80),
  currencyCode: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()).optional(),
  grossAmount: amount('grossAmount', { nonNegative: true }).optional(),
  feeAmount: amount('feeAmount', { nonNegative: true }).optional(),
  netAmount: amount('netAmount').optional(),
  placedAt: optionalDate(),
  shipmentId: uuid().nullable().optional(),
  shipmentNumber: optionalText(120),
})

export const orderIngestSchema = z.object({
  channelId: uuid(),
  orders: z.array(platformOrderInputSchema).min(1).max(500),
})

export const orderListSchema = z.object({
  id: uuid().optional(),
  channelId: uuid().optional(),
  search: z.string().max(200).optional(),
  status: z.string().max(80).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  sortField: z.enum(['id', 'external_order_id', 'placed_at', 'created_at']).optional().default('created_at'),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
})

export const settlementLineInputSchema = z.object({
  externalOrderId: z.string().trim().min(1).max(200),
  grossAmount: amount('grossAmount', { nonNegative: true }).optional(),
  feeAmount: amount('feeAmount', { nonNegative: true }).optional(),
  netAmount: amount('netAmount').optional(),
})

export const settlementImportSchema = z.object({
  channelId: uuid(),
  settlement: z.object({
    externalSettlementId: z.string().trim().min(1).max(200),
    periodStart: optionalDate(),
    periodEnd: optionalDate(),
    currencyCode: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()).optional(),
    grossAmount: amount('settlement.grossAmount').optional(),
    feeAmount: amount('settlement.feeAmount').optional(),
    netAmount: amount('settlement.netAmount').optional(),
    receivedAt: optionalDate(),
  }),
  lines: z.array(settlementLineInputSchema).min(1).max(2000),
})

export const settlementListSchema = z.object({
  id: uuid().optional(),
  channelId: uuid().optional(),
  status: z.string().max(40).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  sortField: z.enum(['id', 'period_end', 'created_at']).optional().default('created_at'),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
})

export const settlementLineListSchema = z.object({
  id: uuid().optional(),
  settlementId: uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(100),
})

export const reconciliationListSchema = z.object({
  id: uuid().optional(),
  channelId: uuid().optional(),
  kind: z.enum(RECONCILIATION_KINDS).optional(),
  status: z.enum(RECONCILIATION_STATUSES).optional().default('open'),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  sortField: z.enum(['id', 'kind', 'created_at']).optional().default('created_at'),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
})

export const reconciliationResolveSchema = z.object({
  id: uuid(),
  note: z.string().trim().min(1).max(500),
})

export const reconciliationIgnoreSchema = z.object({
  id: uuid(),
  note: z.string().trim().min(1).max(500),
})

export type ChannelCreateInput = z.infer<typeof channelCreateSchema>
export type ChannelUpdateInput = z.infer<typeof channelUpdateSchema>
export type OrderIngestInput = z.infer<typeof orderIngestSchema>
export type SettlementImportInput = z.infer<typeof settlementImportSchema>
export type ChannelListQuery = z.infer<typeof channelListSchema>
export type OrderListQuery = z.infer<typeof orderListSchema>
export type ReconciliationListQuery = z.infer<typeof reconciliationListSchema>
