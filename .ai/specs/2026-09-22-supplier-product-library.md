# Supplier Product Library + Role-Grouped Backend Menu

**Date**: 2026-09-22
**Status**: Implemented and verified (Phases 1–6 on 2026-09-22; Phase 7 on 2026-09-23; **Phase 8 — 关联商品：直觉化 + 手动关联 — on 2026-09-23**) — the library then moved to `purchasing` (D4); the Changelog rows are the live record

> **As-shipped deltas (2026-09-23).** Phases 1–6 shipped in `feat(sourcing): import supplier quotations and own
> the supplier product library` (2026-09-22) and were verified end to end; the Status line was stale.
> Phase 7 (产品明细表 field set, dictionary unit, price list, product photos) landed 2026-09-23 and is
> **verified** (gates + the integration suite + a browser smoke — see the Changelog rows). It was implemented
> in the same working tree this note was written in, which is why the intermediate rows read as "in flight";
> the two later rows record the finished state and the module handover.
> The **"no prices"** rule written into this file's TLDR and Problem Statement dates from Phases 1–6
> (`purchasing_supplier_products` carries no price columns). Phase 7 adds a separate price-row table
> (`purchasing_supplier_product_prices`, one row per `price_kind` × currency × minimum quantity) and the
> `purchasing.supplier-products.replace-prices` command, so read the TLDR as the Phase-1–6 truth; the module
> README and the Phase 7 changelog row below carry the current rule.
> Prerequisite: this spec builds on
> [`2026-09-22-supplier-quotation-import.md`](2026-09-22-supplier-quotation-import.md) (the quotation layer);
> the reverse is not true.

> **Ownership handover (2026-09-23).** The library's entity, commands, API, pages, ACL and events moved
> from `sourcing` to **`purchasing`** (decision D4 below): tables renamed
> `sourcing_supplier_products` → `purchasing_supplier_products` and
> `sourcing_supplier_product_prices` → `purchasing_supplier_product_prices` by
> `Migration20260923043000_sourcing` (data preserved; the pkey renames follow in
> `Migration20260923044000_sourcing`), routes at `/api/purchasing/supplier-products/*`, pages at
> `/backend/purchasing/supplier-products`, features `purchasing.supplier-products.*`. `sourcing` feeds
> the library through `purchasing.supplier-products.import-from-quote` and no longer holds the quote
> line's reverse pointer. The master-mapping helpers both promotions share live in
> `products/lib/supplierMapping.ts`. Read every `sourcing_*` / `sourcing.supplier-products.*` mention
> below as the pre-handover state.

## TLDR

Give every supplier its own **product library** — the supplier-facing goods list (item no., name,
spec, unit, unit net weight and size, Qty/Box, MOQ, HS code, **no prices**) that the buyer maintains
inside the
**Purchasing** menu group and that a purchase order line is picked from; and regroup the backend
sidebar into **six business-role groups** (Purchasing / Trade / Finance / Product master / Parties /
Platform ops) so a purchaser sees purchasing and a trade operator sees trade. Reuses
`makeCrudRoute`, the command bus, `CrudForm`, `DataTable`, i18n, ACL, events and the products
module's commands; adds one app-owned table in `sourcing` (which already owns the quotation →
master path), two nullable scalar columns, and one `overrides.nav.groupOrder` declaration.

## Problem Statement

**A supplier's goods have no home.** Today the only supplier-side product data in the system lives
on `sourcing_quote_lines` — *quotation* lines, document-scoped, reachable only by joining
`sourcing_quotes.supplier_id`. All 30 app-owned tables were checked: no entity models "this
supplier sells this item". Consequence: the buyer cannot answer "what does Petkit sell us?" without
opening quotations, and every new order re-picks from the internal product master
(`products_products`), which is a *different* list (internal SKUs, prices, categories) built for
stock, internal sales and contracts.

**Picking a purchase order forces a detour.** `purchasing_purchase_order_lines` accepts only
`product_id` (app product master) or `catalog_product_id` (historical installed catalog) — the
`refine` in `src/modules/purchasing/commands/orders.ts:69-82` enforces exactly one of the two. So
"order what this supplier actually offers" means: leave purchasing → open the products module →
find/select the product → come back. And a product that does not exist in the master yet cannot be
ordered at all, even though the goods are real and the supplier quoted them.

**Downstream cost of the missing link.** `cross_border_shipment_allocations` can only reference a
purchase-order line and freezes that line's `product_snapshot`. A line without an official catalog
link is rejected at allocation time with 422
(`src/modules/cross_border/commands/shipments.ts:110-118`) because stock receipt is variant-level.
So the "sync to the master" step is not optional for anything that ships — it just happens today
with no record of *which supplier item* the product came from.

**The sidebar does not match the org chart.** Two different groups both render as 「采购」
(`purchasing.nav.group` and `sourcing.nav.group`), trade pages are split across three groups
(`cross_border`, `trade_docs`, `internal_sales`), and the export-finance pages (收汇档案/出口退税档案)
are parked under 「采购」. A purchaser scrolling the sidebar sees trade documents; a trade operator
sees purchasing. Roles are the natural boundary: the company has a procurement person and a trade
person, and neither wants the other's menu.

Affected users: the buyer (creates orders from the supplier's list), the trade operator (ships what
was bought), and the finance operator (reads order/container files).

## Overview and Success Measures

- **Primary outcome:** a supplier's product library is maintained inside the Purchasing menu, and a
  purchase order line can be created from it in ≤2 clicks from the order form without visiting the
  products module; the sidebar shows exactly six role groups.
- **Leading indicators:** library rows per supplier; share of order lines carrying
  `supplier_product_id`; `promote` (sync-to-master) runs per week; count of sidebar groups rendered.
- **Baseline:** zero supplier-product rows (feature absent); 6+ nav groups with two labelled 采购.
- **Market / product reference:** mid-market ERP vendor master + purchase catalogue (Odoo
  `product.supplierinfo`, SAP purchasing info records, NetSuite vendor item) — adopted: the supplier
  item is a *vendor-side* record keyed by the supplier's own item number, carries packaging/MOQ and
  is linked to (not merged with) the internal item; rejected: maintaining a second price list (the
  repo's `purchasing` Q-P-004 keeps prices on the order/quotation), and auto-creating master
  products on import (would flood `products_products` with un-synced duplicates). Phase 8 keeps the
  same reference: Odoo carries the **vendor's own code and name on the vendor-specific line**
  (`product.supplierinfo`), SAP keeps the supplier material number on the purchasing **info record**
  for a *material × vendor* pair, and both let an operator pick an existing item rather than match on
  a string — adopted: an explicit 关联已有商品 action plus a 未建档 filter and bulk action. Rejected:
  auto-linking by name or by a "closest" match, and promoting on save.

## Goals

- **REQ-SPL-001** — A supplier product library row is a first-class, organization-private,
  soft-deleted, optimistic-locked record: supplier (`supplier_id` + name snapshot), supplier code
  (`supplier_sku`, unique per supplier **including soft-deleted rows**), original item no., name,
  description, unit, HS code, MOQ, carton quantity (Qty/Box), unit net weight, inner packing
  (L×W×H), optional link to the product master (`product_id`), status, source, last quotation
  reference, notes. The whole-carton figures — carton G.W / N.W and the outer carton size — were
  removed on 2026-09-23 (D5: a buyer maintains unit data only).
- **REQ-SPL-002** — The buyer maintains the library from `/backend/purchasing/supplier-products`
  inside the **Purchasing** nav group: list with supplier/status/search filters and server-side
  paging, create, edit, soft delete, and a "sync to product master" row action.
- **REQ-SPL-003** — A quotation's lines can be added to the supplier library in one action
  (`import-from-quote`): `supplier_sku` = `derived_sku ?? item_no`; existing rows are updated with
  **non-empty, changed values only** (a blank column never erases stored data); a row already in
  sync counts as `skipped`; each line fails in isolation with a readable message; the quote line
  stores the library row it created/updated.
- **REQ-SPL-004** — Promoting quotation lines into the product master (the existing
  `sourcing.promote.run` path) also upserts the supplier library row and backfills `product_id`, so
  the two paths converge on one library; a library-upsert failure never rolls back a product write.
- **REQ-SPL-005** — "Sync to product master" on a library row creates or updates
  `products_products` **by SKU** through `products.items.create|update`, writes the packaging/HS/spec
  fields, merges a `purchase`-tier price row from the most recent matching quotation line when one
  exists (whole price set submitted so `internal`/`export` survive), backfills `product_id`, and is
  idempotent (`action: 'skipped'` on a second run). It refuses a SKU owned by a soft-deleted product.
- **REQ-SPL-006** — A purchase order line may reference a supplier library row
  (`supplier_product_id`, nullable scalar). Resolution rules: the row must be visible in the caller's
  organization; it must belong to the order's supplier (otherwise 422
  `supplier_product_supplier_mismatch`); a line may not combine `supplierProductId` with
  `productId`/`catalogProductId`; and a line with none of the three is still rejected. A library row
  already synced to the master resolves through the existing product-master branch (and keeps the
  catalog bridge); an un-synced row freezes a supplier snapshot (`title`/`sku`/`unit`/`spec` plus
  `supplierSku`).
- **REQ-SPL-007** — The order line projection and the order form expose the supplier reference: the
  line payload carries `supplierProductId` and `supplierSku`; the order form's line editor picks
  from the selected supplier's library (or from the product master, switchable), pre-selects nothing
  from prices, and shows the supplier code on the order detail.
- **REQ-SPL-008** — The trade side inherits the supplier code without a second product list: shipment
  allocations expose `supplierSku` from the frozen `product_snapshot`, and the allocation guard's
  message tells the operator exactly which step is missing (sync + catalog link) instead of only
  refusing.
- **REQ-SPL-009** — The backend sidebar renders exactly six business-role groups in a fixed order —
  Purchasing / Trade / Finance / Product master / Parties / Platform ops — with no duplicated group
  label; every page keeps its `requireFeatures` gate.
- **REQ-SPL-010** — Every new command, route, page, ACL feature, event and message is scope-checked
  (`ensureScope`, fail closed), feature-gated, localized (zh + en), and covered by an integration
  test.
- **REQ-SPL-011** — The library row carries the full 产品明细表 field set the business maintains and
  prints: the supplier's raw name (`name`), **our** Chinese name (`name_zh`) and English name
  (`name_en`), the supplier's item no. (`item_no`), HS code, 申报要素 (`declaration_elements`), unit,
  MOQ, carton quantity (Qty/Box), unit net weight, the item's own size (`inner_packing`, L×W×H — the
  form labels it 产品尺寸 / "Product size"), product photos and notes.
  Carton G.W / N.W and the outer carton size left the field set on 2026-09-23 (D5). HS code stays **text**: a HS code is an identifier with leading
  zeros and dotted groups (`8471.30.0000`), not an arithmetic value, so a numeric column would
  corrupt it.
- **REQ-SPL-012** — The unit is a **dictionary** value, not free text: `purchasing/setup.ts` seeds the
  organization's `supplier_product_unit` dictionary (idempotent, insert-only) and the form renders a
  dropdown fed by it through the app's **one** client loader (`products/lib/unitOptions.ts`, the same
  list the product form and the trade-document lines read), while the API keeps accepting any code (a quotation import or an older row may
  carry one the dictionary does not list yet, and opening such a row must never blank it).
- **REQ-SPL-013** — A library row carries a **price list**, not price columns:
  `purchasing_supplier_product_prices` holds one row per `price_kind` × currency × minimum quantity.
  The two prices the business prints side by side are `supplier_cost` (the legacy 「PK 单价」, the
  supplier's own price) and `company_offer` (the legacy 「KC 单价」, ours) — the party is a code and
  the currency is a separate column, so a second supplier, currency or quantity ladder is a row
  rather than a schema change. The whole set is submitted in one
  `purchasing.supplier-products.replace-prices` command; rows missing from the payload are
  **deactivated**, never deleted; the currency must exist in the currency dictionary.
- **REQ-SPL-014** — Product photos are stored as an ordered `image_attachment_ids` list on the row,
  uploaded through the installed `attachments` module against
  `entityId = purchasing:purchasing_supplier_product` + the row id, and bound by a row update (so an
  image list can never overwrite a concurrently edited row): create-then-bind, upload failure never
  loses the row, unlinking never deletes the file.
- **REQ-SPL-015** — The library form separates **ERP-generic** fields (SKU, names, unit, HS code,
  declaration elements, prices, unit weight, Qty/Box, dimensions) from the **supplier-sheet** fields
  (the supplier's raw name, item no., spec text and notes) into their own groups, and every
  abbreviation is spelled out in the label or the field help: L/W/H = length/width/height, Qty/Box =
  quantity per carton, MOQ = minimum order quantity, HS = Harmonized System. A buyer who has never seen the supplier's workbook can read every field.
- **REQ-SPL-016** — "Sync to product master" maps the library's own names onto the master
  (`name_zh ?? name` → `products_products.name`, `name_en` → `name_en`) and prefers the library's
  active `supplier_cost` price row (minimum quantity 1, in its own currency) over the newest matching
  quotation line, falling back to the quotation when the row quotes no price — one source of truth
  for the price that lands in the master, without ever pre-filling an order line (Q-P-004 stands).
- **REQ-SPL-017** — The library list states each row's link state where the work happens: the
  关联商品 column renders the linked **product's name and SKU** as a link to the product's edit page;
  an unlinked row shows a 未建档 badge with an inline 建商品档案 action (not hidden in the `⋯` menu)
  and a 关联已有商品 action; a successful 建商品档案 reports the next required step — fill the
  product's 官方目录链接 — with a link to that product (**as a dismissible alert above the table, not
  as a flash: this platform's `flash(message, kind)` carries no link**); and a 建档状态 filter
  (全部 / 未建档 / 已建档, the list's existing server-side `status`/`supplierId` filter pattern)
  narrows the list server-side on the **stored** `product_id` — the filter is a column condition
  (`product_id is null` / `is not null`), never a client-side slice of one page, so `total` and paging
  stay correct. A row whose linked product was soft-deleted afterwards keeps its 已建档 bucket and
  renders 已关联的商品已删除 (warning tone) with 换绑 / 解除关联 offered as the way out, because both
  `promote` and `sync-fields` would refuse it. The 供应商货号 field help names the matching rule
  (`supplier_sku` = the product's SKU). The action labels are fixed: the row action and the single-row
  result say 建商品档案, the bulk action 批量建商品档案, and 未建档 / 已建档 are state words only
  (J-SPL-003/J-SPL-004 keep their historical 同步为商品 wording).
- **REQ-SPL-018** — The buyer can clear an unlinked backlog in one action: row selection plus a
  批量建商品档案 bulk action promotes the selected rows through one request, reporting
  `created / updated / skipped / failed[]` with a per-row reason, leaving every other row untouched
  (per-row isolation, no cross-row transaction). Duplicate ids in the request are collapsed to their
  first occurrence before processing, so the counts always describe distinct rows, and a list that is
  empty after that collapse is a 400. This action requires `purchasing.supplier-products.promote`
  (the same feature its route and the master write require) — a role without it never sees the button.
- **REQ-SPL-019** — A row can be linked to an **existing** master product instead of being matched by
  SKU: a 关联已有商品 picker (search by SKU or name, scoped to the caller's organization) writes the
  link through `purchasing.supplier-products.link`; 换绑 re-points it and 解除关联
  (`productId: null`) clears it. The action writes **only** `product_id` — never the product's fields
  or prices — and it holds the target's scope and liveness check **inside the writing transaction**,
  so a product outside the caller's organization is a 404, and a product that is soft-deleted — before
  the click or between the check and the write — is a 422 `product_deleted` with nothing written
  (there is no foreign key to lean on: the link is a scalar id by design).
- **REQ-SPL-020** — A linked row can push its current values onto its product:
  `purchasing.supplier-products.sync-fields` re-runs the same non-empty/changed field mapping and the
  `purchase`-tier price merge `promote` uses, reports exactly what it wrote (`fieldsChanged[]`,
  `priceChanged`), and never touches the catalog link, the `internal`/`export` tiers, or the
  product's variants. An unlinked row and a soft-deleted product are refused with 422. Like
  `promote`, it requires `purchasing.supplier-products.promote` and is therefore hidden from a role
  that holds only `manage`.
- **REQ-SPL-021** — The order form's merged line picker labels every library suggestion with its link
  state (已建档 / 未建档：建过档才能发运、收货), so an unlinked row stays orderable without the buyer
  having to know which of two similar suggestions can actually ship.

## Non-goals

- ~~A **second price list**: prices stay on `sourcing_quote_lines` and purchase order lines
  (`purchasing` Q-P-004 stands). The library deliberately has no price column.~~ **Superseded
  2026-09-23 (REQ-SPL-013)** by the owner's 产品明细表 brief: the two prices the business keeps on the
  item (the supplier's and ours) now live in the library as a price **list**
  (`purchasing_supplier_product_prices`, one row per kind × currency × minimum quantity) instead of two
  currency-named columns. Q-P-004 still stands where it matters: the order line keeps its own
  negotiated `unitPrice` and nothing pre-fills it from the library, so the stale-price risk the
  original non-goal protected against is unchanged.
- Auto-creating product-master rows on import, order, or library save: syncing is an explicit operator
  action. `promote`, `promote-batch` and `sync-fields` write into the product master and its price
  set, so they stay explicit and auditable (owner decision 2026-09-23, rejecting the
  auto-promote-on-save option).
- A separate trade-side "export goods list": trade consumes the purchase-order line snapshot.
- Renaming any existing `pageGroupKey`, or migrating per-user sidebar preferences: the group id is
  the persisted unit, and the regrouping reuses existing ids (`purchasing.nav.group`,
  `cross_border.nav.group`, `products.nav.group`, `parties.nav.group`, `platform_ops.nav.group`) plus
  one new `export_finance.nav.group`.
- ~~Supplier portal access, supplier self-service uploads, and image/media on library rows.~~
  **Superseded 2026-09-23 (REQ-SPL-014)** for images only: product photos are part of the brief and
  are stored as attachment ids on the row. Supplier portal access and supplier self-service uploads
  remain out of scope.
- Auto-merging a library row into an existing master product by name/fuzzy match: automatic matching
  is by SKU. Picking the product **by hand** (REQ-SPL-019) is not a fuzzy match — it is the
  operator's explicit decision, and it is the only way to link a row whose supplier code
  intentionally differs from our own product SKU.

## Proposed Solution

A new app-owned entity `PurchasingSupplierProduct` (`purchasing_supplier_products`) inside the existing
`purchasing` module owns "this supplier sells this item". The module owns the supplier master, the buyer-facing pages and the price list; the quotation lives
in `sourcing`, which reaches the library only through this module's commands. The buyer-facing pages live under `/backend/purchasing/supplier-products` but
declare `pageGroupKey: 'purchasing.nav.group'`, so the menu shows them where the buyer works while
ownership stays with the module that already knows supplier items.

Purchase order lines gain one nullable scalar (`supplier_product_id`) and a `supplierSku` key inside
the already-frozen `product_snapshot`. Resolution reuses the existing master/catalog branches: a
synced library row behaves exactly like a master product line (including the catalog bridge that
stock receipt needs), an un-synced row freezes a supplier snapshot and can still be ordered, but the
shipment/receive guard keeps refusing until it is synced and catalog-linked.

The menu regroup is metadata + i18n only: pages move to their role's `pageGroupKey`, and one
`overrides.nav.groupOrder` on the app's `purchasing` module entry fixes the group order app-wide
(the domain prepends ids ahead of the framework default; unnamed groups keep their position).

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| **D1 — Library first, master on demand** (owner decision) | The supplier's list is the buying surface; `products_products` is the internal record needed for stock, internal sales and contracts. Keeping them separate preserves one source of truth per purpose, and the explicit sync action is the only bridge. | Make the library *be* `products_products` filtered by supplier | Would require a `supplier_id` on the master (cross-purpose row), and every quoted item would need a master row before it could be ordered |
| ~~**D2 — Entity, commands, API and pages live in `sourcing`**~~ **SUPERSEDED by D4 (2026-09-23)** (owner decision) | `sourcing` already owns supplier quotations and the promotion into the master, so quote→library is an in-module write; the module's ACL prefix, events and CRUD helpers are already wired. | New `supplier_products` module, or put it in `purchasing` | A new module duplicates the promotion seam and adds a module entry for one table; `purchasing` would then write quotation lines (cross-module write) or duplicate the mapping |
| **D3 — Six role groups, ids reused** (owner decision) | A group id is persisted in per-user sidebar preferences; reusing existing ids keeps most preferences valid, and one `groupOrder` override fixes the app-wide order without touching installed pages. | Rename groups per role (`procurement.nav.group`, …) | Invalidates every stored preference for no functional gain; the group *label* already carries the role |
| Library row ↔ supplier via scalar id + name snapshot | Same rule as `sourcing_quotes.supplier_id`: no cross-module ORM relation anywhere in the app | ORM `ManyToOne` to `PurchasingSupplier` | Forbidden by the app-wide module-boundary rule; a rename would rewrite history |
| Library row ↔ master via nullable `product_id` | Additive, backfilled by sync, and the master needs no reverse column (no master change at all) | Reverse `supplier_product_id` on `products_products` | Couples the master to one supplier source; a product may legitimately come from several suppliers |
| Order line ↔ library via `supplier_product_id` + snapshot | Matches how the module already freezes display data (`product_snapshot`), so a library edit or delete never rewrites a placed order | FK with `ON DELETE CASCADE`/`RESTRICT` | A hard link would block library deletion and let a rename silently change placed orders |
| Shipments do **not** link to the library | The allocation already freezes the order line's snapshot; a second link would create a second truth about what shipped | `supplier_product_id` on allocations | Duplicates the snapshot and re-introduces the sync problem at the shipment level |
| Library upsert on the existing promotion path (REQ-SPL-004) | The operator already promotes quotation lines; silently leaving the library empty would keep the two lists divergent | Only import on demand | Guarantees the library is a by-product of the workflow the buyer already runs, at no extra click |
| `supplier_sku` unique including soft-deleted rows | Same rule as `products_variants`: a code is a stable business identity; a deleted row still owns its code until restored | Partial unique index `where deleted_at is null` | Re-using a code after deletion would make two rows claim the same supplier code over time; deferred as an explicit one-way decision (see Risks) |
| No price pre-fill on the order line | Q-P-004: the order price is a negotiated fact, not a lookup | Default `unitPrice` from the newest quotation line | Would silently place orders at stale prices |
| **D4 — The library lives in `purchasing`, the quotation feeds it through commands** (owner decision, 2026-09-23) | The owner asked for the 产品明细表 to sit in the 采购 module rather than in `sourcing` with a menu-group override. The library is the buyer's supplier-side list and the pages always rendered in that menu, so the entity, commands, API, pages, ACL and events moved there (`sourcing_supplier_products` → `purchasing_supplier_products`, **renamed, never re-created**, so existing rows survive). `sourcing` keeps the quotation and the promotion, and reaches the library through `purchasing.supplier-products.import-from-quote`; the quotation line's old reverse pointer (`sourcing_quote_lines.supplier_product_id`) was dropped because nothing read it and it pointed across a module boundary. The shared master-mapping helpers moved to `products/lib/supplierMapping.ts`, so both promotions obey one rule without either module importing the other's internals. | Keep D2 (`sourcing` owns it, pages only *rendered* in the 采购 group) | The owner explicitly asked for module ownership, not a menu placement; the cross-module seam this creates is a command call (the app's sanctioned mechanism) and the alternative — `purchasing` writing `sourcing_quote_lines` — is a cross-module *write* |
| **D6 — The link is writable by hand, and only the link is written** (owner decision 2026-09-23) | The SKU match is right for a row with no master record yet, but the product SKU is *our* code: when it deliberately differs from the supplier's code, SKU matching can only produce a duplicate product. A human pick from the scoped master (REQ-SPL-019) resolves that, and writing nothing but `product_id` keeps the master's fields and prices under their own owners and their own review step. | Auto-link by name/fuzzy match, or write the library's values onto the picked product as part of the link | A fuzzy match silently merges two supplier items into one product — the exact reason `promote` matches by SKU; writing fields on link would overwrite a product manager's edits with no confirmation. Field pushing is a separate, explicit action (D7). |
| **D7 — `sync-fields` exists for already-linked rows** (owner decision 2026-09-23) | After the first link `promote` is idempotent (`skipped`), so a name, spec or price corrected in the library never reached the master again — the gap the owner hit while using the page. One action re-runs the same non-destructive mapping (`changedProductFields` + `mergePriceRows`) and reports what it wrote. | Re-write the master on every library save | Every library save would rewrite the master and its price set with no review, and two writers would fight over one record; an explicit action keeps one writer per edit. |
| **D8 — 解除关联 is allowed, not only 换绑** (owner decision 2026-09-23) | A wrong link must be fully reversible, and a row can legitimately stop being something we ship. Already-placed orders keep the bridge they froze on their own line; a draft re-resolves on its next save — the rule that already exists. | 换绑 only | Refusing to unlink leaves a mis-linked row with no way back to 未建档 short of deleting and re-creating the row (and its code is unique including soft-deleted rows, so even that collides). |
| **D9 — The order picker keeps offering unlinked rows, labelled** (owner decision 2026-09-23) | Ordering before archiving is a legitimate early step (prices get negotiated first) and this spec already accepts it; what was missing was the *consequence*, not the freedom. | Refuse unlinked rows in the picker | Hides a legal step behind a forced extra click and reverses an accepted risk for no data-safety gain. |
| Menu order via `overrides.nav.groupOrder` | The domain exists, prepends, and leaves unnamed groups untouched; declared once, on the app's `purchasing` entry | Per-page `pageOrder` alone | Page order cannot interleave groups contributed by other modules; the group order is a single app-wide decision |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| Supplier product | One item a named supplier offers: identified inside the organization by `(supplier_id, supplier_sku)`; carries its current price list as `purchasing_supplier_product_prices` rows | `purchasing_supplier_products` | Duplicate code → 409 `supplier_product_sku_taken` |
| Price row | One quoted price of a library item, keyed by `(price_kind, currency_code, min_quantity)`; `supplier_cost` is what the supplier charges us, `company_offer` is what we quote out. Deactivated, never deleted, when it leaves the submitted set | `purchasing_supplier_product_prices` | Duplicate key in one payload → 400; unknown currency → 400 naming the code |
| Unit of measure | A code (`PCS`, `SET`, `CTN`…) the organization maintains in the `supplier_product_unit` dictionary. The API accepts any code, so an imported row is never rejected or blanked by a dictionary gap | dictionary `supplier_product_unit` (seeded by `purchasing/setup.ts`) + `purchasing_supplier_products.unit` | Missing dictionary → the form falls back to free text and reports it; an unlisted stored code is shown as-is |
| Product photo | An `attachments` id bound to the row through `image_attachment_ids`; the file lives in the attachments module, the order in this column | `purchasing_supplier_products.image_attachment_ids` + `attachments` | Upload failure leaves the row untouched; unlinking removes the id only |
| `supplier_sku` | The library key: `derived_sku ?? item_no` of the quotation line, or the operator's own code for a hand-created row. 1–120 chars, unique per supplier **including soft-deleted rows** | `purchasing_supplier_products.supplier_sku` | Duplicate → 409; taken by a deleted row → per-line failure naming the row |
| Supplier immutability | A row's `supplier_id` never changes after creation (a code is only unique per supplier) | update command | `supplierId` is not part of the update schema; the field is read-only in the form |
| Non-destructive upsert | Import and sync write only non-empty, changed values; a blank source column never erases a stored value | `sourcing/lib/supplierProductImport.ts` | Nothing is written for that field; the row still counts as `updated`/`skipped` per its other fields |
| Sync (promote) | Explicit operator action that creates/updates the master product by SKU and backfills `product_id`; idempotent | `purchasing.supplier-products.promote` | `product_id` already set → `action: 'skipped'`; SKU owned by a deleted product → 422 `sku_belongs_to_deleted_product` |
| Un-synced row | A library row without `product_id`. Orderable (a snapshot is frozen) but not receivable/shippable | `purchasing_supplier_products.product_id` | Shipment allocation → 422 with the sync instruction |
| Order line supplier reference | `supplier_product_id` + `product_snapshot.supplierSku`. At most one of `supplierProductId` / `productId` / `catalogProductId` | `purchasing_purchase_order_lines` | Mixing → 400; none → 400; other supplier's row → 422 `supplier_product_supplier_mismatch` |
| Snapshot `supplierSku` | The supplier-facing code shown on the order and inherited by allocations: `item_no ?? supplier_sku` | `product_snapshot` (jsonb) | Missing key (historical rows) reads as `null` |
| Re-resolution on edit | Saving a draft order re-resolves its lines, so a line whose library row has since been synced picks up `product_id` and the catalog bridge. The *snapshot* stays frozen; the *resolution rule* does not | `resolveOrderLines` | Unresolvable reference → 400/422 as above, never a silent drop |
| Role group | One business role = one `pageGroupKey`. Six groups, in order: `purchasing.nav.group`, `cross_border.nav.group`, `export_finance.nav.group`, `products.nav.group`, `parties.nav.group`, `platform_ops.nav.group` | page metadata + `overrides.nav.groupOrder` | A page with no group falls to the framework default section; an unnamed group keeps its existing position |
| Scope | Organization-private: `tenant_id` + `organization_id` on the row, derived from the session, never from the payload | entities + `ensureScope` | Cross-organization read → 404 / empty list; missing organization → 400 `organization_scope_required` |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| Purchaser | View/create/update/delete supplier products; import from quotations; pick a supplier product on an order line | Organization-private; `tenantId`/`organizationId` from the session (fail closed) | `purchasing.supplier-products.view`, `purchasing.supplier-products.manage`, plus the existing `purchasing.orders.*` for orders |
| Product manager | Sync a library row into the product master | Same organization | `purchasing.supplier-products.promote` (depends on `products.items.manage` + `products.prices.manage`) |
| Trade operator | Read the supplier code on order lines and shipment allocations | Same organization | existing `cross_border.shipments.view` |
| HQ administrator | All of the above across descendant organizations | ACL organization allow-list + descendant expansion (platform mechanism) | same features, granted at HQ |

Trusted scope: every command resolves `tenantId`/`organizationId` from the command context
(`ensureScope`), never from the request body; the list route filters on both columns; the cross-module
read helpers filter on both columns too. No system-scope (`organizationId: null`) row is created —
no installed contract authorizes one here.

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| Supplier product library | app-own | `sourcing` (new entity) | — | Nothing installed models a supplier-side item list |
| Product master + prices | reuse | `products` | command bus: `products.items.create|update`, `products.prices.replace`; reads `products_products`/`products_prices` by scoped Kysely | The master owns identity, prices and the catalog bridge |
| Suppliers | reuse | `purchasing` | scalar `supplier_id` + name snapshot; picker reads `/api/purchasing/suppliers` | No cross-module ORM relation |
| Quotation lines | reuse | `sourcing` | in-module entity + new nullable `supplier_product_id` | Same module, same transaction |
| Purchase order lines | extend | `purchasing` | new nullable `supplier_product_id` + `product_snapshot.supplierSku`; scoped read of the library via `purchasing/lib/sourcingReads.ts` | Keeps one product reference per line and one frozen snapshot |
| Shipment allocations | reuse | `cross_border` | `supplierSku` read out of the frozen snapshot; guard message reworded | No schema change, no second link |
| CRUD/commands/events/i18n/ACL/pages | reuse | platform | `makeCrudRoute`, command bus + `emitCrudSideEffects`, `CrudForm`, `DataTable`, `Page`/`PageBody`, `useT`, `acl.ts`, `events.ts` | Canonical primitives; no parallel substitutes |
| Sidebar grouping | reuse | platform | `pageGroupKey` + `overrides.nav.groupOrder` (wired domain) | No installed file is modified |

Installed records that remain the source of truth: `products_products` / `products_prices`
(master data), `purchasing_suppliers` (supplier identity), `purchasing_purchase_orders(_lines)`
(what was ordered), `sourcing_quotes(_lines)` (what was quoted), `catalog_products` (legacy bridge
for stock receipt). This change duplicates none of them.

## Architecture and Data Flow

```text
buyer (browser)
  -> POST /api/purchasing/supplier-products              (purchasing.supplier-products.create)
  -> POST /api/purchasing/supplier-products/import       (…import-from-quote)
  -> POST /api/purchasing/supplier-products/promote      (…promote)  -> products.items.* / products.prices.replace
                                                                  -> backfill product_id
quotation review console
  -> POST /api/sourcing/quotes/promote                 (existing)  -> products.items.* + library upsert
buyer (purchase order form)
  -> POST/PUT /api/purchasing/purchase-orders          -> resolveOrderLines
        reads purchasing_supplier_products (scoped, read-only)
        writes purchasing_purchase_order_lines.supplier_product_id + product_snapshot.supplierSku
trade operator
  -> POST /api/cross_border/shipments                  -> allocation inherits product_snapshot (incl. supplierSku)
```

- **Module boundaries:** the library belongs to `sourcing` because the quotation → library → master
  path is one invariant chain owned by that module. `purchasing` and `cross_border` never write it;
  they read it through a raw, scoped Kysely helper (the app-wide cross-module read pattern) or through
  a frozen snapshot.
- **Extension points:** none needed — all surfaces are app-owned pages/routes plus one
  `overrides.nav.groupOrder` app-level setting (`overrides.unified-registry`).
- **Alternatives considered:** see the decision table (a `products`-embedded library, a separate
  module, ORM relations, allocation-level links).
- **Compatibility:** new table, two new nullable columns, three new API routes, three new feature
  ids, three new event ids — all additive under `BACKWARD_COMPATIBILITY.md`. The one existing contract
  touched is the order-line `refine`, which is **widened** (three references allowed instead of
  exactly two, and a mixed reference is now rejected explicitly), never narrowed; the existing
  `productId`-only and `catalogProductId`-only payloads keep behaving exactly as before.

## User Journeys

### Journey J-SPL-001 — Maintain a supplier's library by hand

1. Buyer opens `/backend/purchasing/suppliers`, uses the row action 「产品库」 (or opens
   `/backend/purchasing/supplier-products` directly) — the list is filtered to that supplier.
2. Buyer clicks 「新建」, picks the supplier, types the supplier code, name, unit and optional
   packaging fields; save.
3. Row appears in the list with status 在售 and source 手工; a second row with the same code for the
   same supplier is refused with a readable 409 message.
4. Wrong-supplier or missing required fields → inline validation; a stale `updatedAt` on save → 409
   with the standard conflict message and no overwrite.

### Journey J-SPL-002 — Turn a quotation into library rows

1. Buyer opens `/backend/sourcing/quotes/[id]`, reviews the parsed lines and approves the quotation.
2. Buyer selects lines and runs 「加入产品库」 (or the existing 「提升所选为商品」, which now also upserts
   the library).
3. The result banner reports `新建 / 更新 / 跳过 / 失败` counts; failed lines name the line number and
   the reason (no item number; code owned by a deleted row).
4. The library list now shows the rows with source 报价 and the source quotation recorded; a second
   run reports the same lines as 跳过 and changes nothing.

### Journey J-SPL-003 — Sync a library row into the product master

1. Buyer (or product manager) clicks 「同步为商品」 on a library row.
2. The system creates or updates the master product by SKU (name, spec, HS, unit, unit net weight,
   unit dimensions, Qty/Box) and merges the `purchase`-tier price row from the newest matching
   quotation line when one exists.
3. The row's 「关联商品」 column now shows the master SKU; running the action again reports 已同步，跳过.
4. A SKU owned by a soft-deleted product → readable 422; nothing is written.

### Journey J-SPL-004 — Order from the supplier's library and ship it

1. Buyer opens `/backend/purchasing/orders/create`, picks the supplier, then picks each line's item
   from that supplier's library (or switches the row to the product-master picker).
2. Save → 201; the order detail shows the supplier code under the product name.
3. A row from another supplier → 422 `supplier_product_supplier_mismatch` naming the item.
4. Trade operator allocates the line to a shipment: if the library row was synced and catalog-linked,
   the allocation succeeds and shows the supplier code; otherwise the guard explains that the item
   must be synced and catalog-linked first.

### Journey J-SPL-005 — Find the right menu as a role

1. A purchaser logs in and sees exactly one 「采购」 group: 供应商, 供应商产品库, 采购单, 供应商报价.
2. A trade operator sees 「外贸」: 内部销售报价/订单, 购销合同, 发票, 发运单.
3. A finance operator sees 「财务」: 订单档案, 柜档案.
4. A role without a page's feature never sees that item (existing per-page gates unchanged).

### Journey J-SPL-006 — Link a row to a product that already exists (Phase 8)

1. Buyer opens `/backend/purchasing/supplier-products`, filters 建档状态 = 未建档 and sees the backlog.
2. For a row whose supplier code is *not* our SKU, the buyer picks 关联已有商品, searches the product
   master by SKU or name, and confirms — the 商品 column now shows that product's name and SKU and
   links to its edit page. No second product record is created.
3. If the pick was wrong, 换绑 points the row at another product, or 解除关联 returns it to 未建档.
4. A field corrected on the library row afterwards is pushed with 同步字段到商品, which reports the
   fields it wrote; the product's catalog link and its 内部结算价 / 对外销售价 are untouched.

### Journey J-SPL-007 — Clear the backlog in one pass (Phase 8)

1. Buyer selects the rows imported from a quotation (all 未建档) and runs 批量建商品档案.
2. The result reports `新建 / 更新 / 跳过 / 失败`, names each failing row with its reason, and leaves
   the failures untouched.
3. The result offers a link back to the list filtered 已建档 (a batch has no single product to open);
   from there, a row's 商品 link — or the single-row 建商品档案 flash — opens the product, where the
   catalog link and the variant are set: the step that actually unlocks shipping and stock receipt.

## UI and Interaction Contracts

Reference page for every new surface:
`src/modules/purchasing/components/SuppliersTable.tsx` (list + row actions) and
`src/modules/purchasing/components/SupplierForm.tsx` (create/edit form + payload builders), plus the
sourcing quotation pages for page metadata. Guides read: `.ai/guides/backend-ui.md`.

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/purchasing/supplier-products` | Library list: filter by supplier/status/search, sort, paging; row actions 编辑 / 建商品档案 (the `promote` command; relabelled 2026-09-23 from 同步为商品) / 删除 | `GET /api/purchasing/supplier-products`; `POST …/promote`; `DELETE` via `makeCrudRoute`; supplier options from `GET /api/purchasing/suppliers` | `src/modules/purchasing/components/SuppliersTable.tsx` | `Page`, `PageBody`, `DataTable`, `StatusBadge`, `useT` | loading, empty, error, conflict, permission denied | REQ-SPL-002, REQ-SPL-005 |
| `/backend/purchasing/supplier-products/create` | Create a library row | `POST /api/purchasing/supplier-products` | `src/modules/purchasing/components/SupplierForm.tsx` | `Page`, `PageBody`, `CrudForm` | loading, validation error, 409 duplicate code, permission denied | REQ-SPL-001, REQ-SPL-002, REQ-SPL-011, REQ-SPL-012, REQ-SPL-015 |
| `/backend/purchasing/supplier-products/[id]/edit` | Edit a row (supplier read-only) + its price list + photos; the unit is a dictionary dropdown and images upload against the saved row | `PUT /api/purchasing/supplier-products` (optimistic lock via `updatedAt`), `GET|PUT /api/purchasing/supplier-products/prices`, `POST /api/attachments` | `src/modules/purchasing/components/SupplierForm.tsx`, `src/modules/products/components/ProductForm.tsx` (price-rows editor) | `Page`, `PageBody`, `CrudForm` + bare group components (`PackingEditor`, `SupplierProductPriceRows`, `SupplierProductImages`) | loading, conflict (409), validation error, delete confirm, permission denied, dictionary service unavailable (the shared loader yields no options and the field stays free text), upload failure, empty price list, empty image list | REQ-SPL-001, REQ-SPL-002, REQ-SPL-011, REQ-SPL-012, REQ-SPL-013, REQ-SPL-014, REQ-SPL-015 |
| `/backend/sourcing/quotes/[id]` (changed) | Review console: the line grid's bulk actions gain 「加入产品库」 next to 「提升所选为商品」, reporting `added/updated/unchanged/failed` and naming the failing lines | `POST /api/purchasing/supplier-products/import` | `src/modules/sourcing/components/QuoteLinesGrid.tsx` | `DataTable` bulk actions, `flash` status | loading (label carries the running state), empty selection, per-line failure, permission denied | REQ-SPL-003, REQ-SPL-004 |
| `/backend/purchasing/supplier-products` (changed, Phase 8) | The 关联商品 column becomes 商品: the linked product's **name + SKU**, the cell linking to `/backend/products/items/{id}/edit` (a soft-deleted link renders 已关联的商品已删除, warning tone); an unlinked row shows a 未建档 badge with inline 建商品档案 and 关联已有商品 actions; a row linked to a deleted product shows 换绑 / 解除关联 instead; the toolbar gains a 建档状态 filter (全部 / 未建档 / 已建档, server-side on the stored `product_id`) and the table gains row selection with a 批量建商品档案 bulk action; row actions become 编辑 / 建商品档案 / 关联已有商品 / 同步字段到商品 / 换绑 / 解除关联 / 打开商品 / 删除; the single-row 建商品档案 result renders a dismissible success alert above the table whose footer links to the product's 官方目录链接 (`flash()` carries no link), while the **bulk** result reports `created/updated/skipped/failed` (a batch has no single product to open) | `GET /api/purchasing/supplier-products` (already returns `productId`, `productSku`, `productName`, plus the new `productDeleted` and the `linked` filter; `disableListCache` stays for the live label), `POST …/promote`, `POST …/promote-batch`, `POST …/link` (`productId` or `null`), `POST …/sync-fields`, `DELETE` | `src/modules/purchasing/components/SuppliersTable.tsx` (list + `RowActions` + `useConfirmDialog` patterns) and `src/modules/sourcing/components/QuoteLinesGrid.tsx` (bulk action that reports counts) | `Page`, `PageBody`, `DataTable` (row selection, `bulkActions`), `RowActions`, `StatusBadge`, `useConfirmDialog`, `flash`, `useBackendChrome()` + `hasFeature` for the client-side gates | loading, empty library, empty filter result, error, conflict (409 when a row was edited meanwhile), permission denied (a role without `manage` sees no 关联已有商品/换绑/解除关联 and no selection column; a role with `manage` but without `purchasing.supplier-products.promote` sees no 建商品档案/批量建商品档案/同步字段到商品 — the server stays the authority and answers 403 either way), deleted-link state, bulk partial failure (`created/updated/skipped/failed` summary, failures named), light and dark | REQ-SPL-017, REQ-SPL-018, REQ-SPL-019, REQ-SPL-020 |
| `/backend/purchasing/supplier-products/(create\|edit)` (changed, Phase 8) | The 供应商货号 field help states the matching rule: this code is the product master's SKU; a code that intentionally differs is linked from the list (关联已有商品), never duplicated | — (help text only) | `src/modules/purchasing/components/SupplierProductForm.tsx` | `CrudForm` field `description` | unchanged | REQ-SPL-017, REQ-SPL-019 |
| `/backend/purchasing/orders/create` (changed, Phase 8) | Library suggestions in the merged line picker carry their link state in the option description: 已建档 / 未建档：建过档才能发运、收货 | `GET /api/purchasing/supplier-products?supplierId=…&status=active` (the loader reads the `productId` the payload already returns) | `src/modules/purchasing/components/PurchaseOrderForm.tsx` + `orderFormOptions.ts` | `CrudForm` line editor, combobox option description (existing pattern) | supplier not chosen (picker disabled + hint), load failure (named once), unlinked option labelled | REQ-SPL-021 |
| `/backend/purchasing/orders/create` (changed) | Line editor gains a supplier-library picker, switchable with the product-master picker | `GET /api/purchasing/supplier-products?supplierId=…&status=active`; `POST /api/purchasing/purchase-orders` | `src/modules/purchasing/components/PurchaseOrderForm.tsx` | `CrudForm` + existing line editor | supplier not chosen (picker disabled + hint), load failure (visible error), server 422 mismatch surfaced | REQ-SPL-006, REQ-SPL-007 |
| `/backend/purchasing/orders/[id]` (changed) | Line table shows the supplier code under the product name | `GET /api/purchasing/purchase-orders/lines` | `src/modules/purchasing/components/PurchaseOrderDetail.tsx` | `DataTable` (read-only) | absent code (historical lines) renders nothing | REQ-SPL-007 |
| `/backend/cross_border/shipments/[id]` (changed) | Allocation rows show the supplier code | `GET /api/cross_border/shipments/allocations` | `src/modules/cross_border/components/ShipmentDetail.tsx` | existing allocation table | absent code renders nothing | REQ-SPL-008 |

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| Purchaser | 采购 → 供应商, 供应商产品库, 采购单, 供应商报价 | none added | login → 采购 → 采购单 → create (2 clicks) |
| Trade operator | 外贸 → 内部销售报价, 内部销售订单, 购销合同, 发票, 发运单 | none added | login → 外贸 → 发运单 |
| Finance operator | 财务 → 订单档案, 柜档案 | none added | login → 财务 → 订单档案 |
| Product manager | 商品主数据 → 商品, 类型, 分类 | none added | login → 商品主数据 → 商品 |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| Library list | 「还没有该供应商的产品，点『新建』添加第一行」 + 新建 action | table scrolls horizontally on narrow width; filters wrap | search first in tab order; row actions reachable by keyboard; delete confirm is focus-trapped |
| Library form | n/a (form) | single column on narrow width; packing inputs stack | supplier select first; save/cancel at the end; 409 surfaces a status message |
| Order line editor | picker lists "该供应商暂无产品，请先在供应商产品库添加" when empty | line editor stacks on narrow width | picker → quantity → unit price → note; the mode switch is a real button, not a div |

### `/backend/purchasing/supplier-products` — Supplier product library

```text
┌──────────────────────────────────────────────────────────────┐
│ 供应商产品库                                     [新建产品]  │
│ [供应商 ▾] [状态 ▾] [建档状态 ▾] [搜索货号/品名]             │
├──────────────────────────────────────────────────────────────┤
│ ☐ 已选 3 行                        [批量建商品档案（3）]      │
│ DataTable: ☐ | 供应商 | 货号 | 品名 | 单位 | MOQ | 装箱数 |   │
│            商品 | 状态 | 来源 | 更新时间                     │
│  商品列（未建档）: 未建档  [建档] [关联已有商品]             │
│  商品列（已建档）: Eversweet 3 Pro · P-4108 →              │
├──────────────────────────────────────────────────────────────┤
│ pagination + total                                           │
└──────────────────────────────────────────────────────────────┘
```

- **Behavior:** server-side paging/sorting/search through `fetchCrudList`; `?supplierId=` seeds the
  supplier filter; row actions 编辑 (navigate), 同步为商品 (only when `productId` is empty; confirm
  dialog, then reload), 删除 (destructive confirm).
- **Phase 8 behavior (REQ-SPL-017…020):** the 商品 column renders `productName` + `productSku` as a
  link to `/backend/products/items/{id}/edit` (the payload already carries both, resolved live in
  `afterList`), and renders 已关联的商品已删除 when `productDeleted` is set; an unlinked row shows the
  未建档 badge with inline 建商品档案 / 关联已有商品 actions instead of burying them in `⋯`; the
  建档状态 filter (全部 / 未建档 / 已建档, server-side on the stored `product_id`) and the
  row-selection bulk 批量建商品档案 action share the list's existing toolbar; the post-建商品档案
  flash carries a 去填官方目录链接 link, because that field — not the link itself — is what unlocks
  shipping; each write action is hidden without its feature (`promote` for the three master-writing
  actions, `manage` for the three link actions); and the row actions for a linked row become
  同步字段到商品 / 换绑 / 解除关联 / 打开商品. The 建商品档案 confirm dialog names what it will write
  (SKU, name, and that an existing same-SKU product is **updated**,
  not duplicated), and the 关联已有商品 picker searches the product master by SKU or name within the
  caller's organization.
- **Form layout (REQ-SPL-015):** six groups, so an operator who only ever read the supplier's
  workbook can still find a field. Column 1 — 「商品标识」 (`supplierId`/`supplierSku`/`name`/`nameZh`/
  `nameEn`/`imageAttachmentIds`), 「报关信息」 (`hsCode`/`declarationElements`/`unit`) and 「价格」 (the
  price-rows editor); column 2 — 「包装与单重」 (`cartonQuantity`/`unitNetWeight`/`moqQuantity`),
  「产品尺寸」 (`innerPacking`, its own self-titled card — the id and column name are inherited from the
  supplier sheet's 内箱尺寸 column, and the label was renamed on 2026-09-23 because 「内盒尺寸」 read as
  an inner box when the field is the item's own size), 「供应商原始资料」
  (`itemNo`/`description`/`notes`) and 「状态」 (`status`). ERP-generic fields live in 商品标识 /
  报关信息 / 价格 / 包装与单重; the supplier-sheet原文 lives in 供应商原始资料. The group titles changed
  with the 2026-09-23 pruning: 「包装与重量」 promised carton weights the form no longer has.
- **Price rows are a column-1 group (2026-09-23).** `CrudForm` has no full-width group: a `column: 2`
  group is drawn into a `3fr` sidebar — measured 389px at a 1440px viewport — which left the row's
  five controls 73px/73px/45px/45px/45px wide with 「供应商供货价（PK 单价）」 truncated to 「供应」. The
  row grid is a container query rather than a viewport one (`@md` pairs the pickers, then the numbers;
  `@3xl` restores the single-line 12-column row), so the section also holds in the single column the
  form falls back to below `lg`.
- **Field help:** every abbreviation carries its full form in the label or the inline `description`
  (L×W×H = Length×Width×Height cm, Qty/Box = 每箱数量, MOQ = Minimum Order Quantity 最小起订量,
  HS = Harmonized System 海关编码,
  申报要素 = 报关申报要素), and the legacy 「PK / KC」 abbreviations are explained on the price kinds
  (PK = 供应商, KC = 本公司) instead of naming a column.
- **Responsive and accessibility:** horizontal scroll for the table on narrow width, labelled filter
  controls, `aria-live` status for promote/delete results, keyboard-reachable row actions.
- **Localization:** `sourcing.supplierProducts.*` in `src/modules/sourcing/i18n/{zh,en}.json`.
- **Design-system and theming:** shared `DataTable`/`CrudForm`/`StatusBadge`, semantic tokens only,
  verified in light and dark mode.

## Data Models

### `PurchasingSupplierProduct` (`purchasing_supplier_products`)

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | uuid, required | primary key | no | immutable |
| `tenant_id` / `organization_id` | uuid, required | `purchasing_supplier_products_scope_idx` | no | trusted context only |
| `supplier_id` | uuid, required | `purchasing_supplier_products_supplier_idx` | no | immutable after create; scalar id into `purchasing_suppliers` |
| `supplier_name_snapshot` | text, nullable | — | no | frozen at write through `loadSupplierName` |
| `supplier_sku` | text, required | unique per `(tenant, organization, supplier)` incl. soft-deleted | no | 1–120 chars, trimmed; duplicate → 409 |
| `item_no` | text, nullable | — | no | the supplier's original item number (display) |
| `name` | text, required | — | no | 1–300 chars; the supplier's raw product name |
| `name_zh` | text, nullable | — | no | ≤ 300 chars; our Chinese name; becomes the master's `name` on sync |
| `name_en` | text, nullable | — | no | ≤ 300 chars; our English name; becomes the master's `name_en` on sync |
| `description` | text, nullable | — | no | maps to `products.spec_summary` on sync (newlines → ` / `, 500 chars) |
| `declaration_elements` | text, nullable | — | no | ≤ 2000 chars; 报关申报要素, copied verbatim onto declarations (no lookup, no normalization) |
| `unit` | text, required | — | no | default `PCS`; the form offers the `supplier_product_unit` dictionary, the API accepts any ≤ 24-char code |
| `hs_code` | text, nullable | — | no | ≤ 32 chars; **text on purpose** — leading zeros and dotted groups (`8471.30.0000`) survive, which a numeric column would corrupt |
| `image_attachment_ids` | jsonb, required, default `[]` | — | no | ≤ 12 attachment ids in display order; replace-set semantics (`[]` clears, omitted leaves alone) |
| `moq_quantity` / `carton_quantity` | integer, nullable | — | no | ≥ 0; `carton_quantity` is 装箱数 Qty/Box and stays |
| `unit_net_weight` | numeric(16,4), nullable | — | no | ≥ 0, decimal string |
| `inner_packing` | jsonb, nullable | — | no | `{ length, width, height, unit: 'cm' }` |
| ~~`carton_gross_weight` / `carton_net_weight` / `outer_packing`~~ | dropped 2026-09-23 (D5) | — | — | whole-carton data is not maintained by a buyer; the columns are dropped by `Migration20260923065528_sourcing` (`up`: `drop column "carton_gross_weight", drop column "carton_net_weight", drop column "outer_packing"`, with the matching `down`) — filed in `sourcing` because module chains are applied in module-id order, so anything touching this table must ride the chain that creates and renames it |
| `product_id` | uuid, nullable | — | no | backfilled by sync → `products_products.id`; no reverse column on the master |
| `status` | text, required | — | no | `active` \| `inactive`, default `active` |
| `source` | text, required | — | no | `manual` \| `quote`, default `manual` |
| `last_quote_id` / `last_quote_line_id` | uuid, nullable | — | no | the quotation that last fed this row |
| `notes` | text, nullable | — | no | — |
| `created_at` / `updated_at` | timestamptz, required | `updated_at` is the optimistic-lock version | no | `CrudForm` submits `updatedAt`; stale → 409 |
| `deleted_at` | timestamptz, nullable | soft delete | no | delete is allowed while referenced (order lines keep their snapshot) |

Indexes: `purchasing_supplier_products_scope_idx (organization_id, tenant_id)`,
`purchasing_supplier_products_supplier_idx (supplier_id)`,
`purchasing_supplier_products_scope_supplier_sku_uniq (tenant_id, organization_id, supplier_id, supplier_sku)`
— **no** `deleted_at` predicate (a code stays owned), matching `products_variants`; duplicate checks
therefore query soft-deleted rows too, so a clash returns 409 instead of a 500.

### `PurchasingSupplierProductPrice` (`purchasing_supplier_product_prices`)

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | uuid, required | primary key | no | immutable |
| `tenant_id` / `organization_id` | uuid, required | `purchasing_supplier_product_prices_scope_idx` | no | trusted context only |
| `supplier_product_id` | uuid, required | `purchasing_supplier_product_prices_product_idx` | no | same-module `ManyToOne` with `deleteRule: 'cascade'`; the price list has no meaning without its item |
| `price_kind` | text, required | part of the unique key | no | `supplier_cost` \| `company_offer` (`lib/priceKinds.ts`); the code names **who prices the item**, never a company or a currency |
| `currency_code` | text, required | part of the unique key | no | three uppercase letters, checked against the currency dictionary before the write |
| `min_quantity` | integer, required | part of the unique key | no | ≥ 1, default 1; the base price the list column shows |
| `unit_price` | numeric(18,6), required | — | no | ≥ 0, decimal string; never float arithmetic |
| `is_active` | boolean, required | — | no | default true; a row missing from the submitted set is deactivated, never deleted |
| `created_at` / `updated_at` | timestamptz, required | — | no | the set is replaced as a whole, so a row carries no per-row client version |

Unique key `purchasing_supplier_product_prices_key_uniq (tenant_id, organization_id,
supplier_product_id, price_kind, currency_code, min_quantity)` — deliberately **without** an
`is_active` predicate: reactivating a price reuses its row, so a deactivated and an active row can
never coexist for one key. Indexes: `…_scope_idx (organization_id, tenant_id)`, `…_product_idx
(supplier_product_id)`.

### Changed columns

| Entity | Column | Type | Contract |
|---|---|---|---|
| `SourcingQuoteLine` | `supplier_product_id` | uuid, nullable | the library row this quotation line fed; written by import/promotion |
| `PurchasingPurchaseOrderLine` | `supplier_product_id` | uuid, nullable | the library row this line was ordered from |
| `PurchasingPurchaseOrderLine` | `product_snapshot.supplierSku` | jsonb key | display code (`item_no ?? supplier_sku`); historical snapshots lack the key and read as `null` |

Migration boundary: generated only (`yarn db:generate`), reviewed, applied only after the owner
approves `yarn db:migrate` (AGENTS.md "Ask First"). Integration tests run on the ephemeral database.

**Migration state (checked 2026-09-23).** `yarn db:generate` produced
`src/modules/sourcing/migrations/Migration20260922103027_sourcing.ts` (the table, its two indexes and
the unique key, plus `sourcing_quote_lines.supplier_product_id`) and
`src/modules/purchasing/migrations/Migration20260922103027_purchasing.ts` (one `add column`); both
were reviewed against this spec and both module snapshots updated. They are **applied**:
`mikro_orm_migrations_sourcing` / `_purchasing` record `executed_at 2026-09-22T10:34:27Z`, and a
read-only schema check on the dev database confirms `purchasing_supplier_products` plus
`supplier_product_id` on both `sourcing_quote_lines` and `purchasing_purchase_order_lines`. The
application was applied by the environment's own boot (`yarn db:migrate` then reports "no pending
migrations" for every module), not by a hand-run migration inside this change.

**Integration-run precondition (environment, not code).** `yarn test:integration:ephemeral` starts
the app in production mode, and the production auth module refuses to boot while `JWT_SECRET` is the
placeholder this checkout carries in `.env` (`change-me-dev-secret`, published in `.env.example`):
`[auth.jwt] Refusing to run in production with an unsafe signing secret`. Pass a real secret for the
run (`JWT_SECRET=$(openssl rand -hex 32) yarn test:integration:ephemeral`); nothing in this change
depends on it, and no value was written to a tracked file.

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| `GET` | `/api/purchasing/supplier-products` | auth + `purchasing.supplier-products.view` | `supplierProductListSchema` (`supplierId`, `status`, `search`, `linked`, `page`, `pageSize`, `sortField`, `sortDir`); `linked` is `all \| linked \| unlinked` (default `all`, Phase 8) and filters the stored `product_id` server-side | `{ items, total, page, pageSize }` with `supplierSku`, `productSku`, `productName`, `productDeleted` (Phase 8: `productId` set but no live product resolves — present only on pages that hold at least one linked row, because the label read that produces it is skipped for a page of unlinked rows), `updatedAt` | 400 invalid query, 401, 403 | REQ-SPL-002, REQ-SPL-017 |
| `POST` | `/api/purchasing/supplier-products` | auth + `purchasing.supplier-products.manage` | `supplierProductCreateSchema` | 201 `{ id }` + `sourcing.supplier_product.created` | 400 `supplier_not_found`, 409 `supplier_product_sku_taken`, 403 | REQ-SPL-001 |
| `PUT` | `/api/purchasing/supplier-products` | auth + `purchasing.supplier-products.manage` | `supplierProductUpdateSchema` (+ `x-expected-version`) | 200 `{ ok: true }` + `…updated` | 404, 409 `optimistic_lock_conflict`, 409 duplicate code | REQ-SPL-001 |
| `DELETE` | `/api/purchasing/supplier-products` | auth + `purchasing.supplier-products.manage` | `{ id }` | 200 `{ ok: true }` + `…deleted` | 404 | REQ-SPL-001 |
| `POST` | `/api/purchasing/supplier-products/import` | auth + `purchasing.supplier-products.manage` | `{ quoteId, lineIds[1..200] }` | 200 `{ created, updated, skipped, failed[] }` | 400 `quote_lines_not_found`, 404 quote, 422 `quote_supplier_required` | REQ-SPL-003, REQ-SPL-004 |
| `POST` | `/api/purchasing/supplier-products/promote` | auth + `purchasing.supplier-products.promote` | `{ id }` | 200 `{ productId, action }` | 404, 422 `sku_belongs_to_deleted_product` | REQ-SPL-005 |
| `POST` | `/api/purchasing/supplier-products/link` (Phase 8) | auth + `purchasing.supplier-products.manage` | `{ id, productId: uuid \| null }` (`null` = 解除关联) | 200 `{ productId }` + `purchasing.supplier_product.updated` | 400 invalid payload, 404 unknown row, 404 `product_not_found` (unknown or foreign-organization product), 422 `product_deleted` — the target's scope and liveness are re-checked **inside the transaction that writes `product_id`**, so a product deleted between the picker's read and the write is refused with nothing written | REQ-SPL-019 |
| `POST` | `/api/purchasing/supplier-products/sync-fields` (Phase 8) | auth + `purchasing.supplier-products.promote` (it writes the master) | `{ id }` | 200 `{ productId, fieldsChanged[], priceChanged }`; the **products** commands' own events only — the library row itself is unchanged, so no `purchasing.supplier_product.updated` is emitted | 404, 422 `supplier_product_not_linked`, 422 `product_deleted`, 422 `too_many_price_rows` (unchanged price-set rule) | REQ-SPL-020 |
| `POST` | `/api/purchasing/supplier-products/promote-batch` (Phase 8) | auth + `purchasing.supplier-products.promote` | `{ ids: uuid[1..100] }`; duplicate ids are collapsed to their first occurrence before processing (counts always describe distinct rows) and a list that is empty after the collapse is a 400 | 200 `{ created, updated, skipped, failed[] }` where each failure is `{ id, code, message }` | 400 empty or >100 ids; an unknown id inside the batch is reported per row (404 semantics per row), never as a whole-request failure | REQ-SPL-018 |
| `GET` | `/api/purchasing/supplier-products/prices` | auth + `purchasing.supplier-products.view` | `supplierProductPriceListSchema` (`supplierProductId`/`supplierProductIds`, `priceKind`, `currencyCode`, `isActive`, paging) | `{ items, total, page, pageSize }` with `priceKind`, `currencyCode`, `minQuantity`, `unitPrice`, `isActive` | 400 invalid query, 401, 403 | REQ-SPL-013 |
| `PUT` | `/api/purchasing/supplier-products/prices` | auth + `purchasing.supplier-products.manage` | `supplierProductPricesReplaceSchema` (`supplierProductId`, `rows[]` ≤ 24) | 200 `{ ok: true }` + `purchasing.supplier_product_prices.updated` | 400 duplicate `(kind, currency, minQuantity)`, 400 unknown currency (the message names the code — this module's convention, same as the supplier and order forms), 404 unknown item | REQ-SPL-013 |
| command | `purchasing.supplier-products.create` | — | create schema | created event | 400/409 | REQ-SPL-001 |
| command | `purchasing.supplier-products.update` | — | update schema | updated event | 404/409 | REQ-SPL-001 |
| command | `purchasing.supplier-products.delete` | — | `{ id }` | deleted event | 404 | REQ-SPL-001 |
| command | `purchasing.supplier-products.import-from-quote` | — | `{ quoteId, lineIds }` | counts | 400/404/422 | REQ-SPL-003 |
| command | `purchasing.supplier-products.promote` | — | `{ id }` | `{ productId, action }` | 404/422 | REQ-SPL-005 |
| command | `purchasing.supplier-products.replace-prices` | — | `{ supplierProductId, rows[] }` | `{ supplierProductId, rows }` + `prices_updated` event | 400/404/422 | REQ-SPL-013 |
| command | `purchasing.supplier-products.link` (Phase 8) | — | `{ id, productId \| null }` | `{ productId }` + updated event | 404/422 | REQ-SPL-019 |
| command | `purchasing.supplier-products.sync-fields` (Phase 8) | — | `{ id }` | `{ productId, fieldsChanged, priceChanged }` + products events | 404/422 | REQ-SPL-020 |
| command | `purchasing.supplier-products.promote-batch` (Phase 8) | — | `{ ids }` | `{ created, updated, skipped, failed[] }` | per-row isolation; a row that fails does not affect its neighbours | REQ-SPL-018 |
| `POST`/`PUT` | `/api/purchasing/purchase-orders` (changed) | existing gates | line gains `supplierProductId?` | unchanged | 400 no reference / mixed references, 422 `supplier_product_supplier_mismatch` | REQ-SPL-006 |
| `GET` | `/api/purchasing/purchase-orders/lines` (changed) | existing gate | unchanged | adds `supplierProductId`, `supplierSku` | unchanged | REQ-SPL-007 |
| `GET` | `/api/cross_border/shipments/allocations` (changed) | existing gate | unchanged | adds `supplierSku` | unchanged | REQ-SPL-008 |

All three new routes are `makeCrudRoute`/custom command routes with per-method `metadata`
(`requireAuth` + `requireFeatures`) and an `openApi` document; scope comes from the command context,
never from the payload. The list route is read-only and indexer-backed
(`entityType: 'purchasing:purchasing_supplier_product'`).

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| `sourcing.supplier_product.created` | `sourcing` (CRUD side effects) | client broadcast (list refresh) | sidebar/list refresh | persistent + `clientBroadcast`; idempotent by nature |
| `sourcing.supplier_product.updated` | `sourcing` (CRUD side effects, incl. `promote` backfill) | client broadcast | list refresh | as above |
| `sourcing.supplier_product.deleted` | `sourcing` | client broadcast | list refresh | soft delete; order lines keep their snapshot |
| `purchasing.supplier_product_prices.updated` | `sourcing` (`replace-prices`, one emission per touched row) | client broadcast | list/price-grid refresh | emitted for deactivated rows too, so a grid that still shows a removed price refreshes; the payload names the item, never an amount |
| `products.item.created` / `products.item.updated` | `products` commands (invoked by `promote`, `promote-batch`, `sync-fields`) | existing subscribers | product index/audit | unchanged; `promote` is idempotent through `product_id` |
| `purchasing.supplier_product.updated` (link / unlink / sync-fields, Phase 8) | `purchasing` CRUD side effects on the row | client broadcast | list refresh: the row's label, badge and actions change | same shape as every other row update; the link write needs no version header (the caller is not editing a field) but it **bumps** `updated_at`, so a form open in parallel conflicts on save instead of silently losing the new link |

No scheduled job, queue or notification type is added. `promote` is a synchronous command; the
`import-from-quote` command is bounded to 200 lines per call, which is the request bound.

## Security, Privacy, and Compliance

- **Authorization:** feature gates per route method; no role-name checks. `purchasing.supplier-products.promote`
  depends on `products.items.manage` + `products.prices.manage`, so a sourcing-only role cannot grant
  itself master-data writes.
- **Tenant isolation:** every command derives scope through `ensureScope`; list and cross-module reads
  filter on `tenant_id` + `organization_id` and fail closed; a foreign id yields 404/empty, never data.
- **Sensitive data:** supplier cost data now lives on two records — the quotation line and the
  library's `supplier_cost` price row — both organization-private and behind
  `purchasing.supplier-products.*` / `sourcing.quotes.*`; the library holds no personal data. Nothing
  new is encrypted, and the price event payload carries identifiers only, never an amount.
- **Abuse and failure modes:** duplicate code is a 409, never a 500 (the check queries soft-deleted
  rows); `import` caps at 200 lines; a price submission caps at 24 rows and rejects a duplicate
  `(kind, currency, minQuantity)` key; `promote` is idempotent; the order-line resolution rejects
  mixed references instead of silently preferring one; the sidebar change touches no authorization
  (each page keeps its `requireFeatures`). Image uploads go through the installed `attachments`
  route, so the row never accepts a client-supplied file path and unlinking never deletes a file.
- **Phase 8 write surface:** `link` requires `purchasing.supplier-products.manage` and writes exactly
  one column on the row (`product_id`); `sync-fields` and `promote-batch` require
  `purchasing.supplier-products.promote`, i.e. the same `products.items.manage` +
  `products.prices.manage` dependency every other master write already carries. The link command
  resolves the target product with a scoped read whose scope and liveness conditions are applied
  **inside the transaction that writes `product_id`**: a product outside the caller's organization or
  tenant is a 404, and a soft-deleted product (even one deleted between the picker's read and the
  write) is a 422 — neither is ever silently linked. The client hides each action the caller's
  granted features do not cover (`useBackendChrome()` + `hasFeature`), but that is presentation
  only: every route enforces its own gate and answers 403. No new feature ID is introduced (nothing
  new is authorized), and no route accepts a scope from the payload.

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-SPL-001 | integration | tenant + org A/B, role with `sourcing.*`, supplier A and supplier B | `POST /api/purchasing/supplier-products` twice with the same `(supplierId, supplierSku)`; then `GET` with `search` | 201 then 409 `supplier_product_sku_taken`; list returns exactly the created row with its code | REQ-SPL-001, REQ-SPL-002 |
| TEST-SPL-002 | integration | approved manual quotation with one line (`itemNo`, `derivedSku`, `unitCost`) | `POST …/import` twice | 1st `{created:1, skipped:0}`, row `source='quote'`, code = `derived_sku`; 2nd `{created:0, skipped:1}` and the row is unchanged | REQ-SPL-003 |
| TEST-SPL-003 | integration | a library row from TEST-SPL-002 | `POST …/promote` twice; then `GET /api/products/items?ids=` | 1st `{action:'created'}` with `sku`/`specSummary`; 2nd `{action:'skipped'}`; product count unchanged | REQ-SPL-005 |
| TEST-SPL-004 | integration | two suppliers with libraries; an order on supplier A | `POST /api/purchasing/purchase-orders` with B's row, then with A's row; then `GET …/lines?orderId=` | 422 `supplier_product_supplier_mismatch`; then 201 with `supplierProductId` + `supplierSku` in the line projection | REQ-SPL-006, REQ-SPL-007 |
| TEST-SPL-005 | security | org A data, org B session; a role without `purchasing.supplier-products.view` | read org A's library with B's token; call the list with the unprivileged role | empty/404, no data leak; 403 | REQ-SPL-010 |
| TEST-SPL-006 | UI (manual smoke, dev server) | seeded supplier, library row, approved quotation | walk J-SPL-001 … J-SPL-005 in the browser | six sidebar groups in order; one 采购 group; picker lists only the chosen supplier's items; supplier code on the order detail | REQ-SPL-002, REQ-SPL-007, REQ-SPL-009 |
| TEST-SPL-007 | integration | library row A (org A) and a row of org B; currency dictionary seeded | `PUT /api/purchasing/supplier-products/prices` with two rows (supplier_cost/CNY, company_offer/USD), then again with only one; then a payload with a duplicate key and with an unknown currency; `GET …/prices` for org B with org A's item | first PUT 200 and `GET` returns both rows; second PUT 200 with the removed row `isActive: false` (still returned, never deleted); duplicate key 400; unknown currency 422 `currency_not_in_dictionary`; org B's read is empty/404 | REQ-SPL-013, REQ-SPL-010 |
| TEST-SPL-008 | integration | library row; product master without a matching SKU | `PUT /api/purchasing/supplier-products` with `nameZh`/`nameEn`/`declarationElements`/`imageAttachmentIds` and `unit: 'SET'`; re-read; then `POST …/promote` | the update echoes the new values and the re-read matches (including the cleared image list); the promotion creates the master product with `name = nameZh`, `nameEn` and the `purchase` price row taken from the library's `supplier_cost` row; an unknown unit code is still accepted | REQ-SPL-011, REQ-SPL-012, REQ-SPL-014, REQ-SPL-016 |
| TEST-SPL-009 | integration | one library row whose `supplier_sku` deliberately differs from every product SKU; two products in org A, one in org B | `POST …/link` with the org-A product; re-read the list; `POST …/link` with the other product (换绑); `POST …/link` with `productId: null` (解除); `POST …/link` with the org-B product and with a soft-deleted product; then link again and soft-delete the product afterwards; `GET …?linked=linked` and `?linked=unlinked` | each call 200 and the row's `productId` follows; the list renders the product's name/SKU for the whole page; **no extra product row is created** (count unchanged); org-B product → 404 `product_not_found`, soft-deleted → 422 `product_deleted`, and the row is unchanged in both cases; after the later soft delete the row reports `productDeleted: true`, stays in the `linked` bucket, and 解除 returns it to `unlinked` | REQ-SPL-019, REQ-SPL-017 |
| TEST-SPL-010 | integration | a linked row whose name/spec/price were edited afterwards; its product carries `internal` + `export` price rows, a catalog link and one variant | `POST …/sync-fields` twice; then `GET /api/products/items/{id}` | 1st call 200 with `fieldsChanged` naming the fields and `priceChanged: true`; the product's name/spec match the row, the `purchase` tier follows the row's `supplier_cost` row, `internal`/`export`, `catalog_product_id` and the variant set are untouched; 2nd call reports no field change; an unlinked row → 422 `supplier_product_not_linked` | REQ-SPL-020 |
| TEST-SPL-011 | integration | three unlinked rows: one new SKU, one SKU that already exists, one whose SKU belongs to a soft-deleted product | `POST …/promote-batch` with all three ids, then again with the same ids, then with a payload that repeats one id, then with an empty list | 1st call `{ created: 1, updated: 1, skipped: 0, failed: [{ code: 'sku_belongs_to_deleted_product' }] }`; the two successful rows carry `productId`, the failed row is untouched; 2nd call reports the two as `skipped` and the failure again, and creates nothing new; the repeated-id payload counts the row once; the empty payload is 400 | REQ-SPL-018 |
| TEST-SPL-012 | UI (manual smoke, dev server) | a supplier with linked, unlinked, code-mismatched and deleted-link rows; one role with `manage` only and one with `view` only | walk the list: 未建档 filter → bulk 建商品档案 → inline 建商品档案 on a single row → 关联已有商品 → 换绑 → 解除关联 → 同步字段到商品; then the order form's line picker; then the two limited roles | each action lands on the expected badge/label and the single-row flash leads to the product's 官方目录链接; the picker labels an unlinked suggestion with its consequence; the `manage`-only role sees no 建商品档案 / 批量建商品档案 / 同步字段到商品, the `view`-only role no write action and no selection column; light and dark mode, and the list at narrow width (table scrolls, filters wrap) | REQ-SPL-017, REQ-SPL-018, REQ-SPL-019, REQ-SPL-020, REQ-SPL-021 |

## Implementation Status

Source doc: `.ai/specs/2026-09-22-supplier-product-library.md`

| Phase | State | Dependencies | Acceptance IDs | Focused validation | Exit gate |
|---|---|---|---|---|---|
| Phases 1–7 | verified | — | AC-SPL-001…016 | see the Changelog rows (gates + integration suite + browser smoke, 2026-09-22/23) | shipped in `sourcing` → moved to `purchasing` (D4) |
| Phase 8 — 关联商品：直觉化 + 手动关联 | **verified** | Phase 7 exit gate | AC-SPL-017…021 | `yarn typecheck` ✓, `yarn lint` ✓, `yarn test` ✓ (214), `yarn build` ✓, `yarn test:integration:ephemeral` ✓ for this file (TEST-SPL-009/010/011), browser smoke ✓ | every exit-gate line below observed on the dev server and covered by TEST-SPL-009/010/011 |

### Phase 8 progress

- [x] Slice 1 — list transparency + backlog clearing: `data/validators.ts` (`linked` filter, `supplierProductPromoteBatchSchema`), `api/supplier-products/route.ts` (`linked` in `buildFilters`, `productDeleted` in `afterList`, list item schema), `commands/supplierProducts.ts` + `api/supplier-products/promote-batch/route.ts`, `components/SupplierProductsTable.tsx` (商品 column, 未建档 badge with inline 建档/关联已有商品, 建档状态 filter, row selection + bulk action, next-step alert), i18n zh/en — `yarn generate` registered the new route (`api-routes.generated.ts`), `yarn typecheck` passed, `yarn test src/modules/purchasing` passed (18), eslint clean; browser smoke (dev on :3001, 2026-09-23): 建档状态 chip present, the 商品 cell renders product name + SKU linking to `/backend/products/items/<id>/edit`, inline 建档 → `POST …/promote 200` → the dismissible alert with the 官方目录链接 link, and 批量建商品档案 re-linked an unlinked row. **Smoke found and fixed two defects:** the DataTable's row click swallowed the inline buttons (every control in the cell now stops propagation) and the column header still read 关联商品 (renamed to 商品)
- [x] Slice 2 — manual link: `lib/supplierProductLinking.ts` (in-transaction scope + liveness check with `for update`, raw row write), `commands/supplierProducts.ts` (`purchasing.supplier-products.link`), `api/supplier-products/link/route.ts`, `components/SupplierProductLinkDialog.tsx`, 换绑 / 解除关联 row actions — `yarn typecheck` passed; browser smoke: the picker dialog lists the master with a 当前已关联 marker, 换绑 wrote a new `productId` (`POST …/link 200`, verified through the list payload), 解除关联 confirmed with its own copy and returned the row to 未建档
- [x] Slice 3 — `sync-fields`: `lib/supplierProductPromotion.ts` refactored into `applySupplierProductToMaster` (shared field + price legs, `fieldsChanged`/`priceChanged`), `lib/productsReads.ts` (`findProductById` with `includeDeleted`/`forUpdate`, shared projection), `commands/supplierProducts.ts` (`purchasing.supplier-products.sync-fields`), `api/supplier-products/sync-fields/route.ts`, row action — `yarn typecheck` passed; browser smoke: 同步字段到商品 → `POST …/sync-fields 200` and the list refreshed
- [x] Slice 4 — say the rule where the work happens: `SupplierProductForm` 供应商货号 help (zh/en), `orderFormOptions.ts` (`SupplierProductOption.linked`, `loadOwnedProductOptions` moved here from `PurchaseOrderForm.tsx` so both pickers share one source), `PurchaseOrderForm.tsx` line-picker option description carries 未建档：建过档才能发运、收货 — `yarn typecheck` passed, eslint clean; browser smoke: the order form's line picker showed `SMOKE-LINK-MUDUTOBP — Smoke supplier naming / 本供应商产品库 · 未建档：建过档才能发运、收货` next to the master suggestion's `商品库`
- [x] Slice 5 — evidence: TEST-SPL-009/010/011 live in `__integration__/supplier-products.spec.ts` (lines 591–992) and **pass** in `yarn test:integration:ephemeral` (results.json: "Phase 8 — links, re-points and clears a library row…", "Phase 8 — sync-fields pushes the row's values…", "Phase 8 — promote-batch isolates one row's failure…" all `passed`; the pre-existing library tests still pass; the run's only failures are the four `storage_ops` S3 specs, which are gated on the unset `STORAGE_OPS_TEST_S3_CONFIG` environment variable and unrelated to this change). Full gates: `yarn generate`, `yarn typecheck`, `yarn lint`, `yarn ds:check`, `yarn test` (26 suites / 214 tests) all pass; `yarn build` re-run after the integration runner released the `.next` lock. IN FLIGHT: the `om-code-review` report — the phase is marked `verified` only once its findings are resolved

## Implementation Phases

### Phase 1 — Supplier product library (entity → API → pages)

- **Depends on:** none
- **Outcome:** a purchaser can create, list, edit and delete supplier products from the Purchasing
  menu group; the sidebar already shows the new page in its final group.
- **Why this order / value delivered:** the library is the object every later phase reads or writes.
- **Deliverables:** `PurchasingSupplierProduct` entity + quote-line column, validators, five commands
  (`create`/`update`/`delete` plus the Phase-2 command shells), `makeCrudRoute` route + two custom
  routes, `productsReads.loadProductLabels`, three pages, `SupplierProductsTable`, `SupplierProductForm`,
  ACL features, events, i18n (zh/en), migration (generated), supplier-list row action.
- **Independent slices / estimated commits:** entity+validators+migration; commands+API; pages+components.
- **Requirements closed:** REQ-SPL-001, REQ-SPL-002
- **Tests:** TEST-SPL-001, TEST-SPL-005 (partial: view gate)
- **Validation:** `yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test`
- **Exit gate:** list/create/edit/delete work against the real API; duplicate code returns a readable
  409; `yarn db:generate` produced exactly the expected migration; pages render in light and dark mode.

### Phase 2 — Quotation → library → product master

- **Depends on:** Phase 1 exit gate
- **Outcome:** quotation lines feed the library in one action, the existing promotion also upserts the
  library, and a library row can be synced into the product master.
- **Why this order / value delivered:** closes the "the buyer never re-types a supplier list" loop and
  makes the master link reachable without leaving the purchasing flow.
- **Deliverables:** `lib/supplierProductImport.ts`, `lib/supplierProductPromotion.ts`, the
  `import-from-quote` and `promote` command bodies, the `promoteQuoteLines` hook, the review grid's
  「加入产品库」 bulk action, unit tests.
- **Independent slices / estimated commits:** import lib+command; promotion hook; promote lib+command.
- **Requirements closed:** REQ-SPL-003, REQ-SPL-004, REQ-SPL-005
- **Tests:** TEST-SPL-002, TEST-SPL-003
- **Validation:** `yarn test src/modules/sourcing`
- **Exit gate:** import is idempotent (second run `skipped`), a blank source field never clears a
  stored value, promote is idempotent with the master product verified through the products API, and
  the action is reachable from the review console (not API-only).

### Phase 3 — Purchase orders pick from the library

- **Depends on:** Phase 1 exit gate (read helper + table)
- **Outcome:** an order line can reference a supplier library row; the order form offers that
  supplier's items; the order detail prints the supplier code.
- **Why this order / value delivered:** this is the buyer's daily workflow — ordering what the supplier
  actually sells without visiting the products module.
- **Deliverables:** `purchasing_purchase_order_lines.supplier_product_id` + migration,
  `purchasing/lib/sourcingReads.ts`, `resolveOrderLines` supplier branch + snapshot key, line
  projection fields, `loadSupplierProductOptions`, order-form picker + mode switch, order-detail
  supplier code, i18n.
- **Independent slices / estimated commits:** entity+migration+read helper; command resolution;
  projection+form+detail.
- **Requirements closed:** REQ-SPL-006, REQ-SPL-007
- **Tests:** TEST-SPL-004
- **Validation:** `yarn typecheck && yarn test src/modules/purchasing`
- **Exit gate:** an order with a supplier-library line saves, lists and reads back with
  `supplierProductId` + `supplierSku`; the other-supplier case is a 422; a master-product line is
  unaffected.

### Phase 4 — Trade side inherits the supplier code

- **Depends on:** Phase 3 exit gate (the snapshot key exists)
- **Outcome:** shipment allocations show the supplier code; the allocation guard tells the operator
  which step is missing.
- **Why this order / value delivered:** the trade operator can reconcile what shipped with what the
  supplier calls it, and the refusal becomes actionable.
- **Deliverables:** allocation projection `supplierSku`, `ShipmentForm`/`ShipmentDetail` display,
  guard message rewrite, i18n.
- **Independent slices / estimated commits:** one slice (projection + UI + copy).
- **Requirements closed:** REQ-SPL-008
- **Tests:** covered by TEST-SPL-004's line data plus the manual smoke (TEST-SPL-006)
- **Validation:** `yarn typecheck && yarn test src/modules/cross_border`
- **Exit gate:** an allocation of a supplier-library line renders the code; a line without a catalog
  link is refused with the sync instruction; no schema change to allocations.

### Phase 5 — Role-grouped sidebar

- **Depends on:** Phase 1 (new pages land in their final group from the start)
- **Outcome:** six role groups in a fixed order, one 采购 group, trade pages together, finance pages
  under 财务.
- **Why this order / value delivered:** metadata-only, but it is what makes the new library page findable
  by role and removes the duplicate group.
- **Deliverables:** `pageGroupKey`/`pageOrder`/`pageGroup` edits across sourcing, internal_sales,
  trade_docs, cross_border and export_finance page metadata; `overrides.nav.groupOrder` on the app's
  `purchasing` module entry; i18n labels (zh/en); removal of the three dead nav-group keys.
- **Independent slices / estimated commits:** one slice (mechanical metadata + one override).
- **Requirements closed:** REQ-SPL-009
- **Tests:** TEST-SPL-006
- **Validation:** `yarn generate && yarn typecheck && yarn lint` and a sidebar smoke
- **Exit gate:** the sidebar renders exactly the six groups in order; a page without its feature stays
  hidden; the dead keys are gone from `src/`, `docs/` and `.ai/`.

### Phase 6 — Documentation and knowledge

- **Depends on:** Phases 1–5 exit gates
- **Outcome:** the business architecture, the three module READMEs and the lesson catalog describe the
  new capability and the two reproducible traps (group identity, single `groupOrder` declaration).
- **Deliverables:** `docs/dev/business-architecture.md` (ownership map, source-of-truth table,
  decisions D1/D2/D3, verification steps), `sourcing`/`purchasing`/`cross_border` README sections,
  `.ai/lessons/sidebar-group-is-the-role-boundary.md` + catalog row, spec marked implemented.
- **Requirements closed:** REQ-SPL-009, REQ-SPL-010 (documentation half)
- **Tests:** `node scripts/check-lessons.mjs`
- **Validation:** the full gate (`yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test && yarn build`)
- **Exit gate:** every document names the same rules the code enforces; the lesson script passes.

### Phase 7 — 产品明细表 field set, dictionary unit, price list and product photos

- **Depends on:** Phase 1 exit gate (entity, API and pages exist), Phase 3 (the order line already
  reads the library, so the richer row is what the picker shows)
- **Outcome:** a library row carries everything the business keeps on a 产品明细表 — the supplier's raw
  name plus **our** Chinese and English names, HS code, 申报要素, a dictionary-backed unit, MOQ,
  Qty/Box, G.W / N.W, L×W×H, product photos, notes — and the item's two prices (the supplier's and
  ours) as a proper price list rather than two currency-named columns.
- **Why this order / value delivered:** the library is already the buying surface; without the field
  set a buyer still keeps a spreadsheet beside it, and without prices the supplier's and our own
  number can only be compared inside a quotation.
- **Deliverables:** new columns (`name_zh`, `name_en`, `declaration_elements`,
  `image_attachment_ids`) and the `purchasing_supplier_product_prices` entity + migration; validators;
  `lib/priceKinds.ts`; create/update commands; `purchasing.supplier-products.replace-prices` + the
  prices route + `purchasing.supplier_product_prices.updated`; the `supplier_product_unit` dictionary
  seed in `purchasing/setup.ts`; the promotion mapping (`name_zh ?? name` → master `name`, `name_en` →
  master `name_en`, library `supplier_cost` preferred over the newest quotation line); the regrouped
  form with full-name help, the price-rows editor and the image editor; two list columns; i18n (zh +
  en); README and spec updates.
- **Independent slices / estimated commits:** three slices — (1) fields + entity + migration, (2)
  price list (command, route, event, promotion leg), (3) UI (groups, help, price editor, images,
  list columns, i18n). Slice 2 and 3 both depend on slice 1; slice 3's price editor depends on slice
  2's route.
- **Requirements closed:** REQ-SPL-011, REQ-SPL-012, REQ-SPL-013, REQ-SPL-014, REQ-SPL-015, REQ-SPL-016
- **Tests:** TEST-SPL-007, TEST-SPL-008
- **Validation:** `yarn generate && yarn typecheck && yarn lint && yarn test src/modules/sourcing`
  plus the manual form smoke (unit dropdown, price rows, image upload).
- **Exit gate:** a row saves and reloads our names, 申报要素 and an uploaded photo; the price editor
  writes both kinds and a price removed from the payload comes back `is_active = false` instead of
  gone; the unit dropdown lists the seeded dictionary and still round-trips a code it does not list;
  同步为商品 writes `name_zh`/`name_en` and the library's `supplier_cost` price into the master.

### Phase 8 — 关联商品：让关联一看就懂，并补上"选择关联"

- **Status:** Ready for implementation — all three gate questions answered by the owner 2026-09-23
  (Q-SPL-004 (a) add 同步字段到商品; Q-SPL-005 (a) 换绑 + 解除; Q-SPL-006 (a) unlinked rows stay
  pickable but labelled).
- **Depends on:** Phase 7 exit gate (the row carries names, prices and photos; the list is the buying
  surface) and Phase 3 (the order line already resolves through `product_id`).
- **Problem (owner-reported, 2026-09-23).** The link is a *field match* with no visible rule: the
  list's 关联商品 column shows a bare SKU, the row action 建商品档案 is hidden in the `⋯` menu, the
  success flash names no next step, and a row whose supplier code deliberately differs from our own
  product SKU has **no way to link at all** — it can only create a second, duplicate product record.
  The 官方目录链接 step that shipping/receipt actually requires is never surfaced from the library.
- **Outcome (target).** A buyer looking at `/backend/purchasing/supplier-products` can tell, without
  reading any documentation, (a) whether each row is linked, (b) which product it is linked to, and
  (c) what the next required action is — and when our SKU and the supplier code differ, links the row
  to the **existing** product instead of creating a duplicate.
- **Deliverables:**
  - `data/validators.ts`: `supplierProductLinkSchema` (`{ id, productId: uuid | null }`),
    `supplierProductSyncFieldsSchema` (`{ id }`), `supplierProductPromoteBatchSchema`
    (`{ ids: uuid[1..100] }`), and the additive list-query field
    `supplierProductListSchema.linked: 'all' | 'linked' | 'unlinked'` (default `all`).
  - `commands/supplierProducts.ts`: `purchasing.supplier-products.link` (link / 换绑 / 解除),
    `…sync-fields`, `…promote-batch`; the product lookup that the link command performs is a scoped
    read (Kysely, `products_products`, soft-deleted excluded) in a `lib/` helper, not a cross-module
    import.
  - `lib/supplierProductPromotion.ts`: split the write legs so `promote` (find-or-create → write →
    link) and `sync-fields` (write → report) share one `applySupplierProductToMaster` that returns
    `fieldsChanged[]` / `priceChanged`; both keep `syncOrigin: 'purchasing:supplier-product-promote'`
    and go through the products module's commands.
  - `api/supplier-products/{link,sync-fields,promote-batch}/route.ts` — custom-route + `openApi`,
    per-method `metadata` (`requireAuth` + `requireFeatures`), scope from the command context.
  - `api/supplier-products/route.ts`: `linked` joins `buildFilters` (`product_id` is null / is not
    null) and `afterList` also sets `productDeleted` (`productId` set, no live product resolved).
  - `components/SupplierProductsTable.tsx`: the 商品 column (including the deleted-link state), badges,
    inline actions, the 关联已有商品 picker, the 建档状态 filter, row selection + bulk action, the
    single-row flash-with-link, and the client feature gates for each write action.
  - `components/orderFormOptions.ts` + `PurchaseOrderForm.tsx`: link-state copies on library options.
  - i18n `zh`/`en` for every new string; `SupplierProductForm.tsx` field help; module README section.
- **Independent slices / estimated commits:** four slices.
  1. **List transparency + backlog clearing** — 商品 column with the product link and the
     `productDeleted` state, 未建档 badge, inline 建商品档案 / 关联已有商品 entry points, 建档状态
     filter, row selection + `promote-batch` route, flash with the 官方目录链接 next step. (Ships
     alone: it already removes the "I don't know what to do next" dead end.)
  2. **Manual link** — `link` command + route + picker + 换绑 / 解除 actions. (Independent of slice 1;
     slice 1's picker entry point renders disabled until this lands, so ship 1 and 2 in one PR if the
     gap would be visible.)
  3. **`sync-fields`** — the shared write-leg refactor + command + route + row action. (Depends on 2
     for the shared helper; no UI dependency on 1.)
  4. **Say the rule where the work happens** — 供应商货号 field help + order-picker link labels +
     README/docs. (Depends on 1 for the state it names.)
- **Requirements closed:** REQ-SPL-017, REQ-SPL-018, REQ-SPL-019, REQ-SPL-020, REQ-SPL-021
- **Tests:** TEST-SPL-009 (link / 换绑 / 解除 + cross-organization refusal), TEST-SPL-010
  (`sync-fields` reporting and non-destructiveness), TEST-SPL-011 (`promote-batch` counts and per-row
  failure isolation), TEST-SPL-012 (browser smoke: filter → bulk → inline 建商品档案 → 关联已有商品 →
  换绑 → 解除 → 同步字段, light and dark).
- **Validation:** `yarn generate && yarn typecheck && yarn lint && yarn test src/modules/purchasing`
  plus `yarn test:integration:ephemeral`; the browser smoke covers the light/dark and narrow-width
  states the UI contract names.
- **Exit gate:** on a library with mixed link states — an unlinked row promotes from the list in one
  click and its flash leads to the product's 官方目录链接 field; a row whose code differs from our SKU
  links to the existing product (the product count does not change); 换绑 and 解除 land back on the
  right state; `sync-fields` reports the fields it wrote and leaves `internal`/`export` and the
  catalog link untouched; a mixed selection's bulk run reports `created/updated/skipped/failed` with
  the failing row named and untouched; and the order form labels an unlinked suggestion with its
  consequence.

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-SPL-001 | J-SPL-001, library pages | `purchasing_supplier_products`, `POST/PUT/DELETE /api/purchasing/supplier-products`, `sourcing.supplier_product.*` | Phase 1 | TEST-SPL-001, TEST-SPL-005 | AC-SPL-001 |
| REQ-SPL-002 | J-SPL-001, `/backend/purchasing/supplier-products` | `GET /api/purchasing/supplier-products` | Phase 1 | TEST-SPL-001, TEST-SPL-006 | AC-SPL-002 |
| REQ-SPL-003 | J-SPL-002 | `POST /api/purchasing/supplier-products/import`, `purchasing.supplier-products.import-from-quote` | Phase 2 | TEST-SPL-002 | AC-SPL-003 |
| REQ-SPL-004 | J-SPL-002 | `promoteQuoteLines` → library upsert | Phase 2 | TEST-SPL-002 | AC-SPL-004 |
| REQ-SPL-005 | J-SPL-003 | `POST /api/purchasing/supplier-products/promote` → `products.items.*`, `products.prices.replace` | Phase 2 | TEST-SPL-003 | AC-SPL-005 |
| REQ-SPL-006 | J-SPL-004 | `purchasing_purchase_order_lines.supplier_product_id`, `POST/PUT /api/purchasing/purchase-orders` | Phase 3 | TEST-SPL-004 | AC-SPL-006 |
| REQ-SPL-007 | J-SPL-004 | `GET /api/purchasing/purchase-orders/lines` (`supplierProductId`, `supplierSku`), order form/detail | Phase 3 | TEST-SPL-004, TEST-SPL-006 | AC-SPL-007 |
| REQ-SPL-008 | J-SPL-004 | `GET /api/cross_border/shipments/allocations` (`supplierSku`), allocation guard copy | Phase 4 | TEST-SPL-006 | AC-SPL-008 |
| REQ-SPL-009 | J-SPL-005 | page metadata + `overrides.nav.groupOrder` | Phase 5 | TEST-SPL-006 | AC-SPL-009 |
| REQ-SPL-010 | all | ACL features, i18n catalogs, scope filters | Phases 1–3 | TEST-SPL-005 | AC-SPL-010 |
| REQ-SPL-011 | library create/edit form | `purchasing_supplier_products.name_zh/name_en/declaration_elements`, `POST/PUT /api/purchasing/supplier-products` | Phase 7 | TEST-SPL-008 | AC-SPL-011 |
| REQ-SPL-012 | library form unit field | `supplier_product_unit` dictionary seed (`purchasing/setup.ts`), `supplierProductCreateSchema.unit` | Phase 7 | TEST-SPL-008 | AC-SPL-012 |
| REQ-SPL-013 | library form price section | `purchasing_supplier_product_prices`, `purchasing.supplier-products.replace-prices`, `GET|PUT /api/purchasing/supplier-products/prices`, `purchasing.supplier_product_prices.updated` | Phase 7 | TEST-SPL-007 | AC-SPL-013 |
| REQ-SPL-014 | library form image section | `purchasing_supplier_products.image_attachment_ids` + `POST /api/attachments` (`entityId=purchasing:purchasing_supplier_product`) | Phase 7 | TEST-SPL-008 | AC-SPL-014 |
| REQ-SPL-015 | library create/edit form | form groups + field help in `SupplierProductForm.tsx`, i18n catalogs | Phase 7 | TEST-SPL-008 | AC-SPL-015 |
| REQ-SPL-016 | J-SPL-003 (promote) | `supplierProductToProductFields` + `supplierProductPromotion` price leg → `products.items.*`, `products.prices.replace` | Phase 7 | TEST-SPL-008 | AC-SPL-016 |
| REQ-SPL-017 | J-SPL-003, library list (商品 column, badge, inline actions, 建档状态 filter), library form help | `GET /api/purchasing/supplier-products` (`linked` filter, `productId`/`productName`/`productSku`/`productDeleted`), `SupplierProductsTable.tsx`, i18n | Phase 8 | TEST-SPL-009, TEST-SPL-012 | AC-SPL-017 |
| REQ-SPL-018 | library list (row selection + 批量建商品档案) | `POST /api/purchasing/supplier-products/promote-batch`, `purchasing.supplier-products.promote-batch` | Phase 8 | TEST-SPL-011, TEST-SPL-012 | AC-SPL-018 |
| REQ-SPL-019 | library list (关联已有商品 / 换绑 / 解除关联) | `POST /api/purchasing/supplier-products/link`, `purchasing.supplier-products.link`, `purchasing_supplier_products.product_id` | Phase 8 | TEST-SPL-009, TEST-SPL-012 | AC-SPL-019 |
| REQ-SPL-020 | library list (同步字段到商品) | `POST /api/purchasing/supplier-products/sync-fields`, `purchasing.supplier-products.sync-fields`, `applySupplierProductToMaster` → `products.items.update` + `products.prices.replace` | Phase 8 | TEST-SPL-010, TEST-SPL-012 | AC-SPL-020 |
| REQ-SPL-021 | order form line picker (option labels) | `orderFormOptions.loadSupplierProductOptions` + `PurchaseOrderForm` option description | Phase 8 | TEST-SPL-012 | AC-SPL-021 |

### Extension-surface traceability

| Surface | Reference capability ID | Reference source file | Phase | Integration test | Mechanism classification |
|---|---|---|---|---|---|
| Entity `PurchasingSupplierProduct` + changed columns | `data.entities` | `src/modules/example/data/entities.ts` | Phase 1 | TEST-SPL-001 | emitted-example |
| Validators | `data.validators` | `src/modules/example/data/validators.ts` | Phase 1 | TEST-SPL-001 | emitted-example |
| Migration | `data.migrations` | `src/modules/example/migrations/Migration20251030150038.ts` | Phase 1 | TEST-SPL-001 | emitted-example |
| Library CRUD route | `api.crud-factory` | `src/modules/example/api/customer-priorities/route.ts` | Phase 1 | TEST-SPL-001 | emitted-example |
| `import` / `promote` command routes | `api.custom-route` | `src/modules/example/api/organizations/route.ts` | Phase 1 | TEST-SPL-002 | emitted-example |
| OpenAPI documents | `api.openapi` | `src/modules/example/api/openapi.ts` | Phase 1 | TEST-SPL-001 | emitted-example |
| Commands + CRUD side effects | `commands.write` | `src/modules/example/commands/todos.ts` | Phase 1 | TEST-SPL-001 | emitted-example |
| Query-index bridge | `events.crud-indexer-bridge` | `src/modules/example/commands/todos.ts` | Phase 1 | TEST-SPL-001 | emitted-example |
| Events (`sourcing.supplier_product.*`) | `events.typed-definitions` | `src/modules/example/events.ts` | Phase 1 | TEST-SPL-001 | emitted-example |
| ACL features | `module.acl-features` | `src/modules/example/acl.ts` | Phase 1 | TEST-SPL-005 | emitted-example |
| i18n catalogs | `module.i18n-catalogs` | `src/modules/example/i18n/en.json` | Phase 1 | TEST-SPL-006 | emitted-example |
| Page shells (`page.tsx` + `page.meta.ts`) | `ui.page-shell` | `src/modules/example/backend/todos/page.tsx` | Phase 1 | TEST-SPL-006 | emitted-example |
| Library `DataTable` | `ui.datatable` | `src/modules/example/components/TodosTable.tsx` | Phase 1 | TEST-SPL-006 | emitted-example |
| Library create/edit `CrudForm` | `ui.form-create` | `src/modules/example/components/TodoForm.tsx` | Phase 1 | TEST-SPL-006 | emitted-example |
| Library edit page | `ui.form-edit` | `src/modules/example/backend/todos/[id]/edit/page.tsx` | Phase 1 | TEST-SPL-006 | emitted-example |
| Nav group order override | `overrides.unified-registry` | `src/modules.ts` | Phase 5 | TEST-SPL-006 | framework-only |

## Rollout, Migration, and Rollback

- **Migration:** `yarn generate` then `yarn db:generate` per module (`sourcing` → new table + indexes +
  one column; `purchasing` → one column); SQL reviewed before commit; `yarn db:migrate` is run only
  after the owner approves it (AGENTS.md "Ask First"). Integration tests use the ephemeral database.
- **Migration (Phase 7):** four additive columns on `purchasing_supplier_products`
  (`name_zh`, `name_en`, `declaration_elements`, `image_attachment_ids jsonb default '[]'`) and one
  new table `purchasing_supplier_product_prices` with its two indexes and the unique key; generated by
  `yarn db:generate`, reviewed, and applied only after the owner approves `yarn db:migrate`
  (AGENTS.md "Ask First"). The `jsonb` default is what keeps the ~existing rows valid without a
  backfill.
- **Seed/setup (Phase 7):** `purchasing/setup.ts` gains an idempotent, insert-only `seedDefaults` that
  creates the `supplier_product_unit` dictionary and its entries (`yarn mercato seed:defaults
  --module sourcing`, or automatically on tenant creation). Re-running it never rewrites an entry an
  operator edited and never duplicates the dictionary. `purchasing/setup.ts` keeps `sourcing.*`
  wildcards, which already cover the feature set for *new* roles. Existing tenants need
  `yarn mercato auth sync-role-acls` + restart, or the new page is invisible to their admin role
  (`.ai/lessons/module-features-need-role-acl-sync.md`).
- **Sidebar preferences:** group ids are reused except `export_finance.nav.group`; a user whose stored
  preference names a removed/renamed group keeps the remaining order (the resolver drops unknown ids).
  No data migration is performed; a user may re-order the new group from
  `/backend/sidebar-customization`.
- **Observability:** the promote/import responses carry their counts; failures are logged with the row
  id through the module logger.
- **Rollback:** the change is additive — dropping the three routes/pages and the `nav.groupOrder`
  override restores the previous menu; the new table and columns are inert if unused. No existing row
  is rewritten by this change, so a rollback loses no data.

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| `supplier_sku` uniqueness includes soft-deleted rows | An operator who deletes a row cannot re-create the same code | Duplicate check queries soft-deleted rows and returns 409 with the reason; the failure message names the deleted row | Manual restore or a code change; a one-way decision (flipping to a partial index later is a separate, deliberate migration) |
| An un-synced library row can be ordered but not shipped | An order can be placed for goods that cannot be received | The shipment guard's message names the missing sync + catalog link; the library list marks rows 未同步 | The operator discovers it at allocation time, not at order time (accepted: ordering un-synced goods is a legitimate early step) |
| Two writes on the promotion path (master + library) | A library failure could confuse the operator about what was promoted | Per-line isolation: the product write stays, the library failure is reported on its own line and does not roll back | The line ends `promoted` with no library row; re-running import repairs it |
| `promote` re-resolves on every draft save | Saving a draft can attach a `product_id`/catalog bridge the operator did not choose | Documented as intended: the *snapshot* is frozen, the *resolution rule* is not; the change only ever adds a bridge | A placed order is never re-resolved (`POST_PLACEMENT_UPDATE_FIELDS` forbids line edits after placement) |
| Group regrouping invalidates stored sidebar preferences for renamed ids | A user may see groups in a different order than they arranged | Only one new id; page order inside each group is explicit | Low |
| Menu grouping has no automated test | A wrong `pageGroupKey` silently splits a group (two groups with the same label) | Manual sidebar smoke in TEST-SPL-006; the lesson records the failure mode | Regression risk if a later page forgets its group |
| Migration is generated but not applied in this change | The dev database does not have the new table until approved | Ephemeral integration tests run against a migrated database; delivery notes list the pending `yarn db:migrate` | Deployment step pending owner approval |
| A stored price can go stale (the reason the library originally had none) | A buyer reads an old 供应商供货价 and negotiates from it | Each row carries kind + currency + `updated_at`, both the list and the form show the currency with the amount, nothing pre-fills an order line, and the promotion prefers the row while the quotation remains the negotiation document | The operator must still re-quote deliberately; accepted as the price of keeping money on the item (owner decision, REQ-SPL-013) |
| A unit dictionary entry can be renamed or removed while rows reference it | A row could show a label that no longer matches its stored code | The select falls back to the stored code and the API accepts any code, so a row is never blanked or rejected; the dictionary UI is the operator's to maintain | Cosmetic mismatch until the operator adds the code back; accepted |
| A hand-made link points at the wrong product (the SKU match cannot guard it) | An order placed from that row would freeze the wrong product, and a later `sync-fields` could write the row's values onto an unrelated product | The 商品 column shows the product's name *and* SKU side by side, both write actions are confirmed, `sync-fields` reports exactly which fields it wrote, and 换绑/解除 make the mistake reversible (D8) | An operator who ignores the label can still mis-link; accepted — the alternative (no manual link) forces every such row into a duplicate product, which is worse for the data |
| Several library rows can point at one product (different suppliers, same goods) | A product could be described by two rows with different names/specs, and `sync-fields` runs from either one | Last explicit write wins, and the response names the fields it changed; the master stays the reviewed record, and no automatic write path exists (D7) | Two buyers can race on one product's fields; a deliberate later `sync-fields` decides — accepted, this is why the link itself never writes fields (D6) |
| `promote-batch` reports partial failure | An operator may read a mixed result as "all done" | The response is the established `created/updated/skipped/failed[]` shape, the UI names the failing rows and their reason, and each failure leaves its row untouched | A very large selection (cap 100) may need a second run; accepted |
| 解除关联 leaves a draft order without its catalog bridge | That draft's next save drops the bridge and the shipment guard later refuses the allocation | The guard's message names the missing step, the library list shows 未建档 before the order is placed, and a placed order keeps the bridge it froze | The operator discovers it at allocation time — the same accepted risk the un-synced-row tradeoff above already carries |
| A linked product is soft-deleted after the link was made | The row keeps a link nothing can resolve: the 商品 column cannot print a name, `promote` skips it and `sync-fields` refuses it, so a buyer sees a row that looks linked but cannot be shipped | The list detects it (`productDeleted`), shows 已关联的商品已删除 in warning tone, keeps the row in the 已建档 bucket so it cannot hide, and offers 换绑 / 解除关联 as the two ways out; `link`'s in-transaction check prevents the same state from being created by a race | A buyer must notice the warning and act; nothing repairs it automatically, by design — silently re-pointing a link is exactly what D6 forbids |

## Acceptance Criteria

- [x] **AC-SPL-001** — A purchaser can create, list, edit and soft-delete a supplier product; a
  duplicate `(supplier, code)` returns 409 `supplier_product_sku_taken`, including when the existing
  row is soft-deleted; the supplier cannot be changed on update.
- [x] **AC-SPL-002** — `/backend/purchasing/supplier-products` lists the current organization's rows with
  supplier/status/search filters, server-side paging, and the 关联商品 column showing the master SKU
  when synced.
- [x] **AC-SPL-003** — `import-from-quote` reports `created/updated/skipped/failed`; a second run over
  the same lines reports `skipped` and changes nothing; a blank source value never clears a stored one;
  a line without a code fails alone with a readable message.
- [x] **AC-SPL-004** — Promoting quotation lines into the product master also upserts the library row
  and backfills `product_id`; a library failure does not roll back the product write.
- [x] **AC-SPL-005** — `promote` on a library row creates/updates the master product by SKU, merges the
  `purchase` price row when a matching quotation line exists, backfills `product_id`, and returns
  `action: 'skipped'` on a second run; a SKU owned by a soft-deleted product is refused with 422.
- [x] **AC-SPL-006** — A purchase order line referencing another supplier's library row is rejected with
  422 `supplier_product_supplier_mismatch`; mixing references or providing none is a 400; a valid
  reference saves and reads back with `supplierProductId` and `supplierSku`.
- [x] **AC-SPL-007** — The order form offers the selected supplier's active library rows (disabled with
  a hint when no supplier is chosen), can switch a line to the product-master picker, and the order
  detail prints the supplier code.
- [x] **AC-SPL-008** — Shipment allocations expose `supplierSku` from the frozen snapshot, and a line
  without a catalog link is refused with the sync-and-link instruction.
- [x] **AC-SPL-009** — The backend sidebar renders exactly six groups in the order Purchasing / Trade /
  Finance / Product master / Parties / Platform ops, with a single 采购 group.
- [x] **AC-SPL-010** — Every new surface is feature-gated, organization-scoped, localized in zh and en,
  and has no hard-coded user-facing string (`yarn i18n:check-hardcoded`).
- [x] **AC-SPL-011** — A library row stores and reloads the supplier's raw name, **our** Chinese and
  English names, the HS code as text, 申报要素, unit, MOQ, Qty/Box, unit net weight, inner dimensions,
  notes and an ordered photo list; the list view shows our Chinese name and the base prices.
- [x] **AC-SPL-012** — The unit field is a dropdown fed by the `supplier_product_unit` dictionary
  (seeded per organization, idempotently) through the app's shared unit loader; a code the dictionary
  does not list still round-trips unchanged, and a dictionary the loader cannot read degrades to no
  suggestions (free text), so the picker never blocks a save the API would accept.
- [x] **AC-SPL-013** — The item's prices are rows: both kinds (供应商供货价 / 本公司报价) can be quoted in
  any currency the currency dictionary knows, at any minimum quantity; a price removed from the
  submitted set is deactivated (still readable, not deleted); a duplicate `(kind, currency,
  minQuantity)` key is a 400 and an unknown currency a 400 naming the code.
- [x] **AC-SPL-014** — Product photos upload against the saved row through the installed attachments
  route, render as thumbnails in the form, and can be unlinked; a failed upload leaves the row and
  its other fields untouched; the image list is saved with the row, so a stale form conflicts with
  409 instead of dropping a photo.
- [x] **AC-SPL-015** — The form separates ERP-generic fields from supplier-sheet fields into named
  groups and spells out every abbreviation (L/W/H, Qty/Box, MOQ, HS, PK/KC) in a label or
  inline help, in both zh and en.
- [x] **AC-SPL-016** — 同步为商品 maps `name_zh ?? name` to the master's `name`, `name_en` to
  `name_en`, and prefers the library's active `supplier_cost` row (minimum quantity 1) as the
  `purchase` price, falling back to the newest matching quotation line when the row has no price —
  and never pre-fills a purchase order line.
- [ ] **AC-SPL-017** — On `/backend/purchasing/supplier-products` the 商品 column prints the linked
  product's name and SKU and links to its edit page; an unlinked row shows the 未建档 badge with
  inline 建商品档案 and 关联已有商品 actions; the 建档状态 filter narrows the list **server-side**
  (the `total` follows the filter, the stored `product_id` decides the bucket); a row whose linked
  product was soft-deleted afterwards reads 已关联的商品已删除 and offers 换绑 / 解除关联; a successful
  single-row 建商品档案 leads to the product's 官方目录链接 field; the 供应商货号 help states the
  matching rule; and each write action is hidden from a role whose granted features do not cover it
  (the server still answers 403).
- [ ] **AC-SPL-018** — A multi-row selection promotes in one request and reports
  `created / updated / skipped / failed[]`; a failing row is named with its reason and is left
  unchanged, and its neighbours are written; duplicate ids in the request are processed once; the
  result offers no single-product 官方目录链接 link and instead points back at the 已建档 list.
- [ ] **AC-SPL-019** — A row whose supplier code differs from every product SKU can be linked to an
  existing product through the 关联已有商品 picker without creating a second product; 换绑 re-points
  and 解除关联 clears the link; a product outside the caller's organization is refused with 404 and a
  soft-deleted one with 422 — including one deleted between the check and the write, whose refusal
  writes nothing — and the row is unchanged in every refusal; the link action writes no product field.
- [ ] **AC-SPL-020** — 同步字段到商品 re-applies the library's non-empty/changed values and the
  `purchase`-tier price to the linked product and reports which fields and whether the price changed;
  the `internal`/`export` tiers, the catalog link and the variants are untouched; an unlinked row is
  refused with 422.
- [ ] **AC-SPL-021** — The order form's line picker labels each library suggestion as 已建档 or
  未建档：建过档才能发运、收货, and an unlinked row remains selectable.
- [ ] Every listed backend surface matches its recorded reference and uses the canonical shell/components,
  shared API helpers, semantic tokens, and complete loading, empty, error, conflict, keyboard,
  accessibility, responsive, light-mode, and dark-mode states.
- [x] Every affected API and UI path has self-contained integration coverage and the configured
  validation gate passes (TEST-SPL-007/008; `yarn generate && yarn typecheck && yarn lint && yarn ds:check &&
  yarn test && yarn test:integration:ephemeral`).

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | `AGENTS.md` (root), `.ai/guides/spec-delivery.md`, `.ai/guides/backend-ui.md`, `.ai/guides/contracts.md`, `.ai/guides/upstream/BACKWARD_COMPATIBILITY.md` |
| Data models, APIs, events, UI, and tests are internally consistent | pass | Requirement traceability + extension-surface traceability tables |
| Every workflow completes end to end without a catch-all integration phase | pass | Journeys J-SPL-001…005 mapped to Phases 1–5 |
| Platform-native reuse and extension points were chosen before custom code | pass | Reuse and Ownership Map; only the library entity is app-own |
| UI contracts identify references, canonical components, and theme/state coverage | pass | UI and Interaction Contracts |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | Implementation Phases |

Verdict: `Phases 1–7 implemented and verified (2026-09-22/23); Phase 8 implemented and verified on 2026-09-23 (integration file green, browser smoke walked every exit-gate line, full gate green; the only failing integration specs in that run are the S3-gated storage_ops ones, an environment gate)`.

## Open Questions

None outstanding — Q-SPL-001..003 answered 2026-09-22 (owner decisions D1/D2/D3, recorded in
`docs/dev/business-architecture.md`) and Q-SPL-004…006 answered 2026-09-23 (decisions D6–D9). Phase 8
is unblocked and marked Ready for implementation.

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-SPL-001 | Does the library replace the product master as the ordering source? | owner | no | No — D1: library first, master synced on demand (2026-09-22) |
| Q-SPL-002 | Which module owns the library? | owner | no | D2: `sourcing` owns the entity/commands/API, the pages render in the Purchasing group (2026-09-22) |
| Q-SPL-003 | How many menu groups and which ids? | owner | no | D3: six role groups, existing ids reused, one new `export_finance.nav.group` (2026-09-22) |
| Q-SPL-004 | After a row is linked, an edit to the library (name, spec, price) never reaches the product master again — the 建商品档案 action disappears and `promote` is idempotent. Do you want a way to push the row's current field values onto the linked product, or is the master the record to edit from then on? | owner | **yes** | **answered 2026-09-23 — (a): add 同步字段到商品 on linked rows** (non-empty/changed values only, never the catalog link, never the other two price tiers; decision D7) |
| Q-SPL-005 | Should 解除关联 exist at all, or only 换绑? Unlinking puts a row back to 未建档, which costs it the catalog bridge on any draft order that still resolves through it. | owner | **yes** | **answered 2026-09-23 — (a): 换绑 + 解除** (a wrong link is fully reversible; drafts re-resolve on their next save; decision D8) |
| Q-SPL-006 | An unlinked library row can be ordered today but never shipped or received. Should the order line picker refuse it, or keep offering it with a visible 未建档 warning? | owner | **yes** | **answered 2026-09-23 — (a): keep it pickable, labelled 未建档：建过档才能发运、收货** (decision D9) |

## Changelog

| Date | Change |
|---|---|
| 2026-09-23 | **Phase 8 implemented and verified.** Four slices landed: (1) the 商品 column (product name + SKU, linking to the product's edit page), the 未建档 badge with inline 建商品档案 / 关联已有商品, the server-side 建档状态 filter (`linked`, on the stored `product_id`), the `productDeleted` flag and the bulk 批量建商品档案 route; (2) `purchasing.supplier-products.link` (关联已有商品 / 换绑 / 解除关联) writing only `product_id` with the target's scope and liveness re-checked inside the writing transaction (`select … for update`; raw Kysely row write, side effects emitted from a fresh read); (3) `purchasing.supplier-products.sync-fields`, sharing one `applySupplierProductToMaster` with `promote` and reporting `fieldsChanged[]`/`priceChanged`; (4) the matching rule in the 供应商货号 help and the order picker's 已建档 / 未建档：建过档才能发运、收货 labels. `loadOwnedProductOptions` moved from `PurchaseOrderForm.tsx` into `orderFormOptions.ts` so the order form and the library's link picker share one product source. Evidence: `yarn generate`, `yarn typecheck`, `yarn lint`, `yarn ds:check`, `yarn test` (26 suites/214 tests) green; `yarn test:integration:ephemeral` green for this file (TEST-SPL-009/010/011 pass; the run's 4 failures are the S3-gated `storage_ops` specs, environment, not this change); browser smoke on the dev server walked filter → inline 建档 → the 官方目录链接 next step → 批量建商品档案 → 关联已有商品 → 换绑 → 解除关联 → 同步字段到商品, and the order picker's unlinked notice. **Two defects the smoke caught and this change fixes:** the DataTable row click swallowed the new inline controls (every control in the cell now stops propagation — recorded as a lesson) and the column header still read 关联商品 (now 商品). Deviations from the design as written: the single-row next step renders as a dismissible alert above the table (`flash(message, kind)` carries no link), `sync-fields` emits no row event because the row itself is unchanged, and `productDeleted` is present only on pages that hold at least one linked row. |
| 2026-09-23 | **Phase 8 review fixes (fresh-context review, `CHANGES REQUIRED` → all seven findings applied).** (1) The 建档状态 filter gets a real contract: `supplierProductListSchema` gains `linked: all \| linked \| unlinked` and the list route filters the **stored** `product_id` server-side, so `total` and paging stay correct — no client-side slice of one page. (2) The linked-product-deleted state is defined end to end: `afterList` sets `productDeleted`, the 商品 cell reads 已关联的商品已删除 with 换绑 / 解除关联 as the way out, the row stays in the 已建档 bucket, a risk row explains why nothing auto-repairs it, and TEST-SPL-009 now deletes the product after linking. (3) The role story is reconciled: 建商品档案 / 批量建商品档案 / 同步字段到商品 need `purchasing.supplier-products.promote`, 关联已有商品 / 换绑 / 解除关联 need `manage`, the client hides what the caller lacks (`useBackendChrome()` + `hasFeature`, the platform's existing gate), and the server stays authoritative — TEST-SPL-012 walks both limited roles. (4) One canonical action label: 建商品档案 (row action and single-row flash), 批量建商品档案 (bulk), 未建档/已建档 as state words only; J-SPL-003/004 keep their historical 同步为商品 wording. (5) `promote-batch` collapses duplicate ids to their first occurrence and rejects a list that is empty after that. (6) `link` re-checks the target's scope and liveness **inside the transaction that writes `product_id`** — no foreign key to lean on — so a product deleted between the picker's read and the write is a 422 with nothing written. (7) The bulk result never offers the single-product 官方目录链接 link; it points back at the list filtered 已建档. |
| 2026-09-23 | **Phase 8 filled in and marked `Ready for implementation`.** The skeleton's three blocking questions were answered by the owner the same day, all three choosing the reversible option: 同步字段到商品 exists for already-linked rows (D7), 换绑 **and** 解除关联 are both allowed (D8), and unlinked rows stay pickable in the order form with their consequence on the label (D9). Scope: the 关联商品 column becomes 商品 and prints the product's name + SKU as a link to its edit page, the 未建档 badge owns inline 建档 / 关联已有商品 entry points, a 建档状态 filter plus a bulk 建商品档案 action clears the backlog (`promote-batch` with `created/updated/skipped/failed[]` and per-row isolation), and a new `link` command — writing `product_id` and nothing else, `null` clearing it — serves the row the SKU match cannot (our SKU ≠ the supplier's code). Added: REQ-SPL-017…021, journeys J-SPL-006/007, four UI-contract rows, three routes + three commands, TEST-SPL-009…012, five risk rows, AC-SPL-017…021, and the matching rule (`供应商货号` **is** the product's SKU; a differing code is linked, never duplicated) written into the form help and the order picker's labels. Nothing is implemented yet. |
| 2026-09-23 | **Phase 8 drafted: 关联商品：直觉化 + 手动关联 (draft skeleton, blocked on Q-SPL-004…006).** Owner-reported on the live page: the link is a hidden *field match* (供应商货号 = 商品 SKU), the 关联商品 column shows a bare SKU with no name and no link, 建商品档案 hides in the `⋯` menu and its success flash names no next step, and a row whose supplier code deliberately differs from our SKU cannot be linked at all — it can only create a duplicate product record. Scope chosen by the owner (2026-09-23, option B of three): make the existing SKU-matched path self-explanatory **and** add a 选择已有商品 link path, rather than auto-promoting on save (rejected: it would write into the product master and its price set silently). Phase 8's four slices, the reserved REQ-SPL-017…021 numbers and the three blocking questions are recorded above; UI/API contracts, traceability rows and acceptance criteria follow once the gate clears. |
| 2026-09-23 | **文案：「内盒尺寸」→「产品尺寸」**（owner 实测反馈：这个名字误导，页面是新建供应商产品）。字段 id 与列名 `innerPacking` / `inner_packing` 未动（那是供应商表「内箱尺寸」列的来源），只改 zh/en 的标签与组件里的英文兜底：`产品尺寸（cm）` / `Product size L×W×H (cm)`；实体注释同步写清「这是一件的尺寸、不是内盒」，模块 README 与 UI 契约段落跟着改。报价导入的列映射**目标名**同步改成 `产品尺寸 (cm)` / `Product size (cm)`（alias 仍匹配工作簿表头 `内箱尺寸` / `Inner Box`），商品主数据的同一张卡也从「单件尺寸」改成「产品尺寸」——全 app 一个名字。 |
| 2026-09-23 | **整箱数据移除（owner 口径：采购只维护单件数据）.** `cartonGrossWeight` / `cartonNetWeight` / `outerPacking` left the library and `cartonDimensions` / `cartonGrossWeight` / `cartonNetWeight` left the product master — entity, validator, command, API request schema, `select` list and serialization, the shared `ProductFieldValues` write contract (`products/lib/supplierMapping.ts`), both supplier→master mappers, both master read projections, the workbook-import projection, the form fields/groups, and the i18n keys. Kept on purpose: `cartonQuantity` (装箱数 Qty/Box), `unitNetWeight`, `innerPacking`, and on the master `dimensions` / `netWeight` / `grossWeight`. **Superseded the same day:** the owner then asked 「业务一直不需要箱子规格数据…精简数据表」, so the quotation line's own carton columns were deleted too (2026-09-23, see the quotation spec's Changelog) — the source values survive only in the line's `raw` jsonb. The DB columns are dropped by `Migration20260923065528_sourcing` — filed in `sourcing`, not `purchasing`, because module migration chains run in module-id order and this table is still `sourcing_supplier_products` while `purchasing`'s chain runs (`down` re-adds them). The columns are dropped by `Migration20260923065528_sourcing` — filed in `sourcing`, not `purchasing`, because module chains are applied in module-id order and this table is still `sourcing_supplier_products` while `purchasing`'s chain runs (`down` re-adds the columns); applied to the dev database. |
| 2026-09-23 | **价格 section layout fix (owner-reported: 布局很局促).** The price-rows editor was declared `column: 2`, i.e. drawn into `CrudForm`'s `3fr` sidebar: measured 389px wide at a 1440px viewport, the row's five controls came out 73px/73px/45px/45px/45px and 「供应商供货价（PK 单价）」 truncated to 「供应」 (the form has no full-width group — `CrudFormGroup.column` is `1 | 2`). It is now a **column-1 group**, the placement every other rows editor in this app uses (purchase orders, contracts, invoices, internal sales, shipment allocations), and the row grid is a **container query** instead of a viewport one: `@md` pairs kind+currency and then min qty+unit price, `@3xl` restores the single-line 12-column row. Measured after the fix — 1440px viewport: 907px card, controls 203/203/131/131/131; 1024px: 616px card, two-up; 390px: 358px card, pickers stacked and numbers paired. Smoke: a row with one price was created through the form and read back from `GET /api/purchasing/supplier-products/prices` (`supplier_cost` / `CNY` / min 1 / 12.5), then deleted. |
| 2026-09-23 | **UI review fixes from the owner (2026-09-23).** Four things the owner hit while using the pages: (1) the quotation create/review pages' supplier dropdown was empty — the loader asked for `pageSize: 200` and `purchasing/suppliers` caps at 100, so the request was a 400 with no visible error; both panels now read `sourcing/components/supplierOptions.ts` (cap named once) and surface a load failure under the select. (2) The library form was bilingual label-by-label (「供应商货号 Supplier code」); `zh.json` is now Chinese-only, `en.json` English-only, and every `t()` fallback in the components is the English string. (3) Photos on the **create** page no longer require saving first: the pick is staged with a blob preview and the submit handler creates the row, uploads the files, then binds them in one versioned update (edit page unchanged). (4) The row action 同步为商品 is now 建商品档案 with a confirm body that says the sync is what makes the item shippable/receivable, and the CSV export headers are English-only (the factory takes a static `header` string). Verified with a browser smoke (zh + en): one save on the create page produced a row whose `image_attachment_ids` carried the uploaded file; the list reads 「未建档」 and offers 编辑 / 建商品档案 / 删除. Gate: `yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test` green. |
| 2026-09-23 | **The library moved to `purchasing` (D4).** Entity, commands, API routes, pages, ACL features and events now belong to the module whose menu they render in: `purchasing_supplier_products` / `purchasing_supplier_product_prices` (renamed from `sourcing_*` by `Migration20260923043000_sourcing`, so every existing row — codes, packing, photos, prices — survived), routes `/api/purchasing/supplier-products/*`, pages `/backend/purchasing/supplier-products`, features `purchasing.supplier-products.{view,manage,promote}`, events `purchasing.supplier_product*`. `sourcing` keeps the quotation and the promotion and feeds the library through `purchasing.supplier-products.import-from-quote`, reading the promoted line's `promoted_product_id` there; the quotation line's reverse pointer (`sourcing_quote_lines.supplier_product_id`) was dropped (`Migration20260923043000_sourcing`) because nothing read it and it crossed a module boundary. `purchasing` reads quotation lines through a typed read-only projection (`lib/quoteLineReads.ts`), never through `sourcing`'s entities, and the master-mapping helpers both promotions share moved to `products/lib/supplierMapping.ts`. The unit dictionary seed moved to `purchasing/setup.ts` (the library's module); `products/lib/unitOptions.ts`, the trade-document lines and the unit-picker lesson now point there. |
| 2026-09-23 | **Phase 7 implemented and verified (产品明细表 field set).** The legacy sheet's columns are now the library row's fields: `name` (the supplier's raw name) with our own `name_zh`/`name_en` beside it, `declaration_elements` (申报要素), the HS code kept as **text** (leading zeros and dotted groups survive), the unit offered from the seeded `supplier_product_unit` dictionary through the app's shared loader (`products/lib/unitOptions.ts`), ordered product photos in `image_attachment_ids` (uploaded via the installed `attachments` module and bound by a row update), and the two prices as a **price list**: `purchasing_supplier_product_prices` (`price_kind` × currency × minimum quantity; `supplier_cost` = the legacy 「PK 单价」, `company_offer` = the legacy 「KC 单价」), written whole by `purchasing.supplier-products.replace-prices` with rows missing from the payload deactivated and every currency checked against the currency dictionary. The form is regrouped into 商品标识 / 报关信息 / 价格 / 包装与重量 / 供应商原始资料 / 状态 with every abbreviation spelled out (G.W, N.W, L×W×H, Qty/Box, MOQ, HS, PK/KC), and the list gains 品名（中文 / 英文）plus 供应商供货价 / 本公司报价 columns. 同步为商品 now maps `name_zh ?? name` → the master's `name` and `name_en` → `name_en`, and prefers the library's active `supplier_cost` price over the newest quotation line — one source of truth for the price that reaches the master, with nothing pre-filling an order line (Q-P-004 stands). Verified: `yarn generate && yarn typecheck (non-incremental) && yarn lint && yarn ds:check && yarn test` (19 suites / 183 tests) and `yarn test:integration:ephemeral` (22 passed, including the new fields/photo/price/promotion test), plus a browser smoke that created a row with the dictionary unit, two price rows and an uploaded photo, saved it and read the list columns back. Two smoke-found defects were fixed: the payload builder accepts a numeric field as a number **and** as a string (pinned by `lib/__tests__/supplierProductFormValues.test.ts`), and an amount-less price row is dropped instead of stored as `0`. `Migration20260923021622_sourcing.ts` (four additive columns + the price table) is generated and reviewed but **not applied** to the owner's database; an existing tenant also needs `yarn mercato seed:defaults --module sourcing` for the unit dictionary. |
| 2026-09-23 | **产品明细表 field set (Phase 7).** The owner supplied the legacy supplier-product-library table definition (商品名称 / 英文品名 / 中文品名 / HS CODE / 商品编号 / 申报要素 / 单位 / 商品单价 PK.RMB / 商品单价 KC.USD / 商品图片 / G.W / N.W / L / W / H / Qty/Box) and asked for it on the library, with ERP-generic fields separated from sheet-specific ones, abbreviations spelled out, dictionary-backed dropdowns, and the two prices generalized. Added REQ-SPL-011…016: our own `name_zh`/`name_en` beside the supplier's raw `name`; `declaration_elements`; HS code documented as text (leading zeros, dotted groups); the unit as a seeded `supplier_product_unit` dictionary with a free-text fallback; the price list `purchasing_supplier_product_prices` (kind × currency × minimum quantity, replace-set semantics, deactivate-not-delete) replacing the legacy `PK.RMB` / `KC.USD` columns; ordered product photos through `image_attachment_ids`; the six-group form with full-name help; and a promotion leg that maps our names and prefers the library's supplier price. Two earlier non-goals (no price list, no images on rows) are marked superseded with the mitigations that keep Q-P-004 intact. |
| 2026-09-22 | Initial draft (owner-approved plan transcribed; decisions D1/D2/D3 recorded) |
| 2026-09-23 | Gap closed and migration state corrected. The review console had no way to run `import-from-quote` — the command, route and command tests existed, but the only reachable entry points were 「提升所选为商品」 (which upserts the library as a side effect) and the API itself, while journey J-SPL-002 and the plan's smoke both name a 「加入产品库」 action. `QuoteLinesGrid` now carries it as a bulk action next to promotion: it saves pending grid edits first (the import reads stored values), reports `added/updated/unchanged/failed`, names up to five failing lines, is not gated on `approved` (the library is supplier-side data, and the only precondition the command enforces is a supplier on the quotation), and carries its running state in the label because the bulk-action contract has no `disabled` flag. Verified in the browser on the ephemeral app: suppliers list → 「产品库」 row action → the library page opens filtered to that supplier; a manual quotation's grid exposes 「加入产品库」 and the run lands the row in the library. The migration paragraph above was also corrected: both migrations are applied, so the earlier "pending owner approval" note no longer described the database. |
| 2026-09-22 | Implemented and verified (`yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test` green; `yarn test:integration:ephemeral` green — 21 tests: 6 new sourcing tests plus the pre-existing parties/scope-guards suites). Browser smoke against the ephemeral app (`admin@acme.com`): the sidebar renders exactly the six role groups in the planned order with one Purchasing group holding Suppliers / Supplier products / Purchase orders / Supplier quotations; the library list renders its filters, columns and empty state; creating a row through `CrudForm` lists it; the row action 同步为商品 backfills the link and the 关联商品 column then shows the master SKU while the action disappears; the order form defaults to the product-master picker, switches to 供应商产品库 with the "select a supplier first" hint, loads that supplier’s rows as `SMOKE-P4108 — Eversweet 3 Pro (smoke)`, and the saved order shows `Supplier code: SMOKE-P4108` under the product name. Deviations from the draft, each forced by the primitive it lands on: (1) the library list resolves `productSku`/`productName` in the CRUD factory's `hooks.afterList` (its `transformItem` is synchronous) and therefore sets `disableListCache: true`, because a product renamed in the master must not keep its old label in a cached payload; (2) `upsertSupplierProductRow` and `promoteSupplierProduct` take the resolved `dataEngine` (and `ctx` for the product commands) in addition to `em`, because creating the row and backfilling `product_id` have to go through `createOrmEntity`/`updateOrmEntity` to carry the CRUD side effects and to learn the generated id; (3) `promote` reports `priceSkipped` so the UI can say "synced without a price" instead of implying one was written; (4) packing reuses the module's existing `dimensionsSchema` (blank parts dropped, all-blank collapses to null) and the form's inner/outer editors fix the unit to `cm`, matching the plan's shape; (5) `loadSupplierProductOptions` accepts `string \| null` for its supplier/organization arguments — the form's live values are nullable and an empty supplier must yield no options rather than a request; (6) the create page reads `?supplierId=` client-side through `useSearchParams` (Next 16 makes the server `searchParams` prop a promise, and no page in this repo consumes it). |
