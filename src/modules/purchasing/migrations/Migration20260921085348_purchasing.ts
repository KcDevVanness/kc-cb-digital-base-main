import { Migration } from '@mikro-orm/migrations';

export class Migration20260921085348_purchasing extends Migration {

  override name = 'Migration20260921085348';

  override up(): void | Promise<void> {
    this.addSql(`create table "purchasing_purchase_orders" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "number" text null, "supplier_id" uuid not null, "supplier_snapshot" jsonb null, "status" text not null default 'draft', "currency_code" text not null default 'CNY', "subtotal" numeric(18,4) not null default '0', "tax_total" numeric(18,4) not null default '0', "total" numeric(18,4) not null default '0', "deposit_percent" numeric(6,3) null, "deposit_amount" numeric(18,4) null, "expected_ship_at" date null, "placed_at" timestamptz null, "shipped_at" timestamptz null, "received_at" timestamptz null, "closed_at" timestamptz null, "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`alter table "purchasing_purchase_orders" add constraint "purchasing_purchase_orders_scope_number_uniq" unique ("tenant_id", "organization_id", "number");`);

    this.addSql(`create table "purchasing_purchase_order_lines" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "order_id" uuid not null, "line_number" int not null, "catalog_product_id" uuid not null, "product_snapshot" jsonb null, "quantity" numeric(18,4) not null default '0', "received_quantity" numeric(18,4) not null default '0', "tax_rate" numeric(6,3) not null default '0', "price_includes_tax" boolean not null default true, "unit_price" numeric(18,4) not null default '0', "net_total" numeric(18,4) not null default '0', "tax_amount" numeric(18,4) not null default '0', "line_total" numeric(18,4) not null default '0', "note" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "purchasing_purchase_order_lines" add constraint "purchasing_purchase_order_lines_order_line_uniq" unique ("order_id", "line_number");`);

    this.addSql(`create table "purchasing_purchase_payments" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "order_id" uuid not null, "stage" text not null, "amount" numeric(18,4) not null default '0', "currency_code" text not null default 'CNY', "paid_at" date not null, "reference" text null, "method_note" text null, "created_at" timestamptz not null, primary key ("id"));`);

    this.addSql(`alter table "purchasing_purchase_order_lines" add constraint "purchasing_purchase_order_lines_order_id_foreign" foreign key ("order_id") references "purchasing_purchase_orders" ("id") on delete cascade;`);

    this.addSql(`alter table "purchasing_purchase_payments" add constraint "purchasing_purchase_payments_order_id_foreign" foreign key ("order_id") references "purchasing_purchase_orders" ("id") on delete cascade;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "purchasing_purchase_order_lines" drop constraint if exists "purchasing_purchase_order_lines_order_id_foreign";`);
    this.addSql(`alter table "purchasing_purchase_payments" drop constraint if exists "purchasing_purchase_payments_order_id_foreign";`);
  }

}
