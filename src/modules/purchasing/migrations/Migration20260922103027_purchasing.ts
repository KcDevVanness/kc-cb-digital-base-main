import { Migration } from '@mikro-orm/migrations';

export class Migration20260922103027_purchasing extends Migration {

  override name = 'Migration20260922103027';

  override up(): void | Promise<void> {
    this.addSql(`alter table "purchasing_purchase_order_lines" add "supplier_product_id" uuid null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "purchasing_purchase_order_lines" drop column "supplier_product_id";`);
  }

}
