# Catalog Eject Spike — Evidence Record

**Date**: 2026-09-21
**Question**: is `yarn mercato eject catalog` viable while `sales`, `wms`, `customers`, `currencies`, `dictionaries`, `feature_toggles` are enabled — and what does the app actually inherit?
**Verdict**: mechanically and functionally viable. Two real costs, one measured non-risk.

## Method

Isolated worktree (never the working tree), HEAD `16214fd`, branch `spike/eject-catalog`:

```bash
git worktree add -b spike/eject-catalog <path> HEAD
cp .env <path>/.env                                   # gitignored, needed for DATABASE_URL
cp -R src/modules/{currency_policy,scope_guards} <path>/src/modules/   # app-owned, untracked
cp src/modules.ts <path>/src/modules.ts               # enables the 7 business modules
yarn install                                          # 16s (warm cache)
yarn mercato eject catalog                            # ok
yarn generate                                         # ok, 212 API paths
yarn tsx spike-orm-probe*.ts                          # probes, removed afterwards
yarn typecheck                                        # clean apart from one pre-existing error
```

The worktree had no `src/modules/catalog/` directory (the `zh` overlay is untracked in the working tree), which is required: `ejectModule` throws `Destination directory already exists: src/modules/catalog` when it does.

## Evidence

1. **Eject is a copy + two rewrites.** `src/modules/catalog/` = 159 files / 2.2 MB; `src/modules.ts` entry flipped to `from: '@app'` with its `overrides` block intact. Implementation (`node_modules/@open-mercato/cli/dist/lib/eject.js`): copy (skips `__tests__`/`__mocks__`), rewrite relative cross-module imports to `<package>/modules/...`, flip the registry. **Dependents are not touched.**

2. **The app copy becomes the registered entity source.** `.mercato/generated/entities.generated.ts:11` now reads
   `import * as E_catalog_9 from "../../src/modules/catalog/data/entities";`
   and the ORM receives exactly that array (`MikroORM.init({ entities })`, `@open-mercato/shared/dist/lib/db/mikro.js`). 119 entities registered.

3. **The predicted duplicate-metadata hazard did NOT materialise.** Installed `sales` still imports the package copy (`@open-mercato/core/modules/catalog/data/entities` in `api/channels/route`, `api/price-kinds/route`, `seed/examples`). Probe results:

   | Probe | Result |
   |---|---|
   | app-copy `CatalogProduct` registered | `true`, entityName `catalog.CatalogProduct` |
   | package-copy class is the registered class | `false` (two class objects exist) |
   | `metadata.get(appClass) === metadata.get(pkgClass)` | **`true`** — one metadata entry, no duplicate |
   | resolved metadata's `.class` | **the app copy's class** (`pkgMeta.class === pkgClass` → `false`) |
   | table mapping | both → `catalog_products`; `catalog_product_offers` for `CatalogOffer` |
   | queries through the package class | `count`/`findAll` succeed against the same table |

   MikroORM resolves both classes onto one metadata by entity name, so package-path imports keep working and instantiate app-copy entities. Caveat: that resolution depends on the class/export names staying identical — renaming an entity class in the copy is a contract change, not a refactor.

4. **Routes and pages are live copies.** `.mercato/generated/backend-route-shard.003.catalog.generated.ts` and `api-route-shard.003.catalog.generated.ts` import all 9 backend pages and 12 API routes from `../../src/modules/catalog/**`.

5. **Self-referencing package imports remain — 33 occurrences in 6 files** (the copy imports its own components through the package path, which eject does not rewrite):

   | File | Count |
   |---|---|
   | `src/modules/catalog/backend/catalog/products/[id]/page.tsx` | 11 |
   | `src/modules/catalog/backend/catalog/products/create/page.tsx` | 9 |
   | `src/modules/catalog/backend/catalog/products/[productId]/variants/create/page.tsx` | 5 |
   | `src/modules/catalog/backend/catalog/products/[productId]/variants/[variantId]/page.tsx` | 5 |
   | `src/modules/catalog/components/products/ProductsDataTable.tsx` | 1 |
   | `src/modules/catalog/components/categories/CategoriesDataTable.tsx` | 1 |

   Consequence: editing `src/modules/catalog/components/products/{productForm,variantForm,VariantBuilder,ProductMediaManager}.tsx` has **no effect** on those pages until the specifiers are repointed at the local files. This is the highest-value trap for a UI-layout customization.

6. **Generate/typecheck deltas are nil.** The `[OpenAPI] Bundling failed … static fallback` warning is pre-existing (`components.schemas` is 0 in the main tree too). `yarn typecheck` reports only `src/modules/scope_guards/__integration__/scope-guards.spec.ts(214,23)` — pre-existing in the working tree, unrelated to eject.

## Costs the app inherits on eject

- Upgrade ownership of 12 entities, 24 commands, 18 events, 9 pages, 7 ACL features, 8 search entities, 2 AI agents, 29 AI tools, 1 worker, 1 subscriber, 26 migrations + snapshot. Every `@open-mercato/core` bump becomes a manual diff/merge; the package's catalog copy remains installed and must keep being ignored by the registry.
- The 33 self-references above must be repointed before UI edits take effect.

## Not covered by this spike

- Runtime endpoint verification (`/api/sales/channels`, `/api/sales/price-kinds`, product pages) with a live dev server and a session.
- Behaviour of `yarn db:generate` after eject (no schema change expected: identical identifiers and tables).
- Any customization: this spike proved *feasibility of owning the copy*, not that owning it is necessary.
