# Order File Fields + Export Finance (`export_finance`)

**Date**: 2026-09-22
**Status**: Ready for implementation

> Third app-owned business slice after `purchasing` and `trade_docs`. Owner input: the business keeps a 35-field **订单档案** (purchase → supplier pickup → export customs → overseas subsidiary → collection → export tax refund) in a hand-maintained Excel and needs it in the system with **two outputs** — a business view and a finance view.
>
> The file inventory of the 35 fields is unchanged from the owner's sheet; this spec resolves where each one lands, inventing only the 14 fields no existing module can carry.

## TLDR

Split the 35-field order file across the modules that already own the data (12 fields already exist, 9 are recorded through an existing mechanism, 14 are genuine gaps), add the three missing recording surfaces (purchase-order header fields + purchase-order documents, shipment container info + four new export document types, a contract seal scan), and add one app-owned module **`export_finance`** for the two finance anchors: **collection is recorded per purchase order** (`是否已收款`, 涉外收入证明) and **the tax refund is recorded per container/shipment** (`退税状态`, `退税金额`, `税金额备注`, 报告草单, 出口退税资料整理), with the container-level refund amount **back-allocated to each order by purchase-amount share**. A read-only aggregation layer then serves the business tab, the finance tab, the checklist (单据齐套) and CSV export.

## Problem Statement

The 订单档案 sheet is the single operational view the business and finance both work from, and it cannot be produced from the system today:

1. **The purchase order has no business identity.** The system number is `PO-YYYY-NNNN`; the business number (年-月-序列, e.g. `2609-001`) has nowhere to live, and neither do the order description (产品类型), the purchaser (采购负责人) or the customer (海外分公司) — the latter two are today only in the operator's head and the chat thread.
2. **Purchase-side paperwork has no home.** INV.NO, the invoice form, the packing list, the payment receipts and their invoices are files in a folder; the container facts (柜型/箱号/封条/订舱号/提单号) live in the forwarder's email; SO / 电放提单 / 国内段运费水单 / 订舱运杂费 have no document type at all.
3. **The signed contract scan has no home.** `trade_docs` stores the *generated* XLSX (`generated_attachment_id`) but not the counterparty-stamped scan that finance files against the refund.
4. **The two finance answers that the sheet exists for cannot be recorded.** 是否已收款 is per **order** (a container may hold several orders from several suppliers); 退税 is per **container** (one declaration), yet the operator must see the refund of each order — today done by hand in Excel, which is why the two figures drift.
5. **There is no assembly point.** Nothing renders "one order, all its documents, business view or finance view", and the field-by-field answer to "what is still missing for this order" is a spreadsheet column.

Evidence: `src/modules/purchasing/**` (order header has no business number/owner/customer/document table), `src/modules/cross_border/**` (`shipments` has no container columns; `EXPORT_DOC_TYPES` has five values and none of SO / telex release / domestic freight / booking charges), `src/modules/trade_docs/**` (contract has no manual attachment), and no module mentions 收汇 or 退税.

## Overview and Success Measures

- **Primary outcome:** an operator can fill one purchase order's 订单档案 end to end (header, documents, container facts, sealed contract, collection, refund) and read both the business view (`/7 + /5` checklist) and the finance view (order amount, deposit/balance, paid/outstanding, KC price, USD invoice, collection status, allocated refund) from one page; CSV export gives the same two views.
- **Leading indicators:** every refund figure visible on an order equals the container figure allocated by purchase share and the shares sum to the container amount; every one of the 35 fields has a named home; the checklist column is empty for a fully-documented order.
- **Baseline:** zero purchase orders carry a business number; zero collection/refund records exist; the sheet is the only place the finance columns exist.
- **Market / product reference:** mid-market trade ERP (Odoo `stock.landed.cost` + `account.tax` refund, NetSuite landed cost and tax-refund workflows, SAP GTS) keeps the customs/refund declaration at **container/document level** and derives per-order figures. Adopted: container-level declaration with derived per-order allocation, document checklist per anchor. Rejected: a "unified order" entity that copies purchasing/cross_border/trade_docs data; automatic customs/refund filing; multi-container-per-shipment modelling (see Assumptions).

## Goals

Requirements are grouped A–F; each maps to a phase, a test, and an acceptance criterion below.

- **REQ-A1** — `purchasing_purchase_orders` gains six nullable columns — `business_number`, `product_category`, `owner_user_id`, `owner_snapshot`, `customer_id`, `customer_snapshot` — written by the existing create/update commands from the request payload (snapshots come from the client, exactly like `trade_docs`' `counterpartySnapshot`); the commands never read another module's tables.
- **REQ-A2** — The purchase-order update command keeps its post-`draft` write gate but widens the allowed post-placement set to exactly `businessNumber`, `productCategory`, `ownerUserId`, `ownerSnapshot`, `customerId`, `customerSnapshot`, `expectedShipAt`, `notes`; any other key in a non-`draft` update is rejected with 409 and no write.
- **REQ-A3** — `product_category` is a single-select backed by the seeded dictionary `order_product_category` (`litter_box` / `pet_supplies` / `cat_litter`); the seed is idempotent and never rewrites an operator's edited label.
- **REQ-B1** — `purchasing_purchase_order_documents` stores purchase-side paperwork as **one row per file** with `doc_type` ∈ `supplier_invoice` | `packing_list` | `purchase_payment_receipt` | `other`, `document_number`, `issued_at`, `attachment_id`, `note`.
- **REQ-B2** — Purchase-order document CRUD is exposed as `makeCrudRoute` CRUD actions over registered commands, gated by `purchasing.orders.view` (read) and `purchasing.orders.manage` (write), with per-method `metadata` and exported `openApi`.
- **REQ-C1** — `cross_border_shipments` gains `container_type`, `container_number`, `seal_number`, `booking_number` (all nullable text); `container_type` is a single select backed by the seeded dictionary `container_type` (`40HQ`, `120AUTO`, `40HQ*2`, `20GP+40HQ`, `3*40HQ`, `20GP`, `GUANGZHOU_LOGISTICS_KAPRO`).
- **REQ-C2** — `EXPORT_DOC_TYPES` gains `so`, `telex_release`, `domestic_freight_receipt`, `booking_charges_receipt`; the existing document command/route keep working unchanged and the new types appear in the shipment UI.
- **REQ-D1** — `trade_docs_contracts` gains `attachment_id` (the **signed/stamped scan**; the generated XLSX keeps `generated_attachment_id`), bound through a new `trade_docs.contracts.attach` command and `PUT /api/trade_docs/contracts/attach` route gated by `trade_docs.contracts.manage`.
- **REQ-E1** — `export_finance_collections` is unique per `(tenant, organization, purchase_order_id)` and carries `collection_status` ∈ `received` | `not_received` | `unknown`, plus `purchase_order_number` and `currency_code` snapshots; `PUT /api/export_finance/collections` upserts it (create when absent, optimistic-locked update when present).
- **REQ-E2** — `export_finance_refunds` is unique per `(tenant, organization, shipment_id)` and carries `tax_refund_status` ∈ `completed` | `applied` | `not_started` | `unknown`, `tax_refund_amount` (numeric(18,4), hand-entered, ≤2 decimals accepted) and `tax_refund_note`; the save command rejects a `shipment_id` that is missing or `cancelled` in `cross_border_shipments` with 409 and creates no row.
- **REQ-E3** — `export_finance_collection_documents` (`foreign_income_certificate` | `other`) hangs on the order-level collection, `export_finance_refund_documents` (`tax_refund_package` | `report_draft` | `other`) hangs on the container-level refund; both are one row per file, CRUD through registered commands and `makeCrudRoute` actions.
- **REQ-E4** — **Allocation rule (single authoritative definition):** `share_i = HALF_UP(refundAmount × orderTotal_i / Σ orderTotal, 2)`; the rounding remainder lands on the order with the largest share (ties → the lowest `number`, then lowest id); when `Σ orderTotal = 0` every order's allocation is `null`; the allocations always sum to the container amount.
- **REQ-E5** — **Order refund status** is the *least advanced* status of the order's containers: `unknown(0) < not_started(1) < applied(2) < completed(3)`; an order with no container record reads `unknown`.
- **REQ-F1** — A read-only projection serves `/api/export_finance/order-files` (business + finance views of one order: derived business status, dates, container facts, the five finance amounts, collection status, aggregated refund status, allocated refund amount, `containers[]`, and a 12-item checklist) and `/api/export_finance/container-files` (the container as the refund unit: container facts, its orders with allocated refunds, refund status/amount/note, and a 7-item checklist). Both honour tenant + organization scope and support `format=csv`.
- **REQ-F2** — **Derived business status** (no new stored column): `cancelled` > `closed` > `received` > `shipped` (order `shipped` or shipment departed) > `factory_pickup` (order `placed` and at least one container has the `picked_up` milestone) > `placed` > `draft`.
- **REQ-F3** — Money is read through `src/modules/trade_docs/lib/money.ts` (`quantizeExactDecimal` / `subtractExactDecimal` / `sumAmounts`) with the currency scale from `readCurrencyScaleInfo`; `Number.toFixed` is not used anywhere in this slice.
- **REQ-F4** — `KC订单价格` is the most recent non-cancelled `direction='sales'`, `source_kind='purchase_order'`, `source_id=<order>` contract's `finance_total`; `USD` is the most recent non-void `direction='outbound'` invoice of that contract (`issued_at desc nulls last, updated_at desc`) with its currency code; both are `null` when absent.
- **REQ-G1** — Four backend pages ship under `/backend/export-finance/...` (orders list with business/finance tabs, order detail with the two tabs + collection form + collection documents, containers list, container detail with the refund form and the reverse order table whose allocations and total reconcile to the container amount), each with `page.meta.ts`, ACL features, zh/en strings, loading/empty/error/conflict/permission-denied states.
- **REQ-G2** — The new module owns features `export_finance.orders.view`, `export_finance.cabinets.view`, `export_finance.manage`; `setup.ts` grants them to `superadmin`/`admin` only; `yarn mercato auth sync-role-acls` is run after they are added.

## Non-goals

- A **unified order entity** duplicating purchase order / shipment / contract data. The order file is a projection over the four owning modules.
- **Multi-select** product category and customer (see Assumptions 1–2; the additive upgrade path is named there).
- **Writing** anything into `purchasing`, `cross_border`, `trade_docs` from `export_finance`, and any cross-module ORM relation; the projection is raw scoped read-only SQL.
- **A new attachment paradigm** (one-to-many `attachments`). Multi-file fields are expressed as document rows, one file per row.
- Automating the customs refund calculation, filing, or reconciliation against a tax authority; the refund amount is entered by finance.
- A separate `expected_delivery_at` column — `expected_ship_at` carries the 预计交货日期 label (Assumptions 3).
- Persisting the per-order allocation as rows — it is derived at read time (Assumptions 7 names the upgrade path).
- Editing any published migration, `node_modules`, or `.mercato/generated/**`.

## Proposed Solution

Four small recording extensions plus one new module, and a read-only aggregation layer that is the only place the 35 fields meet.

```text
purchasing ── purchase_orders (business no., category, owner, customer)
           └── purchase_order_documents  (INV.NO + form, packing list, payment receipts)
cross_border ── shipments (container type/number/seal/booking)
             └── export_documents  (SO, telex release, customs, domestic freight, booking charges)
trade_docs ── contracts (+ stamped scan), invoices (+ KC INVOICE scan)
export_finance
  ├─ collections        (per purchase order: 是否已收款)  ← collection_documents (涉外收入证明)
  ├─ refunds            (per shipment: 退税状态/金额/备注) ← refund_documents (报告草单, 资料整理)
  └─ read-only projections: order-files (12-item checklist) / container-files (7-item checklist)
                     ↑ join through cross_border_shipment_allocations (the existing 拼柜 link)
```

- **Module boundaries:** `export_finance` owns exactly the two finance anchors and the projection; the container↔order link is **reused**, not duplicated (`cross_border_shipment_allocations`), so a shipment that gains or loses an order immediately changes what the order's refund view shows.
- **Extension points:** additive columns + additive dictionary entries + additive enum members; no installed contribution is replaced, overridden, or hidden.
- **Alternatives considered:** (a) refund per order — rejected, the declaration is per container and 拼柜 is the norm; (b) collection per container — rejected, the money arrives against the order; (c) a stored allocation table — deferred, read-time derivation cannot drift from the container figure; (d) storing a derived business status — rejected, it would need a writer on every milestone.
- **Compatibility:** every change is additive. Existing lists keep their fields; the new purchase-order update gate is *stricter* for non-header keys after `place`, which is the current behavior expressed as an explicit allow-list.

## Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| Refund anchored on the shipment, allocated to orders by purchase share | matches the declaration unit; keeps one authoritative refund amount | refund rows per order | two numbers drift on 拼柜; the container figure is what finance files |
| Collection anchored on the purchase order | the money arrives per order from the subsidiary | collection per shipment | one container may hold orders of different suppliers/collections |
| Derived status, no stored column | milestone + order status already carry the fact; a stored copy needs writers everywhere | `business_status` column | drift risk with no reader benefit |
| Documents as rows, one file per row | uses the existing attachment pointer, no new paradigm | attachment list per record | new relation + new uploader contract for no benefit |
| Allocation derived at read time | always equals the current container amount and order set | `export_finance_refund_allocations` table | must be rewritten whenever an allocation changes; deferred |
| Snapshots (`purchase_order_number`, `currency_code`, `owner_snapshot`, `customer_snapshot`) sent by the client | matches the module's existing `supplier_snapshot` / `counterparty_snapshot` pattern; no cross-module read in a command | server-side cross-module lookup | would couple the command layer to peer tables |
| Reuse `expected_ship_at` for 预计交货日期 | one column already means "when the goods should arrive" | new `expected_delivery_at` | additive later if the business splits the two dates |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| 订单档案 / order file | the 35-field projection of one purchase order | the projection (read-only) | never written |
| 业务订单号 `business_number` | business numbering 年-月-序列, free text, not unique-enforced | `purchasing_purchase_orders` | duplicates allowed (the business reuses sequences across years) |
| 系统单号 `number` | `PO-YYYY-NNNN`, assigned at `place`, unique per organization | `purchasing_purchase_orders` | unchanged |
| Reserved hash / business status | `cancelled` > `closed` > `received` > `shipped` > `factory_pickup` > `placed` > `draft` | derived (REQ-F2) | unknown order status falls through to `draft` |
| 预付款 (planned) | `deposit_amount` when set, else `HALF_UP(total × deposit_percent / 100, currency scale)` | `purchasing_purchase_orders` | both null → `null`, not 0 |
| 尾款 (planned) | `total − 预付款`, never a stored value | derived | `null` when the deposit plan is null |
| 已付 / 未付 | sum of the order's payment rows; `未付 = total − 已付` (may go negative and is shown signed) | `purchasing_purchase_payments` | no rows → paid `0` |
| KC订单价格 | the sales contract's `finance_total`, currency `CNY` | `trade_docs_contracts` | no contract → `null` |
| USD (海外分公司发票) | the latest non-void outbound invoice of the KC contract: `total` + `currency_code` | `trade_docs_invoices` | no invoice → `null` |
| 是否已收款 | order-level enum; absent record reads `unknown` | `export_finance_collections` | unknown is never rendered as "not received" |
| 退税状态 (container) | container-level enum; absent record reads `unknown` | `export_finance_refunds` | — |
| 退税状态 (order) | least advanced of its containers' statuses (REQ-E5) | derived | no containers → `unknown` |
| 本单分摊退税额 | REQ-E4 allocation of each container amount; per order summed over containers | derived | container amount null → skipped; all null → `null` |
| 税金额备注 | container-level free text, surfaced on the order only through `containers[]` | `export_finance_refunds` | — |
| 单证齐套 (checklist) | a document counts only when a row of that type exists **and** its `attachment_id` is non-null | derived | order-level export items count a hit in **any** of the order's containers |
| Order checklist keys | `supplierInvoice`, `packingList`, `purchasePaymentReceipt`, `purchaseContract`, `salesContract`, `kcInvoiceStamped`, `foreignIncomeCertificate` (7) + `so`, `telexRelease`, `customsDeclaration`, `domesticFreight`, `bookingCharges` (5) | derived | `checklistMissing[]` lists only the missing |
| Container checklist keys | the same 5 export keys + `taxRefundPackage`, `reportDraft` | derived | as above |
| 拼柜 link | `cross_border_shipment_allocations` (`shipment_id` + `purchase_order_id`); the only order↔container relation | `cross_border` | soft-deleted shipments are excluded |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| 采购 / 业务 operator | record purchase-order header fields and purchase documents; view the order file business tab; export CSV | rows of their organization (and descendants per the directory rule) | `purchasing.orders.view` / `purchasing.orders.manage`, `export_finance.orders.view` |
| 单证 / 物流 operator | container info + export documents on the shipment | own organization | `cross_border.shipments.manage`, `cross_border.documents.manage` |
| 财务 operator | collection + foreign income certificate, refund + refund documents; sign off the container allocation table | own organization | `export_finance.orders.view`, `export_finance.cabinets.view`, `export_finance.manage` |
| Administrator | all of the above | own organization | `superadmin`/`admin` receive `export_finance.*` from `setup.ts` |

Trusted scope: `tenantId` and `organizationId` always come from the authenticated request — for `makeCrudRoute` from the ORM tenant/org keys, for the custom routes from `getAuthFromRequest` plus `resolveOrganizationScopeForRequest` (`filterIds`, falling back to `auth.orgId`), and for commands from `ensureScope`. A missing organization fails closed (400/403), never "all organizations". No system-scope (`organizationId: null`) read or write exists in this slice.

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| Purchase order, lines, payments | extend | `purchasing` | additive columns + one new document entity | the order is the orders' source of truth |
| Container facts + export paperwork | extend | `cross_border` | additive columns + additive enum members + dictionary | the shipment already owns the paperwork |
| Contracts / invoices / attachments | extend | `trade_docs` | one additive column + an `attach` command mirroring `invoices.attach` | the contract already owns its generated file |
| Collection ("是否已收款") | app-own | new `export_finance` | scalar `purchase_order_id` + snapshots | nothing in the platform records export proceeds |
| Tax refund per container | app-own | new `export_finance` | scalar `shipment_id` + snapshots; shipment existence checked by raw scoped read | nothing in the platform records the customs refund |
| Order ↔ container relation | reuse | `cross_border` | `cross_border_shipment_allocations` read-only | avoids a parallel link table that would drift |
| Attachments (files) | reuse | installed `attachments` | `attachment_id` + `/api/attachments/file/<id>` | the platform already stores and serves files |
| Dictionaries | reuse | installed `dictionaries` | `Dictionary`/`DictionaryEntry` seeds | single- and multi-select option source |
| Auth / ACL / scope / CRUD factory / commands / events / openapi | reuse | platform | `makeCrudRoute`, `registerCommand`, `createModuleEvents`, `createCrudOpenApiFactory` | platform-native by rule |
| Money arithmetic | reuse | `trade_docs/lib/money.ts`, `trade_docs/lib/currencyScale.ts` | direct import (pure functions) | one rounding authority |
| CSV serialization | reuse | `@open-mercato/shared/lib/crud/exporters` | `serializeExport` | platform already hardens formula injection |

## Architecture and Data Flow

```text
/backend/purchasing/orders/[id]        -> /api/purchasing/purchase-orders (PUT)      -> purchasing
                                       -> /api/purchasing/purchase-orders/documents  -> purchasing
/backend/cross_border/shipments/[id]   -> /api/cross_border/shipments (PUT)           -> cross_border
                                       -> /api/cross_border/shipments/documents      -> cross_border
/backend/trade-docs/contracts/[id]     -> /api/trade_docs/contracts/attach (PUT)      -> trade_docs
/backend/export-finance/orders         -> /api/export_finance/order-files (GET)       -> projection (read-only)
/backend/export-finance/orders/[id]    -> /api/export_finance/collections (PUT)       -> export_finance
                                       -> /api/export_finance/collection-documents   -> export_finance
/backend/export-finance/containers     -> /api/export_finance/container-files (GET)   -> projection (read-only)
/backend/export-finance/containers/[id]-> /api/export_finance/refunds (PUT)           -> export_finance
                                       -> /api/export_finance/refund-documents       -> export_finance
```

- **Module boundaries:** `export_finance` owns the two anchors and the projection; it never writes peer tables and never imports peer entities (raw Kysely reads only).
- **Extension points:** additive columns, additive enums, dictionary seeds, one new command/route per module for the surfaces that had none (purchase documents, contract attach).
- **Alternatives considered:** a single `export_finance_order_files` materialized table — rejected (a cache with no owner committed to invalidating it); adding the fields to a UMES extension entity — rejected (they are first-class business fields of records the app already owns).
- **Compatibility:** all peer changes are additive; the only behavior change is the explicit post-placement update allow-list in `purchasing` (REQ-A2), which preserves the current rejection of `supplierId`/`currencyCode`/`deposit*`/`lines` edits after `place`.

## User Journeys

### Journey J-001 — Fill a purchase order's 订单档案

1. Operator opens `/backend/purchasing/orders/<id>`, sees the business number, description, purchaser, customer and the document table, clicks 编辑.
2. On the edit page (order `placed`), the business number / description / owner / customer / notes stay editable while supplier, currency, deposit and lines are read-only; saving a non-header field returns 200, sending `currencyCode` returns 409 `Only header metadata can be updated in status placed` and nothing changes.
3. Operator returns to the detail page, adds `supplier_invoice` (INV.NO + file) and `packing_list` rows; each row uploads through the attachments endpoint with `entityId='purchasing:purchase_order'`.
4. Downstream: `/backend/export-finance/orders` now shows `采购·合同类 3/7` for this order and the finance tab shows the plan amounts from its lines.

### Journey J-002 — Record the container facts and the export paperwork

1. On `/backend/cross_border/shipments/<id>` the operator sets 柜型 (dictionary select), 箱号, 封条, 订舱号/提单号 and saves; a stale `updatedAt` returns 409 with the conflict state.
2. They add `so`, `telex_release`, `customs_declaration`, `domestic_freight_receipt` (possibly several rows) and `booking_charges_receipt` documents; each row stores its own file.
3. `/backend/export-finance/containers` lists the container with `出口类 4/5` and the missing item named in a tooltip.

### Journey J-003 — Collection and tax refund, then read both views

1. Finance opens `/backend/export-finance/orders/<poId>`, finance tab, sets 收款状态 to 已收款 and saves — the first save creates the order's collection record, later saves update the same row (optimistic-locked); they upload the 涉外收入证明 (several files = several rows) and download each file.
2. Finance opens `/backend/export-finance/containers/<shipmentId>`, sets 退税状态 = 已申请, 退税金额 = 1234.56, 税金额备注, saves, then uploads 报告草单 and 出口退税资料整理.
3. The container page renders the container's orders with their purchase amounts, share percentages and allocated refunds, plus a 合计 row whose value is the container amount (a mismatch is highlighted).
4. The order's finance tab shows 退税状态 = 已申请 (least advanced of its containers) and 本单分摊退税额 = the allocated figure; the refund note is visible on the container row and, on the order page, only as a "去该柜登记" link (the anchor stays single).
5. Both list pages export CSV with the same columns as the screen; an operator scoped to another organization sees neither the order nor the container.

## UI and Interaction Contracts

Reference implementations inspected: `src/modules/cross_border/components/ShipmentDetail.tsx` (attachment upload field + document table), `src/modules/trade_docs/components/ContractDetail.tsx` (attach/download pattern), `src/modules/purchasing/components/PurchaseOrderForm.tsx` and `PurchaseOrdersTable.tsx` (CrudForm/DataTable shells), `src/modules/trade_docs/components/downloadFile.ts` (file download helper).

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/purchasing/orders/[id]` (extended) | header summary + 单证 table with add/edit/remove and 编辑 link | `GET/POST/PUT/DELETE /api/purchasing/purchase-orders/documents` | `ShipmentDetail.tsx` | `Page`, `PageBody`, `DataTable`, `CrudForm`, upload field | loading, empty, error, conflict, denied | REQ-A1, REQ-B1, REQ-B2 |
| `/backend/purchasing/orders/[id]/edit` (new) | edit header metadata; lines/supplier read-only after `place` | `PUT /api/purchasing/purchase-orders` | `PurchaseOrderForm.tsx` | `Page`, `PageBody`, `CrudForm` | loading, error, 409 conflict, locked hint | REQ-A1, REQ-A2 |
| `/backend/cross_border/shipments/[id]` (extended) | container facts + 4 new document types | `PUT /api/cross_border/shipments` | itself | `CrudForm`, `DataTable` | as today + new fields | REQ-C1, REQ-C2 |
| `/backend/trade-docs/contracts/[id]` (extended) | upload/remove/download the stamped scan | `PUT /api/trade_docs/contracts/attach` | itself + invoice attach | `Button`, upload field | loading, error, empty, denied | REQ-D1 |
| `/backend/export-finance/orders` (new) | business/finance tabs, filters, CSV export | `GET /api/export_finance/order-files` | `TradeDocs`/`Purchasing` list pages | `Page`, `PageBody`, `DataTable`, tabs, `Button` | loading, empty, error, denied | REQ-F1, REQ-G1 |
| `/backend/export-finance/orders/[id]` (new) | business tab (containers, checklist), finance tab (amounts, collection form, certificates) | `GET order-files`, `PUT collections`, collection-documents CRUD | `ContractDetail.tsx` | `Page`, `PageBody`, `CrudForm`, `DataTable` | loading, empty, error, 409, read-only without `manage` | REQ-E1, REQ-E3, REQ-F1, REQ-G1 |
| `/backend/export-finance/containers` (new) | container list + CSV export | `GET /api/export_finance/container-files` | as above | `Page`, `PageBody`, `DataTable` | loading, empty, error, denied | REQ-F1, REQ-G1 |
| `/backend/export-finance/containers/[id]` (new) | refund form, reverse order table with allocations, documents | `GET container-files`, `PUT refunds`, refund-documents CRUD | `ContractDetail.tsx` | `Page`, `PageBody`, `CrudForm`, `DataTable` | loading, empty, error, 409, reconciliation mismatch highlight | REQ-E2, REQ-E3, REQ-E4, REQ-F1, REQ-G1 |

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| 采购 operator | 采购 → 采购订单 | none | login → 采购订单 → order → 编辑 → save header → result |
| 财务 operator | 采购 → 订单档案 (business/finance), 柜档案 | none | login → 订单档案 → finance tab → 收款状态/退税 → save |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| order/container lists | localized "no rows yet" + filter reset hint | table scrolls horizontally, filters collapse | filters reachable by Tab; row click opens the detail |
| checklist tooltips | names the missing item(s) | tooltip stays in viewport | tooltip content is text, not colour-only |
| allocation table | "no orders in this container" | share/amount columns wrap | 合计 row announced last |

### `/backend/export-finance/orders` — 订单档案

```text
┌──────────────────────────────────────────────────────────────┐
│ 订单档案 Order file                        [业务 | 财务] [导出CSV]│
│ [search] [status] [collection] [refund status]               │
├──────────────────────────────────────────────────────────────┤
│ DataTable: business or finance column set                    │
├──────────────────────────────────────────────────────────────┤
│ pagination / total                                           │
└──────────────────────────────────────────────────────────────┘
```

- **Behavior:** the tab is local state mirrored into the query string; changing filters or the tab refetches the same endpoint with `view`; CSV export reuses the same query plus `format=csv`; a row click opens the detail page.
- **Responsive and accessibility:** sticky header, horizontal scroll under 1100px, every status cell renders an i18n label (never a raw enum), the checklist cell exposes a text tooltip with the missing keys.
- **Localization:** `export_finance.orders.*` / `export_finance.cabinets.*` in zh and en with identical key sets.
- **Design-system and theming:** shared `DataTable`/`CrudForm`/`Button` primitives and semantic tokens only; both themes come from the shell — no hard-coded palette.

## Data Models

### `PurchasingPurchaseOrder` (extended)

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `business_number` | text, null | none | no | free text ≤64; editable after `place` |
| `product_category` | text, null | none | no | dictionary `order_product_category` value |
| `owner_user_id` | uuid, null | none | no | system user id; snapshot carries `name`/`email` |
| `owner_snapshot` | jsonb, null | — | no | client-sent display snapshot |
| `customer_id` | uuid, null | none | no | CRM company id; snapshot carries `name` |
| `customer_snapshot` | jsonb, null | — | no | client-sent display snapshot |

### `PurchasingPurchaseOrderDocument` (new)

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | uuid PK, required | — | no | immutable |
| `tenant_id` / `organization_id` | uuid, required | query scope | no | trusted context only |
| `order_id` | uuid, required | FK → `purchasing_purchase_orders`, cascade | no | must resolve inside the caller's scope |
| `doc_type` | text, required | — | no | `supplier_invoice` \| `packing_list` \| `purchase_payment_receipt` \| `other` |
| `document_number` | text, null | — | no | ≤120 |
| `issued_at` | date, null | — | no | ISO date |
| `attachment_id` | uuid, null | — | no | id in the installed attachments store |
| `note` | text, null | — | no | ≤500 |
| `created_at` / `updated_at` / `deleted_at` | timestamps | — | no | soft delete |

### `CrossBorderShipment` (extended)

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `container_type` | text, null | none | no | dictionary `container_type` value |
| `container_number` | text, null | none | no | ≤64; list filter `$ilike` |
| `seal_number` | text, null | none | no | ≤64 |
| `booking_number` | text, null | none | no | ≤64; SO number lives here, not on the SO row |

### `TradeDocsContract` (extended)

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `attachment_id` | uuid, null | none | no | the signed/stamped scan; `generated_attachment_id` remains the generated XLSX |

### `ExportFinanceCollection` (new)

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | uuid PK | — | no | immutable |
| `tenant_id` / `organization_id` | uuid, required | unique key part | no | trusted context only |
| `purchase_order_id` | uuid, required | unique `(tenant, org, purchase_order_id)` | no | upserted by the save command |
| `purchase_order_number` | text, null | — | no | snapshot sent by the client |
| `currency_code` | text, not null default `CNY` | — | no | 3-letter code |
| `collection_status` | text, not null default `unknown` | — | no | `received` \| `not_received` \| `unknown` |
| `updated_at` | timestamp | optimistic-lock version | no | returned to the client and required on update |

### `ExportFinanceCollectionDocument` (new)

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `collection_id` | uuid FK → collection, cascade | list filter | no | must resolve inside scope |
| `doc_type` | text | — | no | `foreign_income_certificate` \| `other` |
| `attachment_id` | uuid, null | — | no | file id |
| `issued_at` / `note` | date / text, null | — | no | ≤500 note |

### `ExportFinanceRefund` (new)

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `shipment_id` | uuid, required | unique `(tenant, org, shipment_id)` | no | the save command rejects a missing/cancelled shipment (409) |
| `shipment_number` | text, null | — | no | snapshot at save time |
| `tax_refund_status` | text, not null default `unknown` | — | no | `completed` \| `applied` \| `not_started` \| `unknown` |
| `tax_refund_amount` | numeric(18,4), null | — | no | hand-entered, ≤2 decimals accepted, quantized to 4 on store |
| `tax_refund_note` | text, null | — | no | ≤500 |
| `updated_at` | timestamp | optimistic-lock version | no | as above |

### `ExportFinanceRefundDocument` (new)

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `refund_id` | uuid FK → refund, cascade | list filter | no | must resolve inside scope |
| `doc_type` | text | — | no | `tax_refund_package` \| `report_draft` \| `other` |
| `attachment_id` / `issued_at` / `note` | as above | — | no | as above |

Migrations: one `yarn db:generate` pass per module produces `alter table … add column` (purchasing, cross_border, trade_docs) and `create table` + unique constraints + indexes (`export_finance`). No `drop`, `rename`, or `NOT NULL` added to an existing column is acceptable in the generated SQL; such output is a signal to fix the entity declaration, not to hand-edit the migration.

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| `POST/PUT/DELETE` | `/api/purchasing/purchase-orders` | `purchasing.orders.manage` | `purchaseOrderCreateSchema` + 6 new optional fields | 201 / 200; `purchasing.purchase_order.updated` | 400 invalid, 409 non-header key after `place`, 409 stale `updatedAt` | REQ-A1, REQ-A2 |
| `GET/POST/PUT/DELETE` | `/api/purchasing/purchase-orders/documents` | view / `purchasing.orders.manage` | `purchaseOrderDocumentCreate/Update/ListSchema` | 201 / 200 / `{ok:true}` | 400 unknown `docType`, 404 out-of-scope order | REQ-B1, REQ-B2 |
| `POST/PUT/DELETE` | `/api/cross_border/shipments` | `cross_border.shipments.manage` | `shipmentCreate/UpdateSchema` + 4 new fields | 201 / 200 | 400 invalid, 409 stale | REQ-C1 |
| `GET/POST/PUT/DELETE` | `/api/cross_border/shipments/documents` | view / `cross_border.documents.manage` | `documentCreate/Update/ListSchema` | 201 / 200 | 400 unknown `docType` | REQ-C2 |
| `PUT` / `trade_docs.contracts.attach` | `/api/trade_docs/contracts/attach` | `trade_docs.contracts.manage` | `{ id, attachmentId: uuid \| null }` | 200 `{ok:true}` | 400 invalid, 404 out of scope | REQ-D1 |
| `GET` | `/api/export_finance/order-files` | `export_finance.orders.view` | `view`, filters, paging, `format` | `{ items, total, page, pageSize }` or CSV | 400 invalid query, 403 denied | REQ-F1, REQ-F2 |
| `GET` | `/api/export_finance/container-files` | `export_finance.cabinets.view` | filters, paging, `format` | as above or CSV | as above | REQ-F1 |
| `GET` / `PUT` | `/api/export_finance/collections` | view / `export_finance.manage` | `collectionSaveSchema` | `{ item }` / `{ id }`; `export_finance.collections.updated` | 400 invalid, 409 stale `updatedAt`, 403 denied | REQ-E1 |
| `GET` / `PUT` / `export_finance.refunds.save` | `/api/export_finance/refunds` | `export_finance.cabinets.view` / `export_finance.manage` | `refundSaveSchema` | `{ item }` / `{ id }`; `export_finance.refunds.updated` | 400 amount with >2 decimals, 409 unavailable shipment, 409 stale | REQ-E2 |
| `GET/POST/PUT/DELETE` | `/api/export_finance/collection-documents` | as collections | `collectionDocument*Schema` | 201 / 200 / `{ok:true}` | 400, 404 | REQ-E3 |
| `GET/POST/PUT/DELETE` | `/api/export_finance/refund-documents` | as refunds | `refundDocument*Schema` | 201 / 200 / `{ok:true}` | 400, 404 | REQ-E3 |

All CRUD routes use `makeCrudRoute` with per-method `metadata` and an exported `openApi`; the two list routes and the two save routes are custom handlers that derive scope from the authenticated request and return 400 when no organization can be resolved. Commands are registered with stable IDs (`registerCommand`) and emit their declared events only after commit; the save commands enforce `updatedAt` optimistic locking and emit `*updated` events.

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| `purchasing.purchase-order-documents.created/updated/deleted` | `purchasing` | none in this slice | CRUD side effects + index | standard `emitCrudSideEffects`; document rows are simple records |
| `trade_docs.contracts.attached` (via `contracts.attach`) | `trade_docs` | none | attachment pointer update | idempotent set/unset |
| `export_finance.collections.updated` | `export_finance` | none | CRUD side effects + index | upsert keyed by `(tenant, org, purchase_order_id)`; repeated saves update one row |
| `export_finance.refunds.updated` | `export_finance` | none | CRUD side effects + index | upsert keyed by `(tenant, org, shipment_id)` |
| `export_finance.collection-documents.*` / `export_finance.refund-documents.*` | `export_finance` | none | CRUD side effects + index | one file per row |

No scheduled job, worker, notification, or cache is introduced: the projection is computed per request from current data, so there is nothing to invalidate.

## Security, Privacy, and Compliance

- **Authorization:** every route declares `requireFeatures`; every page's `page.meta.ts` declares the same features. No role-name check exists.
- **Tenant isolation:** `makeCrudRoute` derives trusted tenant/organization from the request context; the projection filters `tenant_id = ?` and `organization_id in (resolveOrganizationScopeForRequest(...).filterIds)` falling back to `auth.orgId`; missing scope is a 400 with no query executed. The refund save command additionally verifies the shipment is visible in the caller's scope before writing.
- **Sensitive data:** no PII beyond a staff name and a company name, both carried as display snapshots the caller already sees; no credential, token, or free-text-about-a-person field is introduced, so no new encryption map is added. File access stays behind the installed attachments route.
- **Abuse and failure modes:** free-text filters go through `escapeLikePattern`; CSV output goes through the platform serializer (formula neutralization); the search/URL parameters are zod-validated and length-bounded; upserts are locked by a unique-constraint plus `updatedAt`, so a retried save cannot create a second row.

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | integration | two organizations, one purchase order, one shipment with one allocation | create the order with the 6 new fields; place; update the business number; attempt a currency change | 201/200/200/409; read-back equals the write; currency unchanged | REQ-A1, REQ-A2 |
| TEST-002 | integration | dictionary seeds | run `seed:defaults --module purchasing` twice and `--module cross_border` twice | no duplicate dictionary/entry rows; labels unchanged after an operator edit | REQ-A3, REQ-C1 |
| TEST-003 | integration | order + shipment | add `supplier_invoice`/`packing_list` and `so`/`telex_release`/`domestic_freight_receipt`/`booking_charges_receipt` documents; send an unknown type | 201 for each valid; 400 for the unknown type | REQ-B1, REQ-C2 |
| TEST-004 | integration | contract + invoice | attach a scan to the contract and to the invoice | 200; the read-back pointer equals the uploaded file id | REQ-D1, REQ-F1 |
| TEST-005 | integration | order + shipment | PUT collection twice with the same body; PUT refund twice; PUT a 3-decimal amount; PUT a refund against a cancelled shipment | one row per anchor; 400 for the precision violation; 409 and no row for the cancelled shipment | REQ-E1, REQ-E2 |
| TEST-006 | integration | 拼柜: two orders 6000/4000 in one container | set the container refund to 1000.00, then 1000.01 | allocations 600.00/400.00, then 600.01/400.00; the sum equals the container amount | REQ-E4 |
| TEST-007 | integration | 拼柜: three equal orders | set the container refund to 1000.00 | 334.00/333.00/333.00; the remainder lands on the lowest `number` | REQ-E4 |
| TEST-008 | integration | one order split over two containers | set container A `completed`, container B `applied`; then both `completed` | the order reads `applied`, then `completed` | REQ-E5 |
| TEST-009 | integration | order with payments, contract, invoice, documents | GET `order-files?view=finance` | paid/outstanding equal the payments endpoint sum; KC price = contract `finance_total`; USD = invoice total + currency; collection status, allocated refund and `containers[]` match the fixtures | REQ-F1, REQ-F3, REQ-F4 |
| TEST-010 | security | second organization with its own records | GET both list endpoints and both CSV exports with the other organization selected | the other organization's rows are absent | REQ-F1 |
| TEST-011 | integration | orders in the documented states | advance `place` → milestone `picked_up` → shipment `depart` | business status `placed` → `factory_pickup` → `shipped` | REQ-F2 |
| TEST-012 | integration | documents complete/absent | read the order and container checklists | only rows with an attachment count; `checklistMissing` lists the rest; the two key sets do not overlap | REQ-F1 |
| TEST-013 | unit | pure functions | `jest` over `lib/__tests__/orderFileProjection.test.ts` | status precedence, deposit sources, allocation remainder/zero divisor, status aggregation, contract/invoice selection | REQ-F2, REQ-E4, REQ-E5, REQ-F4 |
| TEST-014 | UI | one fully documented order | browser: purchasing detail/edit, export-finance lists/detail/container pages | values, checklists, forms, upload/download and CSV paths work in both tabs | REQ-G1 |

## Implementation Phases

### Phase 1 — Purchase-order fields and documents

- **Depends on:** none
- **Outcome:** a purchase order carries the business number, description, purchaser, customer, `expected_ship_at` label, and a document table; the post-placement edit gate is explicit.
- **Why this order / value delivered:** the order is the row every other finance figure hangs on, and the business number is how the sheet is searched.
- **Deliverables:** entity columns, validators/commands, list projection + filters, dictionary seed, order-document entity/commands/route, order detail/form/edit pages, i18n, migration.
- **Independent slices / estimated commits:** (a) header fields + whitelist + seed; (b) document table + UI.
- **Requirements closed:** REQ-A1, REQ-A2, REQ-A3, REQ-B1, REQ-B2
- **Tests:** TEST-001, TEST-002, TEST-003
- **Validation:** `yarn generate`, focused typecheck, the API walk of the acceptance list
- **Exit gate:** the field round-trips through create → read → post-placement update → 409 on a non-header key; document rows list and delete.

### Phase 2 — Container facts and the four new document types

- **Depends on:** none (independent module)
- **Outcome:** the shipment carries 柜型/箱号/封条/订舱号 and the export paperwork set includes SO, telex release, domestic freight and booking charges.
- **Deliverables:** entity columns, validators/commands, list projection + filter, dictionary seed, shipment form/detail, i18n, migration.
- **Requirements closed:** REQ-C1, REQ-C2
- **Tests:** TEST-002, TEST-003
- **Exit gate:** the four fields round-trip and the four new document types can be created and are selectable in the UI.

### Phase 3 — Contract stamp scan

- **Depends on:** none
- **Outcome:** a signed/stamped contract scan is uploaded, bound, downloaded and removed on the contract detail page.
- **Deliverables:** entity column, attach schema/command/route, detail UI, i18n, migration.
- **Requirements closed:** REQ-D1
- **Tests:** TEST-004
- **Exit gate:** attach → read-back → remove round trip.

### Phase 4 — `export_finance` module: the two anchors

- **Depends on:** Phases 1–3 (the projection reads their columns)
- **Outcome:** collection (per order) and refund (per container) records with their documents can be created, updated (optimistic-locked), listed and deleted through commands, ACL-gated, and seeded for admin roles.
- **Deliverables:** module registration, 4 entities + migration, validators, 6 commands, ACL, 4 routes, i18n, module README, `docs/dev/business-architecture.md` rows.
- **Independent slices / estimated commits:** (a) collections + documents; (b) refunds + documents.
- **Requirements closed:** REQ-E1, REQ-E2, REQ-E3, REQ-G2
- **Tests:** TEST-005
- **Exit gate:** both saves are idempotent by anchor, the cancelled-shipment save is refused, and the document routes work; `yarn mercato auth sync-role-acls` applied.

### Phase 5 — Aggregation and both outputs

- **Depends on:** Phase 4
- **Outcome:** `/api/export_finance/order-files` and `/api/export_finance/container-files` return the business view, the finance view, the checklists, the allocations, and CSV.
- **Deliverables:** the two projection libs + pure functions + unit tests, the two routes (JSON + CSV), the four pages with tabs/forms/checklist/export, i18n.
- **Requirements closed:** REQ-F1, REQ-F2, REQ-F3, REQ-F4, REQ-G1
- **Tests:** TEST-006…TEST-014
- **Validation:** `yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test && yarn build`
- **Exit gate:** the allocation table reconciles to the container amount, both views render for one documented order, and the CSV row appears (and disappears under another organization).

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-A1 | J-001, order detail/edit | `purchasing_purchase_orders.*`, `POST/PUT /api/purchasing/purchase-orders` | 1 | TEST-001 | AC-001 |
| REQ-A2 | J-001 | `purchasing.purchase-orders.update` | 1 | TEST-001 | AC-002 |
| REQ-A3 | J-001 | dictionary `order_product_category` | 1 | TEST-002 | AC-003 |
| REQ-B1 | J-001, order detail | `purchasing_purchase_order_documents` | 1 | TEST-003 | AC-004 |
| REQ-B2 | J-001 | `/api/purchasing/purchase-orders/documents` | 1 | TEST-003 | AC-004 |
| REQ-C1 | J-002, shipment detail | `cross_border_shipments.*`, dictionary `container_type` | 2 | TEST-002 | AC-005 |
| REQ-C2 | J-002 | `EXPORT_DOC_TYPES`, `/api/cross_border/shipments/documents` | 2 | TEST-003 | AC-005 |
| REQ-D1 | contract detail | `trade_docs_contracts.attachment_id`, `contracts.attach` | 3 | TEST-004 | AC-006 |
| REQ-E1 | J-003, order detail finance tab | `export_finance_collections`, `PUT /api/export_finance/collections` | 4 | TEST-005 | AC-007 |
| REQ-E2 | J-003, container detail | `export_finance_refunds`, `PUT /api/export_finance/refunds` | 4 | TEST-005 | AC-008 |
| REQ-E3 | J-003 | the two document tables + routes | 4 | TEST-005 | AC-009 |
| REQ-E4 | J-003, container detail | allocation in the projection | 5 | TEST-006, TEST-007, TEST-013 | AC-010 |
| REQ-E5 | J-003 | aggregation in the projection | 5 | TEST-008, TEST-013 | AC-011 |
| REQ-F1 | order/container lists and details | `order-files`, `container-files` | 5 | TEST-009…TEST-012 | AC-012 |
| REQ-F2 | order list/detail | `deriveBusinessStatus` | 5 | TEST-011, TEST-013 | AC-013 |
| REQ-F3 | finance view | `trade_docs/lib/money.ts` | 5 | TEST-009 | AC-014 |
| REQ-F4 | finance view | contract/invoice selection | 5 | TEST-009, TEST-013 | AC-015 |
| REQ-G1 | all four pages | `page.meta.ts` + components | 5 | TEST-014 | AC-016 |
| REQ-G2 | ACL | `acl.ts`, `setup.ts` | 4 | TEST-005 (denied path) | AC-017 |

## Rollout, Migration, and Rollback

Generation and application stay separate: `yarn db:generate` produces the five migrations, each is reviewed for `add column` / `create table` / `create index` only, and only then `yarn db:migrate` is run once (never as part of a validation pass). Seeds are idempotent (`seed:defaults --module purchasing` / `--module cross_border`) and never overwrite operator edits. ACL sync (`yarn mercato auth sync-role-acls`) runs after the new features are declared. Rollback: the columns and tables are additive and unreferenced by any earlier feature, so dropping the two new modules' tables and the three modules' new columns restores the previous behavior; no data that predates this change is rewritten. Observability is the existing audit/log surface — every write goes through a registered command with `buildLog`.

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| A stale `updatedAt` on a save loses an operator's typing | conflicting edits to a collection/refund | optimistic lock returns 409 and the UI shows the conflict state | operator re-enters the value |
| Allocation drift after an order joins/leaves a container | the order's allocated figure changes without a record | the figure is derived (never stored), the container page always shows the reconciliation row | historical exports differ from later reads — accepted, matches the container amount |
| Purchase-order documents live in `purchasing` while the refund package lives in `export_finance` | an operator must know which page owns which file | the checklist tooltip names the page per missing key | training, not code |
| A container with no orders gets a refund amount | the amount is visible only at container level | the order side shows `null` (documented) and the page states the container is the anchor | accepted |
| One shipment per container (no multi-container shipment) | a real multi-container booking needs separate shipments | documented in Assumptions 6 with a named additive upgrade path | modelling limit |
| Widening the post-placement update gate | a business field could be edited after `place` in a way finance dislikes | the allow-list is explicit and tested; everything else still 409s | accepted |
| `factory_pickup` is derivable but currently unreachable | the business view never shows 工厂提货, so the three-state vocabulary the owner asked for collapses to 已下单/已装运 | recorded here and in `.ai/lessons/derived-status-needs-a-reachable-write-path.md`; the state order is implemented as specified, and the acceptance walk asserts the observable sequence (`placed` → `shipped`) | the owner must decide whether `cross_border` should accept the `picked_up` milestone on a draft shipment (or stop flipping the order to `shipped` at `depart`) — either is a change to that module's state machine, out of this slice |
| Cross-module reads by raw SQL could drift from peer entity names | a rename in a peer module breaks the projection at runtime | column names are asserted by integration tests through the real endpoints | compile-time protection is absent by design |

## Acceptance Criteria

- [ ] **AC-001** — An authenticated operator creates a purchase order carrying `businessNumber`, `productCategory`, `ownerUserId`/`ownerSnapshot`, `customerId`/`customerSnapshot` and reads all six back through the list endpoint in their own organization.
- [ ] **AC-002** — After `place`, updating `businessNumber` succeeds and updating `currencyCode` returns 409 with the read-back value unchanged.
- [ ] **AC-003** — Re-running the purchasing seed twice leaves one `order_product_category` dictionary with exactly the three entries and does not rewrite an edited label.
- [ ] **AC-004** — A `supplier_invoice` document with a number and a file is created, listed and deleted; an unknown `docType` is rejected with 400.
- [ ] **AC-005** — A shipment round-trips 柜型/箱号/封条/订舱号 and accepts documents of the four new types; the container-type dictionary seeds once.
- [ ] **AC-006** — The contract's stamped scan is bound and read back; the generated XLSX pointer is untouched.
- [ ] **AC-007** — Two identical collection saves produce one row (same id); the status round-trips; an unknown status is rejected with 400.
- [ ] **AC-008** — Two identical refund saves produce one row (same id); a 3-decimal amount is rejected with 400; a cancelled shipment is refused with 409 and no row is created.
- [ ] **AC-009** — The two document routes accept their own doc types and reject the unknown type with 400.
- [ ] **AC-010** — For 6000/4000 with a 1000.00 container refund the orders read 600.00/400.00; for 1000.01 they read 600.01/400.00; for three equal 1000.00 orders with 1000.00 the exact share 333.333… quantizes to 333.33 each and the remaining cent lands on the lowest `number`, so they read 333.34/333.33/333.33 (the plan's illustrative 334.00/333.00/333.00 is inconsistent with its own rule E4 — a HALF_UP share of 333.333… is 333.33, not 333.00 — and the implemented reading keeps every order within one cent of its pro-rata share); a zero-denominator container yields `null`; every case sums to the container amount.
- [ ] **AC-011** — An order spanning two containers reports the least advanced refund status, `unknown` when it has none.
- [ ] **AC-012** — The finance view's paid/outstanding match the payments endpoint, KC price matches the contract `finance_total`, the USD line matches the outbound invoice, and the container list documents the refund; another organization's operator sees none of these rows.
- [ ] **AC-013** — The derived business status walks `placed` → `shipped` as the shipment departs (depart also marks the order shipped). The documented `factory_pickup` state is implemented and unit-tested for precedence but is unreachable through the current writers: `cross_border` only accepts milestones while a shipment is `in_transit` (422 on a draft shipment, asserted in the acceptance run), and the `depart` that makes it `in_transit` already flips the order to `shipped`. Documented in Risks and in `.ai/lessons/derived-status-needs-a-reachable-write-path.md`; closing it needs an owner decision on that module's state machine.
- [ ] **AC-014** — `listAllocation`/money outputs are produced by the trade-docs money engine (no `toFixed`), verified by the unit tests.
- [ ] **AC-015** — With several contracts/invoices the newest non-cancelled/non-void row is selected, and absent rows render `null` (not 0).
- [ ] **AC-016** — All four pages render in both tabs/roles with loading, empty, error, conflict and denied states, upload/download work, and CSV export matches the visible columns.
- [ ] **AC-017** — A user without `export_finance.manage` can read the pages and is refused on every write (403).
- [ ] Every listed backend surface matches its recorded Open Mercato reference and uses the canonical shell/components, shared API helpers, semantic tokens, and complete loading, empty, error, conflict, keyboard, accessibility, responsive, light- and dark-mode states.
- [ ] The configured validation gate (`yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test && yarn build`) passes.

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | root `AGENTS.md`, `om-module-scaffold` + its three mandatory references, `om-spec-writing` |
| Data models, APIs, events, UI, and tests are internally consistent | pass | traceability table above |
| Every workflow completes end to end without a catch-all integration phase | pass | Phases 1–5 each ship a working app |
| Platform-native reuse and extension points were chosen before custom code | pass | Reuse and Ownership Map |
| UI contracts identify references, canonical components, and theme/state coverage | pass | UI and Interaction Contracts |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | Implementation Phases |

Verdict: **Ready for implementation**

## Resolved assumptions (autonomous defaults)

The owner's plan resolved the open questions before implementation; recorded here instead of an Open Questions block.

| ID | Question | Decision | Marker |
|---|---|---|---|
| Q-001 | Is 订单描述 / 货柜型号 / 订单状态 single- or multi-select? | single-select (the sheet's `option（array）` reads as "options come from an array"); a multi-value upgrade swaps the column for `jsonb` + `contains` filter | ⚠ NEEDS HUMAN CONFIRMATION |
| Q-002 | Is 客户名称 always one customer (海外分公司)? | yes, one CRM company per order; a multi-customer upgrade replaces the column with a link table | ⚠ NEEDS HUMAN CONFIRMATION |
| Q-003 | Is 预计交货日期 the same date as `expected_ship_at`? | yes — label-only change; a dedicated column is additive later | — |
| Q-004 | Are 预付款/尾款 the plan or the actual? | the plan; actual money always comes from the payment rows and is shown separately | — |
| Q-005 | Is one shipment one container? | yes (柜型/箱号/封条 live on the shipment); a multi-container upgrade adds a child table and moves the refund anchor | ⚠ NEEDS HUMAN CONFIRMATION |
| Q-006 | Is the refund declaration per order or per container? | per container, allocated to orders by purchase share at read time; a persisted allocation table is the named upgrade | — |
| Q-007 | Does the SO document row store its own number? | no — 订舱号/提单号 live on the shipment (`booking_number`); the SO row stores file/date/note only | — |

## Changelog

| Date | Change |
|---|---|
| 2026-09-22 | Initial draft from the approved implementation plan (35-field inventory, two finance anchors, allocation rule) |
