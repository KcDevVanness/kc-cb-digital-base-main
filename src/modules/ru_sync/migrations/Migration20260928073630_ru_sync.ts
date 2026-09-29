import { Migration } from '@mikro-orm/migrations';

export class Migration20260928073630_ru_sync extends Migration {

  override name = 'Migration20260928073630';

  override up(): void | Promise<void> {
    this.addSql(`create table "ru_sync_cursors" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "endpoint" text not null, "cursor" text null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "ru_sync_cursors" add constraint "ru_sync_cursors_tenant_endpoint_uniq" unique ("tenant_id", "endpoint");`);

    this.addSql(`create table "ru_sync_sku_map" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "ru_sku" text not null, "product_id" uuid null, "status" text not null default 'unmapped', "note" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "ru_sync_sku_map_scope_idx" on "ru_sync_sku_map" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "ru_sync_sku_map" add constraint "ru_sync_sku_map_scope_sku_uniq" unique ("tenant_id", "organization_id", "ru_sku");`);

    this.addSql(`create table "ru_sync_snapshots" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "endpoint" text not null, "natural_key" text not null, "payload" jsonb not null, "as_of" date not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "ru_sync_snapshots_endpoint_idx" on "ru_sync_snapshots" ("tenant_id", "organization_id", "endpoint", "as_of");`);
    this.addSql(`create index "ru_sync_snapshots_scope_idx" on "ru_sync_snapshots" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "ru_sync_snapshots" add constraint "ru_sync_snapshots_key_uniq" unique ("tenant_id", "organization_id", "endpoint", "natural_key", "as_of");`);
  }

}
