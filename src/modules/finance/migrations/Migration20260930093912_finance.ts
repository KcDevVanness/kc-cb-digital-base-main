import { Migration } from '@mikro-orm/migrations';

export class Migration20260930093912_finance extends Migration {

  override name = 'Migration20260930093912';

  override up(): void | Promise<void> {
    this.addSql(`alter table "finance_expenses" add "paid_at" date null;`);

    this.addSql(`alter table "finance_shipment_costs" add "paid_at" date null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "finance_expenses" drop column "paid_at";`);

    this.addSql(`alter table "finance_shipment_costs" drop column "paid_at";`);
  }

}
