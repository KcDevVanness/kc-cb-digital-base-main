import { Migration } from '@mikro-orm/migrations';

export class Migration20261010025411_order_hub extends Migration {

  override name = 'Migration20261010025411';

  override up(): void | Promise<void> {
    this.addSql(`alter table "order_hub_company_orders" add "product_category" text null, add "owner_user_id" uuid null, add "owner_snapshot" jsonb null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "order_hub_company_orders" drop column "product_category", drop column "owner_user_id", drop column "owner_snapshot";`);
  }

}
