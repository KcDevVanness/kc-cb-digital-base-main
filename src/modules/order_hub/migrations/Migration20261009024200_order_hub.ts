import { Migration } from '@mikro-orm/migrations';

export class Migration20261009024200_order_hub extends Migration {

  override name = 'Migration20261009024200';

  override up(): void | Promise<void> {
    this.addSql(`create table "order_hub_company_orders" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "number" text not null, "title" text null, "order_date" date not null, "eta_date" date null, "status" text not null default 'draft', "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "order_hub_company_orders_scope_idx" on "order_hub_company_orders" ("organization_id", "tenant_id", "created_at");`);
    this.addSql(`alter table "order_hub_company_orders" add constraint "order_hub_company_orders_scope_number_uniq" unique ("tenant_id", "organization_id", "number");`);

    this.addSql(`create table "order_hub_company_order_links" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "company_order_id" uuid not null, "kind" text not null, "ref_id" uuid not null, "ref_number" text null, "ref_counterparty" text null, "ref_snapshot" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "order_hub_company_order_links_scope_ref_idx" on "order_hub_company_order_links" ("organization_id", "tenant_id", "ref_id");`);
    this.addSql(`alter table "order_hub_company_order_links" add constraint "order_hub_company_order_links_order_kind_ref_uniq" unique ("company_order_id", "kind", "ref_id");`);

    this.addSql(`alter table "order_hub_company_order_links" add constraint "order_hub_company_order_links_company_order_id_foreign" foreign key ("company_order_id") references "order_hub_company_orders" ("id") on delete cascade;`);
  }

}
