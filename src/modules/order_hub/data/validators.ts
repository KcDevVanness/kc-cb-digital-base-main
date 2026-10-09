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

/** One create-time child link. The command resolves and freezes each inside the root's transaction. */
export const companyOrderLinkEntrySchema = z.object({
  kind: z.enum(COMPANY_ORDER_LINK_KINDS),
  refId: z.string().uuid(),
})

/** No `number`, no scope: the server generates the number and derives the scope from the session. */
export const companyOrderCreateSchema = z.object({
  title: z.string().trim().max(200).nullable().optional(),
  orderDate: dateOnlySchema.optional(),
  etaDate: dateOnlySchema.nullable().optional(),
  status: z.enum(COMPANY_ORDER_STATUSES).optional(),
  notes: z.string().max(2000).nullable().optional(),
  /**
   * Optional default customer/supplier. A non-null id must resolve inside the writer's scope (else
   * 422) and its display name is frozen into the paired snapshot column. `null` is the same as
   * omitted on create.
   */
  customerPartyId: z.string().uuid().nullable().optional(),
  supplierId: z.string().uuid().nullable().optional(),
  /** Attach existing children while creating the root — one transaction, no second step. */
  links: z.array(companyOrderLinkEntrySchema).max(20).optional(),
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
  /**
   * Three-state like `title`: absent leaves the stored value alone, an id re-resolves and re-freezes
   * the snapshot, and an explicit `null` clears both halves. A non-null id outside the scope is 422.
   */
  customerPartyId: z.string().uuid().nullable().optional(),
  supplierId: z.string().uuid().nullable().optional(),
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

/**
 * The collaborator list of one root (REQ-014). `companyOrderId` is the dialog's only read; the
 * reverse direction (which roots an organization collaborates on) is not a page.
 */
export const companyOrderCollaboratorsListSchema = z.object({
  companyOrderId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().max(200).default(200),
})

/**
 * Whole-set replace of the collaborating organizations; like the link dialog the operator edits the
 * set as a whole, so this is not per-row. Only the **owner** organization may call it, and the body
 * carries the root version the dialog rendered with (409 on a stale one).
 */
export const companyOrderCollaboratorsReplaceSchema = z.object({
  companyOrderId: z.string().uuid(),
  organizationIds: z.array(z.string().uuid()).max(200),
  updatedAt: z.string().min(1).optional(),
})

export type CompanyOrderCreateInput = z.infer<typeof companyOrderCreateSchema>
export type CompanyOrderUpdateInput = z.infer<typeof companyOrderUpdateSchema>
export type CompanyOrderListQuery = z.infer<typeof companyOrderListSchema>
export type CompanyOrderLinksListQuery = z.infer<typeof companyOrderLinksListSchema>
export type CompanyOrderLinksReplaceInput = z.infer<typeof companyOrderLinksReplaceSchema>
export type CompanyOrderLinkChildInput = z.infer<typeof companyOrderLinkChildSchema>
export type CompanyOrderCollaboratorsListQuery = z.infer<typeof companyOrderCollaboratorsListSchema>
export type CompanyOrderCollaboratorsReplaceInput = z.infer<typeof companyOrderCollaboratorsReplaceSchema>

/**
 * Named error codes the collaboration write path answers with, so a caller (and the integration
 * test) can tell the three refusals apart without matching on prose:
 *   - `company_order_owner_required` — the caller may *see* the root (collaborator) but the action
 *     is owner-only (delete, links/collaborators replace, link-child onto an existing root);
 *   - `collaborator_field_not_allowed` — a collaborator wrote a field outside `status`/`notes`;
 *   - `collaborator_organization_not_found` — a requested collaborator organization is unknown or
 *     outside the writer's tenant.
 */
export const COMPANY_ORDER_OWNER_REQUIRED_CODE = 'company_order_owner_required' as const
export const COMPANY_ORDER_COLLABORATOR_FIELD_CODE = 'collaborator_field_not_allowed' as const
export const COMPANY_ORDER_COLLABORATOR_ORGANIZATION_CODE = 'collaborator_organization_not_found' as const
