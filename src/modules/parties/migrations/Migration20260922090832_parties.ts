import { Migration } from '@mikro-orm/migrations';

export class Migration20260922090832_parties extends Migration {

  override name = 'Migration20260922090832';

  override up(): void | Promise<void> {
    this.addSql(`create table "parties_parties" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "code" text not null, "name" text not null, "country_code" text null, "status" text not null default 'active', "contact_name" text null, "contact_phone" text null, "email" text null, "address_line1" text null, "address_line2" text null, "city" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "parties_parties_scope_status_idx" on "parties_parties" ("organization_id", "tenant_id", "status");`);
    this.addSql(`create index "parties_parties_scope_idx" on "parties_parties" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "parties_parties" add constraint "parties_parties_scope_code_uniq" unique ("tenant_id", "organization_id", "code");`);

    this.addSql(`create table "parties_bank_accounts" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "party_id" uuid not null, "beneficiary_bank" text not null, "account_number" text not null, "swift_code" text null, "bank_address" text null, "is_default" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create unique index "parties_bank_accounts_default_unique_idx" on "parties_bank_accounts" ("party_id") where is_default;`);
    this.addSql(`create index "parties_bank_accounts_party_idx" on "parties_bank_accounts" ("party_id");`);
    this.addSql(`create index "parties_bank_accounts_scope_idx" on "parties_bank_accounts" ("organization_id", "tenant_id");`);

    this.addSql(`create table "parties_roles" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "party_id" uuid not null, "role" text not null, "attributes" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "parties_roles_scope_idx" on "parties_roles" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "parties_roles" add constraint "parties_roles_party_role_uniq" unique ("party_id", "role");`);

    this.addSql(`alter table "parties_bank_accounts" add constraint "parties_bank_accounts_party_id_foreign" foreign key ("party_id") references "parties_parties" ("id") on delete cascade;`);

    this.addSql(`alter table "parties_roles" add constraint "parties_roles_party_id_foreign" foreign key ("party_id") references "parties_parties" ("id") on delete cascade;`);
  }

}
