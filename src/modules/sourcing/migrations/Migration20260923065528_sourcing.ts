import { Migration } from '@mikro-orm/migrations';

/**
 * Removes the whole-carton figures from the supplier product library (owner decision 2026-09-23:
 * 「采购只看单件数据」 — carton G.W / N.W and the outer carton size are not data a buyer maintains).
 *
 * It lives in `sourcing`, not in `purchasing` where the entity does, because of how the CLI applies
 * migrations: each module keeps its own history (`mikro_orm_migrations_<module>`) and the chains run
 * in **module-id order**, so `purchasing` is applied *before* `sourcing`. This table is created (as
 * `sourcing_supplier_products`) and renamed to `purchasing_supplier_products` inside `sourcing`'s
 * chain (`Migration20260922103027_sourcing`, `Migration20260923043000_sourcing`), which means a
 * migration filed under `purchasing` would run against a table that does not exist yet on a fresh
 * database — exactly how the first version of this migration failed the ephemeral suite with
 * `relation "purchasing_supplier_products" does not exist`. The same reasoning placed the pkey
 * renames next door in `Migration20260923044000_sourcing`.
 *
 * The entity, snapshot and every reader/writer live in `purchasing`; only the physical step is here.
 */
export class Migration20260923065528_sourcing extends Migration {

  override name = 'Migration20260923065528';

  override up(): void | Promise<void> {
    this.addSql(`alter table "purchasing_supplier_products" drop column "carton_gross_weight", drop column "carton_net_weight", drop column "outer_packing";`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "purchasing_supplier_products" add "carton_gross_weight" numeric(16,4) null, add "carton_net_weight" numeric(16,4) null, add "outer_packing" jsonb null;`);
  }

}
