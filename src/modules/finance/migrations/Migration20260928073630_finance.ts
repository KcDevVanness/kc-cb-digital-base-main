import { Migration } from '@mikro-orm/migrations';

export class Migration20260928073630_finance extends Migration {

  override name = 'Migration20260928073630';

  override up(): void | Promise<void> {
    this.addSql(`alter table "finance_expenses" alter column "amount" type numeric(18,2) using ("amount"::numeric(18,2));`);

    this.addSql(`alter table "finance_shipment_costs" alter column "amount" type numeric(18,2) using ("amount"::numeric(18,2));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "finance_expenses" alter column "amount" type numeric(18,4) using ("amount"::numeric(18,4));`);

    this.addSql(`alter table "finance_shipment_costs" alter column "amount" type numeric(18,4) using ("amount"::numeric(18,4));`);
  }

}
