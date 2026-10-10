import { z } from 'zod'

/**
 * Company-order statuses — the operator's own marker on the root record, in the deal's own order:
 * 已下单 → 生产 → 工厂提货 → 已报关 → 已装运 → 路上 → 到仓库 (2026-10-09 owner vocabulary). A module
 * constant, not a dictionary: the sales engine keeps its own status dictionary, which is a different
 * concern.
 */
export const COMPANY_ORDER_STATUSES = [
  'placed',
  'in_production',
  'factory_pickup',
  'customs_declared',
  'shipped',
  'in_transit',
  'warehoused',
] as const
export type CompanyOrderStatus = (typeof COMPANY_ORDER_STATUSES)[number]

/**
 * The vocabulary this field used before 2026-10-09 (草稿/进行中/已完成/已取消). Rows written then still
 * carry one of these, so three things hold: validation keeps accepting them (an edit that does not
 * touch the status must not 400), their labels stay in the catalogs, and the picker re-offers a
 * row's own value — opening an old root can therefore never silently rewrite its status on an
 * unrelated save. New rows never get one of these values.
 */
export const LEGACY_COMPANY_ORDER_STATUSES = ['draft', 'in_progress', 'completed', 'cancelled'] as const
export type LegacyCompanyOrderStatus = (typeof LEGACY_COMPANY_ORDER_STATUSES)[number]

/** What a stored status may be — the picker offers less than this (see `companyOrderStatusOptions`). */
export const COMPANY_ORDER_STORED_STATUSES = [
  ...COMPANY_ORDER_STATUSES,
  ...LEGACY_COMPANY_ORDER_STATUSES,
] as const

/** The picker's options: the current vocabulary, plus the row's own value when it predates it. */
export function companyOrderStatusOptions(current?: string | null): string[] {
  const options: string[] = [...COMPANY_ORDER_STATUSES]
  if (
    current &&
    !options.includes(current) &&
    (COMPANY_ORDER_STORED_STATUSES as readonly string[]).includes(current)
  ) {
    options.push(current)
  }
  return options
}

/**
 * 是否已收款 — the operator's own marker on the root (the spreadsheet column of the same name).
 * `unpaid` is what a fresh order starts as; `paid_full` is only ever set by a human. `null` is
 * reserved for rows written before the column existed: the UI renders those as “—” instead of
 * claiming money has or has not arrived.
 */
export const COMPANY_ORDER_PAYMENT_STATUSES = ['paid_full', 'unpaid'] as const
export type CompanyOrderPaymentStatus = (typeof COMPANY_ORDER_PAYMENT_STATUSES)[number]

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

/**
 * The named document slots of a company order (REQ-020): the one-to-one binding between a
 * 35-column document field and the file(s) stored for it. The codes are aligned with the peer
 * modules' own document vocabularies (`cross_border` `EXPORT_DOC_TYPES`, `export_finance`
 * `COLLECTION_DOC_TYPES`) so the summary projection can line a slot up with the child-derived
 * signal of the same kind; `kc_invoice_stamp` and `purchase_slip_invoice` are fields only the
 * order itself represents (a contract attachment and purchasing payment files are their child
 * sources). "Other" is deliberately absent: the root's generic attachments block is that slot.
 */
export const COMPANY_ORDER_DOCUMENT_SLOTS = [
  'commercial_invoice',
  'packing_list',
  'bill_of_lading',
  'telex_release',
  'customs_declaration',
  'domestic_freight_receipt',
  'booking_charges_receipt',
  'purchase_slip_invoice',
  'foreign_income_certificate',
  'kc_invoice_stamp',
] as const
export type CompanyOrderDocumentSlot = (typeof COMPANY_ORDER_DOCUMENT_SLOTS)[number]

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
  status: z.enum(COMPANY_ORDER_STORED_STATUSES).optional(),
  /**
   * 是否已收款. Omitted on create stores the fresh-order default (`unpaid`); an explicit `null` keeps
   * the marker unrecorded (“—”), because the column is three-state on purpose.
   */
  paymentStatus: z.enum(COMPANY_ORDER_PAYMENT_STATUSES).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  /**
   * 订单描述（字典 `product_category` 码）与 采购负责人（人员 id + 冻结显示快照）——根单持有，
   * 关联的采购单只镜像显示。`null` 与缺席同义（新字段无默认值）。
   */
  productCategory: z.string().trim().max(64).nullable().optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  ownerSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
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
  status: z.enum(COMPANY_ORDER_STORED_STATUSES).optional(),
  /** Three-state like `title`: absent leaves the stored value, a value sets it, `null` clears it. */
  paymentStatus: z.enum(COMPANY_ORDER_PAYMENT_STATUSES).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  /**
   * 订单描述/采购负责人：三态与 `title` 相同——缺席不动、给值即写、显式 `null` 清空（两个字段都清，
   * 快照没有单独清法的意义）。变更会向后镜像到已关联的采购单（见 events 的 order_fields_updated）。
   */
  productCategory: z.string().trim().max(64).nullable().optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  ownerSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
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
  // The filter accepts the legacy values too: old rows still carry them and can be narrowed by them.
  status: z.enum(COMPANY_ORDER_STORED_STATUSES).optional(),
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

/** Attach one child; with no `companyOrderId` a sales-kind child gets a fresh root (已下单 / 未收款). */
export const companyOrderLinkChildSchema = z.object({
  kind: z.enum(COMPANY_ORDER_LINK_KINDS),
  refId: z.string().uuid(),
  companyOrderId: z.string().uuid().optional(),
})

/**
 * Register one stored attachment into a named document slot (REQ-021). `id` is chosen by the caller
 * **before** the upload — it is the installed attachment's `recordId` — and becomes the slot row's
 * primary key; the command refuses an `attachmentId` that is not filed under this module's document
 * entity with exactly that record id, or that belongs to another tenant.
 */
export const companyOrderDocumentAttachSchema = z.object({
  id: z.string().uuid(),
  companyOrderId: z.string().uuid(),
  slot: z.enum(COMPANY_ORDER_DOCUMENT_SLOTS),
  attachmentId: z.string().uuid(),
})

/** The slot list of one root (REQ-021); the read is authorized by the root's visibility. */
export const companyOrderDocumentsListSchema = z.object({
  companyOrderId: z.string().uuid(),
})

/** Detach one slot row by its own id (REQ-021); owner-only, like every other root write. */
export const companyOrderDocumentDeleteSchema = z.object({
  id: z.string().uuid(),
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
export type CompanyOrderDocumentAttachInput = z.infer<typeof companyOrderDocumentAttachSchema>
export type CompanyOrderDocumentsListQuery = z.infer<typeof companyOrderDocumentsListSchema>
export type CompanyOrderDocumentDeleteQuery = z.infer<typeof companyOrderDocumentDeleteSchema>
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
/**
 * The attachment a slot registration points at is not a document-entity file of this tenant with the
 * expected record id (422, fail closed) — the registration would otherwise reference a foreign or
 * unrelated file.
 */
export const COMPANY_ORDER_DOCUMENT_ATTACHMENT_CODE = 'company_order_document_attachment_invalid' as const
