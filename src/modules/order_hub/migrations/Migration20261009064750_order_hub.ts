import { Migration } from '@mikro-orm/migrations';

export class Migration20261009064750_order_hub extends Migration {

  override name = 'Migration20261009064750';

  override up(): void | Promise<void> {
    this.addSql(`alter table "order_hub_company_orders" add "payment_status" text null;`);
    this.addSql(`alter table "order_hub_company_orders" alter column "status" set default 'placed';`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "order_hub_company_orders" drop column "payment_status";`);
    this.addSql(`alter table "order_hub_company_orders" alter column "status" set default 'draft';`);
  }

}
