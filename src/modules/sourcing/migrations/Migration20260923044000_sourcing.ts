import { Migration } from '@mikro-orm/migrations';

/**
 * Finishes the library handover: the two primary-key indexes Postgres had auto-named after the old
 * tables (`sourcing_*_pkey`) are renamed to match the tables they now belong to.
 *
 * A corrective migration rather than an edit to `Migration20260923043000_sourcing`, which the
 * environment already applied: the schema in a running database and the migration history must
 * agree, and a name that still says `sourcing` on a `purchasing` table is exactly the kind of stale
 * artifact the next debugging session trips over.
 */
export class Migration20260923044000_sourcing extends Migration {

  override name = 'Migration20260923044000';

  override up(): void | Promise<void> {
    this.addSql(`alter index if exists "sourcing_supplier_products_pkey" rename to "purchasing_supplier_products_pkey";`);
    this.addSql(`alter index if exists "sourcing_supplier_product_prices_pkey" rename to "purchasing_supplier_product_prices_pkey";`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter index if exists "purchasing_supplier_product_prices_pkey" rename to "sourcing_supplier_product_prices_pkey";`);
    this.addSql(`alter index if exists "purchasing_supplier_products_pkey" rename to "sourcing_supplier_products_pkey";`);
  }

}
