import { Migration } from '@mikro-orm/migrations';

export class Migration20260928073630_export_finance extends Migration {

  override name = 'Migration20260928073630';

  override up(): void | Promise<void> {
    this.addSql(`alter table "export_finance_collections" alter column "amount" type numeric(18,2) using ("amount"::numeric(18,2));`);

    this.addSql(`alter table "export_finance_refunds" alter column "tax_refund_amount" type numeric(18,2) using ("tax_refund_amount"::numeric(18,2));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "export_finance_collections" alter column "amount" type numeric(18,4) using ("amount"::numeric(18,4));`);

    this.addSql(`alter table "export_finance_refunds" alter column "tax_refund_amount" type numeric(18,4) using ("tax_refund_amount"::numeric(18,4));`);
  }

}
