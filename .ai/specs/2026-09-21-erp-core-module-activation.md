# ERP Core Module Activation — Catalog, Customers, Sales, WMS, Currencies, Dictionaries, Feature Toggles

**Date**: 2026-09-21
**Status**: Ready for implementation

> Covers turning on the seven installed `@open-mercato/core` business modules that make this minimal base app a working ERP core, plus the app-side Chinese locale overlays those modules need. Requests to enable the reference modules (`example`, `design_system`) stay in `2026-08-06-reference-module-activation.md`; this file owns the business-module decision.

## TLDR

The app ships 69 installed modules and enables twelve platform ones; it has no business domain at all. This specification activates the dependency-closed core set — `catalog`, `customers`, `sales`, `wms`, `dictionaries`, `feature_toggles`, `currencies` — so staff can run 商品 → 报价 → 订单 → 发货 → 退货 → 开票 → 收款 and 仓库/库存 on the existing platform modules (`auth`, `directory`, `query_index`, `search`, `notifications`, `audit_logs`, `attachments`, `dashboards`, `events`). No new entity, route, page, event, or component is authored: the change is seven registry lines, the migrations they imply on a local development database, and seven sparse `zh` locale overlays. Procurement/P2P, general ledger, manufacturing, and payroll do not exist in the platform and are explicitly out of scope.

## Problem Statement

`.mercato/starter-preset.json` is `empty`, `src/official-modules.generated.ts` is empty, and `src/modules.ts` enables only platform modules. A team therefore cannot validate any order-to-cash or inventory workflow on the base app, and the harvest of what the platform already provides (43 core modules, 69 installed) stays invisible.

Activation is not free, and the existing reference-module spec argues why it must be an explicit decision: enabling a module adds routes, navigation entries, ACL features, workers, search indexes, and migrations, and deactivation does **not** drop the tables it created. For business modules the stakes are higher than for the reference gallery: 80 new tables, 67 new permission points, 96 package migrations, four queue workers, and customer/payment data begin to persist.

Two facts make the decision concrete: the modules are already installed as dependencies (`@open-mercato/core@0.8.0`), so activation needs no package install; and a `zh` interface is not available for free — core business modules ship `de/en/es/ko/pl` only, while this app already maintains `zh` overlays for its ten enabled modules.

## Overview and Success Measures

- **Primary outcome:** a signed-in staff user completes 商品建档 → 报价单 → 转销售订单 → 发货 → 发票 → 收款 on the local app, with inventory balances/reservations visible in WMS, and 前台界面在 zh 语言下可读。
- **Leading indicators:** `yarn generate` registers all seven modules without dependency errors; `yarn db:generate` produces a reviewable, scoped migration set; the seven `zh` overlays load in the generated locale track.
- **Baseline:** zero business-domain modules enabled; zero business tables; every business route absent (`/backend/sales/orders` and `/api/sales/orders` are unreachable).
- **Market / product reference:** mid-market ERP suites (Odoo, ERPNext, Zoho Inventory+CRM) ship a comparable core — product/price master, CRM, quote→order→fulfillment→invoice→payment, and warehouse/bins/lots. Adopted: the quote→order→invoice→payment document chain and warehouse topology with reservations and a movement ledger. Rejected: building purchasing/GL/manufacturing here (they are separate capabilities with their own specs) and authoring new UI (the modules ship complete pages).

## Goals

- **REQ-001** — `src/modules.ts` enables exactly `catalog`, `customers`, `sales`, `wms`, `dictionaries`, `feature_toggles`, `currencies` from `@open-mercato/core`, satisfying every `metadata.requires` edge, and `yarn generate` completes without new warnings about those modules.
- **REQ-002** — The activated modules' database objects exist on the local development database only after a reviewed `yarn db:generate` output; no migration is applied before the owner approves the generated SQL, and no other database target is touched.
- **REQ-003** — The seven modules' user-visible surfaces render in Simplified Chinese for the navigation, page titles, columns, form labels, actions, and states an operator meets on the primary paths; ACL permission labels come from the already-translated `auth` overlay and are not duplicated.
- **REQ-004** — Newly activated surfaces fail closed: without a grant, a user receives permission denial and no navigation entry; all reads/writes stay scoped to the session's trusted `tenantId`/`organizationId`.
- **REQ-005** — Deactivation is proven reversible: removing the registry entries and regenerating removes routes, navigation, grants and workers while leaving migrated tables in place, and the exact procedure is recorded.

## Non-goals

- Enabling any other module: `example`, `design_system`, `agent_examples`, `ratelimit_probe` (unregistered reference/demo surfaces), enterprise modules (`record_locks`, `sso`, `security`, `system_status_overlays`, `agent_orchestrator`), CRM-adjacent extras (`checkout`, `payment_gateways`, `gateway_stripe`, `shipping_carriers`, `workflows`, `business_rules`, `staff`, `planner`, `resources`, `integrations`, `data_sync`, `webhooks`, `documents`, `messages`, `inbox_ops`, `portal`, `customer_accounts`, `warranty_claims`, `eudr`, `scheduler`, `content`, `onboarding`). They are the natural next tiers, each with its own decision.
- Authoring or restyling any page, component, API route, entity, command, event, subscriber, widget, or menu item — the modules ship those.
- Building procurement/purchase orders, accounts payable/receivable ledgers, general ledger, cost accounting, manufacturing/BOM, payroll, or fixed assets. The platform has no such module (`supplier` appears only in `eudr`, `vendor` only in `warranty_claims`); those are app-owned capabilities or external-ERP integrations with their own specs.
- Creating `zh` translations for the whole shipped locale (≈6,500 keys): overlays cover the surfaces operators use, and untranslated keys fall back to English by design.
- Deploying to any environment, rewriting role grants, seeding demo business data (`catalog seed-examples`, `sales seed-examples`, `customers seed-examples` stay unused unless requested), or reindexing production search.

## Proposed Solution

Registration is the switch: append seven entries to `enabledModules` in `src/modules.ts` with `from: '@open-mercato/core'`, run `yarn generate`, then generate and apply migrations on the development database. Dependencies are enforced by the generator, not by convention: `sales` declares `requires: ['catalog','customers','dictionaries']` and `wms` declares `requires: ['catalog','sales','feature_toggles']`, and the CLI registry generator exits non-zero listing any missing module. The requested closure therefore equals exactly these seven modules — the transitive closure adds nothing.

Chinese coverage is delivered as app-side sparse overlays (`src/modules/<id>/i18n/zh.json`), the convention already used by the ten enabled modules: `yarn generate` merges each file into `.mercato/generated/modules.i18n.zh.generated.ts`, per key, over the module's English locale. Every overlay key must exist in the package's `i18n/en.json`, so an overlay can never invent a key. ACL labels for all seven modules are already translated in `src/modules/auth/i18n/zh.json` (7/7, 21/21, 19/19, 10/10, 6/6, 3/3, 2/2), so this specification adds no permission-name work.

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| Registry entry in `src/modules.ts` is the only activation switch | One reviewable line per module; everything else is derived by `yarn generate` | An `OM_ERP_MODULES` environment flag | A flag leaves modules registered, so routes/grants exist while "off"; the registry is the audited switch |
| Enable the whole seven-module closure at once | `sales` without `catalog`/`customers`/`dictionaries` and `wms` without `sales` cannot generate; a partial set is either invalid or non-functional | Catalog+customers first, sales/wms later | Rejected: it produces a master-data-only app with no order-to-cash value and repeats the migration review twice |
| `currencies` enabled alongside `sales` | Order/invoice/payment documents carry `currencyCode`; `sales.acl.ts` declares `dependsOn: currencies.view`; exchange rates and the currency dictionary come from here | Leave `currencies` off and keep documents single-currency | Rejected: unresolved ACL dependency diagnostics and no FX data for multi-currency documents |
| Migrations generated, reviewed, then applied to the local dev database only | 96 package migrations create 80 tables; the review is the only place a human sees the schema change | Auto-apply after generate | Rejected by the app's Ask-First rule for migrations and DB targets |
| `zh` overlays authored now, scoped to operator-visible strings | The app's stated language is Chinese; enabling 65 pages of English-only UI is a usability regression, not a missing nicety | Enable in English, translate later | Rejected as the primary path, but the sparse-overlay design keeps the residual (untranslated deep strings) visible and additive |
| No seeds, no demo data, no role grants in this change | Data and grants are separate, deliberate decisions; ACL stays fail-closed | Auto-grant the new features to the admin role | Rejected: grants are the step that makes a surface consequential; the app's own activation spec separates them |
| No UI extension work | The modules own their pages, widgets and menu entries; the app adds text only | Author app-side pages or menu overrides | Rejected: duplicates shipped contracts and creates maintenance surface with no requirement behind it |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| activated | The module id appears in `src/modules.ts` and `yarn generate` has run | `src/modules.ts` + generated registries | routes/nav/ACL/workers absent; framework not-found |
| dependency closure | A module set where every `metadata.requires` edge is satisfied inside the set | module `index.ts` metadata, enforced by the registry generator | `yarn generate` exits 1 and prints the missing ids |
| scope closure | Every read/write filters on the session's trusted `tenantId`/`organizationId` | `auth` session + each module's scope rules | request fails closed (401/403), never an unscoped read |
| zh overlay | App-side sparse map for one module id and one locale, merged over the package locale | `src/modules/<id>/i18n/zh.json` → `.mercato/generated/modules.i18n.zh.generated.ts` | missing key falls back to the package English string; orphan key (absent from the package locale) is a defect and must be removed |
| migration boundary | Migrations are generated in the repository and applied by an explicit command; the app never edits package migrations | `yarn db:generate` output + `yarn db:migrate` | nothing is applied without owner approval |
| deactivation | Removing registry entries removes runtime surfaces but never drops tables or data | this specification + `2026-08-06-reference-module-activation.md` | destructive cleanup is a separate, explicit data change |
| order-to-cash chain | quote → order → shipment → invoice → payment, each document carrying its own currency and totals | `sales` module | currency mismatch on a payment is rejected (`sales.payments.currency_mismatch`); document edits follow optimistic locking |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| developer (local) | enable modules, generate, review SQL, apply migrations to the local dev database | own workstation | none (registry change carries no grant) |
| administrator | grant the new business features to roles after activation | organization | e.g. `catalog.products.manage`, `sales.orders.manage`, `wms.manage_inventory` |
| sales/warehouse staff | read/write the activated modules | organization (session-derived) | `sales.orders.view`, `sales.quotes.manage`, `wms.view`, `wms.receive_inventory`, … |
| user without a grant | sees no navigation entry; receives 403 on the API | organization | — |

Trusted `tenantId` and `organizationId` come from the authenticated session for every activated surface; activation introduces no new scope derivation and no system-scope operation. All 67 new permission points start ungranted, so nothing becomes reachable until an administrator grants it (fail closed).

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| Product/variant/category/price master | reuse | `catalog` | — | shipped, ejectable, single owner of product identity |
| Customer/company/deal/activity master | reuse | `customers` | — | shipped CRM is the source of truth for customer identity; `catalog`-independent |
| Quote/order/shipment/return/invoice/credit memo/payment | reuse | `sales` | events + `sales.*` commands | ships the complete document chain this spec measures |
| Warehouse topology, balances, reservations, movements | reuse | `wms` | `wms.*` commands + sales-order warehouse assignment | owns inventory invariants; consumes `catalog` products and `sales` orders by id |
| Shared enumerations (order statuses, payment methods, currency dictionary entries) | reuse | `dictionaries`, `currencies` | dictionary kinds; `currencies.view` feature dependency | avoids parallel enumeration tables |
| Feature flags for staged rollout of business behavior | reuse | `feature_toggles` | required by `wms` | platform mechanism, no app-specific flag invented |
| Chinese interface text | app-own (overlay only) | overlays under `src/modules/<id>/i18n/zh.json` | `yarn generate` → locale track | app language policy; no package modification |
| Procurement, GL, manufacturing, payroll | out of scope | — | — | no installed module; separate spec when needed |

## Architecture and Data Flow

```text
src/modules.ts (7 new entries)
   -> yarn generate
        -> registry: routes, navigation, ACL features, workers, search index definitions
        -> i18n: .mercato/generated/modules.i18n.zh.generated.ts  (merges src/modules/<id>/i18n/zh.json)
   -> yarn db:generate -> reviewed SQL + snapshot
   -> yarn db:migrate  (local dev database, after approval)
        -> 80 tables owned by the seven modules
   -> runtime: /backend/** pages -> /api/** routes -> module commands -> entities -> events
```

- **Module boundaries:** each activated module owns its invariants and its tables; `sales` references `catalog`/`customers` by id and snapshot (document lines store product/UoM snapshots), `wms` consumes `sales` orders through warehouse-assignment APIs, and no cross-module ORM relation is introduced by this change (the packages' own contracts apply).
- **Extension points:** app-side contributions remain available and untouched — locale overlays (used here), plus the UMES seams (widgets, enrichers, interceptors, page overrides) that later app capabilities would use instead of editing installed code.
- **Alternatives considered:** enabling via `official-modules.json` registration (reserved for official module packaging, not app activation); forking the pages into `src/modules/**` (duplicates shipped contracts).
- **Compatibility:** no installed contract is modified; identifiers, routes, and payloads remain exactly as the packages ship them. Deactivation restores the pre-change runtime surface.

## User Journeys

### Journey J-001 — Activate and review (developer)

1. Add the seven entries to `src/modules.ts`; run `yarn generate`.
2. Registry generation validates `requires` and writes routes/nav/ACL/worker/search registries plus the `zh` locale track.
3. Run `yarn db:generate`; read the scoped SQL and snapshot; confirm no table outside the seven modules is touched.
4. After owner approval, run `yarn db:migrate` against the local development database.
5. Failure path: a missing dependency makes `yarn generate` exit 1 with the required ids; an unexpected SQL statement stops the flow before `db:migrate`.

### Journey J-002 — Sell and ship an order (sales + warehouse staff)

1. Create a product with price in `/backend/catalog/products`; create or pick a customer in `/backend/customers/people`.
2. Create a quote in `/backend/sales/quotes`, send it, convert it to an order.
3. In `/backend/wms`, warehouse assignment/reservation for that order becomes visible; receive stock when goods arrive (`/backend/wms/inventory` → 收货入库), adjust or count as needed.
4. Record the shipment, issue the invoice (`sales.invoices.manage`), register the payment; the payment is rejected if its currency differs from the order's.
5. Permission denial path: a user lacking `sales.orders.view` sees no sales navigation and gets 403 from `/api/sales/orders`.

### Journey J-003 — Read the interface in Chinese

1. A user with `zh` as interface language opens the activated pages.
2. Navigation labels, page titles, table columns, form labels, actions, and empty/error states render Chinese for the covered keys.
3. Keys outside the overlay fall back to the packaged English string; nothing renders as a raw key.

### Journey J-004 — Deactivate

1. Remove the seven entries from `src/modules.ts`; run `yarn generate`.
2. Routes, navigation entries, grants, and workers for those modules disappear; `/backend/sales/orders` returns the framework's ordinary not-found response.
3. Migrated tables and their data remain; dropping them is a separate, explicit decision.

## UI and Interaction Contracts

No app-authored page, component, or route is added by this specification: all listed surfaces ship inside the activated packages with their own canonical shells (`Page`, `PageBody`, `DataTable`, `CrudForm`, shared API helpers, semantic tokens, full state coverage). The app-authored UI artifact is the locale overlay set.

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/catalog/products`, `/backend/catalog/categories`, `/backend/config/catalog` | product/variant/category/price master CRUD, bulk delete | `/api/catalog/**` | shipped `catalog` pages | package-owned | loading, empty, error, conflict, success, permission denied | REQ-001, REQ-004 |
| `/backend/customers/{people,companies,deals,calendar,customer-tasks}` | CRM records, pipeline, activities, interactions | `/api/customers/**` | shipped `customers` pages | package-owned | as above | REQ-001, REQ-004 |
| `/backend/sales/{quotes,orders,documents,channels}`, `/backend/config/sales` | quote/order document workspace, shipments, returns, invoices, payments | `/api/sales/**` | shipped `sales` pages | package-owned | as above | REQ-001, REQ-004 |
| `/backend/wms/**` (`inventory`, `warehouses`, `locations`, `lots`, `movements`, `reservations`, `sku/[id]`), `/backend/wms` | stock receive/adjust/move/allocate, cycle count, operational dashboard | `/api/wms/**` | shipped `wms` pages | package-owned | as above | REQ-001, REQ-004 |
| `/backend/currencies`, `/backend/exchange-rates`, `/backend/config/currency-fetching` | currency and exchange-rate master, rate fetch | `/api/currencies/**` | shipped `currencies` pages | package-owned | as above | REQ-001, REQ-003 |
| `/backend/config/dictionaries` | shared dictionary and entry maintenance | `/api/dictionaries/**` | shipped `dictionaries` page | package-owned | as above | REQ-001 |
| `/backend/feature-toggles/**` | global flags and organization overrides | `/api/feature-toggles/**` | shipped `feature_toggles` pages | package-owned | as above | REQ-001 |
| `src/modules/{catalog,customers,sales,wms,currencies,dictionaries,feature_toggles}/i18n/zh.json` | app-authored Chinese strings merged over the packaged locale | consumed by `yarn generate` | `src/modules/attachments/i18n/zh.json`, `src/modules/example/i18n/zh.json` | flat key → string JSON | absent file ⇒ English fallback; orphan key ⇒ defect to remove | REQ-003 |

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| sales staff | 销售 → 报价单/销售订单 | `sales` new-order/new-quote widgets (grant-gated) | login → 销售订单 → 打开订单, 2 clicks |
| warehouse staff | 仓库 → 库存/仓库/库位/预留 | `wms` operational dashboard | login → 库存 → 收货入库, 2 clicks |
| administrator | 配置 → 产品目录/销售/仓库/字典/币种/功能开关 | existing dashboards plus module widgets when granted | login → 配置, 1 click |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| all activated lists | package-localized empty state with the module's own create action | package-provided narrow-width behavior; verified in Phase 4 at narrow viewport | package-provided; verified for keyboard reachability in Phase 4 |
| overlay text | an untranslated key falls back to English rather than to a raw key | not applicable (text only) | not applicable |

### `/backend/{route}` — page mockups

N/A — no app-authored page exists in this change. Every activated route is a shipped page whose layout contract is owned by its package (`node_modules/@open-mercato/core/src/modules/<id>/backend/**`); this specification deliberately does not restate or fork those contracts, and Phase 4 verifies them by exercising the real pages.

## Data Models

N/A — no entity is authored by this change. The change makes 80 shipped entities reachable; their definitions and migrations are owned by the activated packages.

| Module | Shipped entities (reachable after activation) | Package migrations |
|---|---|---|
| `catalog` | 12 (`catalog_product`, `catalog_product_variant`, `catalog_product_category`, `catalog_offer`, `catalog_product_price`, `catalog_price_kind`, `catalog_product_unit_conversion`, `catalog_product_tag*`, `catalog_option_schema_template`, …) | 26 |
| `customers` | 25 (`customer_entity`, `customer_person_profile`, `customer_company_profile`, `customer_deal`, `customer_deal_stage_transition`, `customer_activity`, `customer_interaction`, `customer_pipeline*`, `customer_address`, `customer_tag*`, …) | 24 |
| `sales` | 27 (`sales_order*`, `sales_order_line`, `sales_order_adjustment`, `sales_quote*`, `sales_shipment*`, `sales_return*`, `sales_invoice*`, `sales_credit_memo*`, `sales_payment*`, `sales_tax_rate`, `sales_channel`, `sales_document_sequence`, …) | 26 |
| `wms` | 9 (`warehouse`, `warehouse_zone`, `warehouse_location`, `product_inventory_profile`, `inventory_lot`, `inventory_balance`, `inventory_reservation`, `inventory_movement`, `sales_order_warehouse_assignment`) | 6 |
| `currencies` | 3 (`currency`, `exchange_rate`, `currency_fetch_config`) | 7 |
| `dictionaries` | 2 (`dictionary`, `dictionary_entry`) | 4 |
| `feature_toggles` | 2 (`feature_toggle`, `feature_toggle_override`) | 3 |

Every activated entity keeps its package-defined scope columns (`tenant_id`, `organization_id`), optimistic-lock version, and encryption map; this change neither adds nor alters a column. Sensitive data becomes persisted for the first time (customer PII, payment amounts, addresses), so the local database becomes real data with the app's normal backup/retention posture; no secret or credential is introduced.

## API, Command, and Error Contracts

N/A — no API contract is authored or modified. Approximately 140 shipped route files become reachable across the seven modules (e.g. `/api/catalog/products`, `/api/customers/people`, `/api/sales/quotes/{send,accept,convert}`, `/api/sales/orders`, `/api/sales/invoices`, `/api/sales/payments`, `/api/wms/inventory/{receive,adjust,move,reserve,release,allocate,cycle-count,import/{template,validate,apply}}`, `/api/wms/sales-orders/{assign-warehouse,unassign-warehouse}`, `/api/currencies/exchange-rates`, `/api/dictionaries`, `/api/feature-toggles/*`). Each keeps its shipped method set, per-method `metadata` + `openApi`, feature gate, validation, and error semantics — including `403` on missing grants, `409` on optimistic-lock conflicts, and `400 sales.payments.currency_mismatch` on a currency mismatch. Activation changes reachability, never contracts.

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| `catalog.*` (18 events, e.g. `catalog.product.created`, `catalog.product.stock_low`) | `catalog` | search/query index, notifications, app subscribers later | index update, low-stock notification | platform event contract (retried, idempotent consumers) |
| `customers.*` (50 events, e.g. `customers.deal.won`) | `customers` | notifications, dashboards, index | deal-won/lost notifications | as above |
| `sales.*` (44 events, e.g. `sales.order.created`, `sales.invoice.created`, `sales.payment.received`) | `sales` | notifications, index, dashboards | order/quote/payment notifications | as above |
| `wms.*` (27 events, e.g. `wms.inventory_balance.updated`, `wms.inventory_reservation.created`) | `wms` | notifications, index | low-stock / reservation-shortfall notifications | as above |
| `currencies.*` (6 events), `dictionaries.*` (3 events) | `currencies`, `dictionaries` | index | master-data change propagation | as above |
| bulk product delete | `catalog` | worker `catalog-product-bulk-delete` | background deletion with progress | queue contract; requires a running `yarn mercato queue worker` |
| bulk deal owner/stage update | `customers` | workers `customers-deals-bulk-update-owner`, `customers-deals-bulk-update-stage` | background updates | as above |

Two queue workers families (three queues) are activated with these modules; the dev supervisor starts workers, so a production-like deployment must run one. Search gains 40 indexed entities (catalog 8, customers 6, sales 22, wms 4) and requires a reindex before those records are searchable.

## Security, Privacy, and Compliance

- **Authorization:** all 67 new ACL features (catalog 7, customers 21, sales 19, wms 10, currencies 6, dictionaries 2, feature_toggles 2) start ungranted; every surface is feature-gated by the packages, never by role name. Phase 4 verifies denial for an unprivileged user.
- **Tenant isolation:** activated modules derive scope from the authenticated session and fail closed; this change introduces no unscoped or system-scope path, and no app-owned code that could bypass them.
- **Sensitive data:** customer PII, addresses, payment amounts, and inventory valuations become persistent. Encryption maps and field-level protection stay as the packages ship them; no credential, token, or provider secret is added by this change (`gateway_stripe`, `channel_*` remain disabled).
- **Abuse and failure modes:** the notable new exposure is *unintended* reachability — mitigated by keeping grants manual and by Phase 4's denial check. Destructive operations exposed by the modules (product bulk delete, inventory adjust, cycle count) are permission-gated and audited by `audit_logs`; deactivation never destroys data.

## Integration Coverage

Tests must be self-contained and map to real API and UI paths.

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | build/generate | the seven registry entries | `yarn generate` | exits 0; generated registry lists all seven ids; no unresolved-dependency error; `zh` locale track contains the seven overlays | REQ-001, REQ-003 |
| TEST-002 | migration review | generated SQL | `yarn db:generate`, then inspect scoped SQL | statements create only tables owned by the seven modules; no drop/alter of existing platform tables; snapshot present | REQ-002 |
| TEST-003 | API integration | local dev DB after migrate; privileged user | `GET /api/catalog/products`, `POST /api/catalog/products`, `GET /api/sales/orders`, `GET /api/wms/inventory/balances` | 200/201 with scoped data; created product is readable back; unknown path before activation returned not-found | REQ-001, REQ-002 |
| TEST-004 | security | user without `catalog.products.view` / `sales.orders.view` | open the corresponding backend route and API | 403 on the API, no navigation entry rendered, no data leaked | REQ-004 |
| TEST-005 | UI | signed-in operator, zh locale, local DB | open `/backend/catalog/products`, `/backend/sales/quotes`, `/backend/wms/inventory` in a browser | pages render (not not-found), primary labels are Chinese, layout usable at narrow width | REQ-003 |
| TEST-006 | rollback | worktree copy of the repo | remove the seven entries, run `yarn generate` | routes/nav/grants for those modules disappear; tables remain; the rest of the app still generates | REQ-005 |

## Implementation Phases

Phases are dependency ordered. Only the current phase may enter implementation; parallel work is limited to independent slices inside that phase.

### Phase 1 — Register the closure and generate

- **Depends on:** none
- **Outcome:** the seven modules are registered and every registry (routes, nav, ACL, workers, search, i18n) reflects them; no database change yet.
- **Why this order / value delivered:** registration is the switch and the cheapest place to discover a dependency or discovery failure.
- **Deliverables:** `src/modules.ts` (seven entries), regenerated `.mercato/generated/**`, a recorded generator output.
- **Independent slices / estimated commits:** one commit.
- **Requirements closed:** REQ-001
- **Tests:** TEST-001
- **Validation:** `yarn generate`; `git diff --stat .mercato/generated` inspected
- **Exit gate:** generator exits 0, prints no unresolved dependency, and the generated registry lists all seven ids.

### Phase 2 — Generate, review, and apply migrations

- **Depends on:** Phase 1 exit gate
- **Outcome:** the local development database carries the 80 tables; nothing is applied elsewhere.
- **Why this order / value delivered:** the app is only functional once the schema exists; review keeps the human in the loop on an irreversible step.
- **Deliverables:** generated migration artifacts + snapshot in the repository, the reviewed SQL summary, and the applied migration on the local dev database.
- **Independent slices / estimated commits:** one commit (generated artifacts only).
- **Requirements closed:** REQ-002
- **Tests:** TEST-002, TEST-003
- **Validation:** `yarn db:generate`, SQL/snapshot review, owner approval, then `yarn db:migrate`
- **Exit gate:** migration applies cleanly; `/api/catalog/products` and `/api/sales/orders` respond with scoped data for a privileged user; no platform table changed.

### Phase 3 — Chinese overlays

- **Depends on:** Phase 1 exit gate (module ids and locale track exist)
- **Outcome:** the seven overlays exist, are valid, and load into the zh locale track.
- **Why this order / value delivered:** translation is independent of the database and can proceed in parallel with Phase 2's review; it makes the activated UI usable in the app's language.
- **Deliverables:** `src/modules/{catalog,customers,sales,wms,currencies,dictionaries,feature_toggles}/i18n/zh.json`; regenerated locale track.
- **Independent slices / estimated commits:** seven independent per-module slices (one file each, no shared file).
- **Requirements closed:** REQ-003
- **Tests:** TEST-001 (locale-track half), TEST-005
- **Validation:** JSON parse + key-existence check against each package `i18n/en.json`; `yarn generate`
- **Exit gate:** every overlay key exists in its package locale, the generated `modules.i18n.zh.generated.ts` lists all seven modules, and no orphan key remains.

### Phase 4 — Exercise the surfaces, prove denial, prove rollback

- **Depends on:** Phase 2 and Phase 3 exit gates
- **Outcome:** the order-to-cash and inventory paths are exercised on the running app; an unprivileged user is denied; deactivation is demonstrated in a scratch copy.
- **Why this order / value delivered:** this is the only phase that proves the activation delivers business value rather than registries.
- **Deliverables:** recorded smoke results (routes, screenshots/text observations), the denial evidence, the rollback transcript, and the updated spec status.
- **Independent slices / estimated commits:** browser smoke and rollback drill may run in parallel; both read-only against the app except the scratch copy.
- **Requirements closed:** REQ-004, REQ-005
- **Tests:** TEST-004, TEST-005, TEST-006
- **Validation:** `yarn typecheck` (focused on the app's own sources), the browser smoke, the rollback drill
- **Exit gate:** every journey in J-002/J-003/J-004 has recorded evidence; nothing renders as a raw translation key; the rollback drill leaves the app generating cleanly.

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-001, all activated routes | registry entries satisfying `requires` | Phase 1 | TEST-001, TEST-003 | AC-001 |
| REQ-002 | J-001 | 96 package migrations → 80 tables | Phase 2 | TEST-002, TEST-003 | AC-002 |
| REQ-003 | J-003, activated pages | `src/modules/<id>/i18n/zh.json` → locale track | Phase 3 | TEST-001, TEST-005 | AC-003 |
| REQ-004 | J-002 step 5 | 67 ACL features, session scope | Phase 4 | TEST-004 | AC-004 |
| REQ-005 | J-004 | registry removal → runtime surface removal | Phase 4 | TEST-006 | AC-005 |

### Extension-surface traceability

Every added surface, its reference, and its own oracle:

| Added surface | Requirement | Reference capability and exact source file | Phase | Own test | Mechanism classification |
|---|---|---|---|---|---|
| `src/modules.ts` — `{ id: 'catalog', from: '@open-mercato/core' }` | REQ-001 | activation is an app-level registry setting; no module contribution is emitted (`framework-only`) | Phase 1 | TEST-001 | `framework-only` |
| `src/modules.ts` — `{ id: 'customers', from: '@open-mercato/core' }` | REQ-001 | as above | Phase 1 | TEST-001 | `framework-only` |
| `src/modules.ts` — `{ id: 'sales', from: '@open-mercato/core' }` | REQ-001 | as above | Phase 1 | TEST-001 | `framework-only` |
| `src/modules.ts` — `{ id: 'wms', from: '@open-mercato/core' }` | REQ-001 | as above | Phase 1 | TEST-001 | `framework-only` |
| `src/modules.ts` — `{ id: 'dictionaries', from: '@open-mercato/core' }` | REQ-001 | as above | Phase 1 | TEST-001 | `framework-only` |
| `src/modules.ts` — `{ id: 'currencies', from: '@open-mercato/core' }` | REQ-001 | as above | Phase 1 | TEST-001 | `framework-only` |
| `src/modules.ts` — `{ id: 'feature_toggles', from: '@open-mercato/core' }` | REQ-001 | as above | Phase 1 | TEST-001 | `framework-only` |
| 7 × `src/modules/<id>/i18n/zh.json` | REQ-003 | `src/modules/example/i18n/en.json` (module locale map emitting the same mechanism) | Phase 3 | TEST-001, TEST-005 | `emitted-example` |

No other runtime or discovery surface is added: no app-owned page, route, entity, command, subscriber, worker, widget, agent, tool, or workflow.

## Rollout, Migration, and Rollback

- **Migration generation/application boundary:** `yarn db:generate` writes the app-side migration artifacts and snapshot; `yarn db:migrate` applies them. Application happens on the local development database only, after the owner has seen the scoped SQL. `yarn db:greenfield` is not used.
- **Seed/setup:** none. `yarn generate` writes registries; the modules' `setup.ts` hooks register their defaults when their surfaces are first used. The modules' `seed-*` CLI commands stay unused for production data; they are available if demo data is ever wanted.
- **Feature flags/rollout order:** registry first, migrations second, grants last (by an administrator, outside this change). Until grants exist the new surface is dark.
- **Observability:** the generator's output, the migration list, and the Phase 4 evidence are the audit trail; `audit_logs` records subsequent business mutations.
- **Rollback:** remove the seven entries from `src/modules.ts` and run `yarn generate`. Routes, navigation, ACL features, and workers disappear; tables and data stay. Reverting the schema is a separate, explicit data change and is deliberately not automated. Locale overlays are inert when their module is unregistered.

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| 80 tables land on the dev database before the first real workflow is tried | unused schema if the team abandons the direction | tables are additive; rollback is registry-only; dropped only by an explicit decision | unused tables remain, as the app's activation spec already accepts |
| A migration touches an unexpected object | data loss or lock contention | Phase 2 review of the scoped SQL; approval gate before `db:migrate` | reviewer error; mitigated by reviewing the generated statement list |
| Chinese overlay covers the operator paths but not every deep string | mixed-language UI in rarely used corners | sparse-overlay fallback is English, never a raw key; coverage grows per file without schema impact | a user may still meet English text |
| New ungoverned permission surface (67 features) | accidental over-granting | all features start ungranted; grants happen in the ACL UI with dependency diagnostics; denied path is tested (TEST-004) | an administrator may grant broadly by design |
| Queue workers (3) not running in a future deployment | bulk product delete / bulk deal updates stall | documented in this spec; dev supervisor starts workers; worker queues are observable via `yarn mercato queue status` | a production deployment without a worker degrades those two bulk paths only |
| Search index empty for 40 new entities until reindexed | search misses business records | known at rollout; reindex is a documented follow-up operation | search results lag until reindex |
| Product/customer data duplication if app modules later copy master data | conflicting sources of truth | reuse map keeps `catalog`/`customers` as owners; later specs must reference them by id/snapshot | future specs may still choose duplication deliberately |

## Acceptance Criteria

- [ ] **AC-001** — With the seven entries registered, `yarn generate` exits 0 and the generated registries list `catalog`, `customers`, `sales`, `wms`, `dictionaries`, `currencies`, `feature_toggles`; before activation the same routes return not-found.
- [ ] **AC-002** — `yarn db:generate` yields only module-owned statements (reviewed and recorded), and after approval `yarn db:migrate` applies cleanly on the local development database; a privileged user reads and writes through `/api/catalog/products` and `/api/sales/orders`.
- [ ] **AC-003** — Every `zh` overlay key exists in its package's `i18n/en.json`, the generated `zh` locale track contains the seven modules, primary labels render Chinese in the browser, and no page shows a raw translation key.
- [ ] **AC-004** — A user without the corresponding feature receives 403 from `/api/catalog/products` and `/api/sales/orders`, and no navigation entry is rendered for them.
- [ ] **AC-005** — Removing the seven registry entries and regenerating removes the runtime surfaces while leaving tables and data intact, and the rest of the app still generates cleanly.
- [ ] Every listed backend surface matches its recorded Open Mercato reference and uses the canonical shell/components, shared API helpers, semantic tokens, and complete loading, empty, error, conflict, keyboard, accessibility, responsive, light-mode, and dark-mode states (verified in Phase 4 by exercising the shipped pages, since the app authors none of them).
- [ ] Every affected API and UI path has self-contained integration coverage and the configured validation gate passes.

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | `AGENTS.md`; `.ai/guides/architecture.md`, `.ai/guides/spec-delivery.md`, `.ai/guides/backend-ui.md`; `om-spec-writing` |
| Data models, APIs, events, UI, and tests are internally consistent | pass | Data Models / API Contracts / Events sections enumerate shipped contracts; traceability rows above |
| Every workflow completes end to end without a catch-all integration phase | pass | J-002 closes inside Phase 2/4 evidence; J-003 in Phase 3/4; J-004 in Phase 4; no polish phase exists |
| Platform-native reuse and extension points were chosen before custom code | pass | Reuse and Ownership Map; only overlays are app-authored |
| UI contracts identify references, canonical components, and theme/state coverage | pass | Activated surfaces are package-owned and listed; the mockup section records why no app-authored layout exists |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | Phases 1–4 above |

Verdict: `Ready for implementation`

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-001 | Which activation tier does the app take? | app owner | no | **Resolved 2026-09-21** — tier A: the seven-module closure (最小闭环) |
| Q-002 | Chinese interface coverage at activation or later? | app owner | no | **Resolved 2026-09-21** — overlays authored during activation, scoped to operator-visible strings |
| Q-003 | Which database target receives the migrations? | app owner | no | **Resolved 2026-09-21** — local development database, after the owner confirms the generated SQL |

## Changelog

| Date | Change |
|---|---|
| 2026-09-21 | Initial draft and ready-for-implementation after scope decisions (tier A, zh overlays, local-database migrations) |
| 2026-09-21 | Implemented: registry entries + `yarn generate` (19 modules, 213 API route files, 40 route shards), `yarn db:migrate` on `kc_cb_base_min` (96 migrations, 85 new tables, all platform tables untouched), 7 `zh` overlays (2,700+ keys, 0 orphans), `yarn typecheck` exit 0, browser verification of the activated pages in zh (light + dark + narrow), authenticated API checks (200 with cross-module enrichers), fail-closed denial checks (403/401), and a pre-activation worktree drill proving removal restores the 12-module surface (67 route files). Residual: long config-page help copy and DB-seeded custom-field labels stay English by design. |
