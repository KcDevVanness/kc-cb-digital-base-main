import { Migration } from '@mikro-orm/migrations';

/**
 * Adds the supplier library's single-unit gross weight and volume (`unit_gross_weight`,
 * `unit_volume`) to `purchasing_supplier_products`.
 *
 * It lives in `sourcing`, not in `purchasing` where the entity does, for the reason recorded next
 * door in `Migration20260923065528_sourcing`: each module keeps its own history
 * (`mikro_orm_migrations_<module>`) and the chains run in **module order**, with `purchasing`
 * applied *before* `sourcing`. This table is created (as `sourcing_supplier_products`) and renamed
 * to `purchasing_supplier_products` inside `sourcing`'s chain
 * (`Migration20260922103027_sourcing`, `Migration20260923043000_sourcing`), so a migration filed
 * under `purchasing` runs against a table that does not exist yet on a fresh database — which is
 * exactly how the first version of this migration failed the ephemeral suite with
 * `relation "purchasing_supplier_products" does not exist`.
 *
 * `if not exists` keeps the move harmless for a database that already applied the file while it sat
 * in `purchasing`: the statements become a no-op there instead of failing on the existing columns.
 * The entity, snapshot and every reader/writer live in `purchasing`; only the physical step is here.
 */
export class Migration20260924024748_sourcing extends Migration {

  override name = 'Migration20260924024748';

  override up(): void | Promise<void> {
    this.addSql(`alter table "purchasing_supplier_products" add column if not exists "unit_gross_weight" numeric(16,4) null, add column if not exists "unit_volume" numeric(16,6) null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "purchasing_supplier_products" drop column if exists "unit_gross_weight", drop column if exists "unit_volume";`);
  }

}
