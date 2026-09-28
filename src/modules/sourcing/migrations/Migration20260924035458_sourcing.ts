import { Migration } from '@mikro-orm/migrations';

/**
 * Narrows the library's `unit_volume` to whole cm³ (owner 2026-09-24: the form showed a padded
 * `88642.000000`; the sheet's 体积 is a whole number of cm³).
 *
 * Filed in `sourcing`, not in `purchasing` where the entity lives: the module chains run in
 * module-id order (`purchasing` before `sourcing`) and this table is created and renamed inside
 * `sourcing`'s chain, so a `purchasing`-filed statement would run before the table exists on a fresh
 * database — see `.ai/lessons/cross-module-rename-migration-ordering.md` and
 * `Migration20260924024748_sourcing`, which adds the column as numeric(16,6) in the first place.
 *
 * `using ("unit_volume"::numeric(16,0))` is the same cast MikroORM generated: existing values round
 * to the nearest whole cm³, which is lossless for the sheet figures this column holds.
 */
export class Migration20260924035458_sourcing extends Migration {

  override name = 'Migration20260924035458';

  override up(): void | Promise<void> {
    this.addSql(`alter table "purchasing_supplier_products" alter column "unit_volume" type numeric(16,0) using ("unit_volume"::numeric(16,0));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "purchasing_supplier_products" alter column "unit_volume" type numeric(16,6) using ("unit_volume"::numeric(16,6));`);
  }

}
