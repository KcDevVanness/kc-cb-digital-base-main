# Products Master Data + Purchase/Sales Contracts with Dual-Caliber Amounts

**Date**: 2026-09-22
**Status**: Implemented (Phases 0–6) — verified 2026-09-22 and 2026-09-23

> **As-shipped deltas (2026-09-23).** Every phase including the owner-deferred Phase 4 (contract Excel) is in
> the tree; the Status line was stale. Where the body differs from the shipped code, the code and
> `src/modules/<id>/README.md` win:
> - **API prefix is the module directory name:** `/api/trade_docs/...` and `/api/products/...` (snake_case),
>   not `/api/trade-docs/...`. See [`.ai/lessons/module-api-path-is-directory-name.md`](../lessons/module-api-path-is-directory-name.md)
>   and `.mercato/generated/api-route-metadata.generated.ts`.
> - **Commands shipped as families, not per-action ids:** `trade_docs.contracts.{create,update,delete,transition,attach,generate-document}`
>   and `trade_docs.invoices.{create,update,delete,transition,attach}` — `issue|sign|close|cancel` and
>   `confirm|void` are `transition` actions.
> - **Extra surface not in the body:** `POST /api/trade_docs/contracts/attach` + the stamped-scan
>   `trade_docs_contracts.attachment_id` column (added by
>   [`.ai/specs/2026-09-22-order-file-and-export-finance.md`](2026-09-22-order-file-and-export-finance.md) Phase 3;
>   distinct from the generated XLSX pointer).
> - **Page hiding** uses `routes.pages` + `metadata.navHidden` for the 8 catalog pages (REQ-016), never `null`.
> - **Brand is no longer defaulted (2026-09-23).** The company also designs and commission-produces
>   products, so `brand`'s column/validator/form defaults went from `'Petkit'` to empty, the model field
>   is labelled 型号 rather than 品牌方型号, and the `purchase` price tier's label is 成本价（采购 / 自产）
>   (the code stays `purchase`; contracts store the code). One catalogue holds purchased and self-made
>   goods; the shipment/receipt rules below are unchanged — a purchase order plus the catalog link is what
>   makes a line shippable, self-made or not. See `src/modules/products/README.md` § 货源.
> - Product variants live in this same round: [`.ai/specs/2026-09-22-product-variants.md`](2026-09-22-product-variants.md).

> Second app-owned business slice after `purchasing`. Owner-confirmed inputs (2026-09-22): the company is a trading principal that **buys from Petkit/agents** and **sells to its Russian subsidiary**, which sells to Russian enterprises — so a purchase contract and a sales contract exist for the same goods, and one product carries **three price tiers**. The installed `catalog` will accumulate customization, so the owner chose to **own product master data** in an app module and reuse only the platform's underlying capabilities (auth, scope, CRUD factory, commands, attachments, currencies, events). Contract Excel generation is explicitly **deferred by the owner** to a later slice; this spec delivers it last, behind an explicit exit gate.
>
> Standing rule from the owner: **the contract Excel template may change** — its columns live in one constant (`lib/contractTemplate.ts`) and the spec records that as the only non-blocking open item.

## TLDR

Build two app-owned modules. **`products`** owns the product master the business actually sells: product types, a category tree, products with export/packaging/lithium fields, and three fixed price tiers (`purchase` / `internal` / `export` — the price the company pays, the price the subsidiary is charged, and the price the subsidiary charges its customers). **`trade_docs`** owns purchase/sales **contracts** and inbound/outbound **invoices** referencing those products by id + snapshot, and computes every contract line and total in **two calibers**: the *financial amount* (exact, currency-decimal-rounded, invoice-authoritative once an invoice line is confirmed) and the *contract amount* (2-digit half-up, for the printed contract). The difference is stored on the contract head, invoices archive their scanned file as an attachment, and — last — the contract can be rendered to Excel.

## Problem Statement

The current system cannot express the company's commercial chain. Concretely:

1. **No owned product master.** The installed `catalog` is the platform's product registry with its own page set and customization surface; the owner's stated position is that official components will need heavy customization and that business UI/flows must be owned by the app. Product data used by contracts (品牌方型号, 规格串, HS/CN/原产国, 单件净重/毛重与尺寸, 装箱数, 锂电能量, 认证) is exactly what contract generation and export declarations need, and it must be maintained in an app-owned surface.
2. **No three-tier pricing.** Today nothing stores "purchase price / internal settlement price / export price" for the same SKU, per currency, with a minimum-quantity ladder — the three prices the business negotiates in the same meeting.
3. **No contract document at all.** Purchasing has orders and payments, sales has quotes/orders, but the **购销合同** (the signed paper that carries 唛头, 付款方式, 运输方式, 目的地, 交期, 大写金额) exists nowhere; it is produced by hand in Excel today.
4. **No second amount caliber.** Finance needs a number that ties to the invoice to the cent; the contract needs a number that reads as a round 2-decimal figure. With one number, either the contract disagrees with the invoice or finance carries fractional cents. Both must exist side by side, with the difference visible.
5. **Invoice scans have no home.** Supplier/issued invoice files arrive as PDFs/photos and are currently filed outside the system; the owner asked for **archive + download only** in this slice (no parsing, no AI).

Evidence: the repository's own inventory — `src/modules/purchasing/**` implements suppliers/orders/payments but no product master and no contract; `docs/dev/business-architecture.md` records "商品主数据 → 复用 `catalog`" as a decision taken **before** the owner's customization requirement, and the catalog eject spike (`.ai/analysis/2026-09-21-catalog-eject-spike.md`) showed ejecting the official module is a 12-entity/9-page/24-command liability.

## Overview and Success Measures

- **Primary outcome:** an operator maintains Petkit products (type, category, packaging, three prices) and produces one purchase contract **and** one sales contract for the same shipment, each printing a 2-decimal contract total while the system shows an invoice-tied financial total and the difference between them.
- **Leading indicators:** every contract line carries a product snapshot; `finance_total` equals the confirmed invoice total for invoiced lines; `difference_total` is zero on contracts whose lines were never touched by an invoice; each product exposes three tiers without a price-list module.
- **Baseline:** zero owned product rows; contract totals live in hand-maintained Excel; no invoice archive.
- **Market / product reference:** mid-market ERP contract/order documents (SAP SD/MM contract document, Odoo `sale.order` printed quotation, NetSuite transaction form) print header terms + line grid + totals. Adopted: header terms, line grid with product snapshot, per-line amount, header total, document version. Rejected: multi-currency auto-conversion, tax engines, credit limits, and multi-template document designers — none is required by this slice.

## Goals

- **REQ-001** — `products` is a new app-owned module (`src/modules/<id>/`, `{ id: 'products', from: '@app' }`) with its own entities, commands, routes, pages, ACL, i18n and migrations; no installed file, generated file, or shipped migration is edited.
- **REQ-002** — Product types are organization-scoped, unique by code, seeded with the Petkit starting set, deactivatable, and deletable only when unreferenced.
- **REQ-003** — Categories form a per-organization tree with stored hierarchy columns (`parent_id`, `root_id`, `tree_path`, `ancestor_ids`, `child_ids`, `descendant_ids`) rebuilt by command on create/update; a cycle is rejected with 422 and no data change.
- **REQ-004** — A product carries SKU (unique per organization), names, brand/series/manufacturer model, type, one primary category, spec summary, barcode, unit, export fields (HS/CN/origin), weights and dimensions **per unit** plus the units-per-carton figure, lithium battery fields, certification list, status, notes, and an **optional** link to an official catalog product (`catalog_product_id` + `catalog_snapshot`) so the official chain stays compatible.
- **REQ-005** — Prices are rows with a fixed tier code (`purchase` | `internal` | `export`), a currency, a minimum quantity, a 6-decimal unit price, an optional validity window, and an active flag; the product's full price set is submitted in one `replace` command that upserts and deactivates missing rows instead of deleting them.
- **REQ-006** — `trade_docs` is a second new app-owned module owning contracts and invoices; contracts carry `direction` (`purchase` | `sales`), a lifecycle (`draft → issued → signed → closed`, `cancelled` from `draft`/`issued` with a mandatory reason), a counterparty by id + snapshot, our party snapshot, a price tier, a currency, an optional exchange-rate snapshot, source reference (order id + snapshot) and the signed/delivery dates plus the printed header terms (付款方式/运输方式/目的地/唛头/备注).
- **REQ-007** — Contract lines reference a `products` product by scalar id + snapshot (sku/name/model/spec/unit/HS code/origin) and carry quantity, unit price, and the two derived amounts; an issued contract's number is `PC-<year>-<4 digits>` / `SC-<year>-<4 digits>`, unique per organization.
- **REQ-008** — Invoices carry `direction` (`inbound` | `outbound`), an external number (indexed, not unique), a lifecycle (`draft → confirmed`, `void`), an optional contract, counterparty snapshot, source reference, currency, subtotal/total, issue date, and an archived attachment; invoice lines may bind to a contract line.
- **REQ-009** — **Amount caliber (single authoritative definition):**
  - *financial amount* = `HALF_UP(quantity × unit_price, currency decimal places)` per line, with the currency scale read from `Currency.decimalPlaces` (missing/invalid → 2, clamped to 0..8); the line's financial amount is **the bound confirmed invoice line's amount when one exists**, otherwise the computed value; the contract's `finance_total` is the sum of line financial amounts (never a re-quantization of a sum).
  - *contract amount* = `HALF_UP(quantity × unit_price, 2)` per line; `contract_total` is the sum.
  - *difference* = `contract_total − finance_total`, stored on the head.
  - All three are computed with BigInt scaled integers (`parseExactDecimal` + app-side `multiply` / `quantize`), **never `toFixed`**: `(1.005).toFixed(2)` is `"1.00"` and would understate a contract.
- **REQ-010** — Every route uses `makeCrudRoute` (or a guarded command route) with per-method `metadata` (`requireAuth` + `requireFeatures`) and exported `openApi`; every page ships `page.meta.ts` with `requireAuth` + `requireFeatures`; mutations go through commands with zod validators, scope derived from the session (fail closed), optimistic locking on user-editable records (409 on stale version).
- **REQ-011** — Every surface ships zh + en strings, loading/empty/error/conflict/permission-denied states, semantic design tokens, keyboard submission (`Cmd/Ctrl+Enter`) and no horizontal overflow at narrow width.
- **REQ-012** — Invoice attachments are archived and downloadable in this slice (upload via `/api/attachments`, bind via a command); **no parsing, no OCR, no LLM extraction**.
- **REQ-013** — The last phase renders a contract to XLSX using the platform's zero-dependency writer (`buildXlsx`) and stores it as an attachment on the contract; amounts are written as numbers so Excel can sum them; the sheet layout comes from one template constant.

## Non-goals

- Product **batch import** from supplier workbooks — now specified in [`.ai/specs/2026-09-22-supplier-quotation-import.md`](2026-09-22-supplier-quotation-import.md) (app-owned `sourcing` module: quotation intermediate layer, SheetJS reader, mapping profiles, promotion through this module's commands). This spec does not implement it.
- Disabling, replacing, or ejecting the official `catalog`, and switching `purchasing`'s product picker to `products` — both are follow-up decisions; this slice only adds the optional `catalog_product_id` link.
- Invoice content parsing, OCR, or AI extraction (owner chose archive-only).
- Tax computation on contracts/invoices: lines carry `quantity × unit_price`; tax stays in `purchasing`/`sales` where the tax split already exists.
- Automatic FX conversion: an exchange rate is stored as a snapshot only.
- A general ledger, AP/AR ageing, or settlement — outside this slice.
- Multi-category assignment per product (one primary `category_id` today; an assignment table is additive later).
- Custom/multi-template contract rendering (merged cells, borders, column widths) — requires a spreadsheet dependency and therefore an approval step.

## Proposed Solution

Two modules, one shared money engine, and a derived-head design.

```text
products
  products_types ──1:n──> products_products ──1:n──> products_prices (tier: purchase | internal | export)
                              ^   │
              products_categories (tree, one primary category)   │ scalar id + jsonb snapshot
                                                                 │
trade_docs                                                       │
  trade_docs_contracts ──1:n──> trade_docs_contract_lines ───────┘
        │  contract_total / finance_total / difference_total (recomputed by command)
        │
        └──1:n──> trade_docs_invoices ──1:n──> trade_docs_invoice_lines
                        └── attachment_id (archived scan, download only)

amount flow per line:  quantity × unit_price
                       ├─ quantize(currencyScale)  → finance_amount   (or bound confirmed invoice line amount)
                       └─ quantize(2)              → contract_amount
                       head: Σ finance_amount → finance_total ; Σ contract_amount → contract_total
                             contract_total − finance_total → difference_total
```

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| Own the product master in an app module (`products`) | The owner will customize product UI/flows heavily; owning the module keeps the change surface inside `src/modules/products/**` while still using platform primitives | Reuse `catalog` as the business product master | Official page set + entity would need app-level overrides in official components; the owner explicitly re-scoped this after the catalog eject spike |
| Keep an optional `catalog_product_id` link | The official chain (`sales`, `purchasing`) references `catalog_products`; the link keeps future reconciliation possible without coupling lifecycles | Cross-module ORM relation to `CatalogProduct` | Prohibited by the platform rule; couples two module lifecycles |
| Price tiers as three fixed codes in `lib/tiers.ts` | The business has exactly three prices; a code list is legible in the DB and in contracts, and needs no official price-kind table | Official price kind table | Pulls an installed module's data model into an app decision; codes are simpler to keep stable across upgrades |
| Product references as id + jsonb snapshot | History survives renames; the platform's durable-reference pattern (`purchasing` does exactly this) | Foreign keys / joins across modules | Same as above |
| Two amount calibers computed from one BigInt engine | Finance ties to the invoice; the contract prints round numbers; the difference is a first-class stored value reviewed by an operator | One number, rounded at the end | Hides the discrepancy the business explicitly wants to see |
| Quantization in BigInt (`multiply` + `quantize`), never `toFixed` | Binary floating point cannot represent 1.005; `toFixed` would silently understate a legal document | `Number.toFixed` / `Math.round(x*100)/100` | The owner's requirement is "财务金额必须准确、对得上"; float rounding fails that on a documented test case |
| Invoice lines bind to contract lines (optional) | Finance needs to say "this contract line was invoiced at a different price", not to rewrite the contract | Auto-overwrite contract unit price from the invoice | Destroys the negotiated (contract) number the customer signed |
| Invoices confirm explicitly | The financial caliber flips to "invoice wins" only for **confirmed** invoices; a draft invoice must not move money | Treat any invoice line as authoritative | A draft or voided invoice would silently distort `finance_total` |
| Contract numbering at `issue` | Mirrors `purchasing` (`number` null while draft, assigned on leaving draft) and keeps drafts out of the sequence | Number at create | Gaps and abandoned numbers in a legal document series |
| Attachment archive only | Owner's explicit choice for this slice; `extractAttachmentContent` returns null for XLSX and the AI channel is unconfigured | Wire extraction now | Dead path with no requirement behind it |
| Excel via the platform's `buildXlsx` | Zero new dependencies; the repo has no spreadsheet library and `npmMinimalAgeGate` + the integrations guide make adding one an approval step | `exceljs` / `sheetjs` | New dependency for one document; deferred until the copy of the company template genuinely needs merged cells |
| Hierarchy columns on category rows, rebuilt by command | Same shape and semantics as the official category tree, so the algorithm is proven; no recursive CTE at read time | Compute paths on read | Recursive queries on every list; the official module already made this call |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| product type | Petkit product family (`fountain`, `feeder`, `litter_box`, `camera`, `accessory`); code unique per organization | `products_types` | duplicate code → 409; delete while referenced → 422 |
| category tree | Per-organization tree; a node stores `parent_id`, `root_id`, `tree_path` (`id/id/id`), `ancestor_ids`, `child_ids`, `descendant_ids`; rebuilt after every create/update | `products_categories` | cycle (self or own descendant as parent) → 422, data unchanged |
| primary category | One `category_id` per product (nullable); the contract groups by category | `products_products` | unknown/foreign-scope category → 400 |
| price tier | `purchase` (what we pay the agent) / `internal` (what the subsidiary is charged) / `export` (what the subsidiary charges its customers) | `lib/tiers.ts` constant | unknown code → 400 |
| price row | `(product, tier, currency_code, min_quantity)` unique; `unit_price` numeric(18,6); inactive rows stay for history | `products_prices` | duplicate key in one payload → 400; replace never hard-deletes |
| contract direction | `purchase` (we buy: counterparty is a supplier) or `sales` (we sell: counterparty is a customer/branch) | `trade_docs_contracts` | missing/invalid → 400 |
| contract status | `draft → issued → signed → closed`; `cancelled` only from `draft`/`issued` and requires a reason | command transition table | illegal transition → 422 with state unchanged |
| contract number | `PC-<year>-<4 digits>` (purchase) / `SC-<year>-<4 digits>` (sales), unique per organization, assigned at `issue` from the max existing number of that direction+year | `trade_docs_contracts` | duplicate → 409 |
| financial amount | `HALF_UP(quantity × unit_price, currencyScale)`; if the line is bound to a **confirmed** invoice line, that invoice line's `amount` | `lib/money.ts` + `lib/contractTotals.ts` | never negative-scaled; unavailable currency row → scale 2 + UI hint |
| contract amount | `HALF_UP(quantity × unit_price, 2)` | `lib/money.ts` | — |
| difference | `contract_total − finance_total` (signed; negative means finance exceeds the contract) | contract head | displayed, never hidden |
| invoice status | `draft → confirmed`; `confirmed → void`; `void` reverts its influence on the contract | `trade_docs_invoices` | confirming twice → 422 |
| invoice number | External document number typed by the operator, indexed but **not unique** (two systems may reuse numbers) | `trade_docs_invoices` | duplicate allowed by design |
| counterparty snapshot | Name/address/contact/bank captured on the contract head; renaming the master does not rewrite a signed contract | contract/invoice head | — |
| quantity/price precision | `numeric(18,6)` for quantity and unit price; amounts `numeric(18,4)`; tier prices `numeric(18,6)` | entities | values normalized to strings at the command boundary |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| product manager (HQ) | maintain product types, categories, products, and price sets | organization = HQ (+ descendants) | `products.items.view`, `products.items.manage`, `products.types.manage`, `products.categories.manage`, `products.prices.manage` |
| sales/contract operator (HQ) | create and issue purchase and sales contracts, manage invoices | organization = HQ (+ descendants) | `trade_docs.contracts.view`, `trade_docs.contracts.manage`, `trade_docs.invoices.view`, `trade_docs.invoices.manage` |
| finance (HQ) | confirm invoices, watch `finance_total` and the difference | organization = HQ | `trade_docs.invoices.manage`, `trade_docs.contracts.view` |
| subsidiary staff | read its own organization's contracts/invoices; read products of its own organization | organization = own only | `trade_docs.contracts.view`, `products.items.view` |
| read-only viewer | read lists and details | per grant | `*.view` features |

Trusted scope only: every command derives `tenantId` from `ctx.auth.tenantId` and `organizationId` from `ctx.selectedOrganizationId ?? ctx.auth.orgId`, and fails closed with the platform's `organization_scope_required` error when the organization is missing. No payload field can set scope. List/detail/mutation visibility follows the CRUD factory's organization guard plus the ACL organization set (HQ sees descendants, a subsidiary sees itself) — the configuration recorded in `docs/dev/multi-company-org-model.md`.

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| Product types, categories, products, price tiers | **app-own** | `products` (new) | — | Owner-confirmed business master with heavy planned customization |
| Official product registry | reuse (link only) | `catalog` | `catalog_product_id` + `catalog_snapshot` scalar/jsonb on `products_products` | Keeps the official chain compatible without a cross-module relation |
| Contracts, invoices, invoice archive | **app-own** | `trade_docs` (new) | references `products` by id + snapshot | No installed document of this shape exists |
| Supplier master / customer master | reuse | `purchasing`, `customers` | `counterparty_id` scalar + `counterparty_snapshot` | Masters are already owned; contracts must not duplicate them |
| Order source | reuse (later, id only) | `purchasing`, `sales` | `source_kind` + `source_id` + `source_snapshot` | Contracts may be derived from an order without owning it |
| Currency decimals | reuse | `currencies` | scoped read of `Currency.decimalPlaces` | One authority for the financial rounding scale |
| Currency code picker | reuse | `dictionaries` | `/api/customers/dictionaries/currency` | Same store every other picker uses |
| Organization tree and visibility | reuse | `directory` + CRUD factory | scope columns + ACL organization set | Platform mechanism, no app code |
| Attachment storage | reuse | `attachments` | `attachment_id` scalar + `/api/attachments` upload + attach command | Platform storage, drivers, partitions, access rules |
| Query index / search | reuse | `query_index` | `list.entityId` + `CrudIndexerConfig` | Lists are indexed by the factory |
| Command bus, audit, undo | reuse | `commands` + `audit_logs` | `registerCommand` + `isUndoable` | Same as `purchasing` |
| Events | reuse | `events` | `createModuleEvents` + `clientBroadcast` | Live list refresh |
| XLSX writing | reuse | `@open-mercato/core` `staff/lib/timesheets-reports/xlsx` | `buildXlsx` import through the package export map | No new dependency |
| Row/page shells, tables, forms, conflicts | reuse | `@open-mercato/ui` | `Page`/`PageBody`/`DataTable`/`CrudForm`/`surfaceRecordConflict`/`withScopedApiRequestHeaders` | Platform customizations (columns, actions) arrive through the platform's extension seams, not forks |

## Architecture and Data Flow

```text
/backend/products/{items,types,categories}      Page + DataTable + CrudForm (feature-gated)
        v
/api/products/**                                 makeCrudRoute / command route (per-method metadata + openApi)
        v
commands/*                                       zod validate -> scope -> entity write -> hierarchy rebuild/price replace -> events
        v
products_* tables                                tenant+org scoped, updated_at, snapshots

/backend/trade-docs/{contracts,invoices}         Page + DataTable + CrudForm + detail surfaces
        v
/api/trade-docs/**                               makeCrudRoute + guarded command routes (transitions, attach, document)
        v
commands/*                                       validate -> scope -> totals engine -> persist -> events
        v
trade_docs_* tables                              contract head stores contract/finance/difference totals
        |
        +-- lib/money.ts (BigInt multiply/quantize) <- lib/currencyScale.ts (Currency.decimalPlaces)
        +-- lib/contractTotals.ts (invoice-first per line, sums, difference)
        +-- lib/contractTemplate.ts + buildXlsx (Phase 4, attachment)
```

- **Module boundaries:** `products` owns product identity, hierarchy, and prices; `trade_docs` owns commercial documents and the amount calibers. They are separate modules because each is independently deployable (products ships and is usable with no contract module) and because the owner's standing instruction is "one capability = one app-owned module". The transactional invariant inside `trade_docs` (contract head totals and its lines) is why those two live in one module; invoice confirmation reaching into a contract total is a same-module write.
- **Extension points:** nothing installed is modified. Products are the extension-ready surface (types/categories/prices rows) rather than new columns on `catalog_products`.
- **Alternatives considered:** a single `products_and_contracts` module (rejected: forces the contract's migration and pages onto the product master's release); storing contract totals only as computed-on-read values (rejected: the operator must be able to filter/export by `finance_total`/`difference_total`, and a signed contract's numbers must be durable).
- **Compatibility:** `products` never writes `catalog_products`; the optional link column is additive. `trade_docs` never writes `purchasing`/`sales`. Existing `purchasing` pages and APIs keep their current behavior.

## User Journeys

### Journey J-001 — Maintain the product master (product manager, HQ)

1. Opens 产品类型 → creates `fountain` 智能饮水机 (seeded defaults already exist; the seed is idempotent).
2. Opens 产品类别 → creates 饮水机 → 无线饮水机 (child) → the list shows `tree_path`; moving a parent under its own descendant is rejected with 422 and nothing changes.
3. Opens 产品 → 新建: fills SKU `PK-W5C`, name, brand `Petkit`, model `W5C`, category, spec `白色 / 1.5L / 含滤芯`, unit `PCS`, carton quantity, lithium battery flag; saves.
4. In the same form's 三档价格 group submits purchase CNY 168.000000, internal USD 26.500000, export RUB 2450.000000; the API upserts them in one command.
5. Failure paths: duplicate SKU → 409 with the field surfaced; unknown category in another organization → 400; stale `updatedAt` on edit → 409 conflict dialog; a user without `products.items.manage` gets no navigation entry and 403 on the API.

### Journey J-002 — Purchase contract → invoice → financial caliber shift

1. Contract operator opens 购销合同 → 新建, sets direction `purchase`, counterparty kind `supplier` (picked from `purchasing` suppliers), price tier `purchase`, currency CNY, adds two product lines with quantities and unit prices (e.g. `3 × 1200.4`).
2. The line grid immediately shows `contract_amount` (2dp) and `finance_amount` (currency scale); the head shows the two totals and 差额.
3. 签发 (issue) assigns `PC-2026-0001` and locks the lines; 签订 records `signed_at`; printing uses the contract total.
4. Supplier sends an invoice for 3600.00 while the contract computed 3601.20: the operator creates an inbound invoice, binds its line to the contract line with the invoiced amount, and 确认 (confirm) — `finance_total` becomes the invoice figure and 差额 shows the 1.20 discrepancy.
5. 作废 (void) on the invoice reverts `finance_total` to the computed value; nothing else changes.
6. Failure paths: illegal transition (`draft → signed`) → 422 with the state unchanged; second 签发 → 422; stale edit → 409.

### Journey J-003 — Archive the invoice scan

1. On the invoice detail the operator picks a PDF/photo; the client uploads it to `/api/attachments` with `entityId='trade_docs:trade_docs_invoice'` and the record id, then binds it with `trade_docs.invoices.attach`.
2. The detail shows 查看文件 with a download link; the file is served by the platform's attachment route.
3. Failure path: upload fails → the invoice itself is already saved and the row offers 重试; the binding is idempotent per record.

### Journey J-004 — Generate the contract document (Phase 4)

1. On an issued/signed contract the operator clicks 生成合同 → the command writes the XLSX into `attachments` and stores `generated_attachment_id` / `generated_at`.
2. 下载合同 streams the stored file with the XLSX content type; the detail page downloads it as a Blob.
3. Failure path: the template constant is missing a value → the cell is empty rather than the request failing; regeneration replaces the stored pointer with a new attachment (old file kept).

## UI and Interaction Contracts

Closest installed references inspected: `src/modules/purchasing/backend/purchasing/{suppliers,orders}/**` (page + `page.meta.ts` + `DataTable` list + `CrudForm` create/edit + detail page), `src/modules/purchasing/components/{SuppliersTable,SupplierForm,PurchaseOrderDetail}.tsx`, and the platform's `catalog` product list/form pages. `.ai/guides/backend-ui.md` governs component choice.

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/products/items` | list products, filter by status/type/category, search SKU/name, export | `GET /api/products/items` | `catalog` products list / `purchasing` suppliers list | `Page`, `PageBody`, `DataTable`, `ListEmptyState`, `RowActions` | loading, empty, error, permission denied | REQ-004, REQ-010, REQ-011 |
| `/backend/products/items/create`, `/backend/products/items/[id]/edit` | create/edit product incl. three-tier price rows | `POST/PUT /api/products/items`, `PUT /api/products/prices` | `purchasing` supplier form (groups), order line editor | `CrudForm` (groups) + inline price row editor | validation error, conflict (409), success, permission denied | REQ-004, REQ-005 |
| `/backend/products/types` (+create/edit) | maintain product types | `GET/POST/PUT/DELETE /api/products/types` | `catalog` options list | `DataTable` + `CrudForm` | as above + delete-blocked (422) | REQ-002 |
| `/backend/products/categories` (+create/edit) | maintain the category tree; show `tree_path`; parent picker excludes self and descendants | `GET/POST/PUT/DELETE /api/products/categories` | `catalog` category list | `DataTable` (indented `tree_path`) + `CrudForm` | as above + cycle rejection (422) | REQ-003 |
| `/backend/trade-docs/contracts` | list contracts (direction, status, counterparty, currency, contract/finance/difference totals), CSV export | `GET /api/trade-docs/contracts` | `purchasing` orders list | `DataTable` + `StatusBadge` + `formatCurrency` | loading, empty, error, conflict, permission denied | REQ-006, REQ-009 |
| `/backend/trade-docs/contracts/create`, `/[id]/edit` | create/edit a contract with its lines (product picker from `products`) | `POST/PUT /api/trade-docs/contracts` | `purchasing` order create | `CrudForm` + line editor | as above | REQ-007 |
| `/backend/trade-docs/contracts/[id]` | detail: header, lines with both amounts and their source, three head totals, invoice link column, transitions, attachment area, 生成/下载 | `GET /api/trade-docs/contracts`, `/transitions`, `/invoices`, `/[id]/document` | `purchasing` order detail | `Page`, `PageBody`, `DataTable`, confirm dialog | as above + transition errors | REQ-006, REQ-009, REQ-013 |
| `/backend/trade-docs/invoices` (+create/edit) | list and maintain invoices incl. attachment upload/bind | `GET/POST/PUT /api/trade-docs/invoices`, `/attach` | `purchasing` payments panel | `DataTable` + `CrudForm` | as above + upload retry | REQ-008, REQ-012 |

References are rendered as display values, never raw ids: product lines show the stored snapshot (`sku` + `name`), counterparties show the snapshot name, category shows `tree_path`, type shows its name. Product/type/category option sources are the new module's own list routes (`/api/products/{items,types,categories}`); the currency picker reuses `/api/customers/dictionaries/currency`; the supplier picker reuses `/api/purchasing/suppliers`.

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| product manager | 商品 (产品 / 产品类型 / 产品类别) | none in this slice | login → 商品 › 产品 → 新建 → save (3 clicks) |
| contract operator | 购销 (购销合同 / 发票) | none in this slice | login → 购销 › 购销合同 → 新建 → add lines → 签发 (4 clicks) |
| finance | 购销 › 发票 | none | login → 购销 › 发票 → open → 上传 → 确认 |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| items list | 尚无产品，先建产品类型与类别 + 新建按钮 | columns degrade by `priority` meta; no horizontal scroll | Enter submits search; focus returns to the trigger after a dialog closes |
| product form | sections keep their headings while empty | price rows stack at narrow width | `Cmd/Ctrl+Enter` submits; field errors focus the first invalid field |
| categories list | 尚无类别提示 + 新建 | `tree_path` truncates with a title | as above |
| contract detail | lines empty state blocks 签发 (a contract without lines is not issuable) | header block wraps; line table keeps both amount columns visible | transitions confirm with keyboard-accessible dialogs; status changes announced via live region |
| invoice form | 未选择文件 + 上传按钮; upload failure shows inline 重试 | upload control stays usable at narrow width | as above |

### `/backend/products/items` — 产品列表

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ 产品                                              [导出] [新建产品]          │
│ [搜索 SKU/名称] [状态 ▾] [类型 ▾] [类别 ▾]                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│ SKU | 名称 | 类型 | 类别(tree_path) | 单位 | 状态 | 更新时间 | ⋯             │
│ PK-W5C | Petkit 无线饮水机 W5C | 智能饮水机 | 宠物 / 饮水机 | PCS | 启用 | ⋯  │
├─────────────────────────────────────────────────────────────────────────────┤
│ 分页 1/1 · 共 1 条                                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

### `/backend/products/items/create` — 新建产品 (steps)

```text
① 基本信息  ›  ② 出口/包装/锂电  ›  ③ 三档价格  ›  ④ 变体/SKU     ← 步骤条：编号、可点、出错步标红
第 1 / 4 步 · 切换步骤不会丢失已填内容；带 * 为必填。

① 基本信息  基本信息 : SKU* 类型▾ │ 名称* │ 英文名 品牌 │ 系列 型号 │ 类别▾ 状态* │ 规格串 │ 条码 单位 │ 备注
                                                        [上一步] [下一步]
② 出口/包装/锂电
出口与包装 : HS 编码 CN 编码 原产国 │ 净重 毛重
产品尺寸   : 长 宽 高 单位▾
装箱       : 每箱数量
锂电与认证 : 含锂电池▢ 电池容量(mAh) 电池能量(Wh) 认证(多值)
官方目录链接（选填） : 搜索官方目录商品…▾
                                                        [上一步] [下一步]
③ 三档价格  三档价格 : [+ 添加价格行] 档位▾ 币种▾ 起订量 单价(6位) 生效起 生效止 启用▢
                                                        [上一步] [下一步]
④ 变体/SKU  变体 / SKU : [+ 添加 SKU] 编码 名称 条码 状态 默认
                                                        [上一步]
```

- **Steps fill the page width:** `groupsForStep` renders one step at a time, so no group declares
  `column: 2` any more — a step whose groups were all sidebar groups drew its whole content into the
  `3fr` rail with the `7fr` column empty beside it.
- **Step chrome:** the rail is the DS `StepIndicator` (numbered, every step clickable, the step that
  owns a rejected field drawn as `error`) inside `CrudForm`'s `contentHeader`; 上一步/下一步 is the
  step's last `bare` group, so a long step never has to be scrolled back to the top to move on.
- **Required is checked per step:** `scopeRequiredToStep` marks a field `required` only on the step
  that owns it. A cross-step submit therefore reaches the API, and the 400's `path` makes the form
  jump to that step with the message attached (`revealInvalidStep`) — the client-side block alone
  would flash "请修正标红的字段" while the offending field sits unrendered on another step.
- **Behavior:** the price grid submits the product's whole price set through `PUT /api/products/prices` after the product create/update succeeds; failure of either step surfaces the failing step and keeps entered values; the list refresh is driven by `clientBroadcast` events rather than polling.
- **Responsive and accessibility:** every field has a label; the price grid is a real table with a caption; error summary announces the first error to screen readers.
- **Localization:** `products.*` keys in `i18n/{zh,en}.json`; amounts formatted with the shared currency helper; no literal user-facing strings in components.
- **Design-system and theming:** semantic tokens (`text-muted-foreground`, `StatusBadge` variants) only; light and dark verified; no hard-coded palette values.

### `/backend/trade-docs/contracts/[id]` — 合同详情

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ PC-2026-0001 · 采购合同   [签发] [签订] [关闭] [取消] [生成合同] [下载合同]   │
│ 对方: 广州某某代理商   币种: CNY   价格档: 采购价   状态: 已签发             │
├─────────────────────────────────────────────────────────────────────────────┤
│ 行: # | 品名/型号 | 规格 | 单位 | 数量 | 单价 | 合同金额 | 财务金额 | 来源   │
│     1 | W5C      | 白色/1.5L | PCS | 3 | 1200.4 | 3601.20 | 3601.20 | 按单价 │
├─────────────────────────────────────────────────────────────────────────────┤
│ 合同金额 3601.20  财务金额 3600.00  差额 1.20   (发票: INV-2026-77 已确认)   │
├─────────────────────────────────────────────────────────────────────────────┤
│ 附件: (Phase 4) 合同文件.xlsx [下载]                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Data Models

All tables carry `tenant_id` + `organization_id` (uuid, required, session-derived), `created_at`, `updated_at`, soft delete where history matters, and a composite scope index. Amounts are PostgreSQL `numeric` read as strings; no float ever touches money.

### `products_types`

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | uuid, required | PK | no | immutable |
| `tenant_id`, `organization_id` | uuid, required | unique `(tenant, org, code)` | no | trusted context only |
| `code` | text, required | unique per scope | no | `^[a-z0-9_]+$`, editable while unreferenced in practice; delete blocked when products reference it |
| `name`, `name_en` | text required / text nullable | — | no | editable |
| `sort_order` | integer, default 0 | — | no | editable |
| `is_active` | boolean, default true | — | no | deactivation hides it from selectors |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | — | no | soft delete |

### `products_categories`

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | uuid, required | PK | no | immutable |
| `tenant_id`, `organization_id` | uuid, required | unique `(tenant, org, code)` | no | trusted context only |
| `code`, `name`, `name_en` | text | index on name | no | editable |
| `parent_id` | uuid, nullable | index | no | must resolve inside the same org; must not be self or a descendant (422) |
| `root_id` | uuid, nullable | index | no | derived |
| `tree_path` | text, nullable | index | no | derived `id/id/id` |
| `ancestor_ids`, `child_ids`, `descendant_ids` | jsonb, default `[]` | — | no | derived, rebuilt on every create/update |
| `sort_order`, `is_active` | integer / boolean | — | no | editable |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | — | no | soft delete, blocked while children or products reference it |

### `products_products`

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | uuid, required | PK | no | immutable |
| `tenant_id`, `organization_id` | uuid, required | scope index | no | trusted context only |
| `sku` | text, required | unique `(tenant, org, sku)` (includes soft-deleted rows) | no | operator-entered, 1..64, duplicate → 409 |
| `name`, `name_en` | text required / nullable | index on name | no | editable |
| `brand` | text, default `''` | — | no | editable; no brand is assumed (a self-made product must not inherit a supplier's brand) |
| `series`, `manufacturer_model` | text, nullable | — | no | editable |
| `type_id`, `category_id` | uuid, nullable | index | no | must resolve inside the same org when set |
| `spec_summary` | text, nullable | — | no | printed on contracts |
| `barcode` | text, nullable | — | no | GTIN/EAN |
| `unit` | text, default `'PCS'` | — | no | editable |
| `hs_code`, `cn_code`, `country_of_origin_code` | text, nullable | — | no | export declarations |
| `net_weight`, `gross_weight` | numeric(16,4), nullable | — | no | per unit |
| `dimensions` | jsonb, nullable | — | no | `{length,width,height,unit}`; the form labels it 产品尺寸 / "Product size" (2026-09-23 统一命名) |
| `carton_quantity` | integer, nullable | — | no | 装箱数 Qty/Box — how many units one carton holds; kept |
| ~~`carton_dimensions`, `carton_gross_weight`, `carton_net_weight`~~ | dropped 2026-09-23 | — | — | whole-carton measurements are not maintained (unit data only); the columns are dropped by `Migration20260923065528_products` (`up`: `drop column "carton_dimensions", drop column "carton_gross_weight", drop column "carton_net_weight"`, with the matching `down`) |
| `battery_capacity_mah` | integer, nullable | — | no | lithium declaration |
| `battery_wh` | numeric(10,2), nullable | — | no | lithium air-freight declaration |
| `contains_lithium_battery` | boolean, default false | — | no | drives the air-freight flag |
| `certifications` | jsonb, nullable | — | no | `string[]` |
| `status` | text, default `'active'` | index | no | `active` \| `inactive`; inactive hidden from selectors |
| `catalog_product_id`, `catalog_snapshot` | uuid nullable / jsonb nullable | index | no | optional link to the official registry; never written by this module |
| `notes` | text, nullable | — | no | editable |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | version | no | soft delete |

### `products_prices`

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id`, `tenant_id`, `organization_id` | uuid, required | PK / scope index | no | system |
| `product_id` | uuid, required | unique with tier/currency/min-qty; cascade delete with the product | no | same-module `@ManyToOne` (`deleteRule: cascade`) |
| `price_tier` | text, required | unique part | no | `purchase` \| `internal` \| `export` |
| `currency_code` | text, required | unique part | no | 3-letter ISO, uppercased, checked against the currency dictionary |
| `min_quantity` | integer, default 1 | unique part | no | ≥ 1 |
| `unit_price` | numeric(18,6), default `'0'` | — | no | ≥ 0 |
| `starts_at`, `ends_at` | date, nullable | — | no | optional validity window |
| `is_active` | boolean, default true | — | no | a tier with no active row means "no price quoted" |
| `created_at`, `updated_at` | timestamptz | — | no | system |

### `trade_docs_contracts`

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id`, `tenant_id`, `organization_id` | uuid, required | PK / scope index | no | system |
| `number` | text, nullable | unique `(tenant, org, number)` | no | assigned at `issue`; `PC-`/`SC-<year>-<4 digits>` |
| `direction` | text, default `'purchase'` | index | no | `purchase` \| `sales` |
| `status` | text, default `'draft'` | index | no | command-driven transitions only |
| `counterparty_kind` | text, required | — | no | `supplier` \| `customer` |
| `counterparty_id`, `counterparty_snapshot` | uuid nullable / jsonb nullable | index | commercial data | snapshot frozen at `issue` |
| `our_party_snapshot` | jsonb, nullable | — | commercial data | name/address/contact/bank of our side |
| `price_tier` | text, nullable | — | no | `purchase` \| `internal` \| `export` |
| `currency_code` | text, default `'CNY'` | — | no | drives the financial scale |
| `exchange_rate` | numeric(18,8), nullable | — | no | snapshot only, never auto-converted |
| `source_kind`, `source_id`, `source_snapshot` | text/uuid/jsonb, nullable | index on source_id | no | order reference by id + snapshot |
| `contract_total`, `finance_total`, `difference_total` | numeric(18,4), default `'0'` | index on finance_total | financial | recomputed by the totals engine on every line/invoice change |
| `signed_at`, `delivery_date` | date, nullable | — | no | set by `sign` / editable headers |
| `payment_terms`, `shipping_method`, `destination`, `marks`, `notes` | text, nullable | — | no | printed contract terms |
| `generated_attachment_id`, `generated_at` | uuid nullable / timestamptz nullable | — | no | Phase 4 document pointer |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | version | no | soft delete (draft/cancelled only) |

### `trade_docs_contract_lines`

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id`, `tenant_id`, `organization_id` | uuid, required | PK / scope index | no | system |
| `contract_id` | uuid, required | unique `(contract, line_number)` | no | same-module `@ManyToOne`, cascade |
| `line_number` | integer, required | unique per contract | no | assigned 1..n by the command |
| `product_id`, `product_snapshot` | uuid nullable / jsonb nullable | index | no | snapshot: sku/name/model/spec/unit/hs_code/origin |
| `name`, `sku`, `model`, `spec`, `unit` | text, nullable | — | no | printing copies of the snapshot (a re-import of the product cannot rewrite an issued contract) |
| `quantity` | numeric(18,6), default `'0'` | — | no | editable while `draft` |
| `unit_price` | numeric(18,6), default `'0'` | — | no | editable while `draft` |
| `contract_amount`, `finance_amount` | numeric(18,4), default `'0'` | — | financial | derived |
| `note` | text, nullable | — | no | editable |
| `created_at`, `updated_at` | timestamptz | — | no | system |

### `trade_docs_invoices`

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id`, `tenant_id`, `organization_id` | uuid, required | PK / scope index | no | system |
| `number` | text, nullable | index (not unique) | no | external document number |
| `direction` | text, required | index | no | `inbound` \| `outbound` |
| `status` | text, default `'draft'` | index | no | `draft` \| `confirmed` \| `void` |
| `counterparty_kind`, `counterparty_id`, `counterparty_snapshot` | text / uuid / jsonb | index | commercial data | same convention as contracts |
| `contract_id` | uuid, nullable | index | no | same-module `@ManyToOne`, `nullable: true` |
| `source_kind`, `source_id`, `source_snapshot` | text/uuid/jsonb, nullable | — | no | order reference |
| `currency_code` | text, default `'CNY'` | — | no | must match the bound contract for confirmation to affect it |
| `subtotal`, `total` | numeric(18,4), default `'0'` | — | financial | derived from lines |
| `issued_at` | date, nullable | — | no | editable |
| `attachment_id` | uuid, nullable | index | commercial document | platform attachment; archive + download only |
| `notes` | text, nullable | — | no | editable |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | version | no | soft delete (draft/void only) |

### `trade_docs_invoice_lines`

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id`, `tenant_id`, `organization_id` | uuid, required | PK / scope index | no | system |
| `invoice_id` | uuid, required | unique `(invoice, line_number)` | no | `@ManyToOne`, cascade |
| `line_number` | integer, required | unique per invoice | no | assigned by the command |
| `product_id`, `product_snapshot` | uuid nullable / jsonb nullable | index | no | same convention as contract lines |
| `description`, `sku`, `unit` | text, nullable | — | no | printing |
| `quantity`, `unit_price` | numeric(18,6), default `'0'` | — | no | editable while `draft` |
| `amount` | numeric(18,4), default `'0'` | — | financial | editable as printed on the supplier's invoice (may differ from `quantity × unit_price`) |
| `contract_line_id` | uuid, nullable | index | no | `@ManyToOne` to `TradeDocsContractLine`, `nullable: true`, `deleteRule: 'set null'` |
| `created_at`, `updated_at` | timestamptz | — | no | system |

Entity IDs derive from class names (`ProductsProduct` → `products:products_product`); every list route must declare the exact entity id or the query engine looks for a non-existent table.

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success | Errors / concurrency |
|---|---|---|---|---|---|
| `GET/POST/PUT/DELETE` | `/api/products/items` | `products.items.view` / `products.items.manage` | item create/update/list schemas | list / 201 / 200 / 200 + `products.item.*` | 400/403/404/409 (duplicate sku, stale version) |
| `GET/POST/PUT/DELETE` | `/api/products/types` | `products.items.view` / `products.types.manage` | type schemas | as above + `products.type.*` | 409 duplicate code; 422 delete while referenced |
| `GET/POST/PUT/DELETE` | `/api/products/categories` | `products.items.view` / `products.categories.manage` | category schemas | as above + `products.category.*` | 409 duplicate code; 422 cycle / delete with children |
| `GET/PUT` | `/api/products/prices` | `products.items.view` / `products.prices.manage` | `{ productId, rows[] }` | 200 + `products.prices.updated` | 400 invalid tier/currency/min-qty; 404 unknown product |
| `GET/POST/PUT/DELETE` | `/api/trade-docs/contracts` | `trade_docs.contracts.view` / `.manage` | contract schemas | list / 201 / 200 / 200 + `trade_docs.contract.*` | 400/403/404/409 |
| `GET` | `/api/trade-docs/contracts/lines` | `trade_docs.contracts.view` | line list schema | list | 403 |
| `POST` | `/api/trade-docs/contracts/transitions` | `trade_docs.contracts.manage` | `{ id, action: issue\|sign\|close\|cancel, reason? }` | 200 + `trade_docs.contract.<action>` | 422 illegal transition / missing cancel reason |
| `GET` | `/api/trade-docs/contracts/[id]/document` | `trade_docs.contracts.view` | — | XLSX stream (Phase 4) | 404 when nothing generated yet |
| `GET/POST/PUT/DELETE` | `/api/trade-docs/invoices` | `trade_docs.invoices.view` / `.manage` | invoice schemas | list / 201 / 200 + `trade_docs.invoice.*` | 400/403/404/409/422 |
| `GET` | `/api/trade-docs/invoices/lines` | `trade_docs.invoices.view` | line list schema | list | 403 |
| `POST` | `/api/trade-docs/invoices/transitions` | `trade_docs.invoices.manage` | `{ id, action: confirm\|void, reason? }` | 200 + `trade_docs.invoice.confirmed\|voided` | 422 illegal transition |
| `PUT` | `/api/trade-docs/invoices/attach` | `trade_docs.invoices.manage` | `{ id, attachmentId, updatedAt }` | 200 + `trade_docs.invoice.attached` | 400/403/404/409 |
| command | `trade_docs.contracts.generate-document` | `trade_docs.contracts.manage` | `{ id }` | 200 `{ attachmentId }` + `trade_docs.contract.document.generated` | 404/422 when not issued |

Commands (all `registerCommand`, scope fail-closed, audit + undo where the entity supports it):

- `products.types.create | update | delete`
- `products.categories.create | update | delete` (hierarchy rebuilt after create/update)
- `products.items.create | update | delete` (soft delete)
- `products.prices.replace`
- `trade_docs.contracts.create | update | delete | issue | sign | close | cancel | generate-document`
- `trade_docs.invoices.create | update | delete | confirm | void | attach`

Every CRUD route uses `makeCrudRoute` with per-method `metadata` and an exported `openApi` built from `createCrudOpenApiFactory`; the transition/attach routes follow `src/modules/purchasing/api/purchase-orders/{transitions,payments}/route.ts` (POST/PUT action + a list surface for the ORM binding). `list.export` is enabled for items and contracts with explicit columns so contract CSV carries 合同金额/财务金额/差额.

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| `products.item.created/updated/deleted` | `products` | open lists (`clientBroadcast`) | list refresh | payload: ids + scope only |
| `products.type.*`, `products.category.*` | `products` | open lists | list refresh | as above |
| `products.prices.updated` | `products` | open lists | product price grid refresh | as above |
| `trade_docs.contract.created/updated/issued/signed/closed/cancelled` | `trade_docs` | open lists; later subscribers (notifications, `sales`/`purchasing` linkage) | list refresh; invoice screens re-derive totals | idempotent subscribers; audit row per command |
| `trade_docs.invoice.created/updated/confirmed/voided/attached` | `trade_docs` | open lists; contract head recomputation happens inside the same command, not via a subscriber | `finance_total` may change | same-transaction recompute — no event ordering hazard |
| `trade_docs.contract.document.generated` | `trade_docs` | open lists | download link appears | regeneration creates a new attachment and moves the pointer |

No jobs, queues, or scheduled work are introduced. Attachment access, indexing, and audit reuse installed behavior.

## Security, Privacy, and Compliance

- **Authorization:** feature ids as listed above; list/detail/mutation all gated; UI hiding never substitutes for the API check. No role-name checks anywhere.
- **Tenant isolation:** scope columns on every table; commands fail closed without a resolvable organization; reads use the factory's automatic scope guard, with cross-module reads (currency decimals, product snapshots) written as scoped Kysely queries with bound parameters.
- **Sensitive data:** counterparty addresses/banks are commercial data, not personal PII; contract and invoice files are stored through the platform's attachment driver (partition by entity, access-checked download). No secrets, no tokens, no encryption map additions — no new column holds an end-customer identifier.
- **Abuse and failure modes:** duplicate SKU/code → 409 (uniqueness includes soft-deleted rows so the user never gets a driver error); cycle attempts → 422 with data unchanged; stale writes → 409 via `updated_at` optimistic lock; invoice confirmation cannot be replayed (422) and voiding reverses cleanly; the money engine parses only decimal strings and rejects non-finite input (line rejected, contract unchanged); no endpoint accepts a client-computed total — the head totals are always server-derived.

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | unit | — | `lib/money.ts` cases: `1 × 0.005` @2dp, `2.5 × 0.125` @2dp, `3 × 12.3456` @2dp, `3 × 1200.4` @0dp vs contract 2dp, sum of `0.01+0.02`, difference on an invoice-covered line, `resolveCurrencyScale(null\|0\|99)` | exact strings as specified in Phase 2 | REQ-009 |
| TEST-002 | unit | — | `lib/categoryTree.ts` on A>B>C then moving B to root; cycle attempt | `ancestor_ids`/`descendant_ids`/`tree_path`/`depth` match hand-computed values; cycle rejected | REQ-003 |
| TEST-003 | unit | — | validators: invalid tier, lowercase currency, `min_quantity: 0` | each rejected with a field error | REQ-005 |
| TEST-004 | API | tenant + HQ org + operator with features | type → category A/B/C → product → three price rows → list with `search` | 201s, `treePath` = `A/B/C`, prices round-trip, duplicate SKU → 409, inactive product filtered out | REQ-002…005 |
| TEST-005 | security | user without `products.items.manage`; second organization | POST/PUT/GET across scope | 403 on write; 404/absent cross-organization reads | REQ-001, REQ-010 |
| TEST-006 | concurrency | product and contract rows | PUT with a stale `updatedAt` | 409, no silent overwrite | REQ-010 |
| TEST-007 | API | product + contract | create purchase contract with two lines incl. a 4-decimal unit price → `issue` → `sign` → `close` | number `PC-<year>-0001`; head totals equal hand-computed values; `draft → signed` → 422 unchanged; second `issue` → 422 | REQ-006, REQ-007, REQ-009 |
| TEST-008 | API | contract with confirmed + voided invoice lines | create inbound invoice bound to a contract line, confirm, then void | `finance_total` follows the invoice, then reverts; `difference_total` correct in both states | REQ-008, REQ-009 |
| TEST-009 | API | invoice | upload `/api/attachments` → `attach` | binding persists, detail shows the download link, idempotent re-bind | REQ-012 |
| TEST-010 | UI | operator, zh + en, narrow width | items/categories/contracts/invoices flows incl. conflict and error states | canonical shells, complete states, no raw strings or palette colors | REQ-011 |
| TEST-011 | API | issued contract | generate document → download | XLSX content type, non-empty body, amounts numeric (Phase 4) | REQ-013 |
| TEST-012 | migration | worktree copy | `yarn db:generate` → review → apply | SQL scoped to the two modules' tables; reversible | REQ-001 |

## Implementation Phases

### Phase 0 — Spec and ownership documents

- **Depends on:** none
- **Outcome:** this spec plus the ownership/PRD/plan rows recording that product master data is app-owned.
- **Deliverables:** `.ai/specs/2026-09-22-products-and-trade-docs.md`, `docs/dev/business-architecture.md`, `docs/prd/cross-border-erp.md`, `docs/plans/cross-border-erp.md`.
- **Requirements closed:** — (documentation gate)
- **Validation:** spec sections complete; no blocking open question.
- **Exit gate:** spec status `Ready for implementation`; docs reference it.

### Phase 1 — `products` module (types, categories, products, prices)

- **Depends on:** Phase 0
- **Outcome:** an operator maintains product types, the category tree, products, and three price tiers; every surface is feature-gated, org-scoped, and localized.
- **Why this order / value delivered:** the price tiers and product snapshots are inputs to every contract line; nothing downstream can be verified without them.
- **Deliverables:** `src/modules/products/{index.ts,acl.ts,setup.ts,events.ts,README.md,i18n/{zh,en}.json}`, `data/{entities,validators}.ts`, `lib/{tiers,categoryTree}.ts`, `commands/{types,categories,items,prices}.ts`, `api/{items,types,categories,prices}/route.ts` + `api/openapi.ts`, `backend/products/{items,types,categories}/**` + `components/*`, registration in `src/modules.ts`, migration (generated → reviewed → approved), seed defaults.
- **Independent slices / estimated commits:** (a) entities + validators + tiers/categoryTree + commands + routes; (b) pages/components + i18n; (c) migration + seed + smoke evidence.
- **Requirements closed:** REQ-001…REQ-005, REQ-010 (product surfaces), REQ-011.
- **Tests:** TEST-002, TEST-003, TEST-004, TEST-005, TEST-006, TEST-010 (products), TEST-012.
- **Validation:** `yarn generate`, `yarn typecheck`, `yarn lint`, focused jest on `src/modules/products`, API smoke, browser pass.
- **Exit gate:** types/categories/products/prices work end to end in zh; duplicate SKU → 409; cycle → 422; cross-organization read fails; validation gate green.

### Phase 2 — `trade_docs` module (contracts, invoices, dual-caliber amounts)

- **Depends on:** Phase 1 exit gate
- **Outcome:** purchase and sales contracts with dual-caliber amounts and lifecycle; inbound/outbound invoices that move the financial caliber when confirmed and archive their file.
- **Why this order / value delivered:** the contracts are the commercial document the owner asked for; after this phase finance can tie every contract to an invoice.
- **Deliverables:** `src/modules/trade_docs/**` (entities, validators, `lib/{money,currencyScale,contractTotals}.ts`, commands, routes, pages, i18n, README), registration, migration (generated → reviewed → approved).
- **Independent slices / estimated commits:** (a) entities + money engine + currencyScale + contractTotals + unit tests; (b) contract commands/routes; (c) invoice commands/routes + attach; (d) pages/components + i18n.
- **Requirements closed:** REQ-006…REQ-012.
- **Tests:** TEST-001, TEST-007, TEST-008, TEST-009, TEST-010 (trade docs), TEST-012.
- **Validation:** `yarn generate`, `yarn typecheck`, `yarn lint`, `yarn jest --config jest.config.cjs src/modules/trade_docs`, API smoke, browser pass.
- **Exit gate:** `PC-2026-0001` issued and closed; totals match hand computation; invoice confirm/void moves and reverts `finance_total`; attachment bound and downloadable; illegal transitions 422.

### Phase 3 — Dual-caliber output surfaces

- **Depends on:** Phase 2 exit gate
- **Outcome:** the two calibers and the difference are visible wherever an operator makes a decision, and contract CSV export carries them.
- **Deliverables:** contract list/detail columns + summary block, per-line amount-source indicator, invoice influence display, CSV export columns, currency-scale fallback hint.
- **Requirements closed:** REQ-009 (display contract), REQ-010 (export).
- **Tests:** TEST-007, TEST-008, TEST-010.
- **Validation:** focused jest + API export smoke + browser pass.
- **Exit gate:** CSV contains 合同金额/财务金额/差额 with correct values; a contract whose lines are invoice-covered shows the invoice as the amount source.

### Phase 5 — Product form convergence, official catalog pages hidden, purchasing switched (owner-confirmed 2026-09-22)

- **Depends on:** Phase 2 exit gate
- **Why this slice / value delivered:** the owner's review of the product form was "字段偏多，有些功能点不需要" plus "完全独立出来代码，自定流程、字段与 UI 布局". The module is already app-owned (no catalog entity/component/command is referenced); this slice makes the *surface* match the intent and removes the second product surface from the admin.
- **Outcome:** one product master in the sidebar, a product form that leads with basics + the three price tiers and keeps the export/declaration fields one step away, and a purchase order whose lines reference that same master by id + snapshot.
- **REQ-015** — The product form is step-based: step 1 basics (SKU/name/type/category/spec/unit/status), step 2 the export & packaging + battery & certification fields (declaration data), step 3 the three price tiers; a failed submit jumps to the step that owns the first server-side field error. Which step shows which field is data in `lib/formLayout.ts`, so a later field whitelist is a one-file edit. No field is deleted, so contract snapshots and declarations keep their inputs.
- **REQ-016** — The installed catalog's `backend` pages for products, product variants and categories are hidden through the module registry's page overrides — `overrides.routes.pages` on the `catalog` entry (`{ routes: { pages: { '/backend/catalog/products': null, … } } }`). The domain is `routes.pages`; a top-level `pages` key is read by no applier and hides nothing (see `.ai/lessons/module-override-page-hide-needs-routes-domain.md`). The module, its API and `config/catalog` stay enabled: `sales` still resolves catalog offers/price kinds, and existing rows keep working. Hiding is a registry concern, never an edit to node_modules.
- **REQ-017** — Purchase order lines reference the app-owned master: new nullable `purchasing_purchase_order_lines.product_id` (additive), the line picker reads `GET /api/products/items` narrowed to the selected organization, and create/update resolve the display snapshot from `products_products`. `catalog_product_id` stays for historical rows (read fallback + list projection), and a line still needs exactly one product reference. `cross_border`'s scoped read of order lines reports both ids as nullable.
- **Non-goals for this slice:** switching `sales` document lines to `products` (its line dialog still reads `/api/catalog/products`), deleting or ejecting the installed catalog, migrating historical order lines, and removing the catalog entities/ACL.
- **Deliverables:** `src/modules/products/lib/formLayout.ts`, restructured `src/modules/products/components/ProductForm.tsx` (+ zh/en keys), `purchasing_purchase_order_lines.product_id` + entity/validators/commands/routes/UI changes, `src/modules.ts` page overrides, migration for the new column, and cross-library verification (API smoke + browser pass).
- **Requirements closed:** REQ-015, REQ-016, REQ-017.
- **Tests:** extend TEST-004 (product form/API), TEST-007 (order create with a `products` reference), TEST-010 (UI).
- **Validation:** `yarn generate`, `yarn typecheck`, `yarn lint`, `yarn ds:check`, focused jest, API smoke (order create + issue with a `products`-backed line), browser pass on the stepped form and on the purchase order create page.
- **Exit gate:** the admin lists one product master; a purchase order line created through the UI references `products_products.id` and shows the snapshot; historical lines that only carry `catalog_product_id` still render; no installed file changed.

### Phase 4 — Contract Excel document (owner-deferred, last)

- **Depends on:** Phase 3 exit gate
- **Outcome:** an issued contract renders to XLSX, is stored as an attachment, and downloads from the detail page.
- **Deliverables:** `lib/contractTemplate.ts`, `lib/amountInWords.ts`, `trade_docs.contracts.generate-document`, `api/trade-docs/contracts/[id]/document/route.ts`, detail-page actions.
- **Requirements closed:** REQ-013.
- **Tests:** TEST-011.
- **Validation:** `yarn jest --config jest.config.cjs src/modules/trade_docs`, end-to-end generate + download, open the file once in a spreadsheet app.
- **Exit gate:** the stored file opens, the detail line amounts sum to the contract total, and the amounts are numeric cells.

## Phase 6 — 内部销售单据（方案待定，2026-09-22 调查完成）

**为什么需要决定**：官方 `sales` 单据链（报价→订单→发货→发票）在本部署里**零数据**，而它的商品选择器硬编码官方目录
（`sales/components/documents/LineItemDialog.tsx` 调 `/api/catalog/products`、`/api/catalog/variants`、单位换算与 offer），
而官方目录的后台页面已隐藏、目录里只剩测试数据。业务侧的"卖给俄罗斯分公司"目前由 `trade_docs` 的销售合同 + 销项发票承载。

**调查结论（代码级证据，实施前已核实）**：

| 事项 | 结论 |
|---|---|
| 行上能否存自建商品 id | **能，无需改库/命令**：`sales_order_lines.product_id` 是可空 uuid 无外键，行 schema `productId: uuid().optional()` 不做目录校验 |
| 目录里查不到商品会怎样 | **容忍**：`normalizeLineUom` 在 `resolveProductUomState` 返回 null 时走 fallback（不抛错），只是少了 UoM/单位换算富化 |
| 有没有选品器替换点 | **没有**：`LineItemDialog` 不暴露 injection spot，`sales/widgets` 也没有注册 `components` 句柄；平台只有 `page:/data-table:/crud-form:/section:` 四种替换句柄 |
| 因此可选方案 | A 自建「内部销售单据」页面（选品走 `products`），隐藏官方 sales 新建/编辑页，底层链（发货/发票）保留；B 把 `products` 镜像进目录（官方 UI 原样可用，但回到两套主数据）；C eject `sales` 自养（完全掌控，承担升级责任） |
| 共同前提 | 发货与库存按变体级入账，因此无论选哪条，商品仍需「官方目录链接」才能发运/收货（REQ-017 的桥接已覆盖采购链） |

**状态**：owner 选择 **A**（自建 app-owned 内部销售单据页面，隐藏官方新建页，底层链保留）。已实现为 `src/modules/internal_sales/**`：

- **REQ-018** — `internal_sales` 是 app 自有界面模块（`{ id: 'internal_sales', from: '@app' }`）：6 个页面（报价/订单 各 列表·新建·编辑）、2 个组件、zh/en i18n、README；不新增实体、不新增迁移、不新造功能位（复用 `sales.quotes|orders.manage`，因为真正的门禁在官方 API）。
- **REQ-019** — 行引用自建商品主数据（`productId` = `products_products.id`，选品器读 `GET /api/products/items` 并按当前组织收敛）；商品有「官方目录链接」时自动解析默认启用变体写入 `productVariantId`（snake_case 响应兼容），快照 `catalogSnapshot{sku,name,spec}` 写入时冻结。
- **REQ-020** — 编辑遵循官方两条行为：抬头 `PUT /api/sales/{quotes,orders}` 只改标量（不替换行），行经 `…lines` 集合 upsert/delete；版本只由抬头 PUT 携带（行写入因重算合计会推进父单据版本），表单 `disableOptimisticLock`，保存后重读单据；官方新建页 `/backend/sales/documents/create` 隐藏，官方列表与 `config/sales` 保留。

## Requirement Traceability

| Requirement | Journey / surface | Data / API / event contracts | Reference capability (`src/modules/example/**`) | Phase | Tests | AC |
|---|---|---|---|---|---|---|
| REQ-001 | module registration | `src/modules.ts`, `index.ts`, migration | `module.metadata` → `src/modules/example/index.ts`; `data.migrations` → `src/modules/example/migrations/Migration20251030150038.ts` | 1, 2 | TEST-012 | AC-001 |
| REQ-002 | types page + API | `products_types`, `/api/products/types`, `products.type.*` | `api.crud-factory` → `src/modules/example/api/customer-priorities/route.ts`; `events.typed-definitions` → `src/modules/example/events.ts` | 1 | TEST-004, TEST-010 | AC-002 |
| REQ-003 | categories page + API | `products_categories`, build in `commands/categories.ts` | `data.entities` → `src/modules/example/data/entities.ts`; `commands.write` → `src/modules/example/commands/todos.ts` | 1 | TEST-002, TEST-004 | AC-003 |
| REQ-004 | items page + API | `products_products`, `/api/products/items` | `ui.datatable` → `src/modules/example/components/TodosTable.tsx`; `ui.form-create` → `src/modules/example/components/TodoForm.tsx` | 1 | TEST-004, TEST-005 | AC-004 |
| REQ-005 | price grid + API | `products_prices`, `/api/products/prices` | `data.validators` → `src/modules/example/data/validators.ts` | 1 | TEST-003, TEST-004 | AC-005 |
| REQ-006 | contracts page/API/commands | `trade_docs_contracts`, `/api/trade-docs/contracts*` | `api.crud-factory` → `src/modules/example/api/customer-priorities/route.ts`; `api.custom-route` → `src/modules/example/api/organizations/route.ts` | 2 | TEST-007 | AC-006 |
| REQ-007 | contract lines | `trade_docs_contract_lines` | `data.entities` → `src/modules/example/data/entities.ts` | 2 | TEST-007 | AC-007 |
| REQ-008 | invoices page/API/commands | `trade_docs_invoices`, `..._invoice_lines` | `api.crud-factory` → `src/modules/example/api/customer-priorities/route.ts` | 2 | TEST-008 | AC-008 |
| REQ-009 | money engine + heads | `lib/money.ts`, `lib/contractTotals.ts`, head columns, CSV | `runtime.tenant-scoped-cache` is **not** used; engine is app-owned pure functions | 2, 3 | TEST-001, TEST-007, TEST-008 | AC-009 |
| REQ-010 | all routes/pages | per-method `metadata`, `openApi`, `page.meta.ts`, optimistic lock | `api.openapi` → `src/modules/example/api/openapi.ts`; `module.acl-features` → `src/modules/example/acl.ts` | 1, 2 | TEST-005, TEST-006 | AC-010 |
| REQ-011 | all UI | `i18n/{zh,en}.json`, page states | `module.i18n-catalogs` → `src/modules/example/i18n/en.json`; `ui.page-shell` → `src/modules/example/backend/todos/page.tsx` | 1, 2 | TEST-010 | AC-011 |
| REQ-012 | invoice attachment | `attachment_id`, `/api/trade-docs/invoices/attach` | `api.option-source-routes` → `src/modules/example/api/tags/route.ts` (upload binding pattern) | 2 | TEST-009 | AC-012 |
| REQ-018 | app-owned internal-sales surface | `src/modules/internal_sales/**` (pages, components, i18n) | `ui.page-shell` → `src/modules/example/backend/todos/page.tsx`; `ui.form-create` → `src/modules/example/components/TodoForm.tsx` | 6 | TEST-010, TEST-011 | AC-019 |
| REQ-019 | internal-sales lines reference `products` | option loader `products/components/formOptions.ts`, variant bridge in `InternalSalesForm.tsx` | `api.option-source-routes` → `src/modules/example/api/tags/route.ts` | 6 | TEST-007, TEST-011 | AC-020 |
| REQ-020 | edit reconciles head + line collection under the aggregate lock | `saveInternalSalesDocument`, `src/modules.ts` sales page override | `commands.write` → `src/modules/example/commands/todos.ts` | 6 | TEST-011 | AC-021 |
| REQ-015 | product form steps + field layout constant | `lib/formLayout.ts`, `components/ProductForm.tsx` | `ui.form-create` → `src/modules/example/components/TodoForm.tsx` | 5 | TEST-004, TEST-010 | AC-015 |
| REQ-016 | installed catalog pages hidden | `src/modules.ts` page overrides | `overrides.compileable-reference` → `src/modules/example/references/module-overrides.reference.ts` | 5 | TEST-010 | AC-016 |
| REQ-017 | purchase order lines reference `products` | `purchasing_purchase_order_lines.product_id`, line picker, `resolveOrderLines` | `data.entities` → `src/modules/example/data/entities.ts`; `commands.write` → `src/modules/example/commands/todos.ts` | 5 | TEST-007 | AC-017 |
| REQ-013 | document generation | `lib/contractTemplate.ts`, `commands.generate-document`, `[id]/document` route | `api.custom-route` → `src/modules/example/api/organizations/route.ts` | 4 | TEST-011 | AC-013 |

## Rollout, Migration, and Rollback

- Migrations are generated with `yarn db:generate`, reviewed line by line (scoped to `products_*` / `trade_docs_*`; no drops of existing objects), and applied **only after explicit approval** (`yarn db:migrate`). Never migrate to validate.
- Seeds: `products` adds its five product types through `seedDefaults` (idempotent insert-only). Existing tenants run `yarn mercato seed:defaults --module products`; role grants sync with `yarn mercato auth sync-role-acls`.
- Rollback: removing the module entry from `src/modules.ts` (or the module directory) removes its routes and pages at the next `yarn generate`; tables and rows persist. Within a phase, rollback is the previous commit plus `yarn generate`. Attachment files written by Phase 4 stay in the storage driver (no destructive cleanup).
- Observability: command audit rows (`audit_logs`) for every mutation, plus `clientBroadcast` events for list refresh. No new background process.
- Compatibility: no installed API/table/event is modified; both modules are additive. Everything the official chain reads (`catalog_products`) is untouched.

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| Two masters for the same product (`products` and `catalog`) | Confusion about which one a document references | Contracts reference `products` only; `catalog_product_id` link is documented in the module README and `docs/dev/business-architecture.md` | Reconciliation remains manual until a follow-up slice |
| Float rounding in money | A contract prints a value the invoice disagrees with | BigInt engine + unit tests pinned on `0.005`, `0.125`, `12.3456` | Accepted (tests fail loudly if someone reintroduces `toFixed`) |
| Invoice-authoritative per-line override | A wrong invoice silently moves `finance_total` | Only **confirmed** invoices count; `difference_total` is displayed; the line shows its source | Operator error; audit trail records who confirmed |
| Currency row missing (new organization) | Financial scale falls back to 2 | Fallback is explicit, clamped 0..8, and surfaced as a UI hint | A currency with ≠2 decimals could be mis-scaled until seeded |
| Broken category hierarchy data | Lists show wrong paths | Command-side rebuild after every create/update; cycle rejected; tree computed with the proven algorithm | Manual DB edits outside commands |
| Contract numbering race | Duplicate `PC-<year>-0001` | Unique constraint on `(tenant, org, number)` → 409; the command reads the max existing number inside the transaction | Two simultaneous issues: one gets 409 and retries |
| Attachment upload before/after binding | Orphan uploads | Binding is idempotent; the invoice row keeps its state and offers retry | Orphan files in storage |
| Template changes after Phase 4 | The generated document stops matching the company's paper | Columns live in `lib/contractTemplate.ts`; the spec records the open item | Regeneration needed after a template change |
| Scope creep into being an accounting system | Wrong long-term ownership | Non-goals: no ledger, no FX conversion, no tax | Accepted |

## Acceptance Criteria

- [x] **AC-001** — `products` and `trade_docs` register as `from: '@app'`; no installed file, generated file, or shipped migration is edited (verified by `git status` on those paths).
- [x] **AC-002** — Product types are seeded idempotently, unique per organization, and can be deleted only when unreferenced (422 otherwise).
- [x] **AC-003** — A three-level category tree rebuilds correct `ancestor_ids`/`descendant_ids`/`tree_path`/`depth`; a cycle attempt returns 422 with unchanged data.
- [x] **AC-004** — Products round-trip every field group (basic, export/packaging, lithium/certifications) and enforce a unique SKU per organization including soft-deleted rows.
- [x] **AC-005** — The three tiers round-trip through `PUT /api/products/prices`; removed rows are deactivated, not deleted.
- [x] **AC-006** — Contracts move only through `draft → issued → signed → closed` (cancel from `draft`/`issued` with a reason); invalid transitions return 422 with the state unchanged; numbers are `PC/SC-<year>-<4 digits>` and unique per organization.
- [x] **AC-007** — Contract lines snapshot the product; editing a product afterwards does not change an issued contract.
- [x] **AC-008** — Confirming an invoice bound to a contract line makes that line's financial amount the invoice amount; voiding reverts it; both are reflected in `finance_total` and `difference_total`.
- [x] **AC-009** — Amount tests pass exactly as specified (including `1 × 0.005 → 0.01` and `2.5 × 0.125 → 0.31`); no `toFixed` in `src/modules/trade_docs/**`.
- [x] **AC-010** — Every route has per-method `metadata` + `openApi`; every page has `page.meta.ts`; stale writes return 409; cross-organization access fails closed.
- [x] **AC-011** — zh and en strings exist for every new key; lists and forms cover loading/empty/error/conflict/permission-denied; narrow width has no horizontal overflow; `Cmd/Ctrl+Enter` submits.
- [x] **AC-012** — An invoice attachment uploads, binds, and downloads.
- [x] **AC-013** — A generated contract XLSX downloads with the XLSX content type, opens in a spreadsheet app, and its line amounts sum to the contract total.
- [x] **AC-015** — The product form leads with basics and the three price tiers, keeps the declaration fields on their own step, and `lib/formLayout.ts` is the single place a later field whitelist edits.
- [x] **AC-016** — The installed catalog's product/variant/category pages are absent from the admin navigation while the catalog module, its API and `config/catalog` stay enabled; no `node_modules` file changed.
- [x] **AC-017** — A purchase order line created through the UI stores `product_id` pointing at `products_products` plus a display snapshot; historical lines carrying only `catalog_product_id` still render and still sum correctly.
- [x] **AC-014** — `yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test && yarn build` passes for this change: generate ✓ (pre-existing OpenAPI-bundle fallback on Node 24), typecheck ✓, lint 0 errors, ds:check clean for `products/**` and `trade_docs/**` (the single remaining violation is in a concurrently developed module), `yarn test` 104 passed, `yarn build` exit 0.

## Final Compliance Report

| Check | Status | Evidence |
|---|---|---|
| Routed guides/skills reviewed | pass | `AGENTS.md`, `.ai/guides/{spec-delivery,backend-ui,contracts}.md`, `om-spec-writing`, `om-module-scaffold` |
| Data models, APIs, events, UI, tests internally consistent | pass | traceability rows; TEST-001…TEST-012 |
| Every workflow completes end to end without a catch-all phase | pass | J-001…J-004 mapped to Phases 1/2/4 |
| Platform-native reuse chosen before custom code | pass | Reuse and Ownership Map |
| UI contracts identify references, canonical components, theme/state coverage | pass | UI table + mockups + REQ-011 |
| Every phase has dependencies, slices, tests, value, exit gate | pass | Phases 0–4 |

Verdict: `Implemented` (Phases 0–6, verified end to end).

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-001 | Exact contract Excel sheet layout (merged header block, borders, column widths) matching the company's existing paper template | business | **no** | Phase 4 ships the layout defined by the constants in `lib/contractTemplate.ts` (header rows, line grid, totals row); when the company template is supplied, only that constant is replaced — the write path, command, route, and attachment storage do not change |
| Q-002 | Product batch import (needs an XLSX reader) | business + technical | **no** | resolved 2026-09-22: moved to [`.ai/specs/2026-09-22-supplier-quotation-import.md`](2026-09-22-supplier-quotation-import.md) — SheetJS reads `.xls`/`.xlsx`, lines land in an app-owned supplier quotation first and are promoted through `products.items.create|update` + `products.prices.replace`. This spec stays the owner of the master-data contract that promotion writes into |

## Changelog

| Date | Change |
|---|---|
| 2026-09-23 | **尺寸字段统一命名「产品尺寸」**（owner 口径：整箱数据已不维护，`dimensions` 就是产品自己的尺寸，不再叫「单件尺寸」）。`products.items.form.field.dimensions` 的 zh 改为 `产品尺寸`、en 改为 `Product size`；供应商产品库那张卡此前已从「内盒尺寸」改成 `产品尺寸（cm）` / `Product size L×W×H (cm)`，报价导入列映射的目标名也从「内箱尺寸」改成 `产品尺寸 (cm)` / `Product size (cm)`（alias 仍匹配工作簿表头的 `内箱尺寸` / `Inner Box`）。字段 id 与列名（`dimensions`、`innerPacking` / `inner_packing`）全部未动。 |
| 2026-09-23 | **整箱数据移除（owner 口径：采购只维护单件数据）.** The product master keeps the **unit** measurements and the units-per-carton figure only: `cartonDimensions` / `cartonGrossWeight` / `cartonNetWeight` left the entity, validator, command, API schema + serialization, the form (the 箱规尺寸 card and the 箱毛重/箱净重 inputs), `lib/formLayout.ts` and both i18n files; `dimensions`, `net_weight`, `gross_weight` and `carton_quantity` stay. The same change removed the whole-carton columns from the supplier product library and stopped both supplier→master mappers — `sourcing`'s `lib/productMapping.ts` and `purchasing`'s — from writing them. DB columns dropped by `Migration20260923065528_products` (down re-adds them). The columns are dropped by `Migration20260923065528_products` (applied to the dev database; `down` re-adds them). |
| 2026-09-23 | **合同文档标题改为跟随语言（owner 语言规则）. The contract template used to hard-code one bilingual label per cell (「合同号 Contract No.」). Every label is now a `trade_docs.contracts.print.*` key resolved by `resolveTranslations()` in `trade_docs.contracts.generate-document` and passed to `buildContractSheet(input, t)`; the archived XLSX keeps the language it was generated in. The two amount-word rows (人民币大写 + `SAY …`) stay: that pairing is the bank/customs convention for the amount, not a language pair. The seed dictionaries of this module lost their English glosses for the same reason (a dictionary label has no locale). Unit test `lib/__tests__/contractTemplate.test.ts` pins both a zh and an en render. |
| 2026-09-22 | Initial draft from the owner-approved plan: app-owned `products` (types, category tree, products, three price tiers with the optional official-catalog link) and app-owned `trade_docs` (purchase/sales contracts, inbound/outbound invoices, invoice archive), dual amount calibers in a BigInt engine, deferred Excel phase. Status `Ready for implementation`; Q-001 non-blocking (sheet layout constant). |
| 2026-09-22 | Implemented and verified. Both modules registered (`products`, `trade_docs`), migrations generated → reviewed → approved → applied (products 13 / trade_docs 16 statements, tables+indexes+foreign keys only). Unit tests: 62 across `products` and `trade_docs` (`money` pins `1 × 0.005 → 0.01`, `2.5 × 0.125 → 0.31`, `3 × 12.3456 → 37.04`, `3 × 1200.4` at scale 0 vs 2, and the stored-scale minor-unit regression for amount-in-words). API smoke: taxonomy + cycle 422, product/price guards, 409 conflicts, 403 without features, `PC-2026-0001` issued/signed/closed with 422 on illegal transitions, invoice confirm → `finance_total` 3601.14 with `difference_total` 0.06 and line source `invoice`, void → revert. Dual-caliber divergence proven live by quoting a 0-decimal currency (contract 3601.80 / finance 3602 / difference −0.20). Excel: generated, stored as an attachment, downloaded with the XLSX content type, and re-read with an independent spreadsheet reader (numeric amount cells; line amounts sum to the contract total). Browser pass covered the list/form/detail surfaces, an end-to-end invoice upload → confirm flow, `Ctrl+Enter` submit, dark theme and 420 px width. |
| 2026-09-22 | Phase 6 implemented and verified (owner chose option A). New app-owned module `internal_sales`: quote/order list, create and edit pages whose lines reference `products_products`; installed `sales` remains the engine underneath and only its catalog-bound create page is hidden. Two installed behaviours were discovered by reading the command layer and drove the design: `sales.*.update` never replaces lines (they live on their own collection endpoint), and every sales command locks the **parent document's** version while a line write bumps it — so exactly the head patch carries the operator's version, the form runs with `disableOptimisticLock`, and it re-reads the document after saving (without that, the operator's second save 409s). Verified end to end in the browser and in the database: a quote (2 × 55.50 → 111.00) and two orders (3 × 44.40, 6 × 63.25 after an edit) carry the owned product id, the frozen snapshot and the catalog default variant bridge; edits keep the same line id (upsert, no duplicate) and the head totals follow. A stale-closure bug in the async product picker was found and fixed while verifying (the row lost its product when a slow lookup resolved behind a second state write). |
| 2026-09-22 | Phase 5 implemented and verified. Stepped product form (3 steps, input survives switching, a rejected submit jumps to the offending step) with `lib/formLayout.ts` as the field/step seam. The installed catalog's product/variant/category pages are hidden through `routes.pages` overrides (`CATALOG` gone from the sidebar; module, API and `config/catalog` still enabled). Purchase order lines now reference `products_products` (migration applied: `product_id` uuid null added, `catalog_product_id` relaxed to nullable): verified new line `productId` + frozen snapshot, missing reference 400, foreign-organization product 400, historical catalog-only lines still rendering; the catalog link is written through the product form (UI pick + save confirmed by API) and also carries to the order line as the bridge so shipment allocation succeeds (201) — an unlinked product is refused at allocation with a message naming the fix (422). |
| 2026-09-22 | Owner review of the built surfaces added Phase 5 (REQ-015…017): the product form becomes step-based with `lib/formLayout.ts` as the future field-whitelist seam, the installed catalog's product/variant/category pages are hidden through registry page overrides, and purchase order lines are switched to reference `products_products` by id + snapshot (additive `product_id` column; `catalog_product_id` kept for historical rows). `sales` document lines stay on the catalog and are recorded as a non-goal. |
| 2026-09-22 | Currency-scale fallback surfaced: the contract list publishes `currencyScale` / `currencyScaleFallback` (read from `currencies.decimal_places`) and the detail page shows the hint when the scope has no currency row, so finance can tell a two-decimal fallback from the currency's own definition. |
| 2026-09-22 | Phase 3/4 surfaces verified: contract list/detail show the two calibers plus the difference, per-line `financeSource`, and CSV export carries `Contract Amount / Finance Amount / Difference`. Follow-up decided during the browser pass: pickers are narrowed with an explicit `organizationId` filter (reads expand to descendants, writes act in the selected organization) — recorded as a lesson. |
| 2026-09-22 | Q-002 resolved by moving product batch import out of this spec into [`.ai/specs/2026-09-22-supplier-quotation-import.md`](2026-09-22-supplier-quotation-import.md); the non-goal now points there. Owner approved the one new dependency (SheetJS `xlsx`) for that slice; this spec's own `buildXlsx` write path is unchanged |
| 2026-09-22 | REQ-016 corrected: the page-hide domain is `overrides.routes.pages`. The original top-level `pages` key was read by no applier — the catalog pages stayed routed and in the sidebar while `yarn generate` reported success. Mechanism and diagnosis recorded in `.ai/lessons/module-override-page-hide-needs-routes-domain.md`. The same fix extended the hide to `customers`/`sales`/`wms`/`currencies`/`dictionaries`/`feature_toggles` — 65 `navHidden: true` page overrides in total and **no** `null` page drops (the only `null` in `src/modules.ts` is the `catalog.injection.product-seo` widget), because official notifications freeze `linkHref` at emit time; see `docs/dev/business-architecture.md` → 自建模块对官方模块的消费清单 for what those pages' APIs are still used by |
| 2026-09-23 | Status → `Implemented (Phases 0–6)`. As-shipped deltas added: snake_case `/api/trade_docs/**` + `/api/products/**` paths, `transition`/`attach`/`generate-document` command families, the contract stamped-scan column and `contracts/attach` route, `routes.pages`+`navHidden` page hiding, variants in the same round. |
| 2026-09-23 | 商品表单步骤层重排（仅 UI，API/命令/实体未动）：步骤条换成 DS `StepIndicator`（编号、逐步可点、出错步标红）并移进 `CrudForm.contentHeader`（原先是一排普通按钮、浮在页面标题之上），每步末尾补「上一步/下一步」；声明类分组不再声明 `column: 2`（整步内容原本被画进 `3fr` 侧栏、左侧 `7fr` 全空），`packagingCarton`+`packagingCartonTail` 合并成有标题的「装箱与箱重」，官方目录链接改用与其它自绘区块一致的卡片；`scopeRequiredToStep` 让必填只在所属步骤生效，跨步提交改由 API 的 400 `path` 跳步并标红（原先客户端必填拦截在看不见的字段上触发，只弹一句「请修正标红的字段」而页面上没有任何标红）。实测：四步逐一截图、上一步/下一步、末步提交缺必填 → 跳到第 1 步并标红、完整记录提交 201 后回列表。 |
| 2026-09-23 | 术语定名（仅显示名，表/命令/API/feature/事件 id 全部未动）：**产品类型 → 产品线**、**产品类别 → 产品品类**，两页描述改为写清各自定义（产品线＝平铺标签、不参与层级；产品品类＝唯一层级）。业主提问「类型要不要做成树」的结论：不建树——该轴无行为、无下游读者，层级只在 `products_categories`。范围与依据见 [`.ai/specs/2026-09-23-product-taxonomy-consolidation.md`](2026-09-23-product-taxonomy-consolidation.md)；`products.types.manage` / `products.categories.manage` 与 `/api/products/types\|categories` 保持原样。 |
