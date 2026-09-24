import { Migration } from '@mikro-orm/migrations';

export class Migration20260924035458_products extends Migration {

  override name = 'Migration20260924035458';

  override up(): void | Promise<void> {
    this.addSql(`alter table "products_products" alter column "volume" type numeric(16,0) using ("volume"::numeric(16,0));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "products_products" alter column "volume" type numeric(16,6) using ("volume"::numeric(16,6));`);
  }

}
