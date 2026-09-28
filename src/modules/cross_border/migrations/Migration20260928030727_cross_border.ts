import { Migration } from '@mikro-orm/migrations';

export class Migration20260928030727_cross_border extends Migration {

  override name = 'Migration20260928030727';

  override up(): void | Promise<void> {
    this.addSql(`create table "cross_border_shipment_sales_allocations" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "shipment_id" uuid not null, "sales_order_id" uuid not null, "sales_order_line_id" uuid not null, "sales_order_number" text null, "catalog_product_id" uuid not null, "product_snapshot" jsonb null, "quantity" numeric(18,4) not null default '0', "unit_price" numeric(18,6) null, "currency_code" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "cross_border_shipment_sales_allocations_scope_idx" on "cross_border_shipment_sales_allocations" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "cross_border_shipment_sales_allocations" add constraint "cross_border_shipment_sales_allocations_shipment_line_uniq" unique ("shipment_id", "sales_order_line_id");`);

    this.addSql(`alter table "cross_border_shipment_sales_allocations" add constraint "cross_border_shipment_sales_allocations_shipment_id_foreign" foreign key ("shipment_id") references "cross_border_shipments" ("id") on delete cascade;`);
  }

  override down(): void | Promise<void> {
    // The generated migration carried no down(); the table this migration adds is dropped here so a
    // rollback really removes the slice's storage (its index and FK go with it).
    this.addSql(`drop table if exists "cross_border_shipment_sales_allocations" cascade;`);
  }

}
