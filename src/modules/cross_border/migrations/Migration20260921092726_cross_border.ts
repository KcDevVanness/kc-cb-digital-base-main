import { Migration } from '@mikro-orm/migrations';

export class Migration20260921092726_cross_border extends Migration {

  override name = 'Migration20260921092726';

  override up(): void | Promise<void> {
    this.addSql(`create table "cross_border_shipments" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "number" text null, "status" text not null default 'draft', "carrier_name" text null, "forwarder_contact" text null, "departure_port" text null, "destination_warehouse_id" uuid null, "destination_location_id" uuid null, "current_milestone" text null, "etd" date null, "eta" date null, "departed_at" timestamptz null, "received_at" timestamptz null, "cancelled_at" timestamptz null, "cancel_reason" text null, "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`alter table "cross_border_shipments" add constraint "cross_border_shipments_scope_number_uniq" unique ("tenant_id", "organization_id", "number");`);

    this.addSql(`create table "cross_border_export_documents" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "shipment_id" uuid not null, "purchase_order_id" uuid null, "doc_type" text not null, "document_number" text null, "issued_at" date null, "attachment_id" uuid null, "note" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);

    this.addSql(`create table "cross_border_shipment_allocations" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "shipment_id" uuid not null, "purchase_order_id" uuid not null, "purchase_order_line_id" uuid not null, "purchase_order_number" text null, "catalog_product_id" uuid not null, "product_snapshot" jsonb null, "quantity" numeric(18,4) not null default '0', "received_quantity" numeric(18,4) null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "cross_border_shipment_allocations" add constraint "cross_border_shipment_allocations_shipment_line_uniq" unique ("shipment_id", "purchase_order_line_id");`);

    this.addSql(`create table "cross_border_shipment_milestones" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "shipment_id" uuid not null, "milestone" text not null, "occurred_at" timestamptz not null, "note" text null, "recorded_by" uuid null, "created_at" timestamptz not null, primary key ("id"));`);

    this.addSql(`alter table "cross_border_export_documents" add constraint "cross_border_export_documents_shipment_id_foreign" foreign key ("shipment_id") references "cross_border_shipments" ("id") on delete cascade;`);

    this.addSql(`alter table "cross_border_shipment_allocations" add constraint "cross_border_shipment_allocations_shipment_id_foreign" foreign key ("shipment_id") references "cross_border_shipments" ("id") on delete cascade;`);

    this.addSql(`alter table "cross_border_shipment_milestones" add constraint "cross_border_shipment_milestones_shipment_id_foreign" foreign key ("shipment_id") references "cross_border_shipments" ("id") on delete cascade;`);
  }

}
