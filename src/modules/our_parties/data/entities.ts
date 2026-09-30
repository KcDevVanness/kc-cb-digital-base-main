import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

/**
 * 我方主体档案 — the print profile of one of our own companies.
 *
 * The identity is the **organization** (`organization_id` = an installed `directory` organization,
 * stored as a scalar id; no cross-module ORM relation): the group's main company and each
 * subsidiary are the only legal entities a document may be issued as. The profile adds what the
 * organization row does not carry — the registered address, a contact, and the bank block the paper
 * prints.
 *
 * Scope columns: `tenant_id` and `organization_id` are the row's own scope, and
 * `organization_id` **is** the subject company, so the framework's scoped reads already answer the
 * right question ("may the caller see this company's profile"). A caller acting in a subsidiary
 * may only maintain its own row; the group operator maintains every row below itself.
 */
@Entity({ tableName: 'our_parties_profiles' })
@Index({
  name: 'our_parties_profiles_scope_org_uniq',
  // One **live** profile per company: the predicate excludes soft-deleted rows, so a company whose
  // profile was deleted can be profiled again (a plain unique would make that a permanent 409) and
  // an undone create can be redone.
  expression:
    'create unique index "our_parties_profiles_scope_org_uniq" on "our_parties_profiles" ("tenant_id", "organization_id") where "deleted_at" is null',
})
@Index({ name: 'our_parties_profiles_scope_idx', properties: ['organizationId', 'tenantId'] })
export class OurPartyProfile {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  /** The company this profile describes; also the row's scope. */
  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** 地址. */
  @Property({ name: 'address_line1', type: 'text', nullable: true })
  addressLine1?: string | null

  @Property({ name: 'address_line2', type: 'text', nullable: true })
  addressLine2?: string | null

  /** 城市. */
  @Property({ type: 'text', nullable: true })
  city?: string | null

  /** ISO-3166 alpha-2. */
  @Property({ name: 'country_code', type: 'text', nullable: true })
  countryCode?: string | null

  /** 联系人. */
  @Property({ name: 'contact_name', type: 'text', nullable: true })
  contactName?: string | null

  @Property({ name: 'contact_phone', type: 'text', nullable: true })
  contactPhone?: string | null

  @Property({ type: 'text', nullable: true })
  email?: string | null

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
 * 银行账户 of one profile — a child grid, not flat columns, because a company banks in more than
 * one place and exactly one account is the default the documents print.
 *
 * The four bank columns are encrypted (`encryption.ts`); reads go through the decryption helpers.
 * Same-module child relation only — nothing outside this module joins it.
 */
@Entity({ tableName: 'our_parties_bank_accounts' })
@Index({ name: 'our_parties_bank_accounts_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'our_parties_bank_accounts_profile_idx', properties: ['profile'] })
@Index({
  name: 'our_parties_bank_accounts_default_unique_idx',
  // One default account per profile. A partial unique index is the only shape that expresses this:
  // the command checks the payload, but two concurrent edits could still both mark a row default,
  // and a plain unique on (profile_id, is_default) would also forbid two non-default rows.
  expression:
    'create unique index "our_parties_bank_accounts_default_unique_idx" on "our_parties_bank_accounts" ("profile_id") where is_default',
})
export class OurPartyBankAccount {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  /** Copy of the parent profile's scope column, so a scoped read of the child alone is possible. */
  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => OurPartyProfile, { fieldName: 'profile_id', deleteRule: 'cascade' })
  profile!: OurPartyProfile

  /** 银行 (Beneficiary Bank) — encrypted. */
  @Property({ name: 'beneficiary_bank', type: 'text' })
  beneficiaryBank!: string

  /** 银行账号 (Beneficiary Number) — encrypted. */
  @Property({ name: 'account_number', type: 'text' })
  accountNumber!: string

  /** SWIFT CODE — encrypted. */
  @Property({ name: 'swift_code', type: 'text', nullable: true })
  swiftCode?: string | null

  /** 银行地址 (Bank add) — encrypted. */
  @Property({ name: 'bank_address', type: 'text', nullable: true })
  bankAddress?: string | null

  @Property({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean = false

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
