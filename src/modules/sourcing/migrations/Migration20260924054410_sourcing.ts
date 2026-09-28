import { Migration } from '@mikro-orm/migrations';

/**
 * Narrows the library's `discount_percent` to whole percent (owner 2026-09-24: 折扣 is a whole
 * number — the create form's price group must not carry a decimal point, and an existing value read
 * back as a padded `5.0000`).
 *
 * Filed in `sourcing`, not in `purchasing` where the entity lives: the module chains run in
 * module-id order (`purchasing` before `sourcing`) and this table is created and renamed inside
 * `sourcing`'s chain, so a `purchasing`-filed statement would run before the table exists on a fresh
 * database — see `.ai/lessons/cross-module-rename-migration-ordering.md`, the same reasoning
 * `Migration20260924035458_sourcing` records for `unit_volume`.
 *
 * `using ("discount_percent"::numeric(3,0))` is the cast MikroORM generated: it rounds a stored
 * fraction (none existed in the dev database when this shipped — 2 rows, both whole) to the nearest
 * percent, and the write contract refuses new ones (`data/validators.ts`, `nullableDecimalSchema(0)`).
 */
export class Migration20260924054410_sourcing extends Migration {

  override name = 'Migration20260924054410';

  override up(): void | Promise<void> {
    this.addSql(`alter table "purchasing_supplier_products" alter column "discount_percent" type numeric(3,0) using ("discount_percent"::numeric(3,0));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "purchasing_supplier_products" alter column "discount_percent" type numeric(7,4) using ("discount_percent"::numeric(7,4));`);
  }

}
