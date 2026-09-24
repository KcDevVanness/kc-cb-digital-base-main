import { z } from 'zod'
import { SHIPMENT_STATUSES } from '../../cross_border/data/validators'

/**
 * Input contracts for the export-finance module.
 *
 * `nullable().optional()` on the free-text fields is deliberate and matches the rest of the app:
 * `undefined` means "leave unchanged", `null` means "clear the field", so clearing a value
 * round-trips through validator, command, entity, API and form instead of silently reverting.
 */

/** 是否已收款. `unknown` is the absence of an answer — never rendered as "not received". */
export const EXPORT_FINANCE_COLLECTION_STATUSES = ['received', 'not_received', 'unknown'] as const
export type ExportFinanceCollectionStatus = (typeof EXPORT_FINANCE_COLLECTION_STATUSES)[number]

/** 退税状态, in ascending order of completion (see `aggregateRefundStatus`). */
export const EXPORT_FINANCE_TAX_REFUND_STATUSES = ['completed', 'applied', 'not_started', 'unknown'] as const
export type ExportFinanceTaxRefundStatus = (typeof EXPORT_FINANCE_TAX_REFUND_STATUSES)[number]

export const COLLECTION_DOC_TYPES = ['foreign_income_certificate', 'other'] as const
export type CollectionDocType = (typeof COLLECTION_DOC_TYPES)[number]

export const REFUND_DOC_TYPES = ['tax_refund_package', 'report_draft', 'other'] as const
export type RefundDocType = (typeof REFUND_DOC_TYPES)[number]

/** The two outputs of the order file; the query key switches the column set. */
export const ORDER_FILE_VIEWS = ['business', 'finance'] as const
export type OrderFileView = (typeof ORDER_FILE_VIEWS)[number]

/** Derived business statuses (never stored — see `deriveBusinessStatus`). */
export const ORDER_FILE_STATUSES = [
  'cancelled',
  'closed',
  'received',
  'shipped',
  'factory_pickup',
  'placed',
  'draft',
] as const
export type OrderFileStatus = (typeof ORDER_FILE_STATUSES)[number]

export const ORDER_FILE_SORT_FIELDS = ['placed_at', 'expected_delivery', 'total'] as const
export const CONTAINER_FILE_SORT_FIELDS = ['departed_at', 'eta', 'number'] as const

const uuid = () => z.string().uuid()
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional()
const optionalDate = () => z.string().min(1).nullable().optional()

/**
 * ISO-4217 shape only, exactly like the purchasing contract: membership in the seeded currency
 * dictionary is a business rule checked by the owning module, not by this schema.
 */
export const currencyCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, 'currency code must be a three-letter ISO code')
  .transform((value) => value.toUpperCase())

/** Amounts are entered by finance with at most two decimals; the column stores four. */
const TAX_REFUND_AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/

export const taxRefundAmountSchema = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined || value === null) return null
    const text = typeof value === 'number' ? String(value) : value.trim()
    return text.length === 0 ? null : text
  })
  .refine((value) => value === null || TAX_REFUND_AMOUNT_PATTERN.test(value), {
    message: 'amount must be a positive decimal with at most 2 decimal places',
  })

/**
 * 收汇档案 (order level). The order id is the upsert key; the number and currency travel as
 * display snapshots sent by the client, so the command never reads a peer module's table.
 */
export const collectionSaveSchema = z.object({
  purchaseOrderId: uuid(),
  purchaseOrderNumber: optionalText(64),
  currencyCode: currencyCodeSchema.default('CNY'),
  collectionStatus: z.enum(EXPORT_FINANCE_COLLECTION_STATUSES),
  updatedAt: optionalText(64),
})

/** 退税档案 (container level). Same shape, keyed by the shipment. */
export const refundSaveSchema = z.object({
  shipmentId: uuid(),
  shipmentNumber: optionalText(64),
  currencyCode: currencyCodeSchema.default('CNY'),
  taxRefundStatus: z.enum(EXPORT_FINANCE_TAX_REFUND_STATUSES),
  taxRefundAmount: taxRefundAmountSchema,
  taxRefundNote: optionalText(500),
  updatedAt: optionalText(64),
})

export const collectionDocumentCreateSchema = z.object({
  collectionId: uuid(),
  docType: z.enum(COLLECTION_DOC_TYPES),
  issuedAt: optionalDate(),
  attachmentId: uuid().nullable().optional(),
  note: optionalText(500),
})

export const collectionDocumentUpdateSchema = collectionDocumentCreateSchema
  .omit({ collectionId: true })
  .partial()
  .extend({ id: uuid() })

export const collectionDocumentListSchema = z.object({
  id: uuid().optional(),
  collectionId: uuid().optional(),
  docType: z.enum(COLLECTION_DOC_TYPES).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(100),
})

export const refundDocumentCreateSchema = z.object({
  refundId: uuid(),
  docType: z.enum(REFUND_DOC_TYPES),
  issuedAt: optionalDate(),
  attachmentId: uuid().nullable().optional(),
  note: optionalText(500),
})

export const refundDocumentUpdateSchema = refundDocumentCreateSchema
  .omit({ refundId: true })
  .partial()
  .extend({ id: uuid() })

export const refundDocumentListSchema = z.object({
  id: uuid().optional(),
  refundId: uuid().optional(),
  docType: z.enum(REFUND_DOC_TYPES).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(100),
})

/** 订单档案 list query. `view` switches the CSV column set, not the row set. */
export const orderFileListSchema = z.object({
  purchaseOrderId: uuid().optional(),
  view: z.enum(ORDER_FILE_VIEWS).default('business'),
  status: z.enum(ORDER_FILE_STATUSES).optional(),
  collectionStatus: z.enum(EXPORT_FINANCE_COLLECTION_STATUSES).optional(),
  taxRefundStatus: z.enum(EXPORT_FINANCE_TAX_REFUND_STATUSES).optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  sortField: z.enum(ORDER_FILE_SORT_FIELDS).default('placed_at'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  format: z.enum(['json', 'csv']).optional(),
})

/** 柜档案 list query. */
export const containerFileListSchema = z.object({
  shipmentId: uuid().optional(),
  status: z.enum(SHIPMENT_STATUSES).optional(),
  taxRefundStatus: z.enum(EXPORT_FINANCE_TAX_REFUND_STATUSES).optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  sortField: z.enum(CONTAINER_FILE_SORT_FIELDS).default('departed_at'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  format: z.enum(['json', 'csv']).optional(),
})

export type CollectionSaveInput = z.infer<typeof collectionSaveSchema>
export type RefundSaveInput = z.infer<typeof refundSaveSchema>
export type CollectionDocumentCreateInput = z.infer<typeof collectionDocumentCreateSchema>
export type RefundDocumentCreateInput = z.infer<typeof refundDocumentCreateSchema>
export type OrderFileListQuery = z.infer<typeof orderFileListSchema>
export type ContainerFileListQuery = z.infer<typeof containerFileListSchema>
