import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

/**
 * A retired code that still resolves to a live record.
 *
 * This table is the only part of the code-issuance machinery that outlived the retirement
 * (`.ai/specs/2026-10-10-catalog-single-store.md`): SKUs are typed by hand now, but documents in
 * circulation still print the old codes, so a search that only matched the current SKU would lose
 * the paper trail. Rows are written by hand (the alias register is an operational record), never
 * generated, and a code is **never** re-issued from one.
 */
@Entity({ tableName: 'product_codes_aliases' })
@Index({ name: 'product_codes_aliases_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'product_codes_aliases_target_idx', properties: ['targetKind', 'targetId'] })
@Unique({
  name: 'product_codes_aliases_scope_target_uniq',
  properties: ['tenantId', 'organizationId', 'aliasCode', 'targetKind', 'targetId'],
})
export class ProductCodeAlias {
  [OptionalProps]?: 'createdAt' | 'note'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** The code that was retired (`P4108-UVC`). */
  @Property({ name: 'alias_code', type: 'text' })
  aliasCode!: string

  /** `product` | `supplier_product` — the kind of record the alias resolves to. */
  @Property({ name: 'target_kind', type: 'text' })
  targetKind!: string

  /** Scalar id of the target row; no foreign key across modules. */
  @Property({ name: 'target_id', type: 'uuid' })
  targetId!: string

  @Property({ type: 'text', nullable: true })
  note?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
