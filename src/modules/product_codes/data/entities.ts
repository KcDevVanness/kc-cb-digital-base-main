import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

/**
 * A code rule — what a product code is made of, as data.
 *
 * The rule is a row, not code, because this business already runs two schemes side by side (the
 * 14-digit 成品项目编码 and the `SP-CL001`-shaped SKU 型号) and will keep adding brands. Segments are
 * an ordered array so a new scheme is a new row: `brand` + `category` + `serial` today, a country or
 * a development-type segment tomorrow, without a migration.
 *
 * `mode` is the compatibility switch. `generate` rules are offered to the form's 生成 button;
 * `carry_over` rules exist for a code dialect the business keeps on purpose (the PetKit-era codes)
 * and are only ever *read* — never used to issue a number.
 */
@Entity({ tableName: 'product_codes_rules' })
@Index({ name: 'product_codes_rules_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({
  name: 'product_codes_rules_scope_name_uniq',
  properties: ['tenantId', 'organizationId', 'name'],
})
export class ProductCodeRule {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt' | 'isActive' | 'mode' | 'separator' | 'serialLength' | 'serialScope' | 'enforce'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** Stable, human name (`SKU 型号`). Owned forever, including by a soft-deleted row. */
  @Property({ type: 'text' })
  name!: string

  /** `generate` | `carry_over` — see the class comment. */
  @Property({ type: 'text', default: 'generate' })
  mode: string = 'generate'

  /**
   * Ordered segments: `[{ kind: 'dictionary', key: 'brand', dictionaryKey: 'product_brand', length: 2, upper: true }, …]`.
   * Exactly one segment has `kind: 'serial'`; the validator rejects anything else.
   */
  @Property({ type: 'jsonb' })
  segments!: Record<string, unknown>[]

  /** `-` | `_` | `` — kept to the SKU charset so a generated code can never be rejected on save. */
  @Property({ type: 'text', default: '-' })
  separator: string = '-'

  /** Zero-padded width of the serial segment (`3` → `001`). */
  @Property({ name: 'serial_length', type: 'integer', default: 3 })
  serialLength: number = 3

  /**
   * The tuple a serial is unique within: `brand_category` | `brand` | `global`. The workbook's own
   * project codes run one counter across 二级分类, which is why the default is the wider tuple.
   */
  @Property({ name: 'serial_scope', type: 'text', default: 'brand_category' })
  serialScope: string = 'brand_category'

  /** `warn` — a hand-typed non-conforming code saves with a warning; `strict` — it is refused. */
  @Property({ type: 'text', default: 'warn' })
  enforce: string = 'warn'

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * The issuance ledger — which codes this system handed out, and the serial each one consumed.
 *
 * It is append-only and it is the **only** proof that a code is machine-issued. That single fact is
 * what makes legacy compatibility possible without a backfill: a code that is not in this table is a
 * legacy or hand-typed code by definition, so the PetKit-era codes need no flag column and no
 * migration — they simply are not here.
 *
 * The unique index on `(tenant, organization, code)` is the real guarantee behind "never reused":
 * two concurrent issuances for the same brand+category collide on it, and the loser retries with the
 * next serial. A number consumed by a row that was never saved stays consumed (a visible gap in the
 * sequence panel), which is what keeps the promise true.
 */
@Entity({ tableName: 'product_codes_ledger_entries' })
@Index({ name: 'product_codes_ledger_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({
  name: 'product_codes_ledger_scope_serial_idx',
  properties: ['tenantId', 'organizationId', 'ruleId', 'brandValue', 'categoryValue', 'serial'],
})
@Unique({
  name: 'product_codes_ledger_scope_code_uniq',
  properties: ['tenantId', 'organizationId', 'code'],
})
export class ProductCodeLedgerEntry {
  [OptionalProps]?: 'createdAt' | 'categoryValue'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** Scalar id into `product_codes_rules` — no cross-module relation, and rules stay soft-deleted. */
  @Property({ name: 'rule_id', type: 'uuid' })
  ruleId!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ name: 'brand_value', type: 'text' })
  brandValue!: string

  @Property({ name: 'category_value', type: 'text', nullable: true })
  categoryValue?: string | null

  @Property({ type: 'integer' })
  serial!: number

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

/**
 * The retired-code mapping — the half of compatibility an audit trail cannot do.
 *
 * `products.audit.items.update` already records *that* a SKU changed and who changed it; what it
 * cannot answer is "which row does the old code belong to", which is what search and document
 * lookups need. One row per retired code, written only when an operator explicitly re-codes a row.
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
