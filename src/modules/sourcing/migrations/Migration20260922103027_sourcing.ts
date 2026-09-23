import { Migration } from '@mikro-orm/migrations';

export class Migration20260922103027_sourcing extends Migration {

  override name = 'Migration20260922103027';

  override up(): void | Promise<void> {
    this.addSql(`create table "sourcing_supplier_products" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "supplier_id" uuid not null, "supplier_name_snapshot" text null, "supplier_sku" text not null, "item_no" text null, "name" text not null, "description" text null, "unit" text not null default 'PCS', "hs_code" text null, "moq_quantity" int null, "carton_quantity" int null, "unit_net_weight" numeric(16,4) null, "carton_gross_weight" numeric(16,4) null, "carton_net_weight" numeric(16,4) null, "inner_packing" jsonb null, "outer_packing" jsonb null, "product_id" uuid null, "status" text not null default 'active', "source" text not null default 'manual', "last_quote_id" uuid null, "last_quote_line_id" uuid null, "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "sourcing_supplier_products_supplier_idx" on "sourcing_supplier_products" ("supplier_id");`);
    this.addSql(`create index "sourcing_supplier_products_scope_idx" on "sourcing_supplier_products" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "sourcing_supplier_products" add constraint "sourcing_supplier_products_scope_supplier_sku_uniq" unique ("tenant_id", "organization_id", "supplier_id", "supplier_sku");`);

    this.addSql(`alter table "sourcing_quote_lines" add "supplier_product_id" uuid null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "sourcing_quote_lines" drop column "supplier_product_id";`);
  }

}
