import { Migration } from '@mikro-orm/migrations';

export class Migration20260922082558_export_finance extends Migration {

  override name = 'Migration20260922082558';

  override up(): void | Promise<void> {
    this.addSql(`create table "export_finance_collections" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "purchase_order_id" uuid not null, "purchase_order_number" text null, "currency_code" text not null default 'CNY', "collection_status" text not null default 'unknown', "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "export_finance_collections_scope_idx" on "export_finance_collections" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "export_finance_collections" add constraint "export_finance_collections_scope_order_uniq" unique ("tenant_id", "organization_id", "purchase_order_id");`);

    this.addSql(`create table "export_finance_collection_documents" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "collection_id" uuid not null, "doc_type" text not null, "attachment_id" uuid null, "issued_at" date null, "note" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "export_finance_collection_documents_scope_idx" on "export_finance_collection_documents" ("organization_id", "tenant_id");`);

    this.addSql(`create table "export_finance_refunds" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "shipment_id" uuid not null, "shipment_number" text null, "currency_code" text not null default 'CNY', "tax_refund_status" text not null default 'unknown', "tax_refund_amount" numeric(18,4) null, "tax_refund_note" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "export_finance_refunds_scope_idx" on "export_finance_refunds" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "export_finance_refunds" add constraint "export_finance_refunds_scope_shipment_uniq" unique ("tenant_id", "organization_id", "shipment_id");`);

    this.addSql(`create table "export_finance_refund_documents" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "refund_id" uuid not null, "doc_type" text not null, "attachment_id" uuid null, "issued_at" date null, "note" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "export_finance_refund_documents_scope_idx" on "export_finance_refund_documents" ("organization_id", "tenant_id");`);

    this.addSql(`alter table "export_finance_collection_documents" add constraint "export_finance_collection_documents_collection_id_foreign" foreign key ("collection_id") references "export_finance_collections" ("id") on delete cascade;`);

    this.addSql(`alter table "export_finance_refund_documents" add constraint "export_finance_refund_documents_refund_id_foreign" foreign key ("refund_id") references "export_finance_refunds" ("id") on delete cascade;`);
  }

}
