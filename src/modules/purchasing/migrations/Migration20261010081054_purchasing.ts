import { Migration } from '@mikro-orm/migrations';

export class Migration20261010081054_purchasing extends Migration {

  override name = 'Migration20261010081054';

  override up(): void | Promise<void> {
    this.addSql(`alter table "purchasing_purchase_order_lines" drop column "product_id";`);

    this.addSql(`alter table "purchasing_supplier_products" rename column "product_id" to "catalog_product_id";`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "purchasing_purchase_order_lines" add "product_id" uuid null;`);

    this.addSql(`alter table "purchasing_supplier_products" rename column "catalog_product_id" to "product_id";`);
  }

}
