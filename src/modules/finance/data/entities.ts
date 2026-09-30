import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

/**
 * 柜费用 — one actually incurred cost of one container.
 *
 * The shipment is referenced by scalar id plus a frozen display snapshot
 * (`shipment_number`) — the app-wide rule forbids a cross-module ORM relation, and this module
 * never writes a peer table. The exchange rate is optional on purpose: the operator may record
 * the rate from the bank slip, and when it is empty the read path resolves the current rate
 * instead of inventing one.
 *
 * Nothing here is a ledger entry: the landed-cost allocation on top of these rows is derived per
 * request (`lib/landedCost.ts`), so editing an amount or a rate can never leave a stale
 * allocation behind.
 */
@Entity({ tableName: 'finance_shipment_costs' })
@Index({ name: 'finance_shipment_costs_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'finance_shipment_costs_shipment_idx', properties: ['tenantId', 'organizationId', 'shipmentId'] })
export class FinanceShipmentCost {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt' | 'allocationBasis' | 'currencyCode'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** Scalar id into `cross_border_shipments`; validated to exist in this organization on write. */
  @Property({ name: 'shipment_id', type: 'uuid' })
  shipmentId!: string

  @Property({ name: 'shipment_number', type: 'text', nullable: true })
  shipmentNumber?: string | null

  /** Dictionary value from `shipment_cost_type` (ocean_freight, duty, …); checked on write. */
  @Property({ name: 'cost_type', type: 'text' })
  costType!: string

  /** `amount` allocates by purchase-line net total, `quantity` by allocated quantity. */
  @Property({ name: 'allocation_basis', type: 'text', default: 'amount' })
  allocationBasis: string = 'amount'

  @Property({ type: 'numeric', precision: 18, scale: 2 })
  amount!: string

  @Property({ name: 'currency_code', type: 'text', default: 'CNY' })
  currencyCode: string = 'CNY'

  /** CNY per one unit of `currency_code`; empty → the read path resolves the current rate. */
  @Property({ name: 'exchange_rate', type: 'numeric', precision: 18, scale: 8, nullable: true })
  exchangeRate?: string | null

  @Property({ name: 'incurred_at', type: 'date', nullable: true })
  incurredAt?: Date | null


  /** Scalar id into `parties` (forwarder / customs broker) plus its display snapshot. */
  @Property({ name: 'party_id', type: 'uuid', nullable: true })
  partyId?: string | null

  @Property({ name: 'party_snapshot', type: 'jsonb', nullable: true })
  partySnapshot?: Record<string, unknown> | null

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
 * 期间费用 — one expense of one reporting period that is **not** tied to a container.
 *
 * A container cost ({@link FinanceShipmentCost}) lands on purchase lines through the landed-cost
 * allocation; an advertising or platform bill has no container to land on, so it is recorded here
 * against a period (both ends inclusive on the screen) and enters the profit-and-loss ledger
 * directly. The channel and the counterparty are scalar ids plus display snapshots — never an ORM
 * relation across modules.
 */
@Entity({ tableName: 'finance_expenses' })
@Index({ name: 'finance_expenses_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'finance_expenses_period_idx', properties: ['tenantId', 'organizationId', 'periodStart'] })
export class FinanceExpense {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt' | 'currencyCode'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** Dictionary value from `finance_expense_type` (advertising, platform_fee, …); checked on write. */
  @Property({ name: 'expense_type', type: 'text' })
  expenseType!: string

  /** First day of the period, inclusive. */
  @Property({ name: 'period_start', type: 'date' })
  periodStart!: Date

  /** Last day of the period, inclusive; earlier than `period_start` is rejected. */
  @Property({ name: 'period_end', type: 'date' })
  periodEnd!: Date


  @Property({ type: 'numeric', precision: 18, scale: 2 })
  amount!: string

  @Property({ name: 'currency_code', type: 'text', default: 'CNY' })
  currencyCode: string = 'CNY'

  /** CNY per one unit of `currency_code`; empty → the read path resolves the current rate. */
  @Property({ name: 'exchange_rate', type: 'numeric', precision: 18, scale: 8, nullable: true })
  exchangeRate?: string | null

  /** Scalar id into `platform_ops_channels` (which marketplace the money was spent on). */
  @Property({ name: 'channel_id', type: 'uuid', nullable: true })
  channelId?: string | null

  @Property({ name: 'channel_snapshot', type: 'jsonb', nullable: true })
  channelSnapshot?: Record<string, unknown> | null

  /** Scalar id into `parties` plus its display snapshot. */
  @Property({ name: 'party_id', type: 'uuid', nullable: true })
  partyId?: string | null

  @Property({ name: 'party_snapshot', type: 'jsonb', nullable: true })
  partySnapshot?: Record<string, unknown> | null

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
