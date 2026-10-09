import { Migration } from '@mikro-orm/migrations';

export class Migration20261009044102_order_hub extends Migration {

  override name = 'Migration20261009044102';

  override up(): void | Promise<void> {
    this.addSql(`alter table "order_hub_company_orders" add "customer_party_id" uuid null, add "customer_snapshot" jsonb null, add "supplier_id" uuid null, add "supplier_snapshot" jsonb null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "order_hub_company_orders" drop column "customer_party_id", drop column "customer_snapshot", drop column "supplier_id", drop column "supplier_snapshot";`);
  }

}
