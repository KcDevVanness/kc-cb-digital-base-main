---
title: "A migration that alters a renamed table must live where it runs after the rename"
modules: ["purchasing", "sourcing", "platform"]
areas: ["architecture", "framework-context", "module-data"]
topics: ["migrations", "migration-ordering", "fresh-database", "module-order", "table-rename", "integration-environment"]
---

# A migration that alters a renamed table must live where it runs after the rename

**Context**: `purchasing_supplier_products` is not created by `purchasing`. It was renamed into that
namespace by a **`sourcing`** migration (`src/modules/sourcing/migrations/Migration20260923043000_sourcing.ts:28`,
`alter table "sourcing_supplier_products" rename to "purchasing_supplier_products"`) during the 2026-09-23
ownership handover. A later, uncommitted `purchasing` migration
(`Migration20260924024748_purchasing.ts`, `alter table "purchasing_supplier_products" add "unit_gross_weight" …`)
made the ephemeral integration environment impossible to start:

```
[integration] Initializing application data (includes migrations)...
💥 Failed: Command failed: yarn run initialize (exit 1)
❌ Initialization failed: relation "purchasing_supplier_products" does not exist
```

The failure reproduced with an untouched spec, so it was not caused by the change under test.

**Problem**: `dbMigrate` walks **modules** in their registered order and hands each module's directory to its
own MikroORM migrator with its own `mikro_orm_migrations_<module>` table
(`node_modules/@open-mercato/cli/src/lib/db/commands.ts:343-382`: `sortModules(loadEnabledModules())` then one
`Migrations` instance per module). `purchasing` is registered before `sourcing` (`src/modules.ts`), so on a
**fresh** database every `purchasing` migration runs *before* the rename that creates the table — the batch
fails and rolls back, and every later step that touches the table dies with "relation … does not exist".
An incrementally migrated database (dev, staging) never shows it, because there each migration ran when it was
written, in historical order. Alphabetical ordering does not save it either (`purchasing` < `sourcing`), and
neither does the filename timestamp: ordering is per module, not global.

**Rule**: Before adding a migration, check **which module creates the table** it touches, not which module owns
the entity today. If the table was renamed across a module boundary (grep the migrations for
`rename to "<table>"`), place the migration in a module that is registered **after** the renaming module — or
make the statement defensive — and prove it on a fresh database (`yarn mercato test:integration <spec>`, which
builds an empty database) rather than on the already-migrated dev database.

**Applies to**: any migration on `purchasing_supplier_products`, `purchasing_supplier_product_prices` and the
other tables moved from `sourcing` to `purchasing` on 2026-09-23; `src/modules/*/migrations/**`;
`src/modules.ts` registration order; the ephemeral integration environment and CI, which always start from an
empty database.

**Resolution (2026-09-24)**: the same change moved the file to
`src/modules/sourcing/migrations/Migration20260924024748_sourcing.ts` (class `Migration20260924024748_sourcing`,
same `name`), exactly as `Migration20260923065528_sourcing` does for the 2026-09-23 column drop. Two follow-ups
that come with the move: the **snapshot stays with the entity** — `purchasing/migrations/.snapshot-open-mercato.json`
keeps the new columns so `yarn db:generate` reports no changes for either module (verified: rerun is a no-op) —
and an **already-migrated database must have its ledger re-filed**, because the per-module table records the full
name: the row moved from `mikro_orm_migrations_purchasing` to `mikro_orm_migrations_sourcing` (same
`executed_at`), after which `yarn db:migrate` reports no pending migrations for either chain. Proof of the fresh
path is the ephemeral run reaching "Initializing application data (includes migrations)" and building the app.
