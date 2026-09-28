import { Migration } from '@mikro-orm/migrations';

/**
 * The money caliber: amounts are `numeric(18,2)` now (HALF_UP, the single amount scale).
 * Generated from the entity diff and scoped to the tables that exist on this branch.
 */
export class Migration20260928073630_export_finance extends Migration {

  override name = 'Migration20260928073630';

  override up(): void | Promise<void> {
    this.addSql(`alter table "export_finance_refunds" alter column "tax_refund_amount" type numeric(18,2) using ("tax_refund_amount"::numeric(18,2));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "export_finance_refunds" alter column "tax_refund_amount" type numeric(18,4) using ("tax_refund_amount"::numeric(18,4));`);
  }

}
