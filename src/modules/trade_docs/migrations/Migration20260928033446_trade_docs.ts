import { Migration } from '@mikro-orm/migrations';

export class Migration20260928033446_trade_docs extends Migration {

  override name = 'Migration20260928033446';

  override up(): void | Promise<void> {
    this.addSql(`alter table "trade_docs_invoices" add "invoice_kind" text null, add "our_number" text null, add "tax_total" numeric(18,4) not null default '0', add "gross_total" numeric(18,4) not null default '0';`);
    this.addSql(`alter table "trade_docs_invoices" add constraint "trade_docs_invoices_our_number_uniq" unique ("tenant_id", "organization_id", "our_number");`);

    this.addSql(`alter table "trade_docs_invoice_lines" add "tax_rate" numeric(6,3) not null default '0', add "price_includes_tax" boolean not null default true, add "tax_amount" numeric(18,4) not null default '0';`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "trade_docs_invoice_lines" drop column "tax_rate", drop column "price_includes_tax", drop column "tax_amount";`);

    this.addSql(`alter table "trade_docs_invoices" drop constraint if exists "trade_docs_invoices_our_number_uniq";`);
    this.addSql(`alter table "trade_docs_invoices" drop column "invoice_kind", drop column "our_number", drop column "tax_total", drop column "gross_total";`);
  }

}
