import { Migration } from '@mikro-orm/migrations';

export class Migration20260928073630_products extends Migration {

  override name = 'Migration20260928073630';

  override up(): void | Promise<void> {
    this.addSql(`alter table "products_prices" alter column "unit_price" type numeric(18,4) using ("unit_price"::numeric(18,4));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "products_prices" alter column "unit_price" type numeric(18,6) using ("unit_price"::numeric(18,6));`);
  }

}
