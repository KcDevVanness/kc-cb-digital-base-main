import { Migration } from '@mikro-orm/migrations';

export class Migration20260928021830_trade_docs extends Migration {

  override name = 'Migration20260928021830';

  override up(): void | Promise<void> {
    this.addSql(`create table "trade_docs_documents" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "kind" text not null default 'proforma', "direction" text not null default 'sales', "number" text null, "status" text not null default 'draft', "counterparty_kind" text not null default 'customer', "counterparty_id" uuid null, "counterparty_snapshot" jsonb null, "our_party_snapshot" jsonb null, "consignee_snapshot" jsonb null, "notify_party_snapshot" jsonb null, "currency_code" text not null default 'CNY', "exchange_rate" numeric(18,8) null, "subtotal" numeric(18,4) not null default '0', "total" numeric(18,4) not null default '0', "payment_terms" text null, "incoterms" text null, "valid_until" date null, "delivery_date" date null, "marks" text null, "source_kind" text null, "source_id" uuid null, "source_snapshot" jsonb null, "issued_at" date null, "generated_attachment_id" uuid null, "generated_at" timestamptz null, "attachment_id" uuid null, "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "trade_docs_documents_kind_status_idx" on "trade_docs_documents" ("tenant_id", "organization_id", "kind", "status");`);
    this.addSql(`create index "trade_docs_documents_scope_idx" on "trade_docs_documents" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "trade_docs_documents" add constraint "trade_docs_documents_scope_number_uniq" unique ("tenant_id", "organization_id", "number");`);

    this.addSql(`create table "trade_docs_document_lines" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "document_id" uuid not null, "line_number" int not null, "product_id" uuid null, "product_snapshot" jsonb null, "name" text null, "sku" text null, "model" text null, "spec" text null, "unit" text null, "quantity" numeric(18,6) not null default '0', "unit_price" numeric(18,6) not null default '0', "amount" numeric(18,4) not null default '0', "source_snapshot" jsonb null, "note" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "trade_docs_document_lines_scope_idx" on "trade_docs_document_lines" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "trade_docs_document_lines" add constraint "trade_docs_document_lines_document_line_uniq" unique ("document_id", "line_number");`);

    this.addSql(`alter table "trade_docs_contracts" add "incoterms" text null;`);

    this.addSql(`alter table "trade_docs_document_lines" add constraint "trade_docs_document_lines_document_id_foreign" foreign key ("document_id") references "trade_docs_documents" ("id") on delete cascade;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "trade_docs_document_lines" drop constraint if exists "trade_docs_document_lines_document_id_foreign";`);

    // The generated down() only reverses what it can express as an ALTER; the two tables this
    // migration creates are dropped here so a rollback really removes the slice's storage.
    this.addSql(`drop table if exists "trade_docs_document_lines" cascade;`);
    this.addSql(`drop table if exists "trade_docs_documents" cascade;`);

    this.addSql(`alter table "trade_docs_contracts" drop column "incoterms";`);
  }

}
