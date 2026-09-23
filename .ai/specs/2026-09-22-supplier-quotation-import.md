# Supplier Quotation Import → Product Library (app-owned `sourcing` module)

**Date**: 2026-09-22
**Status**: Ready for implementation

## TLDR

Add an app-owned `sourcing` module that turns any supplier quotation workbook (legacy `.xls` BIFF8, `.xlsx`, or `.csv`) into a reviewed **supplier quotation** — `sourcing_quotes` + `sourcing_quote_lines` + reusable `sourcing_import_profiles` — and then promotes the selected lines into the app-owned product master (`products_products` + a `purchase`-tier `products_prices` row) through the existing `products.*` commands. Layout variance across suppliers is absorbed by an alias dictionary, a saved per-layout mapping profile, a downloadable standard template, and an optional AI mapping fallback. Reused platform capabilities: `attachments` (file storage), `attachments.attachmentService.readScoped` (server-side byte read), `makeCrudRoute` + the command bus + CRUD events/indexer/audit, `CrudForm`/`DataTable`/`FileUploadArea`, i18n catalogs, and the zero-dependency `buildXlsx` writer. The smallest coherent outcome: upload a PetKit quotation, review 69 lines, approve, promote 5 of them, and see 5 products with their CNY purchase prices.

## Problem Statement

The company buys from Petkit/agents and sells to its Russian subsidiary; product master data is app-owned in `products`. Today a product library can only be built one row at a time (the `products` module still ships no UI), or by hand-editing the supplier's spreadsheet and re-typing it into the system — the operator's actual workflow is "delete the rows we do not need, then copy the rest".

Two real files prove the pain and the variance:

- `PETKIT Quotation Sheet-2026_NEW.xlsx` — one sheet, 82 rows × 13 columns: letterhead rows 1–3, header row 4, data rows 5–81 (69 data rows + 6 category banner rows `FEEDING`/`CLEANING`/`GROOMING`/`FUN`/`SPORT`/`ACCESSORY`), 78 embedded product images, vertically merged variant rows, `/` placeholders, a `10 pallets` MOQ, and Item No. values that repeat inside the file (`P4108`, `P4116`, `P9906`, `PD10`, `P4113`, `P41161`, `PKCL10`).
- `订单表-2026 EXW.xls` — a WPS-written BIFF8 proforma invoice: 98 rows, two-row header at rows 9–10, 78 item rows at rows 11–88 with **no Item No. and no HS Code at all** (name + `CNY/PC` + carton `G.W.`/`N.W.`/`L`/`W`/`H`/`qty/box`), followed by `TOTAL`, `Subtotal with 3% MKT FEE`, `Subtotal with 2% Rebate for 2025`, payment terms and the supplier's bank account rows.

Evidence that this is a real gap in the current design, not an oversight to patch later: `.ai/specs/2026-09-22-products-and-trade-docs.md` lists "Product **batch import** (no XLSX *reader* exists in the repo; a CSV path is a separate slice)" as a non-goal and records Q-002 "Product batch import (needs an XLSX reader)" as deferred; `.ai/analysis/2026-09-21-business-model-reassessment.md` names `sync_excel` as the on-demand lever for "供应商价目表/商品批量"; and `.ai/specs/2026-09-21-purchasing-module.md` Q-P-004 resolved "no supplier price list — unit prices are entered per order", so a supplier quotation has nowhere to live today.

Affected users: the owner/procurement operator who builds the product library, and downstream consumers (`trade_docs` contracts, `platform_ops` channel flows) that need correct master data with prices and export/packaging fields.

## Overview and Success Measures

- **Primary outcome:** one Petkit quotation workbook becomes 5+ promoted products with `purchase`-tier CNY prices, MOQ ladders and carton/HS fields in under 10 minutes of operator time, with zero manual re-typing of prices.
- **Leading indicators:** imported line count per file; auto-mapping confidence distribution; lines requiring a manual SKU; promotion `created/updated/skipped/failed` counts; second import of the same layout skipping the mapping step (profile hit).
- **Baseline:** zero owned product rows; the product library is built by hand-editing spreadsheets; no supplier quotation record exists anywhere.
- **Market / product reference:** mid-market ERP/PIM import wizards (Odoo "Import" column-mapping dialog, Akeneo import profiles, NetSuite CSV import) — adopted: upload → detected column mapping with per-column confidence → saved mapping presets → row-level validation report → commit; rejected: automatic background folder watching, per-cell LLM extraction of whole sheets, and multi-sheet bulk splitting (none is required by this slice).

## Goals

- **REQ-001** — A supplier quotation is a first-class record: header (`supplier_id` + name snapshot, date, validity, currency, status `draft|approved|archived|cancelled`, source file/sheet/signature, actual mapping) with lines (item no., name, variant, derived SKU, HS code, description, unit, unit cost, suggested RSP, MOQ raw+quantity, carton quantity/cartons, unit net weight, carton gross/net weight, inner/outer packing, carton volume, raw source row, warnings, row status, selection, promotion result). Organization-private, soft-deleted, optimistic-locked.
- **REQ-002** — An operator uploads `.xls`, `.xlsx` or `.csv` through the platform attachment route and the server parses it (SheetJS) into quotation lines; unsupported/encrypted/unreadable workbooks fail with a readable error instead of producing an empty quotation.
- **REQ-003** — Header row, category banner rows and footer rows are detected automatically, and every source column is mapped to a target field with an explicit confidence (`exact`/`alias`/`fuzzy`/`none`); duplicate target assignments and unmapped columns are surfaced, and the operator can override any mapping.
- **REQ-004** — A confirmed mapping is saved as a reusable profile keyed by the sheet's layout signature, so the next file with the same layout imports with the mapping step pre-filled (and skipped when fully confident).
- **REQ-005** — The review surface shows every parsed line with per-row selection, inline correction of derived SKU / name / MOQ / unit cost / section, warning badges, and a comparison against the product's current `purchase` price (or "未建档").
- **REQ-006** — Derived SKUs follow one deterministic rule: the first row of an Item No. group keeps the Item No.; later rows get `-<variant token>` from the name difference (fallback `-2`, `-3`); rows without an Item No. fall back to a name slug and are flagged; every collision inside the file is suffixed and flagged.
- **REQ-007** — `approve` freezes a quotation: `draft → approved`, assigns the organization-unique number `SQ-<year>-<4 digits>`, snapshots the supplier name, validates the currency against the dictionary and requires at least one promotable line.
- **REQ-008** — `promote` turns selected lines into product master data through the `products.*` commands: create or update by SKU (never blanking existing non-null fields), merge the `purchase`-tier price row without deactivating the product's other tiers, create missing categories from section labels, isolate per-line failures, and be idempotent on a second run.
- **REQ-009** — A quotation can be created and filled by hand (no file), and its lines promote through the same path, so "build a product list manually" does not require a spreadsheet.
- **REQ-010** — A standard template (canonical bilingual headers + 3 example rows) downloads as XLSX; a workbook whose header row matches the template is recognized and imported without manual mapping.
- **REQ-011** — When the rule dictionary cannot confidently map the columns, an operator may request an AI mapping suggestion; the feature is off unless a model provider is configured, sends only the header row plus at most three sample rows after showing the exact payload, and never writes to the database by itself.
- **REQ-012** — The original workbook stays attached to the quotation, and every parsed line keeps its raw source row, so a re-parse with a different mapping loses nothing and the file can be deleted explicitly when it is no longer needed.

## Non-goals

- Multi-sheet batch import: one sheet per quotation in this slice; a workbook with several sheets is imported sheet by sheet.
- Extracting embedded product images (the PetKit workbook's 78 images) into product media.
- Promoting `Suggested RSP` (the product master has no retail-price field; the value stays on the quotation line).
- Scheduled/folder-based pulling of supplier files, and any mail-inbox ingestion.
- Wiring `purchasing` purchase orders to imported products (`purchasing_purchase_order_lines.catalog_product_id` still points at the installed `catalog`; switching that picker stays the deferred decision from the products spec).
- Whole-sheet AI extraction (per-row LLM parsing) — only the column mapping may be AI-assisted.
- Any automatic FX conversion: a quotation's price is stored in its own currency.

## Proposed Solution

A new app-owned module `sourcing` owns the supplier quotation lifecycle and the workbook-to-rows translation; the product master stays owned by `products` and is written only through its commands.

Flow: upload (existing attachment route) → server-side parse with SheetJS into a raw grid → structural detection (header/banner/footer/merges) → column mapping (saved profile → alias dictionary → optional AI) → normalized lines stored on a draft quotation → operator review (select/correct) → approve → promote selected lines through `products.items.create|update` + `products.prices.replace` (+ `products.categories.create`).

Why this is the smallest platform-native solution: it reuses the attachment store, the CRUD factory, the command bus with its events/indexer/audit, `CrudForm`/`DataTable`, i18n, and the zero-dependency XLSX writer; it adds exactly one dependency (the reader), one module, and three tables. The rejected alternatives are recorded below.

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| Supplier quotation as an app-owned intermediate layer | `products_prices` has no `supplier_id`, no quote date and no source-document link, and its uniqueness key is `(product, tier, currency, minQuantity)`; `purchasing` deliberately keeps no price list (Q-P-004), so quotation history and multi-supplier comparison have nowhere else to live | Import straight into `products` + `purchase` price | Loses the source workbook, the quote date and any chance to diff a newer quotation; also makes re-import indistinguishable from a first import |
| SheetJS `xlsx` 0.20.3 from the SheetJS CDN tarball | One dependency covers legacy BIFF8 `.xls` (the owner's real file), `.xlsx` and `.csv`; hand-rolled BIFF8 parsing is ~600 lines of RK/MULRK/SST-CONTINUE/merge handling where a misread silently corrupts prices | Zero-dependency `jszip` + hand-rolled OOXML reader; `exceljs`; enabling `sync_excel` + a `DataSyncAdapter` | `jszip` path cannot read `.xls` at all; `exceljs` is XLSX-only; `sync_excel` has a CSV-only parser, a closed `['customers.person']` entity enum inside `node_modules`, and `data_sync` resolves `progressService` while the `progress` module is not enabled in this app |
| Parse server-side, store parsed lines | Re-parsing with a different mapping is deterministic and auditable; the mapping request stays small; the AI key never reaches the browser; a 19 MB workbook never crosses the wire twice | Parse in the browser and post rows | Splits the parser into two implementations, makes re-mapping impossible after the tab closes, and blocks the server-side AI path |
| Promotion writes through the command bus | Product events, query-index updates, audit rows and optimistic locks are produced by the commands; direct inserts would silently skip all four | Insert `products_products` rows directly from the import | Bypasses audit/events/indexer; forbidden by the module-boundary rules |
| `products.prices.replace` called with the merged price set | The command replaces a product's whole price set and deactivates rows missing from the payload | A new "upsert one price row" command | Would add a public command to another module's contract for one caller; merging in the caller keeps `products` unchanged |
| Section banners become `products_categories`, not `products_types` | Banner text (`FEEDING`, `CLEANING`, …) is a product family/merchandising grouping, which is what the category tree models; `products_types` is the Petkit product family the operator curates by hand | Banner → `products_types` | Would collide with operator-curated type codes and leave categories empty |
| `sourcing.promote.run` requires `products.items.manage` + `products.prices.manage` via `dependsOn` | Promotion is a real product mutation; the ACL chain makes the dependency explicit instead of relying on the route gate alone | A single `sourcing.*` feature | Would let a sourcing-only role write product master data |
| AI mapping through `createModelFactory` + `generateObject` from the `ai` package | The library layer works while `ai_assistant` stays disabled, and matches the in-repo precedent (`warranty_claims/lib/aiAssist.ts`) | Enable `ai_assistant` and declare a module AI tool | Enabling the module registers chat routes/pages and AI tables for a single button; deferred until the app wants a general assistant |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| Supplier quotation | A supplier's offer of products at prices, valid at a point in time; identified by `SQ-<year>-<4 digits>` once approved | `sourcing_quotes` | Draft without number; approve assigns it; duplicate number → 409 |
| Quotation line | One offered product variant inside a quotation, carrying both normalized fields and the raw source row | `sourcing_quote_lines` | Invalid line stays in the quotation with `row_status='invalid'` and warnings; it never blocks the other lines |
| Layout signature | `sha256(sheetName + '\|' + normalized header cells joined by \u0001)` truncated to 16 hex chars; the key that identifies "same layout" for mapping profiles | `sourcing_import_profiles.layout_signature` | No profile match → alias dictionary; still ambiguous → operator mapping or AI |
| Section label | The banner row text that applies to following rows until the next banner (`FEEDING`, …); empty for sheets without banners | `sourcing_quote_lines.section_label` | On promotion it becomes a top-level product category (`code = slug(label)`); a label whose slug is empty is skipped with a warning |
| Derived SKU | The product identity a line would promote as: `Item No.` for the first row of an Item No. group, `Item No.-<VARIANT>` for later rows, name slug when the Item No. is missing | `sourcing_quote_lines.derived_sku` | Missing/too-short slug → `sku_required` warning and the line cannot be promoted until the operator types one |
| Promotable line | `selected = true`, `row_status = 'ready'`, `derived_sku` non-null, quotation `approved` | `sourcing_quote_lines` | Promotion returns 422 `quote_not_approved`, or per-line failures with the run continuing |
| Promotion idempotency | A line already carrying `promoted_product_id` is skipped; a product whose merged price set is unchanged is skipped | `sourcing_quote_lines.promoted_*` | Re-running promotion returns `skipped` counts and changes nothing |
| Non-null-wins update | Promotion never writes a null/empty value over an existing product field; only non-empty and different values are sent to `products.items.update` | promotion rules in `lib/productMapping.ts` | Existing master data cannot be blanked by an import |
| Currency | Quotation-level `currency_code`, optionally overridden per line; must be three uppercase letters and present in the currency dictionary | currency dictionary (`products/lib/currencyDictionary.ts` contract) | `currency_not_in_dictionary` at approve/promote; nothing is written |
| MOQ | `moq_raw` keeps the source text; `moq_quantity` is the leading integer, defaulting to 1 for the price row | `sourcing_quote_lines.moq_*` | `10 pallets` → quantity 10 + `moq_partial` warning; non-numeric with no leading digit → warning `moq_not_numeric`, quantity null → price row uses 1 |
| Row status | `staged` (parsed, unreviewed) → `ready` (validated) / `invalid` (blocked) / `skipped` (operator excluded) → `promoted` | `sourcing_quote_lines.row_status` | Illegal transitions are rejected by the commands; `promoted` is terminal except by an explicit re-parse of staged lines |
| Optimistic locking | Quotation header and lines carry `updated_at`; every edit submits it | entities + `enforceCommandOptimisticLock` | Stale version → 409 with the conflicting ids; nothing is overwritten |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| Procurement operator | Upload, parse, remap, review, approve, archive quotations; promote lines into products | Organization-private; `tenantId`/`organizationId` from the session, fail-closed | `sourcing.quotes.view`, `sourcing.quotes.manage`, `sourcing.import.run`, `sourcing.promote.run` |
| Product manager | Read quotations to understand where a product price came from | Same organization | `sourcing.quotes.view` |
| HQ administrator | All of the above across descendant organizations | ACL organization allow-list + descendant expansion (platform mechanism) | same features, granted at HQ |

Trusted scope: every command resolves `tenantId`/`organizationId` from the command context (`ensureScope`), never from the request body; the list/read routes filter by both columns. No system-scope (`organizationId: null`) row is created by this module — there is no installed contract that would authorize one. Cross-organization access fails closed (403 from the route gate, 404 when the id belongs to another organization).

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| Product master + prices | reuse | `products` | command bus: `products.items.create|update`, `products.prices.replace`, `products.categories.create`; reads `products_products`/`products_categories`/`products_prices` by id | The master already owns identity, hierarchy and the three price tiers |
| Suppliers | reuse | `purchasing` | id only (`supplier_id`) + name snapshot; option source for the picker | No cross-module ORM relation; the snapshot keeps history readable |
| File storage | reuse | `attachments` | `POST /api/attachments` (client) + `attachmentService.readScoped` (server) | The platform owns bytes, quotas, MIME checks and partitions |
| Excel writing (template) | reuse | `@open-mercato/core` `staff/lib/timesheets-reports/xlsx` | `buildXlsx` + `XLSX_CONTENT_TYPE` | Zero-dependency writer already in the framework |
| Excel/CSV reading | app-own (new dependency) | `sourcing` | `xlsx` (SheetJS) inside `lib/workbook.ts` | No reader exists anywhere in the repo or framework |
| AI model access | reuse | `@open-mercato/ai-assistant` library layer | `createModelFactory(container).resolveModel({ moduleId: 'sourcing' })` + `generateObject` from `ai` | Works without enabling the AI module; precedent in `warranty_claims/lib/aiAssist.ts` |
| CRUD/list/form shells, i18n, ACL, audit | reuse | platform | `makeCrudRoute`, `CrudForm`, `DataTable`, `Page`/`PageBody`, `FileUploadArea`, `useT`, `acl.ts`, command audit | Platform primitives; no parallel substitutes |
| Quotation lifecycle, mapping profiles, promotion policy | app-own | `sourcing` (new) | — | Nothing installed models a supplier quotation or its promotion into the master |

Installed records that remain the source of truth: `products_products`/`products_prices`/`products_categories` (master data), `purchasing_suppliers` (supplier identity), `attachments` (file bytes). This module never duplicates them; it stores ids and snapshots only.

## Architecture and Data Flow

```text
operator (browser)
  -> POST /api/attachments                        (attachments: bytes + partition)
  -> POST /api/sourcing/quotes                    (command sourcing.quotes.create)
  -> POST /api/sourcing/quotes/parse              (attachmentService.readScoped -> xlsx -> detect -> map -> lines)
  -> POST /api/sourcing/quotes/remap              (mapping/profile -> rebuild staged lines)
  -> PUT  /api/sourcing/quote-lines               (command sourcing.quote-lines.update-batch)
  -> POST /api/sourcing/quotes/approve            (draft -> approved, number SQ-<year>-<4>)
  -> POST /api/sourcing/quotes/promote            (command sourcing.quotes.promote)
        -> commandBus: products.categories.create   (missing section category)
        -> commandBus: products.items.create|update (SKU match, non-null wins)
        -> commandBus: products.prices.replace      (merged purchase row)
        -> events: sourcing.quote.promoted + products.item.* + audit + indexer
```

- **Module boundaries:** `sourcing` owns quotation state, parsing, mapping profiles and promotion policy; `products` keeps the master and its price invariants. They are separate because a quotation is valid and useful before any product exists, and because promotion must go through the product commands rather than share a transaction with them (per-line failure isolation is the requirement).
- **Extension points:** none added to installed modules. The module's own pages/commands are the only new surfaces; the product picker/supplier picker are read through existing routes.
- **Alternatives considered:** a single "import" module that also owns the product master (rejected: duplicates `products`), and a browser-only converter that exports a CSV for manual upload (rejected: no review, no audit, no profile reuse).
- **Compatibility:** no existing table, route, event or schema is modified. `products_prices` semantics (replace-whole-set) are respected by merging in the caller. `purchasing`'s picker and `trade_docs`' snapshots are untouched.

## User Journeys

### Journey J-001 — Import a PetKit quotation and promote part of it

1. Operator opens `/backend/sourcing/quotes` and clicks 导入 Excel.
2. System creates a draft quotation, the operator picks the workbook; the client uploads it to `/api/attachments` and calls `parse`.
3. Server parses, detects header row 4 and the six banners, maps 13 columns (12 mapped, `Picture` ignored), derives SKUs, and stores 69 staged lines; the wizard shows the mapping table with confidences.
4. Operator saves the mapping as a template, reviews the grid, unselects the rows that are not wanted (today's "delete rows" step, inverted), fixes one SKU, and clicks 确认报价单 → `SQ-2026-0001`.
5. Operator selects 5 lines and clicks 提升所选为商品; the response reports `created: 5`; the products list now shows 5 SKUs with CNY `purchase` prices and MOQ `min_quantity`.
6. Failure paths: an unreadable workbook → 422 with the file name and a "save as .xlsx" hint; a stale line edit → 409 conflict surfaced per row; a line whose SKU already exists as a soft-deleted product → that line fails with `sku_deleted` while the other four promote.

### Journey J-002 — Re-import the same layout next month

1. Operator uploads the new quotation; `layout_signature` matches the saved profile, so step 2 arrives pre-mapped (fully confident mappings skip the table).
2. The grid shows the new price next to the current `purchase` price for every SKU that already exists, with the delta.
3. Operator promotes the changed lines; existing products are updated, unchanged prices are reported as `skipped`.

### Journey J-003 — Build a product list without a spreadsheet

1. Operator clicks 新建报价单, fills supplier/date/currency, and adds lines by hand (item no., name, price, MOQ, carton data).
2. Lines go through the same review/approve/promote path, so manual entry and import converge on one promotion implementation.

### Journey J-004 — Standard template round trip

1. Operator clicks 下载标准模板, sends the XLSX to a supplier, and receives it filled in.
2. Uploading it is recognized as the template layout; the mapping step is skipped and the review grid opens directly.

## UI and Interaction Contracts

Closest installed references: page shell and list from `src/modules/purchasing/backend/purchasing/suppliers/page.tsx` + `src/modules/purchasing/components/SuppliersTable.tsx`; wizard/upload/mapping/review flow from the packaged `wms` module's `components/backend/ImportInventoryDialog.tsx` (upload → column mapping → review → validate/apply) and `sync_excel`'s `widgets/injection/upload-config/widget.client.tsx` (per-column target selects, diagnostics, saved session); upload call shape from `src/modules/purchasing/components/PurchaseOrderDetail.tsx`. Design rules: `.ai/guides/backend-ui.md` (invoked through `om-backend-ui-design`).

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/sourcing/quotes` | Quotation list; actions 导入 Excel, 新建报价单, 下载标准模板; row actions 打开, 删除 | `GET/POST/DELETE /api/sourcing/quotes`; `GET /api/sourcing/template` | `purchasing` suppliers list page + `SuppliersTable` | `Page`, `PageBody`, `DataTable`, `RowActions`, `Button`, `Dialog`, `FileUploadArea` | loading, empty, error, permission denied, conflict on delete | REQ-001, REQ-010 |
| `/backend/sourcing/quotes/create` | Manual quotation: header (`CrudForm`) + line editor (≤50 rows) | `POST /api/sourcing/quotes`, `POST /api/sourcing/quote-lines` | `purchasing` suppliers create page + `PurchaseOrderForm` line editor | `CrudForm`, `Page`, `PageBody`, `Select` (supplier option source) | loading, error, validation, permission denied | REQ-009 |
| `/backend/sourcing/quotes/[id]` | Review console: header summary, 3-step wizard (upload → mapping → review), line grid, 确认报价单, 提升所选为商品, 删除原始文件 | `POST /api/sourcing/quotes/{parse,remap,approve,promote,ai-mapping}`, `PUT /api/sourcing/quote-lines`, `GET /api/products/prices?priceTier=purchase` | `wms` `ImportInventoryDialog` (wizard steps) + `sync_excel` upload-config widget (mapping table) | `Page`, `PageBody`, `DataTable` (+`bulkActions` for row selection), `Dialog`, `Select`, `Badge`/`StatusBadge`, `FileUploadArea`, `Button` | loading, empty (no file yet / no lines), parsing, mapping, review, error, conflict (409 per row), AI unavailable, permission denied | REQ-002…REQ-008, REQ-011, REQ-012 |

Cross-record references: the supplier field is a `CrudForm` `select` backed by the purchasing suppliers option loader (`loadSupplierOptions` in `src/modules/purchasing/components/PurchaseOrderForm.tsx`) and stores `supplier_id`; the promoted-product column shows `SKU + name` read from the products list (display values, never raw ids); the current-price column is a lookup by `productId` over `/api/products/prices?priceTier=purchase`.

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| Procurement operator | 采购 → 报价单 (`sourcing.nav.group` = 采购, order after suppliers/orders) | none in this slice | login → 报价单列表 → 导入 Excel → 复核 → 确认 → 提升 (4 clicks, no typing except corrections) |
| Product manager | 采购 → 报价单 (read-only) | none | login → 报价单列表 → 打开 → 查看价格与来源文件 |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| Quotation list | "还没有报价单" + primary action 导入 Excel | table collapses to card rows at narrow width; toolbar wraps | focus starts on the toolbar; Enter opens the focused row |
| Wizard step 1 (upload) | "选择供应商报价 Excel（.xls / .xlsx / .csv）" + 下载标准模板 link | drop zone full width; file name wraps | drop zone is focusable; Enter/Space opens the file dialog; Esc closes the dialog |
| Wizard step 2 (mapping) | "已识别为标准模板格式（N/N 列）" when template-matched | mapping table scrolls horizontally, keeps the source column sticky | each select is tab-reachable in column order; Esc returns to step 1 |
| Wizard step 3 (review) | "没有解析到数据行：请检查表头行选择" | grid scrolls horizontally; selection column sticky | selection checkbox toggles with Space; ⌘/Ctrl+Enter approves; row-level 409 keeps focus on the edited cell |
| AI mapping block | disabled button + "AI 未配置：请在 .env 设置 OPENAI_API_KEY" | block stacks under the mapping table | the payload preview is a labelled read-only region; the send-headers-only switch is a labelled checkbox |

### `/backend/sourcing/quotes` — 报价单列表

```text
┌──────────────────────────────────────────────────────────────────────┐
│ 报价单                                    [下载标准模板][新建报价单][导入 Excel]│
│ 搜索: [____]   状态: [全部 ▾]   供应商: [全部 ▾]                       │
├──────────────────────────────────────────────────────────────────────┤
│ 单号 | 供应商 | 报价日期 | 币种 | 行数 | 已提升 | 状态 | 更新时间 | ⋯ │
│ SQ-2026-0001 | PETKIT | 2026-07-22 | CNY | 69 | 5 | 已确认 | … | ⋯ │
├──────────────────────────────────────────────────────────────────────┤
│ 第 1–20 条 / 共 N 条                                       [<] [>]     │
└──────────────────────────────────────────────────────────────────────┘
```

- **Behavior:** server-side pagination/sort/search (`quoteListSchema`); 打开 navigates to the review console; 删除 is confirm-dialog + optimistic-lock version header, allowed for `draft`/`cancelled` only; 导入 Excel opens the create dialog that chains create → upload → parse.
- **Responsive and accessibility:** the table becomes stacked rows under `md`; the toolbar wraps; every action has a translated label and an `aria-label`; status renders through `StatusBadge`.
- **Localization:** `sourcing.quotes.page.*`, `sourcing.quotes.list.*`, `sourcing.quotes.actions.*`, `sourcing.common.*` in `src/modules/sourcing/i18n/{zh,en}.json`.
- **Design-system and theming:** `Page`/`PageBody`/`DataTable`/`Button`/`Badge` only; semantic tokens, verified in light and dark and at narrow width; no raw `<table>`, no arbitrary Tailwind values, no inline styles.

### `/backend/sourcing/quotes/[id]` — 复核台 (review console)

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ SQ-2026-0001 · PETKIT · 2026-07-22 · CNY · 69 行 · 已提升 5   [确认报价单] │
│ 来源: PETKIT Quotation Sheet-2026_NEW.xlsx · 工作表 Sheet1 · [删除原始文件]│
├──────────────────────────────────────────────────────────────────────────┤
│ ① 上传  ② 映射（已保存模板: Petkit 2026）  ③ 复核            [下一步]     │
├──────────────────────────────────────────────────────────────────────────┤
│ 源列                     → 目标字段            置信度                     │
│ Item No.                 → 货号 SKU            exact                     │
│ Item No.& Name           → 品名                alias                     │
│ Picture                  → （忽略）            ignored                   │
│ … 13 列，2 处重复目标，0 列未映射            [AI 识别] [保存为模板]        │
├──────────────────────────────────────────────────────────────────────────┤
│ ☑ | 行 | 分类 | 货号 | 品名 | SKU(可改) | HS | 箱规 | 单价 | MOQ | 现采购价/差异 | 状态 | 告警│
│ ☑ | 5  | —   | P4108 | Eversweet 3 Pro | P4108 | 8421… | 46.5*46.5*40 | 230 CNY | 500 | 230（无变化） | 就绪 | —  │
│ ☑ | 6  | —   | P4108 | Eversweet 3 Pro-UVC | P4108-UVC | … | … | 270 CNY | 500 | 未建档 | 就绪 | —  │
├──────────────────────────────────────────────────────────────────────────┤
│ 已选 5 / 69 · [标记跳过] [提升所选为商品]                     [保存修改]    │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Behavior:** step 1 creates the draft + uploads + parses; step 2 shows the mapping table (per-column target `Select`, confidence badge, duplicate-target diagnostics, AI block) and re-derives lines through `remap`; step 3 shows the line grid where `derivedSku`, `productName`, `moqQuantity`, `unitCost`, `sectionLabel` are inline-editable and saved in one batch (≤200 rows) with the rows' `updatedAt`; a 409 is surfaced per row with the conflicting ids and the grid refreshes that row; 确认报价单 is disabled while any selected line is `invalid`; 提升所选为商品 is disabled unless the quotation is `approved`; Esc closes the wizard dialog and resets the session, ⌘/Ctrl+Enter confirms the current step.
- **Responsive and accessibility:** the grid keeps the selection column and the SKU column sticky while scrolling horizontally; warnings are text (not colour alone) with `title`/`aria-describedby`; focus moves to the first invalid cell after a failed save; status changes are announced through the platform flash region.
- **Localization:** `sourcing.wizard.*`, `sourcing.mapping.*`, `sourcing.lines.*`, `sourcing.promote.*`, `sourcing.errors.*`.
- **Design-system and theming:** `DataTable` with `bulkActions` provides the selection column (no raw table); `Dialog` for the wizard; `FileUploadArea` for the drop zone; semantic tokens only; light/dark and narrow width verified.

## Data Models

### `sourcing_quotes`

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | uuid, required | PK | no | immutable |
| `tenant_id`, `organization_id` | uuid, required | `sourcing_quotes_scope_idx` | no | trusted context only |
| `number` | text, nullable | unique `(tenant, org, number)` | no | assigned by `approve` as `SQ-<year>-<4 digits>`; never reused |
| `supplier_id` | uuid, nullable | index | no | id into `purchasing_suppliers`; validated same-org at approve |
| `supplier_name_snapshot` | text, nullable | — | no | frozen at approve |
| `quote_date`, `valid_until` | date, nullable | — | no | operator-editable while draft |
| `currency_code` | text, default `'CNY'` | — | no | three uppercase letters + currency-dictionary check at approve |
| `status` | text, default `'draft'` | index | no | `draft` \| `approved` \| `archived` \| `cancelled`, command-driven only |
| `source_kind` | text, default `'excel_import'` | — | no | `excel_import` \| `manual` |
| `source_attachment_id` | uuid, nullable | — | no | attachment id (no cross-module ORM relation) |
| `source_file_name`, `source_sheet_name` | text, nullable | — | no | display only |
| `source_layout_signature` | text, nullable | index | no | see layout signature rule |
| `header_row_index` | integer, nullable | — | no | 0-based |
| `column_map`, `section_rules` | jsonb, nullable | — | no | the mapping actually used; enables deterministic re-parse |
| `source_profile_id` | uuid, nullable | — | no | profile that matched, if any |
| `line_count`, `promoted_count` | integer, default 0 | — | no | derived counters, recomputed by the commands |
| `notes` | text, nullable | — | no | operator free text |
| `approved_at` | timestamptz, nullable | — | no | set by approve |
| `created_by` | uuid, nullable | — | no | actor id |
| `created_at`, `updated_at` | timestamptz, required | version | no | `updated_at` is the optimistic-lock version |
| `deleted_at` | timestamptz, nullable | — | no | soft delete, only from `draft`/`cancelled` |

### `sourcing_quote_lines`

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id`, `tenant_id`, `organization_id` | uuid, required | scope index | no | trusted context only |
| `quote_id` | uuid, required | unique `(quote, line_number)`; `@ManyToOne` cascade | no | same-module relation only |
| `line_number` | integer, required | unique part | no | 1..n assigned by the parse/remap command |
| `source_row_number` | integer, nullable | — | no | 0-based source row for reconciliation |
| `section_label` | text, nullable | — | no | banner text |
| `item_no`, `product_name`, `variant_label` | text, nullable | — | no | supplier values + the extracted variant token |
| `derived_sku` | text, nullable | index | no | required for promotion; 1..64 of `[A-Za-z0-9._\-/]` |
| `hs_code`, `description`, `unit` | text | — | no | `unit` default `'PCS'` |
| `unit_cost` | numeric(18,6), nullable | — | no | ≥ 0 |
| `currency_code` | text, nullable | — | no | line-level override of the header currency |
| `suggested_rsp` | numeric(18,6), nullable | — | no | kept on the line; never promoted |
| `moq_raw`, `moq_quantity` | text / integer, nullable | — | no | raw text preserved; quantity ≥ 1 when present |
| `carton_quantity`, `cartons` | integer, nullable | — | no | ≥ 0 |
| `unit_net_weight`, `carton_gross_weight`, `carton_net_weight` | numeric(16,4), nullable | — | no | kg, ≥ 0 |
| `inner_packing`, `outer_packing` | jsonb, nullable | — | no | `{length,width,height,unit:'cm'}` normalized to cm |
| `carton_volume` | numeric(16,6), nullable | — | no | m³, ≥ 0 |
| `raw` | jsonb, required | — | no | source row keyed by original header; nothing is lost |
| `warnings` | jsonb, default `'[]'` | — | no | `sku_required`, `sku_from_name`, `duplicate_sku_in_file`, `moq_partial`, `moq_not_numeric`, `section_slug_empty`, `merged_continuation` |
| `row_status` | text, default `'staged'` | index | no | `staged` \| `ready` \| `invalid` \| `skipped` \| `promoted` |
| `selected` | boolean, default true | — | no | review selection |
| `promoted_product_id`, `promoted_price_id` | uuid, nullable | — | no | promotion result ids |
| `promoted_at` | timestamptz, nullable | — | no | set with the ids |
| `created_at`, `updated_at` | timestamptz, required | version | no | optimistic-lock version for line edits |

### `sourcing_import_profiles`

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id`, `tenant_id`, `organization_id` | uuid, required | PK / scope | no | trusted context only |
| `name` | text, required | — | no | operator-provided label |
| `supplier_id` | uuid, nullable | — | no | hint only, not part of uniqueness |
| `layout_signature` | text, required | unique `(tenant, org, layout_signature)` | no | re-saving the same layout overwrites the profile |
| `sheet_name` | text, nullable | — | no | recorded for readability |
| `header_row_index` | integer, required | — | no | 0-based |
| `column_map` | jsonb, required | — | no | `{targetField: {sourceIndex, sourceHeader}}` |
| `section_rules`, `field_options` | jsonb, nullable | — | no | `{useSections, categoryFromSection}`, `{brand, unit, defaultCurrency}` |
| `built_in` | boolean, default false | — | no | reserved for the standard template profile |
| `usage_count`, `last_used_at` | integer / timestamptz | — | no | bumped on each successful parse |
| `created_at`, `updated_at` | timestamptz, required | — | no | — |

Migration: one generated migration adding these three tables. No existing table, column, index or constraint is touched. Soft delete applies to quotations only; lines cascade with their quotation; profiles are hard-deleted.

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| `GET/POST/PUT/DELETE` | `/api/sourcing/quotes` | `sourcing.quotes.view` / `.manage` | `quoteListSchema`, `quoteCreateSchema`, `quoteUpdateSchema` (+`updatedAt`) | list / 201 `{id}` / 200 `{ok:true}` + `sourcing.quote.created|updated|deleted` | 400 validation, 403, 404 cross-org, 409 stale version or duplicate number | REQ-001, REQ-007 |
| `GET` | `/api/sourcing/quotes/[id]` | `sourcing.quotes.view` | path id | `{quote, lines summary, promotion counts}` | 403, 404 | REQ-001 |
| `POST` | `/api/sourcing/quotes/parse` | `sourcing.import.run` | `quoteParseSchema {quoteId, attachmentId, sheetName?, headerRowIndex?, profileId?}` | `{sheets, structure, columns, duplicateTargets, lineCount, warnings, profileId?}` + `sourcing.quote.updated` | 422 `unreadable_workbook`, 422 `attachment_missing`, 409 when lines were already promoted | REQ-002, REQ-003, REQ-004 |
| `POST` | `/api/sourcing/quotes/remap` | `sourcing.import.run` | `quoteRemapSchema {quoteId, sheetName, headerRowIndex, columnMap, sectionRules?, saveProfile?, profileName?}` | same shape as parse + `profileId` when saved | 422 unknown target field, 409 promoted lines present | REQ-003, REQ-004 |
| `POST` | `/api/sourcing/quotes/ai-mapping` | `sourcing.import.run` | `aiMappingSchema {quoteId, sheetName?, headerRowIndex?}` | `{columns, notes?, provider, model}` | 503 `ai_not_configured`, 504 `ai_timeout`, 502 `ai_failed` | REQ-011 |
| `GET` | `/api/sourcing/ai-status` | `sourcing.quotes.view` | — | `{available, provider, model}` | 401/403 | REQ-011 |
| `PUT` | `/api/sourcing/quote-lines` | `sourcing.quotes.manage` | `quoteLinesBatchUpdateSchema {quoteId, rows[≤200] {id, updatedAt, selected?, derivedSku?, productName?, moqQuantity?, unitCost?, sectionLabel?}}` | `{updated, conflicts[]}` + `sourcing.quote_line.updated` | 409 with conflicting line ids, 422 invalid SKU pattern | REQ-005, REQ-006 |
| `POST/PUT/DELETE` | `/api/sourcing/quote-lines` | `sourcing.quotes.manage` | `quoteLineCreateSchema` / `quoteLineUpdateSchema` / `{id, updatedAt}` | 201 / 200 `{ok:true}` | 400, 403, 404, 409 | REQ-009 |
| `GET` | `/api/sourcing/quote-lines` | `sourcing.quotes.view` | `quoteLineListSchema {quoteId, page, pageSize, status?}` | paged list | 403, 404 | REQ-005 |
| `POST` | `/api/sourcing/quotes/approve` | `sourcing.quotes.manage` | `{id, updatedAt}` | `{number, status}` + `sourcing.quote.approved` | 422 `no_ready_lines`, 422 `currency_not_in_dictionary`, 409 illegal state | REQ-007 |
| `POST` | `/api/sourcing/quotes/archive` | `sourcing.quotes.manage` | `{id, updatedAt}` | `{status}` + `sourcing.quote.archived` | 409 illegal state | REQ-007 |
| `POST` | `/api/sourcing/quotes/promote` | `sourcing.promote.run` (+`products.items.manage`, `products.prices.manage` via `dependsOn`) | `promoteSchema {quoteId, lineIds?[≤500], force?}` | `{created, updated, skipped, failed[{lineId, lineNumber, message}]}` + `sourcing.quote.promoted` | 422 `quote_not_approved`, per-line failures isolated, 409 concurrent promotion | REQ-008 |
| `GET` / `DELETE` | `/api/sourcing/import-profiles` | `sourcing.quotes.view` / `.manage` | `importProfileListSchema` / `{id}` | list / 200 `{ok:true}` | 403, 404 | REQ-004 |
| `GET` | `/api/sourcing/template` | `sourcing.import.run` | — | XLSX stream (`XLSX_CONTENT_TYPE`, `Content-Disposition: attachment`) | 401/403 | REQ-010 |

Route mechanics: the list/CRUD surface uses `makeCrudRoute` with `actions.create.commandId = 'sourcing.quotes.create'`; every other route is a hand-written guarded route that builds its command context (`createRequestContainer` + `getAuthFromRequest` + `resolveOrganizationScopeForRequest`) and executes a registered command through the command bus. Every route file exports per-method `metadata` (`requireAuth: true` + `requireFeatures`) and an `openApi` document. Idempotency: `parse`/`remap` replace only `staged` lines and refuse when promoted lines exist; `promote` skips already-promoted lines and unchanged price sets. Optimistic locking: quote and line mutations require the row's `updatedAt` and fail 409 with the conflicting ids.

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| `sourcing.quote.created` | `sourcing.quotes.create` | quotation list (`clientBroadcast`) | list refresh | not retried; audit row via the command |
| `sourcing.quote.updated` | parse/remap/header update | review console | re-render of steps | idempotent by construction (full replace of staged lines) |
| `sourcing.quote.approved` | `sourcing.quotes.approve` | list + audit | number assigned | rejected when already approved |
| `sourcing.quote.promoted` | `sourcing.quotes.promote` | list + audit | promotion counters | per-line idempotency; a re-run reports `skipped` |
| `sourcing.quote_line.updated` | batch line edit | review console | row refresh | 409 on stale version |
| `products.item.created|updated`, `products.prices.updated`, `products.category.created` | `products.*` commands invoked by promotion | platform indexer/audit, product pages | product master + search index | produced by the framework; per-line failure is caught and reported, never retried automatically |
| `sourcing.quote.archived|deleted` | archive/delete commands | list | soft delete | only from `draft`/`cancelled` |

No scheduled job, queue worker, notification or cache entry is added in this slice. Progress reporting is not needed: parse/remap/promote are bounded synchronous requests (≤ 25 MB workbook, ≤ 200 lines per batch, ≤ 500 lines per promotion) and return their counts in the response.

## Security, Privacy, and Compliance

- **Authorization:** feature-gated routes only (`sourcing.quotes.view|manage`, `sourcing.import.run`, `sourcing.promote.run` with `dependsOn` on `products.items.manage`/`products.prices.manage`); never a role-name check. Feature ids are declared in `acl.ts` and granted through `setup.ts` defaults.
- **Tenant isolation:** every command derives `tenantId`/`organizationId` from the command context via `ensureScope`; every read filters both columns; attachment reads use `attachmentService.readScoped` with `expectedOwner: { entityId: 'sourcing:sourcing_quote', recordId: quoteId }` so a foreign attachment id cannot be read. Cross-organization ids return 404.
- **Sensitive data:** supplier cost data is commercially sensitive but not personal data; it is not encrypted at rest in this slice (no encryption map is declared) and never leaves the deployment except through the explicit AI mapping action, which sends only the header row plus at most three sample rows after the operator sees the exact payload. No secret is logged; parse errors carry the file name and a reason code, never cell contents of other organizations.
- **Abuse and failure modes:** workbook size is bounded by the attachment limit (25 MB) and rows by a hard cap of 20 000 per sheet; the parse path never evaluates formulas (raw cached values only) and never follows external links; sheet/cell text is rendered as text (no HTML injection); repeated promotion is idempotent; concurrent edits surface 409 instead of overwriting; deleting the source file is an explicit action.

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | integration | tenant + org + superadmin session; real `PETKIT Quotation Sheet-2026_NEW.xlsx`; `CNY` in the currency dictionary | create quote → upload attachment → `parse` → `remap` with saved profile → `approve` → `promote` 5 lines | 69 parsed lines, header row 3, 6 sections, `P4108`→`P4108`/`P4108-UVC`, `SQ-2026-0001`, `created:5`, 5 products with CNY `purchase` prices and `min_quantity=MOQ`; second `promote` returns all `skipped` | REQ-002…REQ-008 |
| TEST-002 | security | second organization + a session without `sourcing.import.run` | read/write a foreign quotation id; call `parse`/`promote` without the feature; read a foreign attachment id | 403/404 fail-closed, no data leak, no partial write | REQ-001, REQ-008 |
| TEST-003 | UI | one draft quotation with mixed warnings + one approved quotation | wizard steps in zh/en: empty, parsing, mapping with duplicate targets, review with `sku_required`, 409 conflict on a stale row edit, AI unavailable state | observable states, keyboard (Esc, ⌘/Ctrl+Enter, Space on checkbox), narrow width, light + dark | REQ-005, REQ-011 |
| TEST-004 | unit | literal fixtures copied from both real files + synthesized `.xls`(biff8)/`.xlsx` workbooks | `readWorkbook`, `detectStructure`, `detectColumnMappings`, `normalizeCell`, `deriveLineSkus` | header/banner/footer detection, merge expansion, `/`→null, `46.5*46.5*40cm` and `0.465*0.465*0.4` → `58/39.5/45.5 cm`, `10 pallets` → 10 + warning, variant suffixing, in-file collision suffixing | REQ-002, REQ-003, REQ-006 |
| TEST-005 | integration | product with `internal` + `export` price rows and a soft-deleted SKU | promote a line whose SKU exists (price changed) and a line whose SKU is soft-deleted | existing tiers survive (not deactivated), changed `purchase` row updated, soft-deleted SKU line fails with `sku_deleted`, other lines unaffected | REQ-008 |
| TEST-006 | unit | `promoteLines` with a mocked command bus failing for one line | run promotion over three lines, one failing | `created:1, updated:1, failed:1`; failing line keeps `row_status='invalid'` + warning; the other two are `promoted` | REQ-008 |
| TEST-007 | integration | configured model factory absent (no provider env) | `GET /api/sourcing/ai-status`; `POST /api/sourcing/quotes/ai-mapping` | `{available:false}`; 503 `ai_not_configured`; no DB write; UI button disabled | REQ-011 |
| TEST-008 | integration | — | `GET /api/sourcing/template`, then import the downloaded file | `XLSX_CONTENT_TYPE`, non-empty body, header row matches `TEMPLATE_HEADERS`, second import recognizes the template and maps all columns `exact` | REQ-010 |
| TEST-009 | migration | worktree copy of the repo | `yarn db:generate` | SQL adds only the three `sourcing_*` tables; no drop/alter of existing tables; reversible | REQ-001 |

## Implementation Phases

Phases are dependency ordered; only the current phase enters implementation.

### Phase 0 — Spec and ownership documents

- **Depends on:** none
- **Outcome:** this spec plus the documentation rows that record the new module and its ownership.
- **Why this order / value delivered:** the repository's spec-first gate; the products spec's deferred Q-002 becomes a decided, implemented capability.
- **Deliverables:** `.ai/specs/2026-09-22-supplier-quotation-import.md`, updated `.ai/specs/2026-09-22-products-and-trade-docs.md` (non-goal + Q-002 rows point here), `docs/dev/business-architecture.md`, `docs/prd/cross-border-erp.md`, `docs/plans/cross-border-erp.md`, one `.ai/lessons/` record if a durable rule emerged.
- **Independent slices / estimated commits:** spec; docs; lessons.
- **Requirements closed:** — (documentation gate)
- **Tests:** —
- **Validation:** spec sections complete; `node scripts/check-lessons.mjs` when a lesson is added.
- **Exit gate:** spec status `Ready for implementation`, no blocking open question, docs reference the module.

### Phase 1 — Parsing, detection, mapping and SKU library

- **Depends on:** Phase 0
- **Outcome:** a pure, tested library that turns a workbook buffer into normalized lines with an explicit mapping and SKU proposals.
- **Why this order / value delivered:** everything else consumes it, and it is the only part with a new dependency; it can be verified against the two real files before any schema exists.
- **Deliverables:** `package.json` (`xlsx` 0.20.3 CDN tarball), `src/modules/sourcing/lib/{workbook,headerDetection,fieldAliases,columnMapping,valueNormalization,skuDerivation}.ts`, unit tests with literal fixtures from both real files plus synthesized `.xls`/`.xlsx` workbooks.
- **Independent slices / estimated commits:** (a) dependency + `workbook.ts`; (b) `headerDetection.ts` + `fieldAliases.ts` + `columnMapping.ts`; (c) `valueNormalization.ts` + `skuDerivation.ts` + tests.
- **Requirements closed:** REQ-002 (library half), REQ-003, REQ-006
- **Tests:** TEST-004
- **Validation:** `npx jest --config jest.config.cjs src/modules/sourcing`, `yarn typecheck`, `yarn lint`; one-off node check against both real files.
- **Exit gate:** the real PetKit workbook yields header row 3, 6 sections, 69 data rows; the real `.xls` yields sheet `形式发票`, header row 9, 78 data rows with footer rows excluded.

### Phase 2 — `sourcing` module: entities, commands, routes

- **Depends on:** Phase 1 exit gate
- **Outcome:** quotations can be created, parsed, remapped, edited, approved, archived and listed through the API with scope, ACL, audit and events.
- **Why this order / value delivered:** the review console and promotion both need persisted lines; this is the first slice that a user can exercise end to end through the API.
- **Deliverables:** `src/modules/sourcing/{index,acl,events,setup,README}.ts|md`, `data/{entities,validators}.ts`, `commands/{quotes,quoteLines,profiles}.ts`, `api/**/route.ts`, `api/openapi.ts`, migration (generated → reviewed → approved), registration in `src/modules.ts`, `yarn generate`.
- **Independent slices / estimated commits:** (a) skeleton + entities + validators + migration; (b) quote commands + routes; (c) parse/remap commands + profile persistence; (d) line commands + batch edit.
- **Requirements closed:** REQ-001, REQ-003, REQ-004, REQ-007, REQ-012
- **Tests:** TEST-001 (API half), TEST-002, TEST-009
- **Validation:** `yarn db:generate` (review) → approved `yarn db:migrate` → `yarn generate`, `yarn typecheck`, `yarn lint`, focused jest, API smoke.
- **Exit gate:** create → upload → parse → remap → approve works with 69 lines and `SQ-2026-0001`; cross-org and missing-feature calls fail closed; migration contains only the three tables.

### Phase 3 — Promotion into the product master

- **Depends on:** Phase 2 exit gate
- **Outcome:** selected lines become products with merged `purchase` prices, created categories, per-line failure isolation and idempotent re-runs.
- **Why this order / value delivered:** this is the business outcome — the product library actually gets built.
- **Deliverables:** `lib/productMapping.ts`, `lib/promotion.ts`, `sourcing.quotes.promote` command + route + event, tests.
- **Independent slices / estimated commits:** (a) mapping + promotion service; (b) command/route/event; (c) tests incl. price merge and soft-deleted SKU.
- **Requirements closed:** REQ-008
- **Tests:** TEST-005, TEST-006
- **Validation:** focused jest, API smoke against a live database (products tables present), `yarn typecheck`.
- **Exit gate:** 5 lines promote to 5 products with CNY `purchase` rows and MOQ `min_quantity`; a second promotion reports `skipped`; a product's `internal`/`export` prices survive.

### Phase 4 — Review console UI

- **Depends on:** Phase 3 exit gate
- **Outcome:** the operator imports, reviews and promotes entirely in the browser, in zh and en.
- **Why this order / value delivered:** the API is usable only by hand until this lands; the review grid replaces the "delete rows in Excel" workflow.
- **Deliverables:** `backend/sourcing/quotes/{page,create,[id]}` + `page.meta.ts`, `components/{QuotesTable,QuoteWizard,ColumnMappingTable,QuoteLinesGrid,ManualQuoteForm}.tsx`, `i18n/{zh,en}.json`.
- **Independent slices / estimated commits:** (a) list page + table + create dialog; (b) wizard steps 1–2 (upload + mapping + AI block); (c) review grid + line edit + approve/promote actions; (d) manual create page + i18n.
- **Requirements closed:** REQ-005, REQ-009, REQ-010 (UI half), REQ-011 (UI half)
- **Tests:** TEST-003
- **Validation:** `yarn ds:check`, focused jest, browser pass (zh/en, narrow width, keyboard, light/dark).
- **Exit gate:** a full import → review → approve → promote run happens in the browser with no console errors and no ds:check violation.

### Phase 5 — Standard template and AI mapping

- **Depends on:** Phase 4 exit gate
- **Outcome:** suppliers can be handed a standard template that imports without mapping, and unknown layouts can get an AI-assisted mapping proposal.
- **Why this order / value delivered:** both are accelerators on top of a working pipeline; neither is needed to import the owner's two files.
- **Deliverables:** `GET /api/sourcing/template` (via `buildXlsx`), template-header recognition in `columnMapping.ts`, `lib/aiMapping.ts`, `POST /api/sourcing/quotes/ai-mapping`, `GET /api/sourcing/ai-status`, docs note on the AI data boundary.
- **Independent slices / estimated commits:** (a) template endpoint + recognition; (b) AI service + routes + UI wiring.
- **Requirements closed:** REQ-010, REQ-011
- **Tests:** TEST-007, TEST-008
- **Validation:** focused jest + API smoke; AI path exercised only for the not-configured branch.
- **Exit gate:** the downloaded template re-imports with every column `exact`; `ai-status` reports unavailable and the mapping endpoint returns 503 without writing anything.

### Phase 6 — Documentation and verification

- **Depends on:** Phase 5 exit gate
- **Outcome:** the change ships with its documentation, a green validation gate and recorded evidence.
- **Deliverables:** `src/modules/sourcing/README.md` contract section, spec Final Compliance Report + Changelog, `docs/dev/` AI boundary note, removed one-off scripts.
- **Requirements closed:** all (verification)
- **Tests:** TEST-001…TEST-009 re-run
- **Validation:** `yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test && yarn build`
- **Exit gate:** full gate green; both real files verified against the recorded truth; browser evidence recorded.

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-001, J-003, `/backend/sourcing/quotes` | `sourcing_quotes`, `sourcing_quote_lines`, `/api/sourcing/quotes` | Phase 2 | TEST-001, TEST-002, TEST-009 | AC-001 |
| REQ-002 | J-001 | `/api/sourcing/quotes/parse`, `lib/workbook.ts` | Phase 1, Phase 2 | TEST-001, TEST-004 | AC-002 |
| REQ-003 | J-001, wizard step 2 | `/api/sourcing/quotes/{parse,remap}`, `lib/columnMapping.ts` | Phase 1, Phase 2 | TEST-004 | AC-003 |
| REQ-004 | J-002 | `sourcing_import_profiles`, `remap` `saveProfile` | Phase 2 | TEST-001 | AC-004 |
| REQ-005 | J-001, review grid | `PUT /api/sourcing/quote-lines`, `GET /api/products/prices` | Phase 4 | TEST-003 | AC-005 |
| REQ-006 | J-001 | `lib/skuDerivation.ts`, `derived_sku` | Phase 1 | TEST-004 | AC-006 |
| REQ-007 | J-001 | `sourcing.quotes.approve`, `number` | Phase 2 | TEST-001 | AC-007 |
| REQ-008 | J-001, J-002 | `sourcing.quotes.promote` → `products.*` commands | Phase 3 | TEST-001, TEST-005, TEST-006 | AC-008, AC-009 |
| REQ-009 | J-003 | `/backend/sourcing/quotes/create`, `sourcing.quote-lines.create` | Phase 4 | TEST-003 | AC-010 |
| REQ-010 | J-004 | `GET /api/sourcing/template`, `TEMPLATE_HEADERS` | Phase 5 | TEST-008 | AC-011 |
| REQ-011 | J-001, AI block | `/api/sourcing/{ai-status,quotes/ai-mapping}`, `lib/aiMapping.ts` | Phase 5 | TEST-007 | AC-012 |
| REQ-012 | J-001 | `raw` jsonb, `source_attachment_id`, 删除原始文件 | Phase 2 | TEST-001 | AC-013 |

## Rollout, Migration, and Rollback

- Migration is generated with `yarn db:generate`, reviewed (must contain only the three `sourcing_*` tables, no drop/alter of existing objects) and applied only after approval; the module is registered in `src/modules.ts` followed by `yarn generate`.
- Prerequisite: the `products_*` tables must exist before promotion can be verified (`src/modules/products/migrations/` is currently empty). Parsing, review, approval, template and profile behaviour do not depend on them; if the tables are absent, generate and apply the products migration first (with approval) and re-run the promotion verification.
- No seed data is required. `CNY` must exist in the currency dictionary for the owner's files; if it does not, seeding it is a prerequisite of the approve/promote acceptance test, not of the module.
- Rollback: the migration is additive, so disabling the module in `src/modules.ts` removes every surface while leaving the three tables and their data intact; dropping the three tables is a complete rollback and touches nothing else. Uploaded workbooks are ordinary attachments and can be deleted through the attachment route.
- Observability: `sourcing.*` events plus the command audit rows (`sourcing.quote`, `sourcing.quote_line`, `sourcing.import_profile`) and the promotion response counts; no new metrics or alerts.

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| A legacy `.xls` or protected workbook cannot be parsed | The operator cannot import that file | `parse` returns 422 `unreadable_workbook` with the file name and a "save as .xlsx" hint; SheetJS is exercised against the real WPS file in Phase 1 | A password-protected workbook still needs manual re-export |
| Price merge deactivates other tiers | Product loses `internal`/`export` prices | Promotion reads the existing price rows, merges the `purchase` row and submits the whole set; TEST-005 pins that other tiers survive | A concurrent price edit between read and replace is last-write-wins (the platform's documented semantics for that command) |
| Layout drift inside one supplier (added/renamed columns) | Wrong mapping silently | Layout signature changes → no profile hit → confidence drops to `fuzzy`/`none` and the operator must confirm; `raw` keeps the original row | A renamed column that still matches an alias could map wrongly and must be caught in review |
| Ambiguous Item No. variants | Wrong SKU identity in the master | Deterministic suffix rule + `sku_from_name`/`duplicate_sku_in_file` warnings + inline correction before approve | Operator discipline; promotion refuses lines without a SKU |
| Imported data overwrites curated master fields | Loss of product information | Non-null-wins updates; only changed fields are sent; every write is audited with a before/after snapshot | A wrong non-null value from a supplier sheet can overwrite a curated value; the audit row makes it recoverable |
| Sending cost data to an AI provider | Commercial data leaves the deployment | Off by default, requires a configured key, sends only the header row + ≤3 sample rows after showing the payload, never writes to the DB | The operator can still choose to send sample rows |
| Uploaded workbooks accumulate (no framework retention) | Storage growth | Explicit 删除原始文件 action per quotation; attachment quota (512 MB) still applies | No automatic sweeper in this slice |
| Products tables absent in a fresh environment | Promotion fails at runtime | Documented prerequisite + explicit check in Phase 3 validation | Deployment ordering remains a manual step |

## Acceptance Criteria

- [ ] **AC-001** — An operator creates, edits, lists and soft-deletes an organization-scoped quotation; a foreign organization's quotation id returns 404 and no row is written.
- [ ] **AC-002** — `PETKIT Quotation Sheet-2026_NEW.xlsx` and `订单表-2026 EXW.xls` both parse: the first yields header row 3, 6 sections, 69 data rows; the second yields sheet `形式发票`, header row 9, 78 data rows, with `TOTAL`/`Subtotal`/payment-terms/bank rows excluded.
- [ ] **AC-003** — Every source column is mapped with an explicit confidence; `Picture` is `ignored`; duplicate target assignments and unmapped columns are visible and correctable; an unknown layout produces `none` rather than a guess.
- [ ] **AC-004** — Saving a mapping profile and re-importing the same layout pre-fills the mapping (profile hit) without operator work.
- [ ] **AC-005** — The review grid shows selection, inline SKU/name/MOQ/price/section editing, warnings, and the current `purchase` price (or 未建档) per row; a stale row save returns 409 with the conflicting ids.
- [ ] **AC-006** — SKU derivation is deterministic: `P4108`/`P4108-UVC` from the two `P4108` rows; `P41171`/`P41171-5PCS`; a row without an Item No. gets a name slug with `sku_from_name`, and an un-sluggable name gets `sku_required` and cannot be promoted.
- [ ] **AC-007** — `approve` assigns `SQ-<year>-<4 digits>` once, refuses an empty or all-invalid quotation, refuses a currency outside the dictionary, and cannot run twice.
- [ ] **AC-008** — Promoting 5 selected lines creates 5 products with CNY `purchase` prices whose `min_quantity` equals the line MOQ; a second promotion reports all `skipped`; existing `internal`/`export` price rows remain active.
- [ ] **AC-009** — A failing line (soft-deleted SKU, invalid reference) is reported in `failed[]` with its line number, keeps `row_status='invalid'`, and does not abort the remaining lines.
- [ ] **AC-010** — A hand-created quotation with typed lines approves and promotes through the same commands as an imported one.
- [ ] **AC-011** — The downloaded template imports with every column mapped `exact` and the mapping step skipped.
- [ ] **AC-012** — With no model provider configured, `ai-status` reports unavailable, the AI button is disabled with the environment-variable hint, and the mapping endpoint returns 503 without writing to the database.
- [ ] **AC-013** — Every line keeps its raw source row and the quotation keeps its source file name/sheet/attachment; 删除原始文件 removes the attachment without deleting the quotation.
- [ ] **AC-014** — `yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test && yarn build` passes, and `yarn ds:check` reports no violation under `src/modules/sourcing/backend/**`.
- [ ] Every listed backend surface matches its recorded Open Mercato reference and uses the canonical shell/components, shared API helpers, semantic tokens, and complete loading, empty, error, conflict, keyboard, accessibility, responsive, light-mode, and dark-mode states.
- [ ] Every affected API and UI path has self-contained integration coverage and the configured validation gate passes.

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | Root `AGENTS.md`; `.ai/guides/{contracts,backend-ui,integrations,spec-delivery}.md`; `om-spec-writing` invoked; `om-module-scaffold`/`om-backend-ui-design` routed for implementation phases |
| Data models, APIs, events, UI, and tests are internally consistent | pass | Requirement Traceability rows REQ-001…REQ-012 each name an entity/route and a test |
| Every workflow completes end to end without a catch-all integration phase | pass | J-001…J-004 complete inside Phases 2–5; Phase 6 is documentation and re-verification only |
| Platform-native reuse and extension points were chosen before custom code | pass | Reuse and Ownership Map: attachments, CRUD factory, command bus, `CrudForm`/`DataTable`, `buildXlsx`, AI library layer |
| UI contracts identify references, canonical components, and theme/state coverage | pass | UI and Interaction Contracts table + per-page mockups + design-system note; browser evidence recorded below |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | Implementation Phases 0–6 |

### Verification evidence (2026-09-22)

- **Engine truth (Phase 1, `npx jest src/modules/sourcing`)**: 45 unit tests green (8 suites), including `PETKIT Quotation Sheet-2026_NEW.xlsx` header row 3 / 6 banners / 69 data rows / 13 columns mapped and `订单表-2026 EXW.xls` sheet `形式发票` / header row 9 + unit row 10 / 78 data rows with the footer block rejected.
- **API end-to-end (dev server, real files, non-superadmin role)**: create → upload (19 MB) → `parse` 69 lines + `P4108`/`P4108-UVC`/`P41171-5PCS`/`P4113-UVC` SKUs + `10 pallets` → 10 + `46.5*46.5*40 cm`; `remap` with `saveProfile` → profile hit and 69 lines rebuilt; batch save of 5 rows incl. an SKU correction; `approve` → `SQ-2026-0001`; `promote` → `created:5` with CNY `purchase` prices and `min_quantity = MOQ`; second `promote` → `skipped:5`. The `.xls` file: 78 lines, metre `L/W/H` normalized to `46/47/41 cm`, name-slug SKUs, approve + promote of 2 lines.
- **Template + AI**: `GET /api/sourcing/template` answers `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`; the downloaded file re-imports with `templateMatched: true` and 3 example rows; `ai-status` reports `{available:false}` and `ai-mapping` returns 503 `ai_not_configured` without writing anything.
- **Scope isolation**: a session scoped to the second organization lists 0 quotations and gets 404 for a foreign quotation id.
- **UI (browser, zh + en, light + dark, 1440 and 420 px)**: list page (toolbar, status badges, counters), create page in import mode (upload area → mapping table with per-column confidence + saved-profile badge + AI block with the payload preview), review console (header counters, wizard steps, grid with inline SKU/MOQ/price edits, bulk actions, promotion flash and refreshed counters), and the zh locale rendering of every new string.
- **Conflict state (UI)**: with the review console open, the same row was edited through the API; saving the stale edit from the grid returned the platform's 409 and rendered the shared conflict bar (`记录已更改 此记录已被他人修改，请刷新后重试。` + 刷新) instead of a raw message — the row kept the operator's value so the difference is visible.
- **Keyboard**: the wizard handles `Cmd`/`Ctrl`+`Enter` for the current step's primary action (`Esc` steps back, since the wizard is inline).
- **Price safety (AC-008, the risky half)**: a product was given three tiers (`purchase` CNY/500 @230, `internal` CNY/1 @310.5, `export` USD/1 @49.9); a quotation line pointed at its SKU with a new cost (244.75) was approved and promoted, which **rewrote** the price set (`updated: 1`). Afterwards all three tiers were still active, the `internal`/`export` values were untouched, and the existing `purchase` CNY/500 rung survived alongside the new CNY/1 row — the merge in `lib/productMapping.ts` is what keeps `products.prices.replace`'s "deactivate what is missing" rule from eating the other tiers.
- **AC-007 refusals (API)**: an empty quotation → 422 `no_ready_lines`; a quotation whose currency is not in the dictionary → 422 `currency_not_in_dictionary`; the first approval assigns `SQ-2026-0009` and a second one is refused with 409 `quote_not_draft`; adding a line afterwards is refused with 422 `quote_not_editable`.
- **AC-009 per-line isolation (API)**: a product was created and soft-deleted, then a quotation was made from one line pointing at that dead SKU and one clean line. The promotion returned `created: 1` **and** `failed: [{ lineNumber: 1, message: 'SKU … belongs to a deleted product; rename the line's SKU to promote it' }]`; the failed row ended `invalid` with the `promotion_failed` warning, the other row ended `promoted`.
- **AC-010 manual path (API)**: a hand-created quotation (`source_kind: manual`) with two typed lines reached `ready`, reported `lineCount: 2`, approved as `SQ-2026-0010` and promoted `created: 2`; the typed HS code arrived on the product (`MANUAL-…-1.hsCode = 1234567890`) and the typed section label created the `manual_section` category — the manual and imported paths converge on one promotion implementation.
- **Post-change re-confirmation (API)**: after `parse`/`remap` were made to discharge the declared indexer, a fresh round trip was re-run: create → upload (19 MB) → `parse` → **200, 69 lines, header row 3, profile hit `Petkit 2026 quotation`**, and the platform's "declared an indexer that its command handler did not discharge" warning no longer appears for the parse (it appeared for the same request before the change). `GET /api/sourcing/import-profiles` also returns the saved profile with `usageCount 4`, which is the profile-reuse path end to end.
- **Price-merge rules pinned by unit tests**: `lib/__tests__/productMapping.test.ts` covers the promotion rules that only a live run could show before — spec-summary folding, "never send an empty value over an existing field", numeric (not textual) comparison of decimal strings, currency/MOQ fallback, the tier-preserving merge (other tiers submitted unchanged, a new MOQ rung appended rather than replacing the old one), the no-change short circuit, and category codes (`FEEDING` → `feeding`, a CJK-only label → null).
- **Operational note recorded as a lesson**: a new module's features reach existing roles only after `yarn mercato auth sync-role-acls` **and** a process restart — see `.ai/lessons/module-features-need-role-acl-sync.md`.

Verdict: **Ready for implementation**

### Extension-surface traceability

Every new runtime/discovery surface, with the reference module file it adapts (`src/modules/example/**`, source-present and runtime-disabled — activations/grants apply only after an explicit opt-in).

| Surface | Requirement | Reference capability ID + exact reference file | Phase | Own test | Classification |
|---|---|---|---|---|---|
| Module metadata `src/modules/sourcing/index.ts` | REQ-001 | `module.metadata` — `src/modules/example/index.ts` | Phase 2 | TEST-001 | emitted-example |
| ACL features `src/modules/sourcing/acl.ts` | REQ-001, REQ-008 | `module.acl-features` — `src/modules/example/acl.ts` | Phase 2 | TEST-002 | emitted-example |
| Default role grants `src/modules/sourcing/setup.ts` | REQ-001 | `module.setup-role-features` — `src/modules/example/setup.ts` | Phase 2 | TEST-001 | emitted-example |
| Entities `src/modules/sourcing/data/entities.ts` | REQ-001 | `data.entities` — `src/modules/example/data/entities.ts` | Phase 2 | TEST-009 | emitted-example |
| Validators `src/modules/sourcing/data/validators.ts` | REQ-001 | `data.validators` — `src/modules/example/data/validators.ts` | Phase 2 | TEST-004 | emitted-example |
| Migration `src/modules/sourcing/migrations/*` | REQ-001 | `data.migrations` — `src/modules/example/migrations/Migration20251030150038.ts` | Phase 2 | TEST-009 | emitted-example |
| Commands `src/modules/sourcing/commands/quotes.ts` | REQ-001, REQ-007 | `commands.write` — `src/modules/example/commands/todos.ts` | Phase 2 | TEST-001 | emitted-example |
| Events `src/modules/sourcing/events.ts` | REQ-001, REQ-008 | `events.typed-definitions` — `src/modules/example/events.ts` | Phase 2 | TEST-001 | emitted-example |
| CRUD route `src/modules/sourcing/api/quotes/route.ts` | REQ-001 | `api.crud-factory` — `src/modules/example/api/customer-priorities/route.ts` | Phase 2 | TEST-001 | emitted-example |
| Custom guarded routes `src/modules/sourcing/api/quotes/{parse,remap,approve,promote}/route.ts` | REQ-002, REQ-007, REQ-008 | `api.custom-route` — `src/modules/example/api/organizations/route.ts` | Phase 2, Phase 3 | TEST-001, TEST-002 | emitted-example |
| OpenAPI document `src/modules/sourcing/api/openapi.ts` | REQ-001 | `api.openapi` — `src/modules/example/api/openapi.ts` | Phase 2 | TEST-001 | emitted-example |
| Indexer/audit bridge in commands | REQ-001, REQ-008 | `events.crud-indexer-bridge` — `src/modules/example/commands/todos.ts` | Phase 2 | TEST-001 | emitted-example |
| Backend pages `src/modules/sourcing/backend/sourcing/quotes/**` | REQ-001, REQ-005, REQ-009 | `ui.page-shell` — `src/modules/example/backend/todos/page.tsx` (+ `page.meta.ts`) | Phase 4 | TEST-003 | emitted-example |
| Line grid `src/modules/sourcing/components/QuoteLinesGrid.tsx` | REQ-005 | `ui.datatable` — `src/modules/example/components/TodosTable.tsx` | Phase 4 | TEST-003 | emitted-example |
| Manual quotation form `src/modules/sourcing/components/ManualQuoteForm.tsx` | REQ-009 | `ui.form-create` — `src/modules/example/backend/todos/create/page.tsx` | Phase 4 | TEST-003 | emitted-example |
| Review console page `src/modules/sourcing/backend/sourcing/quotes/[id]/page.tsx` | REQ-005, REQ-007 | `ui.form-edit` — `src/modules/example/backend/todos/[id]/edit/page.tsx` | Phase 4 | TEST-003 | emitted-example |
| i18n catalogs `src/modules/sourcing/i18n/{zh,en}.json` | REQ-005, REQ-009 | `module.i18n-catalogs` — `src/modules/example/i18n/en.json` | Phase 4 | TEST-003 | emitted-example |

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-001 | Should the embedded product images (the PetKit workbook's 78 pictures) be extracted into product media? | business | no | Not in this slice — the picture column maps to `ignored`; if wanted, a follow-up slice anchors images to rows via drawing anchors |
| Q-002 | Should one workbook with several product sheets import as several quotations in one action? | business | no | Not in this slice — the wizard imports one sheet per quotation; multi-sheet batching is additive UI on the same commands |
| Q-003 | Should the AI mapping also extract whole rows for irregular layouts (e.g. the proforma invoice's free-text descriptions)? | business + technical | no | Not in this slice — only the column mapping is AI-assisted; the `.xls` invoice's identity columns are filled by hand |

## Changelog

| Date | Change |
|---|---|
| 2026-09-22 | Initial draft: app-owned `sourcing` module (supplier quotations + mapping profiles + promotion into `products`), SheetJS-based workbook reading, alias/profile/AI mapping, standard template, 6 phases. Decisions locked with the owner: SheetJS parser, built-in but gated AI mapping, Item No. + variant-suffix SKUs, quotation intermediate layer before the product master. Status `Ready for implementation`. |
| 2026-09-22 | Indexer discharge: `parse` and `remap` rewrite the quotation header through `nativeUpdate`, so they now emit the CRUD side effects (`action: 'updated'` with the quote events + indexer) explicitly — the routes declare `sourcing:sourcing_quote`'s indexer, and the platform warns when a declared indexer is not discharged. |
| 2026-09-22 | Verification follow-up: (7) a stale row save answers **the platform's** optimistic-lock 409 body (`code: 'optimistic_lock_conflict'` + both timestamps, with the per-row list in `conflicts`), so the review grid renders the shared, translated conflict bar with a refresh action instead of a module-specific message — verified in the browser by moving a row behind an open page and saving it; (8) the wizard is **inline, not a dialog**, so `Esc` steps back one step rather than closing an overlay, and `Cmd`/`Ctrl`+`Enter` triggers the current step's primary action (apply mapping) through `useDialogKeyHandler`. |
| 2026-09-22 | Implemented and verified. Deviations from the draft, each driven by the real files: (1) blank and merge-continuation rows are **skipped, never** table terminators — the PetKit sheet has two blank spacer rows mid-table and the drafted "stop after two blank rows" rule would have dropped 29 lines; (2) `GET /api/sourcing/quotes/[id]` was added as the draft's API table listed it, and the line-update surface is the batch `PUT` only (the single-row `sourcing.quote-lines.update` command was dropped — a batch of one is the same call and the grid never needs the other); (3) `.xls` rows without an Item No. promote with a name-slug SKU (`sku_from_name`) rather than being blocked on `sku_required`; (4) the create page carries its intent in a URL hash (`#manual` / `#import`) because module pages are not given `searchParams`; (5) the `.xls` `L`/`W`/`H` columns are normalized to centimetres through the same metre heuristic as packed cells (their values are metres); (6) `columnMap` validates as a **partial** record (`z.partialRecord`) so the wizard can send only the fields the operator kept. Dependency added: SheetJS `xlsx` 0.20.3 from the SheetJS CDN tarball. |
