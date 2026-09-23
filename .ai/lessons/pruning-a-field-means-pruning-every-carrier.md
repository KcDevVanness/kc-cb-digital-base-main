---
title: "A pruned field is carried by a dozen files: grep the identifier, and leave the raw-source table alone"
modules: ["products", "purchasing", "sourcing"]
areas: ["module-data", "architecture"]
topics: ["field-removal", "generated-migrations", "migration-ordering", "shared-write-contract", "supplier-mapping", "doc-coupling"]
---

# A pruned field is carried by a dozen files: grep the identifier, and leave the raw-source table alone

**Context**: looking at `/backend/purchasing/supplier-products/create`, the owner ruled that a buyer
never maintains whole-carton data — 「一整箱的重量、长宽高」 — and that only the single unit's weight
and size matter. The fields to delete: `carton_gross_weight`, `carton_net_weight`, `carton_dimensions`
on `products_products`, and `carton_gross_weight`, `carton_net_weight`, `outer_packing` on
`purchasing_supplier_products`. `carton_quantity` (装箱数 / Qty/Box), `dimensions`, `net_weight`,
`unit_net_weight` and `inner_packing` all stay.

**Problem**: a persisted field has no single home. Before this removal, `cartonGrossWeight` alone was
read or written by:

- the entity (`data/entities.ts`), the validator (`data/validators.ts`), the command's create/update/
  response shape (`commands/items.ts`, `commands/supplierProducts.ts`), the API request schema, `select`
  list and serialization (`api/items/route.ts`, `api/supplier-products/route.ts`);
- the **shared write contract** `products/lib/supplierMapping.ts` (`ProductFieldValues` +
  `changedProductFields`), which is what forces *both* supplier→master mappers — `sourcing`'s
  `lib/productMapping.ts` and `purchasing`'s — to move in the same change;
- both master read projections (`*/lib/productsReads.ts`) that feed `changedProductFields`;
- the workbook-import projection `purchasing/lib/quoteLineReads.ts` and its `changedLibraryFields`;
- the form (`components/*Form.tsx`: values type, EMPTY defaults, read, payload builder, field defs,
  group membership) plus `products/lib/formLayout.ts`, whose whitelist/step map decides what renders;
- `i18n/{en,zh}.json` (label + help + a group title that promised carton weights), the module
  `README.md`, and three spec files (REQ text, UI mock, data-model table, acceptance criteria).

Deleting the entity property alone leaves a validator that rejects nothing but types a gone column, a
mapper writing a dropped key, an i18n key no component reads, and two spec tables documenting a column
that no longer exists — all of which typecheck or surface only later.

**Rule**: treat a field removal as a contract change, not a UI edit.

1. Grep the **identifier**, not the feature: camelCase, snake_case and the DB column name, across
   `src/`, `.ai/specs/` and `docs/`. Every hit is a decision point in the same change — the shared
   write contract first, then readers, then writers, then form/i18n, then docs. No shim, no
   "kept for compatibility" column in code.
2. The **DB column goes through `yarn db:generate`** — never a hand-written migration — and the
   generated SQL is reviewed and applied by the owner before it runs. Entities that no longer declare
   a column keep working against a DB that still has it, so code and schema can land in that order.
3. **A typed column with no reader goes, even on a raw-source table — the `raw` jsonb is what
   preserves the source.** Round one of this removal kept `sourcing_quote_lines`'s carton columns
   because the table transcribes the supplier's workbook. The owner's follow-up killed that
   reasoning: 「这些数据等于没用的数据…精简数据表」. `cartons`, `carton_gross_weight`,
   `carton_net_weight`, `outer_packing` and `carton_volume` were write-only — stored, projected
   through the API, read by nobody — while the entire source row already lives in the line's `raw`
   jsonb, so deleting them lost nothing. Ask "who reads this column?" before keeping it for
   provenance: a column nothing reads is not documentation, it is schema debt. (Columns that *do*
   have a reader — `carton_quantity` feeding Qty/Box, `unit_net_weight`, `inner_packing` — stay.)
4. **File the migration with the chain that owns the table's DDL, not the module that owns the
   entity.** The CLI keeps one history per module (`mikro_orm_migrations_<module>`) and applies the
   chains in **module-id order** (`node_modules/@open-mercato/cli/dist/lib/db/commands.js`,
   `sortModules` → `a.id.localeCompare(b.id)`). `purchasing_supplier_products` is created (as
   `sourcing_supplier_products`) and renamed inside `sourcing`'s chain, so a generated
   `Migration…_purchasing` that dropped its carton columns ran **before** the table existed and killed
   `yarn test:integration:ephemeral` on a fresh database with
   `relation "purchasing_supplier_products" does not exist` — while the dev database, where the rename
   was long applied, accepted the same SQL happily. The fix is to move the DDL into
   `src/modules/sourcing/migrations/Migration…_sourcing.ts` (timestamp after the rename), exactly as
   `Migration20260923044000_sourcing` did for the handed-over primary keys. A `yarn db:migrate` against
   the existing dev database proves nothing about ordering: run the ephemeral suite, which builds the
   schema from all chains in order.
5. Field removal is not a phase: the spec `**Status**` line stays, but the REQ text, UI mock,
   data-model table and acceptance criteria that name the field, the module `README.md`, and one
   spec Changelog row all move in the same change.

**Applies to**: any "this field is not needed" request — most recently
`products/lib/supplierMapping.ts`, `purchasing/lib/{supplierProductFormValues,supplierProductImport,quoteLineReads,productMapping}.ts`,
`sourcing/lib/{productMapping,promotion,productsReads}.ts`,
`src/modules/{products,purchasing}/components/*Form.tsx`, and their `i18n/*.json`.
