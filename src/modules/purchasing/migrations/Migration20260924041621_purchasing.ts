import { Migration } from '@mikro-orm/migrations';

/**
 * Adds the supplier's **default brand** (`brand_value`), the prefix of every generated product code
 * for that supplier's library rows.
 *
 * `purchasing_suppliers` is created by this module's own chain (`Migration20260921081717_purchasing`),
 * so this file belongs here. The sibling column on `purchasing_supplier_products` deliberately does
 * **not**: that table is renamed into the `purchasing` namespace by a `sourcing` migration, and the
 * chains run in module order with `purchasing` first — see
 * `src/modules/sourcing/migrations/Migration20260924041621_sourcing.ts` and
 * `.ai/lessons/cross-module-rename-migration-ordering.md`.
 */
export class Migration20260924041621_purchasing extends Migration {

  override name = 'Migration20260924041621';

  override up(): void | Promise<void> {
    this.addSql(`alter table "purchasing_suppliers" add column if not exists "brand_value" text null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "purchasing_suppliers" drop column if exists "brand_value";`);
  }

}
