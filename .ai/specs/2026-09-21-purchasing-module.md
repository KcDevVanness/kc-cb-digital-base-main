# Purchasing Module — Supplier Master, Purchase Orders, Stage Payments

**Date**: 2026-09-21
**Status**: Ready for implementation

> First of the three app-owned modules split out of `.ai/specs/2026-09-21-app-owned-business-module.md` (Q-008). Business inputs are owner-confirmed: domestic agents supply the goods, nothing is consolidated domestically, goods ship direct to the overseas warehouse, payment is stage-based (定金/尾款) with no approval or ageing, and the owner confirmed the derived entity/state model on 2026-09-21. Phase 1 (supplier master) is implemented; the remaining phases follow after its exit gate.

## TLDR

Give the domestic HQ a purchasing record the platform does not have: suppliers, purchase orders with lines that reference catalog products by id + snapshot, and stage-based payments (定金 then 尾款, in full or in parts). Goods ship direct from the supplier to the overseas warehouse, so purchasing owns the commercial record and the derived payment state — never a domestic stock balance. Everything is app-owned (`src/modules/purchasing/`), scoped by organization, and built from platform primitives (`makeCrudRoute`, `CrudForm`, `DataTable`, commands, events, attachments, reviewed migrations).

## Open Questions

All five questions are resolved (owner, 2026-09-21):

- **Q-P-001** — RESOLVED: the deposit is entered either as a percentage or as a directly typed amount, whichever is freer for the operator; the common case is 首付款 30%. The order therefore stores `deposit_percent` and an optional `deposit_amount` override.
- **Q-P-002** — RESOLVED, and broader than first assumed: one purchase order may be split across several shipments, **and** several purchase orders may be consolidated into one shipment (拼柜 / combined dispatch when quantities are small). The shipment↔order relation is therefore **many-to-many with per-line quantities**, owned by the `cross_border` shipment document; purchasing keeps the received-quantity ledger per line.
- **Q-P-003** — RESOLVED: tax is required. Each line carries a tax rate plus a "price includes tax" toggle, and the system derives net / tax / gross accordingly (order totals are the sums; payments are recorded against the gross).
- **Q-P-004** — RESOLVED: no supplier price list — unit prices are entered per order, because supplier products change between purchases.
- **Q-P-005** — RESOLVED: lines reference the **product** (the platform's catalog supports variants, but purchasing is product-level today; a variant column can be added additively later).

## Problem Statement

The installed platform has no purchasing capability at all: the module inventory contains no purchase/procurement/supplier module, and supplier-like concepts exist only inside unrelated modules (`supplier` in `eudr`, `vendor` in `warranty_claims`). Everything upstream of the shipped chain — who we bought from, what we ordered, what was paid and what is still owed — has no home, while the downstream chain (catalog products, internal sales to subsidiaries, warehouse ledgers) is fully shipped.

## Overview and Success Measures

- **Primary outcome:** a purchasing operator maintains suppliers and purchase orders, records a deposit and a balance, and can always answer "what is on order, what shipped, what arrived, what is still owed" for any supplier or order.
- **Leading indicators:** supplier and order records exist per organization; payment state is derived and consistent with the payment rows; every order number is unique per organization.
- **Baseline:** zero purchasing records; the process lives outside the system.
- **Market / product reference:** mid-market ERPs model a purchase order with lines, a stage-payment plan, and receipts; adopted — order + lines + payment rows with a derived balance. Rejected — approval workflows and AP ageing (owner-confirmed out of scope).

## Goals

- **REQ-P-001** — The module lives in `src/modules/purchasing/` and registers as `{ id: 'purchasing', from: '@app' }`; no installed file, generated file, or shipped migration is edited.
- **REQ-P-002** — Suppliers are organization-scoped records with a unique code per organization, contact data, and a default currency. Custom fields on the supplier entity arrive in a follow-up slice (the entity is plain in Phase 1 so the first slice stays verifiable end to end); nothing in the schema blocks adding them.
- **REQ-P-003** — Purchase orders carry a per-organization unique number, a supplier reference by id + display snapshot, lines referencing catalog products by id + display snapshot, and an order currency.
- **REQ-P-004** — Order lifecycle: `draft → placed → shipped → received → closed`, with `cancelled` reachable from `draft`/`placed`; every transition is a command, and an invalid transition leaves the state unchanged.
- **REQ-P-005** — Payments are rows with a stage (`deposit` | `balance` | `other`), an amount, a currency, a paid date, and an optional attachment; the order exposes derived `paidTotal`, `outstanding`, and `paymentStatus` (`unpaid` | `deposit_paid` | `partially_paid` | `paid`).
- **REQ-P-006** — Money and quantity are stored with explicit precision; currency follows the order; no implicit conversion is performed (FX belongs to the settlement slice).
- **REQ-P-007** — Every route uses `makeCrudRoute` or a guarded command route with per-method `metadata` + `openApi`; every page declares its feature in `page.meta.ts`; mutations go through commands with validators.
- **REQ-P-008** — All reads and writes derive tenant + organization from the session and fail closed; HQ roles see their organization plus descendants, subsidiary roles see only themselves.
- **REQ-P-009** — User-editable records expose `updated_at`; concurrent edits surface as conflicts (409), never silent overwrites.
- **REQ-P-010** — UI uses the canonical shells with full state coverage (loading/empty/error/conflict/permission-denied), zh + en strings, semantic tokens, keyboard and narrow-width behaviour; each slice ships with self-contained integration tests and passes the validation gate.

## Non-goals

- Approval workflows, payment terms, AP ageing, or a general ledger: owner-confirmed out of scope.
- A domestic warehouse node or domestic stock balances: goods ship direct from supplier to the overseas warehouse.
- Purchase requisitions, RFQs, supplier scorecards, or multi-currency supplier price lists (until Q-P-004 says otherwise).
- The shipment/in-transit document and export paperwork: owned by the `cross_border` spec; purchasing references it by id once it exists.
- Editing catalog products from purchasing: products are referenced, never modified.

## Proposed Solution

One module, four entities, command-mediated transitions, and a derived payment state.

```text
supplier ──1:n── purchase_order ──1:n── purchase_order_line ──refs──> catalog product (id + snapshot)
                       │
                       └──1:n── purchase_payment (stage: deposit | balance | other)

order.status:  draft → placed → shipped → received → closed        (cancelled from draft|placed)
paymentStatus: unpaid | deposit_paid | partially_paid | paid        (derived from payment rows)
```

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| Payment state derived from payment rows | One source of truth; no status drift | A stored `payment_status` column updated by hand | Drifts the moment a payment is deleted or edited |
| Deposit expressed as percent + override amount | Matches the owner's "定金/尾款" language and survives order edits | Free-text note per order | Cannot compute outstanding |
| Supplier/product references by id + snapshot | History survives renames; no cross-module ORM relation (platform rule) | ORM relations to `catalog`/`customers` | Prohibited; couples lifecycles |
| Receiving recorded manually first | Keeps this module independently shippable before `cross_border` exists | Wait for the shipment module | Blocks the first deliverable on the third |
| No approval, no ageing | Owner-confirmed | Generic workflow engine | Adds machinery with no requirement behind it |

## Domain Vocabulary and Business Rules

| Term / invariant | Rule | Source of truth | Failure behaviour |
|---|---|---|---|
| order number | unique per organization, assigned when the order leaves `draft` | this module | duplicate → conflict, no silent renumber |
| placed | the order is committed to the supplier; lines become read-only except for notes | this module | edits rejected after `placed` |
| shipped | goods left the supplier, in transit to the overseas warehouse | this module (later driven by `cross_border`) | manual confirmation until the shipment module lands |
| received | the overseas warehouse recorded the goods in; stock belongs to `wms` | `wms` ledger + this module's status | partial receipts keep the order open |
| outstanding | order total − sum of payments in the order currency | this module | never negative in the UI; overpayment warns |
| closed | nothing further expected; no edits except reopening by command | this module | mutation rejected |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| purchasing operator (HQ) | maintain suppliers and orders, record payments | organization = HQ (+ descendants) | `purchasing.suppliers.manage`, `purchasing.orders.manage`, `purchasing.payments.manage` |
| HQ finance | record and correct payments | organization = HQ | `purchasing.payments.manage` |
| subsidiary staff | read the orders that belong to their organization | organization = own only | `purchasing.orders.view` |
| viewer | read-only | organization per grant | `purchasing.suppliers.view`, `purchasing.orders.view` |

## Reuse and Ownership Map

| Capability | Reuse / app-own | Provided by | Seam |
|---|---|---|---|
| Product reference | reuse | `catalog` | product id + display snapshot |
| Money/quantity precision, currency codes | reuse | `currencies` + platform conventions | currency code on order/payment |
| Payment attachments (bank slips) | reuse | `attachments` | attachment links on the payment record |
| Audit trail | reuse | `audit_logs` | command metadata |
| Org scope + visibility | reuse | `directory` + CRUD factory | ACL organization grants expanded by descendants |
| Warehouse receipt | reuse (later) | `wms` | `wms.inventory.receive` invoked by the shipment flow |
| Supplier, purchase order, payments | **app-own** | this module | — |

## Architecture and Data Flow

```text
/backend/purchasing/{suppliers,orders}   Page + DataTable + CrudForm (feature-gated)
        v
/api/purchasing/**                       makeCrudRoute + guarded command routes
        v
commands/*                               validate → guard → persist → event
        v
data/entities.ts                         tenant+org scoped, updated_at, snapshots
        v
purchasing.supplier.* / purchasing.purchase_order.* / purchasing.purchase_payment.recorded
```

## User Journeys

### Journey J-P-001 — Onboard a supplier

1. Operator opens 供应商列表 → 新建, fills name/code/contact/currency, saves.
2. Duplicate code in the organization is rejected with a field error; a valid save appears in the list immediately.
3. Failure paths: missing `purchasing.suppliers.manage` → no navigation entry, 403 on API.

### Journey J-P-002 — Order, pay in stages, receive, close

1. Operator creates a purchase order in `draft`: picks the supplier (search by name/code), adds lines by picking catalog products, sets quantities and unit prices, sets the deposit percentage.
2. `下单` (place) assigns the number and locks the commercial fields.
3. Finance records the deposit → `paymentStatus = deposit_paid`, outstanding recomputed.
4. Goods ship direct from the supplier; the operator (later: the shipment module) marks `shipped`.
5. The overseas warehouse receives → `received` (stock lands in `wms`, not here); a partial receipt keeps the order open.
6. Finance records the balance (possibly in parts) → `partially_paid` → `paid`; the operator closes the order.
7. Failure paths: concurrent edit → 409 conflict; forbidden transition → rejected with the state unchanged; overpayment → warning, still recorded.

## UI and Interaction Contracts

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/purchasing/suppliers` | list/create/edit/deactivate suppliers | `/api/purchasing/suppliers` | `catalog` category list + form pages | `Page`, `PageBody`, `DataTable`, `CrudForm` | loading, empty, error, conflict, success, permission denied | REQ-P-002, REQ-P-007, REQ-P-010 |
| `/backend/purchasing/orders` | list orders, filter by supplier/status/payment state | `/api/purchasing/purchase-orders` | `sales` orders list | `Page`, `PageBody`, `DataTable` | as above | REQ-P-003, REQ-P-004 |
| `/backend/purchasing/orders/create` | create order with line editor | `/api/purchasing/purchase-orders` | `sales` order create | `CrudForm` + line editor | as above | REQ-P-003 |
| `/backend/purchasing/orders/[id]` | detail: header, lines, payments panel, transitions | `/api/purchasing/purchase-orders/[id]`, `.../transitions`, `.../payments` | `sales` order detail | `Page`, `PageBody`, `DataTable`, dialog form for payments | as above + transition errors | REQ-P-004, REQ-P-005 |

- **Behaviour:** server-side pagination and filtering; destructive actions confirmed; transitions show only the actions the state allows; payments dialog validates amount ≤ outstanding unless overpayment is confirmed.
- **Responsive and accessibility:** line editor usable at narrow width; focus order follows header → lines → payments; status changes announced to screen readers.
- **Localization:** `purchasing.*` keys, zh + en; numbers/currency formatted via shared helpers.
- **Design system:** semantic tokens only; payment state rendered with neutral/brand tokens plus text, never colour alone.

## Data Models

### `purchasing_suppliers`

| Field | Type / nullability | Scope / index | Sensitive | Lifecycle |
|---|---|---|---|---|
| `id` | uuid, required | PK | no | immutable |
| `tenant_id`, `organization_id` | uuid, required | composite index | no | session-derived |
| `name` | text, required | index | no | editable |
| `code` | text, required | unique per (tenant, org) | no | editable before first order, then stable |
| `contact_name`, `phone`, `email`, `address` | text, nullable | — | contact data | editable |
| `default_currency_code` | text, required | — | no | editable |
| `is_active`, `notes` | boolean / text | — | no | editable |
| `created_at`, `updated_at` | timestamps | version | no | system |

### `purchasing_purchase_orders`

| Field | Type / nullability | Scope / index | Sensitive | Lifecycle |
|---|---|---|---|---|
| `id` | uuid | PK | no | immutable |
| `tenant_id`, `organization_id` | uuid | composite index | no | session-derived |
| `number` | text | unique per (tenant, org) | no | assigned at `placed` |
| `supplier_id` + `supplier_snapshot` | uuid + jsonb | index | no | snapshot frozen at `placed` |
| `status` | text enum | index | no | command-driven |
| `currency_code` | text | — | no | fixed at `placed` |
| `subtotal`, `total` | numeric(18,4) | — | no | recomputed from lines while `draft` |
| `deposit_percent`, `deposit_amount` | numeric | — | no | editable while `draft` |
| `expected_ship_at` | date, nullable | — | no | editable until `shipped` |
| `placed_at`, `shipped_at`, `received_at`, `closed_at` | timestamps, nullable | — | no | transition stamps |
| `notes` | text | — | no | editable |
| `created_at`, `updated_at` | timestamps | version | no | system |

### `purchasing_purchase_order_lines`

| Field | Type / nullability | Scope / index | Sensitive | Lifecycle |
|---|---|---|---|---|
| `id`, `tenant_id`, `organization_id` | uuid | PK / composite index | no | system |
| `order_id` | uuid | index | no | immutable |
| `line_number` | integer | unique per order | no | system |
| `catalog_product_id` + `product_snapshot` | uuid + jsonb | index | no | snapshot frozen at `placed` |
| `quantity` | numeric(18,4) | — | no | editable while `draft` |
| `received_quantity` | numeric(18,4), default 0 | — | no | advanced by receipts (shipment flow or manual); never exceeds `quantity` |
| `tax_rate` | numeric(6,3), default 0 | — | no | editable while `draft`; percent |
| `price_includes_tax` | boolean, default true | — | no | editable while `draft`; drives the derivation below |
| `unit_price` | numeric(18,4) | — | no | editable while `draft`; entered as quoted (gross when the toggle is on, net otherwise) |
| `net_total`, `tax_amount`, `line_total` | numeric(18,4) | — | no | derived: net = price − tax when the toggle is on, else price; tax = net × rate; line_total = net + tax (gross) |
| `note` | text | — | no | editable |

Order totals (`subtotal` = Σ net, `tax_total` = Σ tax, `total` = Σ gross) are recomputed from lines while `draft`; payments are recorded against the gross `total`.

### `purchasing_purchase_payments`

| Field | Type / nullability | Scope / index | Sensitive | Lifecycle |
|---|---|---|---|---|
| `id`, `tenant_id`, `organization_id` | uuid | PK / composite index | no | system |
| `order_id` | uuid | index | no | immutable |
| `stage` | text enum (`deposit`/`balance`/`other`) | index | no | immutable |
| `amount` | numeric(18,4) | — | financial | immutable; corrections are new rows or deletion before close |
| `currency_code` | text | — | no | must equal the order currency (mismatch rejected) |
| `paid_at` | date | index | no | editable |
| `reference`, `method_note` | text | — | financial | editable |
| `created_at` | timestamp | — | no | system |

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success | Errors |
|---|---|---|---|---|---|
| `GET/POST` | `/api/purchasing/suppliers` | `purchasing.suppliers.view` / `.manage` | CRUD schemas | list / 201 + `purchasing.supplier.created` | 400/403/409 |
| `GET/PUT/DELETE` | `/api/purchasing/suppliers/[id]` | as above | CRUD schemas | 200 / 204 + events | 403/404/409 |
| `GET/POST` | `/api/purchasing/purchase-orders` | `purchasing.orders.view` / `.manage` | order + lines schema | list / 201 (draft) | 400/403/409 |
| `GET/PUT/DELETE` | `/api/purchasing/purchase-orders/[id]` | as above | order schema | 200 / 204 | 403/404/409 |
| `POST` | `/api/purchasing/purchase-orders/[id]/transitions` | `purchasing.orders.manage` | `{ action: 'place'\|'cancel'\|'mark_shipped'\|'mark_received'\|'close', reason? }` | 200 + `purchasing.purchase_order.<action>` | 403/404/409/422 invalid transition |
| `POST/DELETE` | `/api/purchasing/purchase-orders/[id]/payments` | `purchasing.payments.manage` | payment schema | 201 + `purchasing.purchase_payment.recorded` | 400/403/404/422 currency mismatch |

Commands: `purchasing.suppliers.create|update|delete`, `purchasing.purchase-orders.create|update|delete|place|cancel|mark-shipped|mark-received|close`, `purchasing.purchase-payments.record|delete`. All routes use `makeCrudRoute` except the transitions/payments command routes, which are guarded custom routes with per-method `metadata` + `openApi`.

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Notes |
|---|---|---|---|---|
| `purchasing.purchase_order.placed` | this module | `cross_border` (later), notifications | shipment can be created against the order | idempotent subscribers |
| `purchasing.purchase_order.received` | this module (later from the shipment flow) | `wms` linkage, notifications | stock already landed via `wms.inventory.receive` | this module never writes stock |
| `purchasing.purchase_payment.recorded` | this module | notifications, settlement slice (later) | payment visible on the order | — |
| overdue-shipment reminder (optional, Q-005) | scheduled worker | notification | reminder to the operator | needs a rule + cool-down before it ships |

## Security, Privacy, and Compliance

- **Authorization:** feature ids only; transitions and payments are command-gated; UI hiding never substitutes for the route check.
- **Tenant isolation:** every read/write filters on session tenant + organization; subsidiary callers see only their own organization's orders.
- **Sensitive data:** supplier contact data and payment references are commercial data — no PII of end customers; bank references are redacted from logs; attachments inherit the platform's storage and access rules.
- **Abuse and failure modes:** duplicate supplier code (unique constraint), duplicate order number (per-org sequence), overpayment (explicit confirmation), concurrent edit (409), deletion of a placed order (rejected — cancel instead).

## Integration Coverage

| Test ID | Level | Setup | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-P-001 | API | tenant + org, operator with features | create supplier → create order with 2 lines → place | number assigned, totals correct, snapshot stored, event emitted | REQ-P-002…004 |
| TEST-P-002 | security | user without features; second organization | list/detail/write attempts | 403; no cross-organization rows in list or detail | REQ-P-008 |
| TEST-P-003 | concurrency | two sessions editing one order | simultaneous update | second gets 409; no lost update | REQ-P-009 |
| TEST-P-004 | flow | order in `placed` | record deposit → balance in two parts | `deposit_paid` → `partially_paid` → `paid`, outstanding exact | REQ-P-005 |
| TEST-P-005 | UI | operator, zh + en | list/form/detail states, narrow width, keyboard | canonical shells, complete states, no raw strings/colours | REQ-P-010 |
| TEST-P-006 | migration/rollback | worktree copy | `yarn db:generate` → review → apply; rollback drill | scoped SQL only, no drops, reversible | REQ-P-001, REQ-P-009 |

## Implementation Phases

### Phase 1 — Supplier master (independently shippable)

- **Depends on:** owner confirmation of this document
- **Outcome:** suppliers can be created, listed, edited, deactivated with permissions and organization scope.
- **Deliverables:** module skeleton (`index.ts`, `acl.ts`, `setup.ts`), `data/{entities,validators}.ts`, `/api/purchasing/suppliers*`, `/backend/purchasing/suppliers*`, `translations.ts` + `i18n/{zh,en}.json`, migration (generated → reviewed → approved), TEST-P-002/TEST-P-005 slices.
- **Validation:** `yarn generate`, `yarn db:generate` review, focused tests, browser pass in zh and en.
- **Exit gate:** an operator with the feature completes create/list/edit; a user without it sees no navigation and gets 403; no installed file changed.

### Phase 2 — Purchase orders with lines

- **Depends on:** Phase 1 exit gate
- **Outcome:** draft orders with catalog-referenced lines, `place`/`cancel` transitions, per-organization numbering.
- **Deliverables:** order + line entities, commands, routes, pages (list/create/detail), tests TEST-P-001/TEST-P-003.

### Phase 3 — Stage payments

- **Depends on:** Phase 2 exit gate
- **Outcome:** deposit/balance payments with derived payment state and outstanding, bank-slip attachments.
- **Deliverables:** payment entity, commands, payments panel, derived fields, TEST-P-004.

### Phase 4 — Receiving, closure, and the subsidiary view

- **Depends on:** Phase 3 exit gate; shipment wiring depends on the `cross_border` spec
- **Outcome:** manual `mark_received`/`close` now, driven by the shipment document later; subsidiary users get a read-only order view scoped to their organization.
- **Deliverables:** transition commands, subsidiary list/detail surface (or dashboard card), notification hooks.

## Requirement Traceability

| Requirement | Surface | Contracts | Phase | Tests | AC |
|---|---|---|---|---|---|
| REQ-P-001 | module registration | `src/modules.ts` | 1 | TEST-P-006 | AC-P-001 |
| REQ-P-002 | suppliers | `/api/purchasing/suppliers` | 1 | TEST-P-001, TEST-P-002 | AC-P-002 |
| REQ-P-003 | orders | `/api/purchasing/purchase-orders` | 2 | TEST-P-001 | AC-P-003 |
| REQ-P-004 | transitions | `/transitions` | 2, 4 | TEST-P-001 | AC-P-004 |
| REQ-P-005 | payments | `/payments` | 3 | TEST-P-004 | AC-P-005 |
| REQ-P-006 | money | entity fields | 2, 3 | TEST-P-001, TEST-P-004 | AC-P-006 |
| REQ-P-007 | API + pages | route metadata | 1–4 | TEST-P-002 | AC-P-007 |
| REQ-P-008 | all reads | scope filters | 1–4 | TEST-P-002 | AC-P-008 |
| REQ-P-009 | edit paths | version column | 1–3 | TEST-P-003 | AC-P-009 |
| REQ-P-010 | UI + tests | canonical shells | 1–4 | TEST-P-005 | AC-P-010 |

## Rollout, Migration, and Rollback

No schema change lands before Phase 1's reviewed migration; migrations are generated by `yarn db:generate` and applied only after approval. Rollback per phase: removing the module's registry entry (or the files) removes its routes/pages at the next `yarn generate`; tables and data stay. No new runtime service is introduced; attachments and notifications use the installed ones.

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation | Residual |
|---|---|---|---|
| Receiving is manual until `cross_border` lands | Status can lag reality | Explicit transition stamps + a reminder rule; the shipment module then drives it | Short-lived manual step |
| Snapshot references freeze stale product data | Reports show the ordered name/price, not today's | Snapshots are intentional for history; the detail page shows a link to the current product | Accepted |
| Derived payment state with manual corrections | Wrong entries distort outstanding | Corrections are new rows/deletions before close; tests cover partials and overpayment | Operator error |
| No approval flow | A mistaken order is only caught by a human | Cancel transition with reason; audit trail records who did what | Accepted by the owner |

## Acceptance Criteria

- [ ] **AC-P-001** — `purchasing` registers as `from: '@app'`; no installed file, generated file, or shipped migration edited.
- [ ] **AC-P-002** — Suppliers are organization-scoped, unique by code per organization, and support custom fields.
- [ ] **AC-P-003** — Orders carry per-organization unique numbers and store supplier/product snapshots.
- [ ] **AC-P-004** — Only the allowed transitions succeed; invalid ones are rejected with the state unchanged.
- [ ] **AC-P-005** — Payment state and outstanding are derived from payment rows and correct across partial payments.
- [ ] **AC-P-006** — Money/quantity precision and currency are explicit; currency mismatch on a payment is rejected.
- [ ] **AC-P-007** — Every route declares per-method auth + feature metadata and OpenAPI; every page declares its feature.
- [ ] **AC-P-008** — Cross-organization access fails closed on list, detail, and mutation paths.
- [ ] **AC-P-009** — Concurrent edits produce 409, never a silent overwrite.
- [ ] **AC-P-010** — Surfaces use canonical shells with complete states in zh and en; integration tests pass and the validation gate is green.

## Final Compliance Report

| Check | Status | Evidence |
|---|---|---|
| Routed guides/skills reviewed | pass | `AGENTS.md`, `.ai/guides/{architecture,contracts,backend-ui,spec-delivery}.md`, `om-spec-writing` |
| Data models, APIs, events, UI, tests internally consistent | pass | traceability rows |
| Workflow completes end to end without a catch-all phase | pass | J-P-002 mapped across Phases 1–4 |
| Platform-native reuse before custom code | pass | Reuse and Ownership Map |
| UI contracts identify canonical components and state coverage | pass | UI table + REQ-P-010 |
| Every phase has dependencies, slices, tests, value, exit gate | pass | Phases 1–4 |
| Owner confirmed the derived entity/state model | pass | Q-P-001…Q-P-005 resolved 2026-09-21 |

Verdict: `Ready for implementation` — Phase 1 (supplier master) is implemented; Phases 2–4 remain.

## Changelog

| Date | Change |
|---|---|
| 2026-09-21 | Initial draft derived from the owner-confirmed business inputs; entity/state model proposed for confirmation |
| 2026-09-21 | Owner confirmed the model (deposit percent-or-amount, split/consolidated shipments, per-line tax with an include-tax toggle, no price list, product-level lines). Status → `Ready for implementation`. Phase 1 (supplier master) implemented: entity, validators, create/update/delete commands with undo, command-backed CRUD route, ACL/setup/events, zh+en locales, migration generated and reviewed (not applied). Business context also deposited in `docs/dev/business-architecture.md`. |
