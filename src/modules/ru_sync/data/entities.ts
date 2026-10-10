import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

/**
 * RU 原始码 → 商品 的映射。
 *
 * The RU side has no SKU rules (mixed case, `склад`/`фабрика` suffixes, factory codes that match no
 * card), so the mapping is a first-class record rather than an implicit string comparison. A row
 * exists for every RU code the sync has ever seen; `status` says what it means:
 *
 * - `mapped`   — bound to a product of this organization (automatically on a unique match, or by
 *                hand when two products look alike);
 * - `ignored`  — deliberately not mapped (a code that will never be ordered);
 * - `unmapped` — the default, and what the exception list is built from.
 *
 * The unmapped list itself is **derived** (a RU code present in a snapshot with no `mapped` row
 * here), so there is no second table to keep in step.
 */
@Entity({ tableName: 'ru_sync_sku_map' })
@Index({ name: 'ru_sync_sku_map_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'ru_sync_sku_map_scope_sku_uniq', properties: ['tenantId', 'organizationId', 'ruSku'] })
export class RuSyncSkuMap {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'status'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** The RU code exactly as the contract returns it (case sensitive, suffix included). */
  @Property({ name: 'ru_sku', type: 'text' })
  ruSku!: string

  /** The product this code resolves to; scalar id into the installed catalog (`catalog_products`). */
  @Property({ name: 'product_id', type: 'uuid', nullable: true })
  productId?: string | null

  /** `mapped` | `ignored` | `unmapped`. */
  @Property({ type: 'text', default: 'unmapped' })
  status: string = 'unmapped'

  @Property({ type: 'text', nullable: true })
  note?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

/**
 * 快照投影 — one row per RU record per snapshot date, keyed by the endpoint's natural key.
 *
 * The payload is stored exactly as received (a JSONB document, not a shred into columns): the
 * contract is still young, fields are additive, and the cockpit reads these snapshots through the
 * projection layer rather than through hand-mapped columns. `as_of` comes from the response
 * envelope and is part of the uniqueness: replaying the same day overwrites, a later day adds.
 *
 * `endpoint` is the entity key of the adapter (`skus`, `stock`, …), never a raw URL.
 */
@Entity({ tableName: 'ru_sync_snapshots' })
@Index({ name: 'ru_sync_snapshots_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'ru_sync_snapshots_endpoint_idx', properties: ['tenantId', 'organizationId', 'endpoint', 'asOf'] })
@Unique({
  name: 'ru_sync_snapshots_key_uniq',
  properties: ['tenantId', 'organizationId', 'endpoint', 'naturalKey', 'asOf'],
})
export class RuSyncSnapshot {
  [OptionalProps]?: 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  endpoint!: string

  /** The contract's natural key for that endpoint (`sku`, `ru_code`, `number` + `model`, …). */
  @Property({ name: 'natural_key', type: 'text' })
  naturalKey!: string

  @Property({ type: 'jsonb' })
  payload!: Record<string, unknown>

  /** The snapshot data date from the response envelope; a response without it is refused. */
  @Property({ name: 'as_of', type: 'date' })
  asOf!: Date

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

/**
 * 同步游标 — the `updated_at` watermark the pull resumes from, one row per endpoint.
 *
 * This is a **tenant-scoped** row, the one deliberate tenant-domain exception in this module: the
 * provider token is a tenant-level credential, so the position that credential advanced belongs to
 * the tenant rather than to one organization. The projections the cursor governs are still
 * organization-scoped rows; nothing about this exception widens what a request may read.
 *
 * The cursor advances only after every page of an endpoint's walk has been committed, so a failed
 * page is re-pulled with the same watermark instead of being skipped.
 */
@Entity({ tableName: 'ru_sync_cursors' })
@Unique({ name: 'ru_sync_cursors_tenant_endpoint_uniq', properties: ['tenantId', 'endpoint'] })
export class RuSyncCursor {
  [OptionalProps]?: 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  endpoint!: string

  /** The largest `updated_at` fully pulled; null means "full pull next time". */
  @Property({ type: 'text', nullable: true })
  cursor?: string | null

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
