import { Migration } from '@mikro-orm/migrations';

export class Migration20260928064025_finance extends Migration {

  override name = 'Migration20260928064025';

  override up(): void | Promise<void> {
    this.addSql(`create table "finance_shipment_costs" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "shipment_id" uuid not null, "shipment_number" text null, "cost_type" text not null, "allocation_basis" text not null default 'amount', "amount" numeric(18,4) not null, "currency_code" text not null default 'CNY', "exchange_rate" numeric(18,8) null, "incurred_at" date null, "party_id" uuid null, "party_snapshot" jsonb null, "attachment_id" uuid null, "note" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "finance_shipment_costs_shipment_idx" on "finance_shipment_costs" ("tenant_id", "organization_id", "shipment_id");`);
    this.addSql(`create index "finance_shipment_costs_scope_idx" on "finance_shipment_costs" ("organization_id", "tenant_id");`);
  }

}
