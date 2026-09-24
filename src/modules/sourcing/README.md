# `sourcing` — supplier quotations and the workbook import

App-owned module. It owns **supplier quotations**: the document a supplier sends with prices for
a set of products, whether it arrives as a workbook or is typed by hand. It does **not** own
product master data — promoting a quotation line writes into `products` through that module's
commands.

Specs: [`.ai/specs/2026-09-22-supplier-quotation-import.md`](../../../.ai/specs/2026-09-22-supplier-quotation-import.md) (quotations and the workbook import), [`.ai/specs/2026-09-22-supplier-product-library.md`](../../../.ai/specs/2026-09-22-supplier-product-library.md) (the supplier product library, owned by `purchasing` since 2026-09-23).

## What lives here

| Piece | File | Contract |
|---|---|---|
| Workbook reading | `lib/workbook.ts` | The only place `xlsx` (SheetJS) is imported. Reads `.xls` (BIFF8), `.xlsx` and `.csv` into plain sheets, expands merged ranges, caps sheets/rows/columns, and fingerprints a layout. |
| Structure detection | `lib/headerDetection.ts` | Finds the header row, an optional unit row, section banners, the data rows and the footer; reports every rejected row with a reason. |
| Column mapping | `lib/columnMapping.ts` + `lib/fieldAliases.ts` | Alias dictionary (EN + 中文) with `exact`/`alias`/`fuzzy` confidence, one winner per target field, the standard template header set, and a currency hint. The downloadable template (`api/template/route.ts`) carries exactly the surviving column set — `SKU / 货号`, `品名 Product Name`, `分类 Section`, `规格 Description`, `HS编码 HS Code`, `单位 Unit`, `单价 Unit Cost`, `币种 Currency`, `MOQ 起订量`, `装箱数 Qty per Carton`, `单重 Unit N.W.(kg)`, `产品尺寸 Product Size(cm)` — and the `产品尺寸` header round-trips through the alias dictionary as well as through the exact template lookup. The alias tables carry both languages because a workbook may print either; the wizard renders **one** of them (`labelZh` / `labelEn` by the reader's locale), never `货号 / SKU` side by side. The `quote_section` seeds are display names only — the picker (`components/quoteSectionOptions.ts`) renders the stored banner in front (`FEEDING — 喂食`). |
| Value normalization | `lib/valueNormalization.ts` | `/` and friends → null, `10 pallets` → 10 + warning, `0.58*0.395*0.455` → centimetres, name → base + variant tokens. |
| SKU derivation | `lib/skuDerivation.ts` | Item No. for the first row of a group, `-<variant token>` for the rest (`P4108` / `P4108-UVC`), name slug when there is no Item No. |
| Line building | `lib/quoteLines.ts` + `lib/quoteAnalysis.ts` | Detection + mapping + normalization → quotation lines, with every source row kept in `raw`. |
| Promotion | `lib/promotion.ts` + `lib/productMapping.ts` | Selected lines → `products.items.create|update` + `products.prices.replace` + `products.categories.create`, then `purchasing.supplier-products.import-from-quote` for the library. The master-side mapping (non-empty/changed values, the whole price set) is shared from `products/lib/supplierMapping.ts`. |
| AI mapping (optional) | `lib/aiMapping.ts` | Header row + up to three sample rows → a proposed mapping. Off unless a model provider is configured. |

## The import keeps single-unit data only

**The whole-carton columns are gone** (owner decision 2026-09-23: purchasing only ever reads
per-unit data). 外箱尺寸, 箱毛重, 箱净重, 体积 and 箱数 — plus the per-side 箱长 / 箱宽 / 箱高 aliases
that only ever assembled the outer size — were deleted from the quotation line end to end: entity,
validators, create command, API request schema / `select` list / response projection, the review
grid's column, i18n and the downloadable template. What a line still carries is the Qty/Box
(`cartonQuantity`, 装箱数), the per-unit weight (`unitNetWeight`, 单重) and the item's own size
(`innerPacking`, 产品尺寸) — nothing else carton-shaped, and `lib/productMapping.ts` therefore offers
the product master only those three.

Nothing is lost for re-mapping: every raw cell of a data row is still kept in the line's `raw` under
its original header text (`lib/quoteLines.ts`), so an unmapped or mis-mapped column can be re-mapped
from the stored attachment without asking the supplier for the file again.

## The supplier product library lives in `purchasing`

`sourcing_supplier_products` was this module's table until 2026-09-23; the entity, commands, API and
pages now belong to **`purchasing`** (`purchasing_supplier_products` and
`purchasing_supplier_product_prices`, pages at `/backend/purchasing/supplier-products`). This module
still *feeds* it, and that is its only remaining involvement:

- **The review console's 「加入产品库」** calls `purchasing.supplier-products.import-from-quote` with the
  quotation and the selected lines; `purchasing` re-reads those lines through a scoped projection
  (`purchasing/lib/quoteLineReads.ts` — this module's entities are never imported there).
- **Promoting lines into the product master** calls the same command for each promoted line, so the
  library stays a by-product of the workflow the buyer already runs. The command reads the line's
  `promoted_product_id`, which is why only the line id travels. A library failure never rolls back a
  product write: the line stays promoted and the reason is reported on its own row.
- The quote line's old reverse pointer (`sourcing_quote_lines.supplier_product_id`) is gone
  (`Migration20260923043000_sourcing`): it pointed at a row another module owns, nothing read it, and
  the library row already records the quotation line it was fed from.

See [`purchasing/README.md`](../purchasing/README.md) for the library's own rules, and
`.ai/specs/2026-09-22-supplier-product-library.md` (D2, superseded) for the handover decision.

## Rules that are easy to get wrong

- **Money is a decimal string.** `unit_cost` and `suggested_rsp` are validated as fixed-scale decimal
  strings and passed through untouched; nothing here does float arithmetic on a price.
- **Promotion never blanks a product field.** Only non-empty, changed values reach
  `products.items.update`, and the price write submits the product's whole price set (the
  `products.prices.replace` contract deactivates rows missing from the payload), so `internal`
  and `export` tiers survive an import.
- **A promoted line is frozen.** Re-parsing or re-mapping a quotation that has promoted lines is
  refused with 409: those lines are the record of what was written to the product master.
- **A quotation's currency is picked.** Both quotation panels (`QuoteCreatePanel`'s manual header and
  `QuoteReviewPanel`'s header) render 币种 as a dropdown over `/api/currency_policy/currencies`
  (`components/currencyOptions.ts`) — the same dictionary `quotes.update` asserts membership in, so a
  hand-typed code can no longer be accepted by the form and rejected on save. A code already stored on
  the quotation is merged into the list, so an older record never renders with an empty trigger, and
  the FX master stays out of it: it drives exchange rates, not pickers.
- **Quotation sections are suggested, not enforced.** The `quote_section` dictionary (`setup.ts`, seeded with the
  workbook banners FEEDING / CLEANING / GROOMING / FUN / SPORT / ACCESSORY) feeds the section cell in the review grid
  and the manual line editor. Both stay typable: a supplier workbook brings its own banners, so the dictionary is a
  shortcut for the sections this business sees most, never a filter on what a parsed quotation may say.
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
`sourcing.promote.run` (which depends on `products.items.manage` + `products.prices.manage`, and on
`purchasing.supplier-products.manage` for the library leg — a sourcing-only role cannot grant itself
master-data writes). The library's own features are declared by `purchasing`.

These are seeded into `superadmin`/`admin` through `setup.ts`'s `defaultRoleFeatures`, which only
applies **when roles are created**. On a tenant that already exists, run
`yarn mercato auth sync-role-acls` and restart the app — the granted feature list is resolved per
process, and a superadmin session bypasses the check entirely, so verify the surface with a normal
role (see `.ai/lessons/module-features-need-role-acl-sync.md`).

## Seeds and verification

```bash
yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test src/modules/sourcing
# the quotation-section dictionary (insert-only, idempotent):
yarn mercato seed:defaults --module sourcing
# the library's integration coverage lives in purchasing/__integration__/supplier-products.spec.ts
yarn test:integration:ephemeral
```
