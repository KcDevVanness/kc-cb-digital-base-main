import { Migration } from '@mikro-orm/migrations';

export class Migration20260930040746_our_parties extends Migration {

  override name = 'Migration20260930040746';

  override up(): void | Promise<void> {
    this.addSql(`create table "our_parties_profiles" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "address_line1" text null, "address_line2" text null, "city" text null, "country_code" text null, "contact_name" text null, "contact_phone" text null, "email" text null, "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "our_parties_profiles_scope_idx" on "our_parties_profiles" ("organization_id", "tenant_id");`);
    this.addSql(`create unique index "our_parties_profiles_scope_org_uniq" on "our_parties_profiles" ("tenant_id", "organization_id") where "deleted_at" is null;`);

    this.addSql(`create table "our_parties_bank_accounts" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "profile_id" uuid not null, "beneficiary_bank" text not null, "account_number" text not null, "swift_code" text null, "bank_address" text null, "is_default" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create unique index "our_parties_bank_accounts_default_unique_idx" on "our_parties_bank_accounts" ("profile_id") where is_default;`);
    this.addSql(`create index "our_parties_bank_accounts_profile_idx" on "our_parties_bank_accounts" ("profile_id");`);
    this.addSql(`create index "our_parties_bank_accounts_scope_idx" on "our_parties_bank_accounts" ("organization_id", "tenant_id");`);

    this.addSql(`alter table "our_parties_bank_accounts" add constraint "our_parties_bank_accounts_profile_id_foreign" foreign key ("profile_id") references "our_parties_profiles" ("id") on delete cascade;`);
  }

}
