import { Migration } from '@mikro-orm/migrations';

export class Migration20261008042809_purchasing extends Migration {

  override name = 'Migration20261008042809';

  override up(): void | Promise<void> {
    this.addSql(`alter table "purchasing_purchase_orders" add "source_sales_order_id" uuid null, add "source_sales_order_kind" text null, add "source_sales_order_number" text null;`);
    this.addSql(`create index "purchasing_purchase_orders_source_sales_order_idx" on "purchasing_purchase_orders" ("organization_id", "tenant_id", "source_sales_order_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "purchasing_purchase_orders_source_sales_order_idx";`);
    this.addSql(`alter table "purchasing_purchase_orders" drop column "source_sales_order_id", drop column "source_sales_order_kind", drop column "source_sales_order_number";`);
  }

}
