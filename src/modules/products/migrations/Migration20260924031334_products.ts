import { Migration } from '@mikro-orm/migrations';

export class Migration20260924031334_products extends Migration {

  override name = 'Migration20260924031334';

  override up(): void | Promise<void> {
    this.addSql(`alter table "products_products" add "volume" numeric(16,6) null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "products_products" drop column "volume";`);
  }

}
