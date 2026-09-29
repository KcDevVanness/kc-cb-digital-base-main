import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

/**
 * A consignment: goods that travel together from the domestic supplier to the overseas
 * warehouse. It exists because neither neighbouring module can express it — `wms` models
 * warehouse ledgers (no transfer/consignment document) and `purchasing` models the commercial
 * order (nothing about how the goods physically move).
 *
 * `number` is assigned at `depart`, so a draft never consumes a sequence slot. Stock is **not**
 * in `wms` balances while the shipment is `in_transit`: the ledger only moves at `receive`.
 */
@Entity({ tableName: 'cross_border_shipments' })
@Unique({ name: 'cross_border_shipments_scope_number_uniq', properties: ['tenantId', 'organizationId', 'number'] })
export class CrossBorderShipment {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text', nullable: true })
  number?: string | null

  @Property({ type: 'text', default: 'draft' })
  status: string = 'draft'

  @Property({ name: 'carrier_name', type: 'text', nullable: true })
  carrierName?: string | null

  @Property({ name: 'forwarder_contact', type: 'text', nullable: true })
  forwarderContact?: string | null

  @Property({ name: 'departure_port', type: 'text', nullable: true })
  departurePort?: string | null

  /**
   * Container model (货柜型号), a `container_type` dictionary code — `setup.ts` seeds the values the
   * logistics team books, so a shipment can only carry a model the picker can show again.
   */
  @Property({ name: 'container_type', type: 'text', nullable: true })
  containerType?: string | null

  /** The box and its seal as printed on the shipping line's paperwork. */
  @Property({ name: 'container_number', type: 'text', nullable: true })
  containerNumber?: string | null

  @Property({ name: 'seal_number', type: 'text', nullable: true })
  sealNumber?: string | null

  /**
   * Booking/waybill number (订舱号/提单号). It lives on the shipment on purpose: an SO document row
   * stores only its file, issue date and note, so the number has exactly one home here.
   */
  @Property({ name: 'booking_number', type: 'text', nullable: true })
  bookingNumber?: string | null

  /** Destination warehouse/location; required when the shipment is received. */
  @Property({ name: 'destination_warehouse_id', type: 'uuid', nullable: true })
  destinationWarehouseId?: string | null

  @Property({ name: 'destination_location_id', type: 'uuid', nullable: true })
  destinationLocationId?: string | null

  /** Mirrors the latest milestone row so lists render one cheap column. */
  @Property({ name: 'current_milestone', type: 'text', nullable: true })
  currentMilestone?: string | null

  @Property({ type: 'date', nullable: true })
  etd?: Date | null

  @Property({ type: 'date', nullable: true })
  eta?: Date | null

  @Property({ name: 'departed_at', type: Date, nullable: true })
  departedAt?: Date | null

  @Property({ name: 'received_at', type: Date, nullable: true })
  receivedAt?: Date | null

  @Property({ name: 'cancelled_at', type: Date, nullable: true })
  cancelledAt?: Date | null

  @Property({ name: 'cancel_reason', type: 'text', nullable: true })
  cancelReason?: string | null

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * One purchase-order line travelling in one shipment.
 *
 * The shipment ↔ purchase order relation is deliberately many-to-many with per-line
 * quantities: several orders may share a container (拼柜), and one order may be split across
 * several consignments. The purchasing side is referenced by scalar ids plus a frozen display
 * snapshot — no cross-module ORM relation, and no cross-module write from here.
 */
@Entity({ tableName: 'cross_border_shipment_allocations' })
@Unique({ name: 'cross_border_shipment_allocations_shipment_line_uniq', properties: ['shipment', 'purchaseOrderLineId'] })
export class CrossBorderShipmentAllocation {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => CrossBorderShipment, { fieldName: 'shipment_id', deleteRule: 'cascade' })
  shipment!: CrossBorderShipment

  @Property({ name: 'purchase_order_id', type: 'uuid' })
  purchaseOrderId!: string

  @Property({ name: 'purchase_order_line_id', type: 'uuid' })
  purchaseOrderLineId!: string

  @Property({ name: 'purchase_order_number', type: 'text', nullable: true })
  purchaseOrderNumber?: string | null

  @Property({ name: 'catalog_product_id', type: 'uuid' })
  catalogProductId!: string

  @Property({ name: 'product_snapshot', type: 'jsonb', nullable: true })
  productSnapshot?: Record<string, unknown> | null

  @Property({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  quantity: string = '0'

  /** Set when the goods are received; null means still in transit. */
  @Property({ name: 'received_quantity', type: 'numeric', precision: 18, scale: 4, nullable: true })
  receivedQuantity?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

/**
 * One **internal sales-order line** travelling in one shipment.
 *
 * The mirror image of `CrossBorderShipmentAllocation`, on the sales side of the chain
 * (对内销售订单 → 拣货装箱 → 报关 → 发运): a container may carry goods ordered on several sales
 * orders, and one order may be split across shipments. The sales side is referenced by scalar
 * ids plus frozen display/price snapshots — no cross-module ORM relation, and no cross-module
 * write from here. Rows are replaced wholesale with the shipment they belong to, exactly like
 * the purchase allocations, and the composite unique key is per (shipment, sales order line).
 */
@Entity({ tableName: 'cross_border_shipment_sales_allocations' })
@Index({ name: 'cross_border_shipment_sales_allocations_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'cross_border_shipment_sales_allocations_shipment_line_uniq', properties: ['shipment', 'salesOrderLineId'] })
export class CrossBorderShipmentSalesAllocation {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => CrossBorderShipment, { fieldName: 'shipment_id', deleteRule: 'cascade' })
  shipment!: CrossBorderShipment

  @Property({ name: 'sales_order_id', type: 'uuid' })
  salesOrderId!: string

  @Property({ name: 'sales_order_line_id', type: 'uuid' })
  salesOrderLineId!: string

  @Property({ name: 'sales_order_number', type: 'text', nullable: true })
  salesOrderNumber?: string | null

  @Property({ name: 'catalog_product_id', type: 'uuid' })
  catalogProductId!: string

  @Property({ name: 'product_snapshot', type: 'jsonb', nullable: true })
  productSnapshot?: Record<string, unknown> | null

  @Property({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  quantity: string = '0'

  /** Internal sales price and currency, frozen at allocation time; null = the line is unpriced. */
  @Property({ name: 'unit_price', type: 'numeric', precision: 18, scale: 4, nullable: true })
  unitPrice?: string | null

  @Property({ name: 'currency_code', type: 'text', nullable: true })
  currencyCode?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

/**
 * Append-only transit history. The six stages are ordered, and a stage earlier than the current
 * one is rejected — a consignment cannot un-clear customs — so the rows double as the audit
 * trail a real-time carrier feed could later write into.
 */
@Entity({ tableName: 'cross_border_shipment_milestones' })
export class CrossBorderShipmentMilestone {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => CrossBorderShipment, { fieldName: 'shipment_id', deleteRule: 'cascade' })
  shipment!: CrossBorderShipment

  @Property({ type: 'text' })
  milestone!: string

  @Property({ name: 'occurred_at', type: Date })
  occurredAt!: Date

  @Property({ type: 'text', nullable: true })
  note?: string | null

  @Property({ name: 'recorded_by', type: 'uuid', nullable: true })
  recordedBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

/**
 * Export paperwork travelling with the consignment. Documents hang on the shipment (one set per
 * container is the common case) and may optionally name a purchase order for a per-order set;
 * the file itself lives in the installed `attachments` module and only its id is stored here.
 */
@Entity({ tableName: 'cross_border_export_documents' })
export class CrossBorderExportDocument {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => CrossBorderShipment, { fieldName: 'shipment_id', deleteRule: 'cascade' })
  shipment!: CrossBorderShipment

  @Property({ name: 'purchase_order_id', type: 'uuid', nullable: true })
  purchaseOrderId?: string | null

  @Property({ name: 'doc_type', type: 'text' })
  docType!: string

  @Property({ name: 'document_number', type: 'text', nullable: true })
  documentNumber?: string | null

  @Property({ name: 'issued_at', type: 'date', nullable: true })
  issuedAt?: Date | null

  @Property({ name: 'attachment_id', type: 'uuid', nullable: true })
  attachmentId?: string | null

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
 * One purchase/sales contract a shipment travels under.
 *
 * The relation is deliberately many-to-many: a consolidated container (拼柜) may carry goods
 * belonging to several contracts, and one contract is usually fulfilled by several shipments.
 * The contract itself lives in `trade_docs`; this module only stores its id plus the
 * `contractNumber`/`contractDirection` display snapshot frozen at write time, so a renamed or
 * re-signed contract never rewrites what a shipment already recorded.
 */
@Entity({ tableName: 'cross_border_shipment_contracts' })
@Index({ name: 'cross_border_shipment_contracts_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'cross_border_shipment_contracts_contract_idx', properties: ['organizationId', 'tenantId', 'contractId'] })
@Unique({ name: 'cross_border_shipment_contracts_shipment_contract_uniq', properties: ['shipment', 'contractId'] })
export class CrossBorderShipmentContract {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => CrossBorderShipment, { fieldName: 'shipment_id', deleteRule: 'cascade' })
  shipment!: CrossBorderShipment

  /** Scalar reference into `trade_docs` — never a cross-module ORM relation. */
  @Property({ name: 'contract_id', type: 'uuid' })
  contractId!: string

  @Property({ name: 'contract_number', type: 'text', nullable: true })
  contractNumber?: string | null

  /** `purchase` | `sales` as printed on the contract, frozen at write time. */
  @Property({ name: 'contract_direction', type: 'text', nullable: true })
  contractDirection?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

/**
 * One line of a packing list.
 *
 * Only `packing_list` documents carry lines — the validator refuses a `lines` payload on any other
 * export-document kind, because measured cartons and weights belong to the packing list and to no
 * other export paper. Every measurement is nullable on purpose: a line may be registered before
 * the packing is finished, and the operator keeps editing it (数量/箱数/毛重/净重/体积/备注).
 * Lines are replaced wholesale by the document command, exactly like shipment allocations.
 */
@Entity({ tableName: 'cross_border_export_document_lines' })
@Index({ name: 'cross_border_export_document_lines_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'cross_border_export_document_lines_document_line_uniq', properties: ['document', 'lineNumber'] })
export class CrossBorderExportDocumentLine {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => CrossBorderExportDocument, { fieldName: 'document_id', deleteRule: 'cascade' })
  document!: CrossBorderExportDocument

  /** Assigned by the command as 1..n; the unique key is `(document, lineNumber)`. */
  @Property({ name: 'line_number', type: 'integer' })
  lineNumber!: number

  /** App-owned product master id (scalar); a free-text line may carry none. */
  @Property({ name: 'product_id', type: 'uuid', nullable: true })
  productId?: string | null

  @Property({ name: 'product_snapshot', type: 'jsonb', nullable: true })
  productSnapshot?: Record<string, unknown> | null

  @Property({ type: 'text', nullable: true })
  name?: string | null

  @Property({ type: 'text', nullable: true })
  sku?: string | null

  @Property({ type: 'text', nullable: true })
  unit?: string | null

  @Property({ type: 'numeric', precision: 18, scale: 4, nullable: true })
  quantity?: string | null

  /** 箱数 — whole cartons, hence scale 0. */
  @Property({ type: 'numeric', precision: 18, scale: 0, nullable: true })
  cartons?: string | null

  @Property({ name: 'gross_weight', type: 'numeric', precision: 18, scale: 4, nullable: true })
  grossWeight?: string | null

  @Property({ name: 'net_weight', type: 'numeric', precision: 18, scale: 4, nullable: true })
  netWeight?: string | null

  /** 体积 in cm³ — integer, the same caliber as `products.volume`. */
  @Property({ type: 'numeric', precision: 18, scale: 0, nullable: true })
  volume?: string | null

  /** Where the line came from: a contract line (`contract_line`) or the operator (`manual`). */
  @Property({ name: 'source_snapshot', type: 'jsonb', nullable: true })
  sourceSnapshot?: Record<string, unknown> | null

  @Property({ type: 'text', nullable: true })
  note?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  /** Set when the owning document is deleted, so a deleted list's lines stop being readable. */
  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
