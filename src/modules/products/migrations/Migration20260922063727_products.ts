import { Migration } from '@mikro-orm/migrations';

export class Migration20260922063727_products extends Migration {

  override name = 'Migration20260922063727';

  override up(): void | Promise<void> {
    this.addSql(`create table "products_categories" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "code" text not null, "name" text not null, "name_en" text null, "parent_id" uuid null, "root_id" uuid null, "tree_path" text null, "depth" int not null default 0, "ancestor_ids" jsonb not null default '[]', "child_ids" jsonb not null default '[]', "descendant_ids" jsonb not null default '[]', "sort_order" int not null default 0, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "products_categories_scope_idx" on "products_categories" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "products_categories" add constraint "products_categories_scope_code_uniq" unique ("tenant_id", "organization_id", "code");`);

    this.addSql(`create table "products_products" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "sku" text not null, "name" text not null, "name_en" text null, "brand" text not null default 'Petkit', "series" text null, "manufacturer_model" text null, "type_id" uuid null, "category_id" uuid null, "spec_summary" text null, "barcode" text null, "unit" text not null default 'PCS', "hs_code" text null, "cn_code" text null, "country_of_origin_code" text null, "net_weight" numeric(16,4) null, "gross_weight" numeric(16,4) null, "dimensions" jsonb null, "carton_quantity" int null, "carton_dimensions" jsonb null, "carton_gross_weight" numeric(16,4) null, "carton_net_weight" numeric(16,4) null, "battery_capacity_mah" int null, "battery_wh" numeric(10,2) null, "contains_lithium_battery" boolean not null default false, "certifications" jsonb null, "status" text not null default 'active', "catalog_product_id" uuid null, "catalog_snapshot" jsonb null, "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "products_products_scope_idx" on "products_products" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "products_products" add constraint "products_products_scope_sku_uniq" unique ("tenant_id", "organization_id", "sku");`);

    this.addSql(`create table "products_prices" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "product_id" uuid not null, "price_tier" text not null, "currency_code" text not null, "min_quantity" int not null default 1, "unit_price" numeric(18,6) not null default '0', "starts_at" date null, "ends_at" date null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "products_prices_scope_idx" on "products_prices" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "products_prices" add constraint "products_prices_key_uniq" unique ("tenant_id", "organization_id", "product_id", "price_tier", "currency_code", "min_quantity");`);

    this.addSql(`create table "products_types" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "code" text not null, "name" text not null, "name_en" text null, "sort_order" int not null default 0, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "products_types_scope_idx" on "products_types" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "products_types" add constraint "products_types_scope_code_uniq" unique ("tenant_id", "organization_id", "code");`);

    this.addSql(`alter table "products_prices" add constraint "products_prices_product_id_foreign" foreign key ("product_id") references "products_products" ("id") on delete cascade;`);
  }

}
