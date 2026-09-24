import { Migration } from '@mikro-orm/migrations';

export class Migration20260922073530_purchasing extends Migration {

  override name = 'Migration20260922073530';

  override up(): void | Promise<void> {
    this.addSql(`alter table "purchasing_purchase_order_lines" add "product_id" uuid null;`);
    this.addSql(`alter table "purchasing_purchase_order_lines" alter column "catalog_product_id" drop not null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "purchasing_purchase_order_lines" drop column "product_id";`);
    this.addSql(`alter table "purchasing_purchase_order_lines" alter column "catalog_product_id" set not null;`);
  }

}
