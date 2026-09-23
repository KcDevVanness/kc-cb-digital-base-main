import { Migration } from '@mikro-orm/migrations';

export class Migration20260921081717_purchasing extends Migration {

  override name = 'Migration20260921081717';

  override up(): void | Promise<void> {
    this.addSql(`create table "purchasing_suppliers" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "code" text not null, "contact_name" text null, "phone" text null, "email" text null, "address" text null, "default_currency_code" text not null default 'CNY', "is_active" boolean not null default true, "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`alter table "purchasing_suppliers" add constraint "purchasing_suppliers_scope_code_uniq" unique ("tenant_id", "organization_id", "code");`);
  }

}
