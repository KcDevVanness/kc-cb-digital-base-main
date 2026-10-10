import { Migration } from '@mikro-orm/migrations';

/**
 * Purchase-order lines lose the app-owned product reference: since the catalog single-store cutover
 * a line points at the installed catalog through `catalog_product_id` (or at a supplier library row
 * through `supplier_product_id`), and the old `product_id` column has no meaning any more.
 *
 * The supplier library's own column rename rides a **sourcing** migration
 * (`Migration20261010081055_sourcing`) because that table is created and renamed inside the
 * sourcing chain, which runs after `purchasing` — see
 * `.ai/lessons/cross-module-rename-migration-ordering.md`.
 */
export class Migration20261010081054_purchasing extends Migration {
  override name = 'Migration20261010081054';

  override up(): void | Promise<void> {
    this.addSql(`alter table "purchasing_purchase_order_lines" drop column "product_id";`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "purchasing_purchase_order_lines" add "product_id" uuid null;`);
  }
}
