import { z } from 'zod'

/**
 * Company-order statuses.
 *
 * A module constant, not a dictionary: the status is the operator's own marker on the root record
 * (the sales engine keeps its own status dictionary, which is a different concern). The four values
 * match the purchasing module's scheme for familiarity.
 */
export const COMPANY_ORDER_STATUSES = ['draft', 'in_progress', 'completed', 'cancelled'] as const
export type CompanyOrderStatus = (typeof COMPANY_ORDER_STATUSES)[number]

/**
 * The child kinds a company order can hold this phase. The values are the frozen API/event
 * vocabulary Phases 2–3 read; a fourth kind is additive.
 */
export const COMPANY_ORDER_LINK_KINDS = [
  'internal_sales_order',
  'external_sales_order',
  'purchase_order',
] as const
export type CompanyOrderLinkKind = (typeof COMPANY_ORDER_LINK_KINDS)[number]

/** A `date` column: a `YYYY-MM-DD` calendar day, never a timestamp. */
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date')

/** No `number`, no scope: the server generates the number and derives the scope from the session. */
export const companyOrderCreateSchema = z.object({
  title: z.string().trim().max(200).nullable().optional(),
  orderDate: dateOnlySchema.optional(),
  etaDate: dateOnlySchema.nullable().optional(),
  status: z.enum(COMPANY_ORDER_STATUSES).optional(),
  notes: z.string().max(2000).nullable().optional(),
})

/**
 * Update carries the record version so the command can enforce the optimistic lock; every editable
 * field is optional, and an explicit `null` clears a nullable one (`title`/`etaDate`/`notes`).
 */
export const companyOrderUpdateSchema = z.object({
  id: z.string().uuid(),
  updatedAt: z.string().min(1).optional(),
  title: z.string().trim().max(200).nullable().optional(),
  orderDate: dateOnlySchema.optional(),
  etaDate: dateOnlySchema.nullable().optional(),
  status: z.enum(COMPANY_ORDER_STATUSES).optional(),
  notes: z.string().max(2000).nullable().optional(),
})

export const companyOrderListSchema = z.object({
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  search: z.string().max(200).optional(),
  status: z.enum(COMPANY_ORDER_STATUSES).optional(),
  kind: z.enum(COMPANY_ORDER_LINK_KINDS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sortField: z
    .enum(['id', 'number', 'title', 'order_date', 'eta_date', 'status', 'created_at', 'updated_at'])
    .optional()
    .default('created_at'),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
})

/**
 * The link list. `companyOrderId` is the primary filter (a company order's own attach block);
 * `refId` is the reverse lookup ("which company order holds this document", used by the legacy-URL
 * resolution). Either may be supplied; the route rejects a request that supplies neither.
 */
export const companyOrderLinksListSchema = z.object({
  companyOrderId: z.string().uuid().optional(),
  refId: z.string().uuid().optional(),
  kind: z.enum(COMPANY_ORDER_LINK_KINDS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

/** Whole-set replace for one kind: the dialog edits the set as a whole, so this is not per-row. */
export const companyOrderLinksReplaceSchema = z.object({
  companyOrderId: z.string().uuid(),
  kind: z.enum(COMPANY_ORDER_LINK_KINDS),
  refs: z.array(z.object({ refId: z.string().uuid() })).max(200),
  updatedAt: z.string().min(1).optional(),
})

/** Attach one child; with no `companyOrderId` a sales-kind child gets a fresh draft root. */
export const companyOrderLinkChildSchema = z.object({
  kind: z.enum(COMPANY_ORDER_LINK_KINDS),
  refId: z.string().uuid(),
  companyOrderId: z.string().uuid().optional(),
})

export type CompanyOrderCreateInput = z.infer<typeof companyOrderCreateSchema>
export type CompanyOrderUpdateInput = z.infer<typeof companyOrderUpdateSchema>
export type CompanyOrderListQuery = z.infer<typeof companyOrderListSchema>
export type CompanyOrderLinksListQuery = z.infer<typeof companyOrderLinksListSchema>
export type CompanyOrderLinksReplaceInput = z.infer<typeof companyOrderLinksReplaceSchema>
export type CompanyOrderLinkChildInput = z.infer<typeof companyOrderLinkChildSchema>
