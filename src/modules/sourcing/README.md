# `sourcing` — supplier quotations and the workbook import

App-owned module. It owns **supplier quotations**: the document a supplier sends with prices for
a set of products, whether it arrives as a workbook or is typed by hand. It does **not** own
product master data — promoting a quotation line writes into `products` through that module's
commands.

Specs: [`.ai/specs/2026-09-22-supplier-quotation-import.md`](../../../.ai/specs/2026-09-22-supplier-quotation-import.md) (quotations and the workbook import), [`.ai/specs/2026-09-22-supplier-product-library.md`](../../../.ai/specs/2026-09-22-supplier-product-library.md) (the supplier product library).

## What lives here

| Piece | File | Contract |
|---|---|---|
| Workbook reading | `lib/workbook.ts` | The only place `xlsx` (SheetJS) is imported. Reads `.xls` (BIFF8), `.xlsx` and `.csv` into plain sheets, expands merged ranges, caps sheets/rows/columns, and fingerprints a layout. |
| Structure detection | `lib/headerDetection.ts` | Finds the header row, an optional unit row, section banners, the data rows and the footer; reports every rejected row with a reason. |
| Column mapping | `lib/columnMapping.ts` + `lib/fieldAliases.ts` | Alias dictionary (EN + 中文) with `exact`/`alias`/`fuzzy` confidence, one winner per target field, the standard template header set, and a currency hint. |
| Value normalization | `lib/valueNormalization.ts` | `/` and friends → null, `10 pallets` → 10 + warning, `0.58*0.395*0.455` → centimetres, name → base + variant tokens. |
| SKU derivation | `lib/skuDerivation.ts` | Item No. for the first row of a group, `-<variant token>` for the rest (`P4108` / `P4108-UVC`), name slug when there is no Item No. |
| Line building | `lib/quoteLines.ts` + `lib/quoteAnalysis.ts` | Detection + mapping + normalization → quotation lines, with every source row kept in `raw`. |
| Promotion | `lib/promotion.ts` + `lib/productMapping.ts` | Selected lines → `products.items.create|update` + `products.prices.replace` + `products.categories.create`. |
| AI mapping (optional) | `lib/aiMapping.ts` | Header row + up to three sample rows → a proposed mapping. Off unless a model provider is configured. |

## Supplier product library

`sourcing_supplier_products` is the **supplier-side goods list**: what each supplier sells us —
supplier code (`supplier_sku`), original item no., name, spec, unit, HS code, MOQ, carton quantity,
weights and inner/outer packing. It is the list a buyer orders from, as opposed to
`products_products` (the internal master that stock, internal sales and contracts need).

- **No prices, by design.** Prices stay on `sourcing_quote_lines` and on purchase order lines
  (purchasing Q-P-004), so a library row can never go stale about money.
- **Two ways in, one row.** An operator can type a row, or push quotation lines in through
  `sourcing.supplier-products.import-from-quote` (`derived_sku ?? item_no` becomes the supplier
  code). Promoting quotation lines into the product master also upserts the library row and backfills
  `product_id`, so the two paths converge instead of maintaining two lists.
- **Sync is explicit.** `sourcing.supplier-products.promote` creates or updates the master product by
  SKU (`products.items.create|update`), merges the `purchase`-tier price row from the most recent
  quotation line that quoted the code (whole price set submitted, so `internal`/`export` survive),
  and backfills `product_id`. It is idempotent — a synced row answers `action: 'skipped'` — and it
  refuses a SKU owned by a soft-deleted product. A library row can be ordered from before it is
  synced, but shipment/receipt needs the master link (variant-level stock receipt).
- **Deletion is soft, the code stays owned.** `supplier_sku` is unique per `(tenant, organization,
  supplier)` **including soft-deleted rows** (same rule as `products_variants`), so duplicate checks
  query soft-deleted rows too: a clash is a readable 409, never a unique-index 500. Deleting a row
  that orders already reference is allowed — those lines froze their own snapshot.

| Piece | Detail |
|---|---|
| Table | `sourcing_supplier_products` (`SourcingSupplierProduct`) |
| API | `GET|POST|PUT|DELETE /api/sourcing/supplier-products`, `POST …/import`, `POST …/promote` |
| Commands | `sourcing.supplier-products.{create,update,delete,import-from-quote,promote}` |
| Pages | `/backend/sourcing/supplier-products` (+ `/create`, `/[id]/edit`) — rendered in the **Purchasing** menu group (`pageGroupKey: 'purchasing.nav.group'`) even though the module owns them |
| Events | `sourcing.supplier_product.{created,updated,deleted}` |
| Reads from `purchasing` | `loadSupplierName` (`lib/purchasingReads.ts`) and the supplier picker `GET /api/purchasing/suppliers` — scalar id + name snapshot, never an ORM relation |
| Reads from `products` | `lib/productsReads.ts` (`findProductBySku`, `loadProductPrices`, `loadProductLabels`); every write goes through `products.*` commands |

## Rules that are easy to get wrong

- **Money is a decimal string.** `unit_cost`, `suggested_rsp` and every weight/volume column are
  validated as fixed-scale decimal strings and passed through untouched; nothing here does float
  arithmetic on a price.
- **Promotion never blanks a product field.** Only non-empty, changed values reach
  `products.items.update`, and the price write submits the product's whole price set (the
  `products.prices.replace` contract deactivates rows missing from the payload), so `internal`
  and `export` tiers survive an import.
- **A promoted line is frozen.** Re-parsing or re-mapping a quotation that has promoted lines is
  refused with 409: those lines are the record of what was written to the product master.
- **A library code is owned forever.** The unique key on `(tenant, organization, supplier,
  supplier_sku)` has no `deleted_at` predicate, so an import that hits a soft-deleted row fails with
  a message naming it instead of reusing the code — and the duplicate check must query soft-deleted
  rows, or the index turns a 409 into a 500.
- **An import never blanks a field.** Only non-empty, changed values are written, so a supplier sheet
  with a half-filled column cannot erase what the buyer typed; re-importing the same lines reports
  `skipped`.
- **The workbook is the source.** `parse` and `remap` both re-read the stored attachment through
  `attachmentService.readScoped` with an owner check, so a re-map is deterministic and one
  quotation can never read another's file.
- **Scope comes from the session.** Every command derives `tenantId`/`organizationId` through
  `ensureScope` and fails closed; no command accepts scope from its payload.

## AI mapping — data boundary

The AI assist is the only path that sends anything outside the deployment. What that means in
practice:

- It is **off** until a model provider is configured (`OM_AI_PROVIDER` + the matching credential,
  e.g. `OPENAI_API_KEY`). With no provider, `GET /api/sourcing/ai-status` reports
  `{ available: false }`, the wizard renders the button disabled with the environment variable to
  set, and `POST /api/sourcing/quotes/ai-mapping` answers `503 ai_not_configured`. There is no
  fallback to a hard-coded provider.
- The request carries the **header row** and, unless the operator switches it off, the **first
  three data rows** of the sheet they are looking at — never the whole workbook, never other
  quotations, never the original file. The wizard shows that exact JSON in a "What will be sent"
  block before the button is usable, and reports how many header cells and sample rows went out.
- The route is **read-only**: the suggestion comes back to the browser and becomes data only when
  the operator clicks "Apply mapping", which goes through the ordinary `remap` command.
- Supplier cost data is commercially sensitive, so the assist is opt-in per import rather than a
  background enrichment; a deployment that never sets a provider never sends anything.

## ACL

`sourcing.quotes.view`, `sourcing.quotes.manage`, `sourcing.import.run`, and
`sourcing.promote.run` (which depends on `products.items.manage` + `products.prices.manage`), plus
the library's own `sourcing.supplier-products.view`, `sourcing.supplier-products.manage`, and
`sourcing.supplier-products.promote` (also depending on `products.items.manage` +
`products.prices.manage`, so a sourcing-only role cannot grant itself master-data writes).

These are seeded into `superadmin`/`admin` through `setup.ts`'s `defaultRoleFeatures`, which only
applies **when roles are created**. On a tenant that already exists, run
`yarn mercato auth sync-role-acls` and restart the app — the granted feature list is resolved per
process, and a superadmin session bypasses the check entirely, so verify the surface with a normal
role (see `.ai/lessons/module-features-need-role-acl-sync.md`).
