import { Migration } from '@mikro-orm/migrations';

export class Migration20260923031027_products extends Migration {

  override name = 'Migration20260923031027';

  override up(): void | Promise<void> {
    this.addSql(`alter table "products_products" alter column "brand" set default '';`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "products_products" alter column "brand" set default 'Petkit';`);
  }

}
