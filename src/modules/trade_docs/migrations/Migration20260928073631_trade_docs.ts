import { Migration } from '@mikro-orm/migrations';

/**
 * The money caliber: amounts are `numeric(18,2)` now (HALF_UP, the single amount scale).
 * Generated from the entity diff and scoped to the tables that exist on this branch.
 */
export class Migration20260928073631_trade_docs extends Migration {

  override name = 'Migration20260928073631';

  override up(): void | Promise<void> {
    this.addSql(`alter table "trade_docs_contracts" alter column "contract_total" type numeric(18,2) using ("contract_total"::numeric(18,2));`);
    this.addSql(`alter table "trade_docs_contracts" alter column "difference_total" type numeric(18,2) using ("difference_total"::numeric(18,2));`);
    this.addSql(`alter table "trade_docs_contracts" alter column "finance_total" type numeric(18,2) using ("finance_total"::numeric(18,2));`);
    this.addSql(`alter table "trade_docs_contract_lines" alter column "contract_amount" type numeric(18,2) using ("contract_amount"::numeric(18,2));`);
    this.addSql(`alter table "trade_docs_contract_lines" alter column "finance_amount" type numeric(18,2) using ("finance_amount"::numeric(18,2));`);
    this.addSql(`alter table "trade_docs_contract_lines" alter column "unit_price" type numeric(18,4) using ("unit_price"::numeric(18,4));`);
    this.addSql(`alter table "trade_docs_invoices" alter column "subtotal" type numeric(18,2) using ("subtotal"::numeric(18,2));`);
    this.addSql(`alter table "trade_docs_invoices" alter column "total" type numeric(18,2) using ("total"::numeric(18,2));`);
    this.addSql(`alter table "trade_docs_invoice_lines" alter column "amount" type numeric(18,2) using ("amount"::numeric(18,2));`);
    this.addSql(`alter table "trade_docs_invoice_lines" alter column "unit_price" type numeric(18,4) using ("unit_price"::numeric(18,4));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "trade_docs_contract_lines" alter column "unit_price" type numeric(18,6) using ("unit_price"::numeric(18,6));`);
    this.addSql(`alter table "trade_docs_contract_lines" alter column "contract_amount" type numeric(18,4) using ("contract_amount"::numeric(18,4));`);
    this.addSql(`alter table "trade_docs_contract_lines" alter column "finance_amount" type numeric(18,4) using ("finance_amount"::numeric(18,4));`);
    this.addSql(`alter table "trade_docs_contracts" alter column "contract_total" type numeric(18,4) using ("contract_total"::numeric(18,4));`);
    this.addSql(`alter table "trade_docs_contracts" alter column "finance_total" type numeric(18,4) using ("finance_total"::numeric(18,4));`);
    this.addSql(`alter table "trade_docs_contracts" alter column "difference_total" type numeric(18,4) using ("difference_total"::numeric(18,4));`);
    this.addSql(`alter table "trade_docs_invoice_lines" alter column "unit_price" type numeric(18,6) using ("unit_price"::numeric(18,6));`);
    this.addSql(`alter table "trade_docs_invoice_lines" alter column "amount" type numeric(18,4) using ("amount"::numeric(18,4));`);
    this.addSql(`alter table "trade_docs_invoices" alter column "subtotal" type numeric(18,4) using ("subtotal"::numeric(18,4));`);
    this.addSql(`alter table "trade_docs_invoices" alter column "total" type numeric(18,4) using ("total"::numeric(18,4));`);
  }

}
