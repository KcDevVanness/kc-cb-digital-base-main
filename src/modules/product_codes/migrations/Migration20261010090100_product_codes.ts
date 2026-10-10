import { Migration } from '@mikro-orm/migrations';

/**
 * Retires the code-issuance tables.
 *
 * The cutover (`.ai/specs/2026-10-10-catalog-single-store.md`) deactivated the code generator: SKUs
 * are typed by hand and only `product_codes_aliases` survives (a retired code must still be
 * searchable). The rules table and the append-only ledger have no owning entity any more, so this
 * migration is hand-written — `yarn db:generate` sees no entity change to diff.
 *
 * `down()` throws for the same reason as the products migration: no data-migration path in this
 * development-phase change; roll back by reverting the branch and rebuilding the database.
 */
export class Migration20261010090100_product_codes extends Migration {
  override name = 'Migration20261010090100';

  override up(): void | Promise<void> {
    this.addSql(`drop table if exists "product_codes_ledger_entries" cascade;`);
    this.addSql(`drop table if exists "product_codes_rules" cascade;`);
  }

  override down(): void {
    throw new Error(
      'Irreversible by design: the code-issuance tables were retired with the catalog single-store ' +
        'cutover (.ai/specs/2026-10-10-catalog-single-store.md). To undo the change, revert the branch ' +
        'and rebuild the development database.',
    );
  }
}
