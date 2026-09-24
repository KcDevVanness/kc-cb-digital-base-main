import { Migration } from '@mikro-orm/migrations';

export class Migration20260922063727_trade_docs extends Migration {

  override name = 'Migration20260922063727';

  override up(): void | Promise<void> {
    this.addSql(`create table "trade_docs_contracts" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "number" text null, "direction" text not null default 'purchase', "status" text not null default 'draft', "counterparty_kind" text not null default 'supplier', "counterparty_id" uuid null, "counterparty_snapshot" jsonb null, "our_party_snapshot" jsonb null, "price_tier" text null, "currency_code" text not null default 'CNY', "exchange_rate" numeric(18,8) null, "source_kind" text null, "source_id" uuid null, "source_snapshot" jsonb null, "contract_total" numeric(18,4) not null default '0', "finance_total" numeric(18,4) not null default '0', "difference_total" numeric(18,4) not null default '0', "signed_at" date null, "delivery_date" date null, "payment_terms" text null, "shipping_method" text null, "destination" text null, "marks" text null, "notes" text null, "generated_attachment_id" uuid null, "generated_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "trade_docs_contracts_scope_idx" on "trade_docs_contracts" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "trade_docs_contracts" add constraint "trade_docs_contracts_scope_number_uniq" unique ("tenant_id", "organization_id", "number");`);

    this.addSql(`create table "trade_docs_contract_lines" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "contract_id" uuid not null, "line_number" int not null, "product_id" uuid null, "product_snapshot" jsonb null, "name" text null, "sku" text null, "model" text null, "spec" text null, "unit" text null, "quantity" numeric(18,6) not null default '0', "unit_price" numeric(18,6) not null default '0', "contract_amount" numeric(18,4) not null default '0', "finance_amount" numeric(18,4) not null default '0', "note" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "trade_docs_contract_lines_scope_idx" on "trade_docs_contract_lines" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "trade_docs_contract_lines" add constraint "trade_docs_contract_lines_contract_line_uniq" unique ("contract_id", "line_number");`);

    this.addSql(`create table "trade_docs_invoices" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "number" text null, "direction" text not null default 'inbound', "status" text not null default 'draft', "counterparty_kind" text not null default 'supplier', "counterparty_id" uuid null, "counterparty_snapshot" jsonb null, "contract_id" uuid null, "source_kind" text null, "source_id" uuid null, "source_snapshot" jsonb null, "currency_code" text not null default 'CNY', "subtotal" numeric(18,4) not null default '0', "total" numeric(18,4) not null default '0', "issued_at" date null, "attachment_id" uuid null, "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "trade_docs_invoices_number_idx" on "trade_docs_invoices" ("tenant_id", "organization_id", "number");`);
    this.addSql(`create index "trade_docs_invoices_scope_idx" on "trade_docs_invoices" ("organization_id", "tenant_id");`);

    this.addSql(`create table "trade_docs_invoice_lines" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "invoice_id" uuid not null, "line_number" int not null, "product_id" uuid null, "product_snapshot" jsonb null, "description" text null, "sku" text null, "unit" text null, "quantity" numeric(18,6) not null default '0', "unit_price" numeric(18,6) not null default '0', "amount" numeric(18,4) not null default '0', "contract_line_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "trade_docs_invoice_lines_scope_idx" on "trade_docs_invoice_lines" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "trade_docs_invoice_lines" add constraint "trade_docs_invoice_lines_invoice_line_uniq" unique ("invoice_id", "line_number");`);

    this.addSql(`alter table "trade_docs_contract_lines" add constraint "trade_docs_contract_lines_contract_id_foreign" foreign key ("contract_id") references "trade_docs_contracts" ("id") on delete cascade;`);

    this.addSql(`alter table "trade_docs_invoices" add constraint "trade_docs_invoices_contract_id_foreign" foreign key ("contract_id") references "trade_docs_contracts" ("id") on delete set null;`);

    this.addSql(`alter table "trade_docs_invoice_lines" add constraint "trade_docs_invoice_lines_invoice_id_foreign" foreign key ("invoice_id") references "trade_docs_invoices" ("id") on delete cascade;`);
    this.addSql(`alter table "trade_docs_invoice_lines" add constraint "trade_docs_invoice_lines_contract_line_id_foreign" foreign key ("contract_line_id") references "trade_docs_contract_lines" ("id") on delete set null;`);
  }

}
