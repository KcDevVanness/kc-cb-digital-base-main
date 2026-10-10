import { Migration } from '@mikro-orm/migrations';

/**
 * The supplier library's product pointer becomes `catalog_product_id`.
 *
 * `purchasing_supplier_products` is created (as `sourcing_supplier_products`) and renamed into the
 * `purchasing` namespace **inside the sourcing chain**, which runs after `purchasing` — module
 * chains are applied in module-id order. Any DDL that touches this table therefore has to live
 * here, in a sourcing migration with a timestamp after the rename; putting it in `purchasing`
 * makes a fresh database fail with `relation "purchasing_supplier_products" does not exist`
 * (`.ai/lessons/cross-module-rename-migration-ordering.md`).
 *
 * The column now points at the installed catalog product (`.ai/specs/2026-10-10-catalog-single-store.md`).
 */
export class Migration20261010081055_sourcing extends Migration {
  override name = 'Migration20261010081055';

  override up(): void | Promise<void> {
    this.addSql(`alter table "purchasing_supplier_products" rename column "product_id" to "catalog_product_id";`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "purchasing_supplier_products" rename column "catalog_product_id" to "product_id";`);
  }
}
