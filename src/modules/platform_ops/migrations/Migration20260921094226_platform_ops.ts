import { Migration } from '@mikro-orm/migrations';

export class Migration20260921094226_platform_ops extends Migration {

  override name = 'Migration20260921094226';

  override up(): void | Promise<void> {
    this.addSql(`create table "platform_ops_channels" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "code" text not null, "platform" text not null, "external_account_id" text null, "currency_code" text not null default 'USD', "is_active" boolean not null default true, "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`alter table "platform_ops_channels" add constraint "platform_ops_channels_scope_code_uniq" unique ("tenant_id", "organization_id", "code");`);

    this.addSql(`create table "platform_ops_order_mirrors" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "channel_id" uuid not null, "external_order_id" text not null, "status" text null, "currency_code" text not null default 'USD', "gross_amount" numeric(18,4) not null default '0', "fee_amount" numeric(18,4) not null default '0', "net_amount" numeric(18,4) not null default '0', "placed_at" timestamptz null, "shipment_id" uuid null, "shipment_number" text null, "raw" jsonb null, "synced_at" timestamptz not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "platform_ops_order_mirrors" add constraint "platform_ops_order_mirrors_channel_external_uniq" unique ("channel_id", "external_order_id");`);

    this.addSql(`create table "platform_ops_reconciliation_items" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "channel_id" uuid not null, "kind" text not null, "external_ref" text not null, "settlement_id" uuid null, "order_mirror_id" uuid null, "expected_amount" numeric(18,4) null, "actual_amount" numeric(18,4) null, "currency_code" text null, "status" text not null default 'open', "note" text null, "resolved_at" timestamptz null, "resolved_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);

    this.addSql(`create table "platform_ops_settlements" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "channel_id" uuid not null, "external_settlement_id" text not null, "period_start" date null, "period_end" date null, "currency_code" text not null default 'USD', "gross_amount" numeric(18,4) not null default '0', "fee_amount" numeric(18,4) not null default '0', "net_amount" numeric(18,4) not null default '0', "status" text not null default 'imported', "received_at" timestamptz null, "raw" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "platform_ops_settlements" add constraint "platform_ops_settlements_channel_external_uniq" unique ("channel_id", "external_settlement_id");`);

    this.addSql(`create table "platform_ops_settlement_lines" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "settlement_id" uuid not null, "external_order_id" text not null, "order_mirror_id" uuid null, "gross_amount" numeric(18,4) not null default '0', "fee_amount" numeric(18,4) not null default '0', "net_amount" numeric(18,4) not null default '0', "created_at" timestamptz not null, primary key ("id"));`);

    this.addSql(`alter table "platform_ops_order_mirrors" add constraint "platform_ops_order_mirrors_channel_id_foreign" foreign key ("channel_id") references "platform_ops_channels" ("id") on delete cascade;`);

    this.addSql(`alter table "platform_ops_reconciliation_items" add constraint "platform_ops_reconciliation_items_channel_id_foreign" foreign key ("channel_id") references "platform_ops_channels" ("id") on delete cascade;`);

    this.addSql(`alter table "platform_ops_settlements" add constraint "platform_ops_settlements_channel_id_foreign" foreign key ("channel_id") references "platform_ops_channels" ("id") on delete cascade;`);

    this.addSql(`alter table "platform_ops_settlement_lines" add constraint "platform_ops_settlement_lines_settlement_id_foreign" foreign key ("settlement_id") references "platform_ops_settlements" ("id") on delete cascade;`);
  }

}
