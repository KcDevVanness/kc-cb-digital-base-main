import { Migration } from '@mikro-orm/migrations';

/**
 * Retires the app-owned product tables.
 *
 * The catalog single-store cutover (`.ai/specs/2026-10-10-catalog-single-store.md`) moved product
 * identity, variants, prices and categories into the installed `catalog` module; these five tables
 * have no owning entity any more, which is also why `yarn db:generate` cannot see them — the
 * migration is hand-written and reviewed like the tables' original ones.
 *
 * `down()` is deliberately not a recreate: the cutover is a development-phase decision with no
 * data-migration path (the rollback story is "revert the branch and rebuild the development
 * database"), and silently restoring empty tables would leave a half-migrated schema behind. The
 * original DDL stays in this module's earlier migrations and in git history.
 */
export class Migration20261010090000_products extends Migration {
  override name = 'Migration20261010090000';

  override up(): void | Promise<void> {
    this.addSql(`drop table if exists "products_prices" cascade;`);
    this.addSql(`drop table if exists "products_variants" cascade;`);
    this.addSql(`drop table if exists "products_products" cascade;`);
    this.addSql(`drop table if exists "products_categories" cascade;`);
    this.addSql(`drop table if exists "products_types" cascade;`);
  }

  override down(): void {
    throw new Error(
      'Irreversible by design: the app-owned product tables were retired with the catalog ' +
        'single-store cutover (.ai/specs/2026-10-10-catalog-single-store.md). To undo the change, ' +
        'revert the branch and rebuild the development database.',
    );
  }
}
