import { Migration } from '@mikro-orm/migrations';

export class Migration20261008095745_trade_docs extends Migration {

  override name = 'Migration20261008095745';

  override up(): void | Promise<void> {
    this.addSql(`create table "trade_docs_order_documents" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "order_kind" text not null, "order_id" uuid not null, "order_number" text null, "document_kind" text not null, "document_id" uuid not null, "document_number" text null, "document_snapshot" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "trade_docs_order_documents_order_idx" on "trade_docs_order_documents" ("organization_id", "tenant_id", "order_kind", "order_id");`);
    this.addSql(`create index "trade_docs_order_documents_scope_idx" on "trade_docs_order_documents" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "trade_docs_order_documents" add constraint "trade_docs_order_documents_order_document_uniq" unique ("order_kind", "order_id", "document_kind", "document_id");`);
  }

}
