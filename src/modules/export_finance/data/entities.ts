import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

/**
 * 出口收汇档案 — the collection record of one purchase order.
 *
 * 收汇 is anchored on the **order**, not on the container: the overseas subsidiary pays for the
 * order it placed, and one container may carry orders of several suppliers whose proceeds arrive
 * separately. `collectionStatus` therefore answers 是否已收款 for exactly one order.
 *
 * The purchase order is referenced by scalar id plus frozen display snapshots
 * (`purchase_order_number`, `currency_code`) — the app-wide rule forbids a cross-module ORM
 * relation, and this module never writes a peer table.
 */
@Entity({ tableName: 'export_finance_collections' })
@Index({ name: 'export_finance_collections_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({
  name: 'export_finance_collections_scope_order_uniq',
  properties: ['tenantId', 'organizationId', 'purchaseOrderId'],
})
export class ExportFinanceCollection {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** One collection record per purchase order; the unique constraint above is the guarantee. */
  @Property({ name: 'purchase_order_id', type: 'uuid' })
  purchaseOrderId!: string

  @Property({ name: 'purchase_order_number', type: 'text', nullable: true })
  purchaseOrderNumber?: string | null

  @Property({ name: 'currency_code', type: 'text', default: 'CNY' })
  currencyCode: string = 'CNY'

  /** `received` | `not_received` | `unknown`; `unknown` is the absence of an answer, not a "no". */
  @Property({ name: 'collection_status', type: 'text', default: 'unknown' })
  collectionStatus: string = 'unknown'

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * 涉外收入证明 and its siblings, one **row per file**.
 *
 * Documents hang on the order-level collection record, so the file set finance files against
 * 是否已收款 stays together; the file itself lives in the installed `attachments` module and only
 * its id is stored here.
 */
@Entity({ tableName: 'export_finance_collection_documents' })
@Index({ name: 'export_finance_collection_documents_scope_idx', properties: ['organizationId', 'tenantId'] })
export class ExportFinanceCollectionDocument {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => ExportFinanceCollection, { fieldName: 'collection_id', deleteRule: 'cascade' })
  collection!: ExportFinanceCollection

  /** `foreign_income_certificate` | `other`. */
  @Property({ name: 'doc_type', type: 'text' })
  docType!: string

  @Property({ name: 'attachment_id', type: 'uuid', nullable: true })
  attachmentId?: string | null

  @Property({ name: 'issued_at', type: 'date', nullable: true })
  issuedAt?: Date | null

  @Property({ type: 'text', nullable: true })
  note?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * 出口退税档案 — the tax-refund record of one container (one shipment).
 *
 * The refund is anchored on the **container** because that is the unit the customs declaration
 * and the refund application are filed in; one container may hold several purchase orders (拼柜).
 * The per-order figure is derived at read time by allocating this amount across the container's
 * orders by purchase-amount share, never stored, so it can never drift from the container amount.
 *
 * The shipment is referenced by scalar id plus a frozen number snapshot.
 */
@Entity({ tableName: 'export_finance_refunds' })
@Index({ name: 'export_finance_refunds_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({
  name: 'export_finance_refunds_scope_shipment_uniq',
  properties: ['tenantId', 'organizationId', 'shipmentId'],
})
export class ExportFinanceRefund {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** One refund record per shipment; the unique constraint above is the guarantee. */
  @Property({ name: 'shipment_id', type: 'uuid' })
  shipmentId!: string

  @Property({ name: 'shipment_number', type: 'text', nullable: true })
  shipmentNumber?: string | null

  @Property({ name: 'currency_code', type: 'text', default: 'CNY' })
  currencyCode: string = 'CNY'

  /** `completed` | `applied` | `not_started` | `unknown`. */
  @Property({ name: 'tax_refund_status', type: 'text', default: 'unknown' })
  taxRefundStatus: string = 'unknown'

  /** Hand-entered by finance: the amount the refund application claims, quantized to 4 places. */
  @Property({ name: 'tax_refund_amount', type: 'numeric', precision: 18, scale: 4, nullable: true })
  taxRefundAmount?: string | null

  /** 税金额备注 — container-level free text, surfaced on an order only through its containers. */
  @Property({ name: 'tax_refund_note', type: 'text', nullable: true })
  taxRefundNote?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * 报告草单 / 出口退税资料整理 and its siblings, one **row per file**, hung on the container-level
 * refund record.
 */
@Entity({ tableName: 'export_finance_refund_documents' })
@Index({ name: 'export_finance_refund_documents_scope_idx', properties: ['organizationId', 'tenantId'] })
export class ExportFinanceRefundDocument {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => ExportFinanceRefund, { fieldName: 'refund_id', deleteRule: 'cascade' })
  refund!: ExportFinanceRefund

  /** `tax_refund_package` | `report_draft` | `other`. */
  @Property({ name: 'doc_type', type: 'text' })
  docType!: string

  @Property({ name: 'attachment_id', type: 'uuid', nullable: true })
  attachmentId?: string | null

  @Property({ name: 'issued_at', type: 'date', nullable: true })
  issuedAt?: Date | null

  @Property({ type: 'text', nullable: true })
  note?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
