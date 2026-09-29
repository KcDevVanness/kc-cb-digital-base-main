import { Migration } from '@mikro-orm/migrations';

/**
 * The supplier price caliber (18,6 → 18,4) for `purchasing_supplier_product_prices`.
 *
 * That table is renamed into the purchasing namespace by **this** chain
 * (`Migration20260923043000_sourcing`), and `dbMigrate` walks modules in registration order with
 * one migrator per chain — `purchasing` is registered before `sourcing`, so on a fresh database a
 * purchasing-chain migration touching the table would run before the rename exists. Keeping the
 * statement here, after the rename, is the rule recorded in
 * `.ai/lessons/cross-module-rename-migration-ordering.md`.
 */
export class Migration20260928082000_sourcing extends Migration {

  override name = 'Migration20260928082000';

  override up(): void | Promise<void> {
    this.addSql(`alter table "purchasing_supplier_product_prices" alter column "unit_price" type numeric(18,4) using ("unit_price"::numeric(18,4));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "purchasing_supplier_product_prices" alter column "unit_price" type numeric(18,6) using ("unit_price"::numeric(18,6));`);
  }

}
