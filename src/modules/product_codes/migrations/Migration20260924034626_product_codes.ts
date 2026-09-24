import { Migration } from '@mikro-orm/migrations';

export class Migration20260924034626_product_codes extends Migration {

  override name = 'Migration20260924034626';

  override up(): void | Promise<void> {
    this.addSql(`create table "product_codes_aliases" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "alias_code" text not null, "target_kind" text not null, "target_id" uuid not null, "note" text null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "product_codes_aliases_target_idx" on "product_codes_aliases" ("target_kind", "target_id");`);
    this.addSql(`create index "product_codes_aliases_scope_idx" on "product_codes_aliases" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "product_codes_aliases" add constraint "product_codes_aliases_scope_target_uniq" unique ("tenant_id", "organization_id", "alias_code", "target_kind", "target_id");`);

    this.addSql(`create table "product_codes_ledger_entries" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "rule_id" uuid not null, "code" text not null, "brand_value" text not null, "category_value" text null, "serial" int not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "product_codes_ledger_scope_serial_idx" on "product_codes_ledger_entries" ("tenant_id", "organization_id", "rule_id", "brand_value", "category_value", "serial");`);
    this.addSql(`create index "product_codes_ledger_scope_idx" on "product_codes_ledger_entries" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "product_codes_ledger_entries" add constraint "product_codes_ledger_scope_code_uniq" unique ("tenant_id", "organization_id", "code");`);

    this.addSql(`create table "product_codes_rules" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "mode" text not null default 'generate', "segments" jsonb not null, "separator" text not null default '-', "serial_length" int not null default 3, "serial_scope" text not null default 'brand_category', "enforce" text not null default 'warn', "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "product_codes_rules_scope_idx" on "product_codes_rules" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "product_codes_rules" add constraint "product_codes_rules_scope_name_uniq" unique ("tenant_id", "organization_id", "name");`);
  }

}
