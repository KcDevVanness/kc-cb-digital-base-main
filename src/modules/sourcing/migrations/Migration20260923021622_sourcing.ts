import { Migration } from '@mikro-orm/migrations';

export class Migration20260923021622_sourcing extends Migration {

  override name = 'Migration20260923021622';

  override up(): void | Promise<void> {
    this.addSql(`create table "sourcing_supplier_product_prices" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "supplier_product_id" uuid not null, "price_kind" text not null, "currency_code" text not null, "min_quantity" int not null default 1, "unit_price" numeric(18,6) not null default '0', "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "sourcing_supplier_product_prices_product_idx" on "sourcing_supplier_product_prices" ("supplier_product_id");`);
    this.addSql(`create index "sourcing_supplier_product_prices_scope_idx" on "sourcing_supplier_product_prices" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "sourcing_supplier_product_prices" add constraint "sourcing_supplier_product_prices_key_uniq" unique ("tenant_id", "organization_id", "supplier_product_id", "price_kind", "currency_code", "min_quantity");`);

    this.addSql(`alter table "sourcing_supplier_products" add "name_zh" text null, add "name_en" text null, add "declaration_elements" text null, add "image_attachment_ids" jsonb not null default '[]';`);

    this.addSql(`alter table "sourcing_supplier_product_prices" add constraint "sourcing_supplier_product_prices_supplier_product_id_foreign" foreign key ("supplier_product_id") references "sourcing_supplier_products" ("id") on delete cascade;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "sourcing_supplier_products" drop column "name_zh", drop column "name_en", drop column "declaration_elements", drop column "image_attachment_ids";`);
    this.addSql(`drop table if exists "sourcing_supplier_product_prices" cascade;`);
  }

}
