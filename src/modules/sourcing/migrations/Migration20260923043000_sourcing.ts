import { Migration } from '@mikro-orm/migrations';

/**
 * Hands the supplier product library over to the `purchasing` module.
 *
 * The entities, commands, API and pages moved to `purchasing` (the menu the pages already rendered
 * in), and the tables move with them: **rename, never re-create**, so every existing library row —
 * codes, packing data, photos and prices — survives the handover and no operator has to re-import a
 * supplier sheet.
 *
 * This migration lives in `sourcing` on purpose. Migrations run per module, and the tables it
 * renames are created by this module's own earlier migrations, so keeping the handover here is what
 * makes the order deterministic: `Migration20260922103027_sourcing` (create) →
 * `Migration20260923021622_sourcing` (the 产品明细表 columns and the price table) → this one. A
 * `purchasing` migration would have to assume `sourcing` ran first, which the runner does not
 * guarantee.
 *
 * The quote line's old reverse pointer (`sourcing_quote_lines.supplier_product_id`) is dropped: it
 * pointed at a row another module owns, nothing read it, and the library row already records the
 * quotation line it was fed from (`last_quote_line_id`).
 */
export class Migration20260923043000_sourcing extends Migration {

  override name = 'Migration20260923043000';

  override up(): void | Promise<void> {
    // The library tables themselves.
    this.addSql(`alter table "sourcing_supplier_products" rename to "purchasing_supplier_products";`);
    this.addSql(`alter index "sourcing_supplier_products_scope_idx" rename to "purchasing_supplier_products_scope_idx";`);
    this.addSql(`alter index "sourcing_supplier_products_supplier_idx" rename to "purchasing_supplier_products_supplier_idx";`);
    this.addSql(`alter table "purchasing_supplier_products" rename constraint "sourcing_supplier_products_scope_supplier_sku_uniq" to "purchasing_supplier_products_scope_supplier_sku_uniq";`);

    // The price list, and the foreign key that follows its item (Postgres keeps the reference
    // pointing at the renamed table; only the constraint's own name is stale).
    this.addSql(`alter table "sourcing_supplier_product_prices" rename to "purchasing_supplier_product_prices";`);
    this.addSql(`alter index "sourcing_supplier_product_prices_scope_idx" rename to "purchasing_supplier_product_prices_scope_idx";`);
    this.addSql(`alter index "sourcing_supplier_product_prices_product_idx" rename to "purchasing_supplier_product_prices_product_idx";`);
    this.addSql(`alter table "purchasing_supplier_product_prices" rename constraint "sourcing_supplier_product_prices_key_uniq" to "purchasing_supplier_product_prices_key_uniq";`);
    this.addSql(`alter table "purchasing_supplier_product_prices" rename constraint "sourcing_supplier_product_prices_supplier_product_id_foreign" to "purchasing_supplier_product_prices_supplier_product_id_foreign";`);

    this.addSql(`alter table "sourcing_quote_lines" drop column "supplier_product_id";`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "sourcing_quote_lines" add "supplier_product_id" uuid null;`);

    this.addSql(`alter table "purchasing_supplier_product_prices" rename constraint "purchasing_supplier_product_prices_supplier_product_id_foreign" to "sourcing_supplier_product_prices_supplier_product_id_foreign";`);
    this.addSql(`alter table "purchasing_supplier_product_prices" rename constraint "purchasing_supplier_product_prices_key_uniq" to "sourcing_supplier_product_prices_key_uniq";`);
    this.addSql(`alter index "purchasing_supplier_product_prices_product_idx" rename to "sourcing_supplier_product_prices_product_idx";`);
    this.addSql(`alter index "purchasing_supplier_product_prices_scope_idx" rename to "sourcing_supplier_product_prices_scope_idx";`);
    this.addSql(`alter table "purchasing_supplier_product_prices" rename to "sourcing_supplier_product_prices";`);

    this.addSql(`alter table "purchasing_supplier_products" rename constraint "purchasing_supplier_products_scope_supplier_sku_uniq" to "sourcing_supplier_products_scope_supplier_sku_uniq";`);
    this.addSql(`alter index "purchasing_supplier_products_supplier_idx" rename to "sourcing_supplier_products_supplier_idx";`);
    this.addSql(`alter index "purchasing_supplier_products_scope_idx" rename to "sourcing_supplier_products_scope_idx";`);
    this.addSql(`alter table "purchasing_supplier_products" rename to "sourcing_supplier_products";`);
  }

}
