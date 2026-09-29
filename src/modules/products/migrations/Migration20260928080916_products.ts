import { Migration } from '@mikro-orm/migrations';

export class Migration20260928080916_products extends Migration {

  override name = 'Migration20260928080916';

  override up(): void | Promise<void> {
    this.addSql(`alter table "products_products" add "source_product_id" uuid null;`);
    this.addSql(`alter table "products_products" add constraint "products_products_source_product_id_foreign" foreign key ("source_product_id") references "products_products" ("id") on delete set null;`);
    this.addSql(`create index "products_products_source_idx" on "products_products" ("organization_id", "tenant_id", "source_product_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "products_products" drop constraint if exists "products_products_source_product_id_foreign";`);

    this.addSql(`drop index "products_products_source_idx";`);
    this.addSql(`alter table "products_products" drop column "source_product_id";`);
  }

}
