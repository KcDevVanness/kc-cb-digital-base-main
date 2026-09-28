import { Migration } from '@mikro-orm/migrations';

/**
 * Adds the library row's **brand override** (`brand_value`) to `purchasing_supplier_products`.
 *
 * It lives in `sourcing`, not in `purchasing` where the entity does, for the reason recorded in
 * `Migration20260923065528_sourcing`: each module keeps its own history
 * (`mikro_orm_migrations_<module>`) and the chains run in **module order**, with `purchasing` applied
 * *before* `sourcing`. This table is created (as `sourcing_supplier_products`) and renamed to
 * `purchasing_supplier_products` inside `sourcing`'s chain, so a migration filed under `purchasing`
 * runs against a table that does not exist yet on a fresh database — the ephemeral suite fails with
 * `relation "purchasing_supplier_products" does not exist` and every later step dies with it.
 *
 * `if not exists` keeps the placement harmless for a database that already applied the generated
 * version while it sat in `purchasing`. The entity, the API projection and the form all live in
 * `purchasing`; only the physical step is here.
 */
export class Migration20260924041621_sourcing extends Migration {

  override name = 'Migration20260924041621';

  override up(): void | Promise<void> {
    this.addSql(`alter table "purchasing_supplier_products" add column if not exists "brand_value" text null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "purchasing_supplier_products" drop column if exists "brand_value";`);
  }

}
