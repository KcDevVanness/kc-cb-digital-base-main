import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

/**
 * Trading parties — the counterparty master this app owns.
 *
 * Scope columns are required (not nullable): a party belongs to exactly one organization, and the
 * visibility rule (HQ sees its descendants, a subsidiary sees itself) is enforced by the scope
 * columns plus the ACL organization set, never by a nullable "shared" row.
 *
 * `code` is unique per organization, not globally: two subsidiaries may deal with the same buyer
 * under their own numbering. It is the only **plaintext** lookup column on purpose — `name` and the
 * contact/address block are covered by `encryption.ts`, and a column that holds ciphertext cannot
 * back a uniqueness constraint, a sort, or a LIKE filter (see `.ai/guides/contracts.md`).
 */
@Entity({ tableName: 'parties_parties' })
@Unique({ name: 'parties_parties_scope_code_uniq', properties: ['tenantId', 'organizationId', 'code'] })
@Index({ name: 'parties_parties_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'parties_parties_scope_status_idx', properties: ['organizationId', 'tenantId', 'status'] })
export class Party {
  [OptionalProps]?: 'status' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** Operator-facing short code; the stable plaintext key for search, uniqueness and audit. */
  @Property({ type: 'text' })
  code!: string

  /** 客户名称 — encrypted at rest (see `encryption.ts`). */
  @Property({ type: 'text' })
  name!: string

  /** ISO-3166 alpha-2. Plaintext: it is a routing/printing attribute, not identifying data. */
  @Property({ name: 'country_code', type: 'text', nullable: true })
  countryCode?: string | null

  @Property({ type: 'text', default: 'active' })
  status: string = 'active'

  /** 联系人. */
  @Property({ name: 'contact_name', type: 'text', nullable: true })
  contactName?: string | null

  /** 联系人电话. */
  @Property({ name: 'contact_phone', type: 'text', nullable: true })
  contactPhone?: string | null

  /** 邮箱. */
  @Property({ type: 'text', nullable: true })
  email?: string | null

  /** 地址. */
  @Property({ name: 'address_line1', type: 'text', nullable: true })
  addressLine1?: string | null

  @Property({ name: 'address_line2', type: 'text', nullable: true })
  addressLine2?: string | null

  /** 城市. */
  @Property({ type: 'text', nullable: true })
  city?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * What a party *is* in a deal. One legal entity can hold several roles at once (a subsidiary is
 * `branch` and `buyer`; a forwarder may also be the `consignee`), which is why roles are rows and
 * not a column on the party.
 *
 * `attributes` is reserved for service-provider specifics (forwarder tracking, broker
 * qualifications, bank accounts metadata) and ships unused: the shape is an open question
 * (`Q-P-004` in `.ai/specs/2026-09-22-app-owned-party-master.md`), and a nullable JSONB column is
 * the reversible place to wait for the answer.
 */
@Entity({ tableName: 'parties_roles' })
@Unique({ name: 'parties_roles_party_role_uniq', properties: ['party', 'role'] })
@Index({ name: 'parties_roles_scope_idx', properties: ['organizationId', 'tenantId'] })
export class PartyRole {
  [OptionalProps]?: 'attributes' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => Party, { fieldName: 'party_id', deleteRule: 'cascade' })
  party!: Party

  /** `buyer` | `consignee` | `branch` | `forwarder` | `broker` | `bank` | `certifier`. */
  @Property({ type: 'text' })
  role!: string

  @Property({ type: 'jsonb', nullable: true })
  attributes?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

/**
 * The bank block printed on contracts and invoices: 银行 (Beneficiary Bank), 银行账号 (Beneficiary
 * Number), SWIFT CODE, 银行地址 (Bank add).
 *
 * A child table rather than columns on the party because buyers change banks and a second account is
 * a normal event, not a schema change. At most one row per party is the default — enforced in the
 * command and by the partial unique index declared in the reviewed migration; the account itself is
 * encrypted at rest.
 */
@Entity({ tableName: 'parties_bank_accounts' })
@Index({ name: 'parties_bank_accounts_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'parties_bank_accounts_party_idx', properties: ['party'] })
@Index({
  name: 'parties_bank_accounts_default_unique_idx',
  // One default account per party. A partial unique index is the only shape that expresses this:
  // the command checks the payload, but two concurrent edits could still both mark a row default,
  // and a plain unique on (party_id, is_default) would also forbid two non-default rows.
  expression:
    'create unique index "parties_bank_accounts_default_unique_idx" on "parties_bank_accounts" ("party_id") where is_default',
})
export class PartyBankAccount {
  [OptionalProps]?: 'isDefault' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => Party, { fieldName: 'party_id', deleteRule: 'cascade' })
  party!: Party

  /** Beneficiary Bank — 银行. */
  @Property({ name: 'beneficiary_bank', type: 'text' })
  beneficiaryBank!: string

  /** Beneficiary Number — 银行账号. No format assumption: IBAN and local numbering both occur. */
  @Property({ name: 'account_number', type: 'text' })
  accountNumber!: string

  /** SWIFT CODE. */
  @Property({ name: 'swift_code', type: 'text', nullable: true })
  swiftCode?: string | null

  /** Bank add — 银行地址. */
  @Property({ name: 'bank_address', type: 'text', nullable: true })
  bankAddress?: string | null

  @Property({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean = false

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
