import { Migration } from '@mikro-orm/migrations';

export class Migration20260922092240_products extends Migration {

  override name = 'Migration20260922092240';

  override up(): void | Promise<void> {
    this.addSql(`create table "products_variants" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "product_id" uuid not null, "code" text not null, "name" text not null, "barcode" text null, "status" text not null default 'active', "is_default" boolean not null default false, "attributes" jsonb null, "sort_order" int not null default 0, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "products_variants_default_unique_idx" on "products_variants" ("product_id") where is_default and deleted_at is null;`);
    this.addSql(`create index "products_variants_scope_idx" on "products_variants" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "products_variants" add constraint "products_variants_scope_code_uniq" unique ("tenant_id", "organization_id", "code");`);

    this.addSql(`alter table "products_variants" add constraint "products_variants_product_id_foreign" foreign key ("product_id") references "products_products" ("id") on delete cascade;`);
  }

}
