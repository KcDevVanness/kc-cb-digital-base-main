import { Migration } from '@mikro-orm/migrations';

export class Migration20260929063626_purchasing extends Migration {

  override name = 'Migration20260929063626';

  override up(): void | Promise<void> {
    this.addSql(`create table "purchasing_supplier_bank_accounts" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "supplier_id" uuid not null, "beneficiary_bank" text not null, "account_number" text not null, "swift_code" text null, "bank_address" text null, "is_default" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create unique index "purchasing_supplier_bank_accounts_default_unique_idx" on "purchasing_supplier_bank_accounts" ("supplier_id") where is_default;`);
    this.addSql(`create index "purchasing_supplier_bank_accounts_scope_idx" on "purchasing_supplier_bank_accounts" ("organization_id", "tenant_id");`);
    this.addSql(`create index "purchasing_supplier_bank_accounts_supplier_idx" on "purchasing_supplier_bank_accounts" ("supplier_id");`);

    this.addSql(`alter table "purchasing_supplier_bank_accounts" add constraint "purchasing_supplier_bank_accounts_supplier_id_foreign" foreign key ("supplier_id") references "purchasing_suppliers" ("id") on delete cascade;`);
  }

}
