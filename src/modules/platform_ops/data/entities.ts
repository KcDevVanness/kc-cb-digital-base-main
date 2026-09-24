import { OptionalProps } from '@mikro-orm/core'
import { Entity, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

/**
 * A storefront binding: one marketplace account owned by one organization.
 *
 * `platform` is free text on purpose — the module must not couple to a specific provider, and
 * the transport that fetches data is a separate, later seam. `code` is unique per organization so
 * two subsidiaries can each run a storefront with their own numbering.
 */
@Entity({ tableName: 'platform_ops_channels' })
@Unique({ name: 'platform_ops_channels_scope_code_uniq', properties: ['tenantId', 'organizationId', 'code'] })
export class PlatformOpsChannel {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  platform!: string

  @Property({ name: 'external_account_id', type: 'text', nullable: true })
  externalAccountId?: string | null

  @Property({ name: 'currency_code', type: 'text', default: 'USD' })
  currencyCode: string = 'USD'

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

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
 * Our read-only copy of a platform order.
 *
 * Keyed by `(channel, external_order_id)` with a unique constraint: idempotency has to survive a
 * retry, a re-import and a concurrent import, so the database — not the caller's bookkeeping — is
 * what prevents duplicates. The platform's own numbers are stored verbatim; overwriting them with
 * our view would destroy the evidence reconciliation exists to produce.
 */
@Entity({ tableName: 'platform_ops_order_mirrors' })
@Unique({ name: 'platform_ops_order_mirrors_channel_external_uniq', properties: ['channel', 'externalOrderId'] })
export class PlatformOpsOrderMirror {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => PlatformOpsChannel, { fieldName: 'channel_id', deleteRule: 'cascade' })
  channel!: PlatformOpsChannel

  @Property({ name: 'external_order_id', type: 'text' })
  externalOrderId!: string

  @Property({ type: 'text', nullable: true })
  status?: string | null

  @Property({ name: 'currency_code', type: 'text', default: 'USD' })
  currencyCode: string = 'USD'

  @Property({ name: 'gross_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  grossAmount: string = '0'

  @Property({ name: 'fee_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  feeAmount: string = '0'

  @Property({ name: 'net_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  netAmount: string = '0'

  @Property({ name: 'placed_at', type: Date, nullable: true })
  placedAt?: Date | null

  /** Set when one of our consignments fulfilled the order. */
  @Property({ name: 'shipment_id', type: 'uuid', nullable: true })
  shipmentId?: string | null

  @Property({ name: 'shipment_number', type: 'text', nullable: true })
  shipmentNumber?: string | null

  /** The payload as received — evidence, never rendered in lists. */
  @Property({ type: 'jsonb', nullable: true })
  raw?: Record<string, unknown> | null

  @Property({ name: 'synced_at', type: Date, onCreate: () => new Date() })
  syncedAt: Date = new Date()

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

/**
 * The platform's payout statement for a period, identified by its own id so re-importing the same
 * statement updates it instead of creating a second one.
 */
@Entity({ tableName: 'platform_ops_settlements' })
@Unique({ name: 'platform_ops_settlements_channel_external_uniq', properties: ['channel', 'externalSettlementId'] })
export class PlatformOpsSettlement {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'currencyCode' | 'grossAmount' | 'feeAmount' | 'netAmount' | 'status'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => PlatformOpsChannel, { fieldName: 'channel_id', deleteRule: 'cascade' })
  channel!: PlatformOpsChannel

  @Property({ name: 'external_settlement_id', type: 'text' })
  externalSettlementId!: string

  @Property({ name: 'period_start', type: 'date', nullable: true })
  periodStart?: Date | null

  @Property({ name: 'period_end', type: 'date', nullable: true })
  periodEnd?: Date | null

  @Property({ name: 'currency_code', type: 'text', default: 'USD' })
  currencyCode: string = 'USD'

  @Property({ name: 'gross_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  grossAmount: string = '0'

  @Property({ name: 'fee_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  feeAmount: string = '0'

  @Property({ name: 'net_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  netAmount: string = '0'

  @Property({ type: 'text', default: 'imported' })
  status: string = 'imported'

  @Property({ name: 'received_at', type: Date, nullable: true })
  receivedAt?: Date | null

  @Property({ type: 'jsonb', nullable: true })
  raw?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

/** One order's contribution to a payout. `orderMirrorId` is filled when the match succeeded. */
@Entity({ tableName: 'platform_ops_settlement_lines' })
export class PlatformOpsSettlementLine {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => PlatformOpsSettlement, { fieldName: 'settlement_id', deleteRule: 'cascade' })
  settlement!: PlatformOpsSettlement

  @Property({ name: 'external_order_id', type: 'text' })
  externalOrderId!: string

  @Property({ name: 'order_mirror_id', type: 'uuid', nullable: true })
  orderMirrorId?: string | null

  @Property({ name: 'gross_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  grossAmount: string = '0'

  @Property({ name: 'fee_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  feeAmount: string = '0'

  @Property({ name: 'net_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  netAmount: string = '0'

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

/**
 * A disagreement awaiting an operator decision.
 *
 * Items are records rather than log lines because somebody has to work them: resolve with a note,
 * or ignore a known one. A resolved item never reopens by itself — a fresh mismatch creates a new
 * item, so the audit trail keeps both the original problem and its resolution.
 */
@Entity({ tableName: 'platform_ops_reconciliation_items' })
export class PlatformOpsReconciliationItem {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'status'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => PlatformOpsChannel, { fieldName: 'channel_id', deleteRule: 'cascade' })
  channel!: PlatformOpsChannel

  @Property({ type: 'text' })
  kind!: string

  @Property({ name: 'external_ref', type: 'text' })
  externalRef!: string

  @Property({ name: 'settlement_id', type: 'uuid', nullable: true })
  settlementId?: string | null

  @Property({ name: 'order_mirror_id', type: 'uuid', nullable: true })
  orderMirrorId?: string | null

  @Property({ name: 'expected_amount', type: 'numeric', precision: 18, scale: 4, nullable: true })
  expectedAmount?: string | null

  @Property({ name: 'actual_amount', type: 'numeric', precision: 18, scale: 4, nullable: true })
  actualAmount?: string | null

  @Property({ name: 'currency_code', type: 'text', nullable: true })
  currencyCode?: string | null

  @Property({ type: 'text', default: 'open' })
  status: string = 'open'

  @Property({ type: 'text', nullable: true })
  note?: string | null

  @Property({ name: 'resolved_at', type: Date, nullable: true })
  resolvedAt?: Date | null

  @Property({ name: 'resolved_by', type: 'uuid', nullable: true })
  resolvedBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
