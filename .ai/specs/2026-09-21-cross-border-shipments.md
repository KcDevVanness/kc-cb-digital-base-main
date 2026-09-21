# Cross-Border Shipments — 发运单 / 在途 / 出口单证

**Date**: 2026-09-21
**Status**: Implemented (assumptions still open to owner override)

> Phase 3 of [`docs/plans/cross-border-erp.md`](../../docs/plans/cross-border-erp.md); requirements in [`docs/prd/cross-border-erp.md`](../../docs/prd/cross-border-erp.md) (B-1…B-5, D-1…D-4).
> The PRD's business questions Q1–Q3 were not yet answered when implementation started; per the spec-writing autonomous defaults they are resolved here with the most reversible choice and marked ⚠ for owner override.

## Resolved assumptions (autonomous defaults)

| PRD question | Chosen answer | Why reversible |
|---|---|---|
| **Q1** 出口单证要哪几张 | One `export_documents` table with a `doc_type` enum (`customs_declaration`, `packing_list`, `commercial_invoice`, `bill_of_lading`, `other`) plus a minimal structured trio (`document_number`, `issued_at`, `note`) and an optional attachment id. No full customs schema. ⚠ | Adding columns or a doc type is additive; nothing downstream depends on a schema we have not built |
| **Q2** 拼柜时单证粒度 | Documents hang on the **shipment** (one set per container/consignment) and carry an **optional** `purchase_order_id` so a per-order set can also be recorded. ⚠ | Both granularities fit the same table; no migration needed to switch |
| **Q3** 货代实时轨迹 | Milestones are recorded by the operator (`picked_up → export_customs → in_transit → arrived → cleared → warehoused`), monotonic, append-only history. A real-time carrier feed later becomes an extra writer of the same milestone rows. ⚠ | The history table is the seam; a feed adds rows, it does not change the model |

## TLDR

Ship the goods the platform has no record for: consignments that combine several purchase orders (拼柜/合并发货), the in-transit state between the domestic supplier and the overseas warehouse, and the export paperwork that travels with them. Receiving a shipment lands the stock in `wms` and tells `purchasing` how much of each order line actually arrived — so the two modules' state machines stay consistent with physical reality without either owning the other's tables.

## Problem Statement

After Phases 1–2 the commercial side is complete (supplier → purchase order → deposit/balance), but the physical side is not: nothing records that goods left the supplier, nothing records which purchase orders share a container, and nothing records the export documents. `wms` models warehouse ledgers and in-warehouse operations only — it has no transfer/consignment entity — so "where are my goods between the supplier and the overseas warehouse" has no answer, and purchase order lines can never become "received".

## Overview and Success Measures

- **Primary outcome:** an operator can see, for any consignment, which purchase-order lines it carries, where it is in transit, which documents accompany it, and what has been received into which overseas warehouse.
- **Leading indicators:** allocated quantity never exceeds the ordered quantity; a received shipment leaves `wms` balances increased and every purchase-order line's `received_quantity` matching what landed.
- **Baseline:** no shipment records exist; the transit state and paperwork live outside the system.

## Goals

- **REQ-CB-001** — Shipments live in `src/modules/cross_border/` registered `{ id: 'cross_border', from: '@app' }`; no installed file, generated file, or shipped migration is edited.
- **REQ-CB-002** — A shipment carries a per-organization unique number (`SHP-<year>-<4 digits>`, assigned when it departs), a carrier/forwarder, a departure port, an optional destination warehouse + location, ETD/ETA, and a status (`draft → in_transit → received`, plus `cancelled`).
- **REQ-CB-003** — Allocations connect a shipment to purchase-order lines by scalar id + product snapshot, with a quantity; the sum of allocations per purchase-order line never exceeds that line's ordered quantity, and one line may not appear twice in the same shipment.
- **REQ-CB-004** — Milestones are append-only rows with a monotonic order; a milestone earlier than the current one is rejected and the shipment's `current_milestone` mirrors the latest row.
- **REQ-CB-005** — Departing a shipment advances every allocated purchase order that is still `placed` to `shipped` (via the purchasing command), so the commercial record follows the physical one.
- **REQ-CB-006** — Receiving a shipment calls `wms.inventory.receive` for each allocation (destination warehouse/location, variant resolved from the product) and then `purchasing.purchase-orders.apply-receipt` for the same quantities; the shipment records what was received per allocation, and a failure in either call leaves the shipment unreceived with a readable error.
- **REQ-CB-007** — Export documents are organization-scoped records on a shipment (type, number, issued date, optional attachment, note); attachments go through the installed `attachments` module, never a bespoke uploader.
- **REQ-CB-008** — Every route uses `makeCrudRoute` or a guarded command route with per-method `metadata` + `openApi`; every page declares its feature in `page.meta.ts`; mutations go through commands.
- **REQ-CB-009** — All reads and writes derive tenant + organization from the session and fail closed; the organization-tree visibility rules of the rest of the app apply unchanged.
- **REQ-CB-010** — Admin surfaces use the canonical shells with full state coverage, zh + en strings, semantic tokens; each phase ships with self-contained integration tests and passes the validation gate.

## Non-goals

- A real-time carrier integration (Q3 assumption: manual milestones now).
- A full customs/tariff data model, e-filing, or duty calculation.
- Domestic warehousing: goods still flow supplier → overseas warehouse (no domestic stock node).
- Writing stock for goods that never arrive (short shipments are a receipt-quantity decision, not a silent write-off).
- Touching the installed `wms` or `purchasing` tables directly: both are reached through their commands.

## Proposed Solution

```text
purchase_order_line ──1:n── shipment_allocation ──n:1── shipment ──1:n── shipment_milestone
      (purchasing)                  │                        └──────1:n── export_document
                                    │
             depart  ──► purchasing.purchase-orders.transition(mark_shipped)   [per allocated order]
             receive ──► wms.inventory.receive            (per allocation, variant resolved)
                     └─► purchasing.purchase-orders.apply-receipt (per allocation line)
```

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected |
|---|---|---|---|
| Many-to-many shipment ↔ purchase order (with per-line quantities) | 拼柜 (several orders in one container) and split dispatch (one order in several consignments) are both real; a 1:n model cannot express the first | Shipment per purchase order | Cannot express consolidation, and would force one "fake" shipment per order |
| Receipt goes through `wms`/`purchasing` commands, not their tables | Keeps each module's invariants (ledger math, received-quantity ceiling) in its owner | Direct ORM writes from this module | Would bypass locks, audit, and the received-quantity guard |
| Milestones as append-only rows + denormalized current value | History is the audit trail; the list needs one cheap column | A single mutable `milestone` column | Loses when each stage happened, which is exactly what "in transit" reporting needs |
| Documents on the shipment with an optional order link | One set per consignment is the common case; per-order sets stay possible | Documents on purchase orders only | Export paperwork is issued per consignment, not per order |
| Variant resolved at receive time | Purchase orders are product-level; `wms` receives at variant level | Requiring a variant on every purchase-order line | Would push a warehouse concern into purchasing |

## Domain Vocabulary and Business Rules

| Term / invariant | Rule | Source of truth | Failure behaviour |
|---|---|---|---|
| allocation | quantity of one purchase-order line travelling in one shipment | this module | exceeding the ordered quantity → 422 |
| in transit | goods left the supplier and are not yet received | this module | stock is **not** in `wms` balances while in transit |
| milestone | physical stage, monotonic: `picked_up < export_customs < in_transit < arrived < cleared < warehoused` | this module | a lower stage is rejected; equal is idempotent-noop |
| receipt | the overseas warehouse booked the goods in | `wms` ledger + purchasing line quantities | any failure → shipment stays `in_transit`, error surfaced |
| short receipt | fewer units arrive than allocated | recorded as received quantity on the allocation | purchase order line keeps its outstanding quantity |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| HQ logistics/单证 | create/edit shipments, allocations, documents; depart; advance milestones | organization = HQ (+ descendants) | `cross_border.shipments.manage`, `cross_border.documents.manage` |
| overseas warehouse staff | receive a shipment into their own warehouse | organization = own only | `cross_border.shipments.receive` |
| viewer | read shipments and their documents | per grant | `cross_border.shipments.view` |

## Reuse and Ownership Map

| Capability | Reuse / app-own | Provided by | Seam |
|---|---|---|---|
| Stock landing | reuse | `wms` | `wms.inventory.receive` (command bus), variant resolved from the product |
| Purchase-order state + received quantities | reuse | `purchasing` | `purchasing.purchase-orders.transition` / `.apply-receipt` (command bus) |
| File storage | reuse | `attachments` | attachment id on the document record |
| Product/catalog reads | reuse (scalar) | `catalog` | product id + snapshot; variant resolved by scoped read |
| Shipment, allocation, milestone, document | **app-own** | this module | — |

## Architecture and Data Flow

```text
/backend/cross_border/shipments[/create|/[id]]      Page + DataTable + CrudForm (feature-gated)
        v
/api/cross_border/shipments{,/allocations,/milestones,/documents,/receive}
        v
commands/*  validate → scope → persist → (depart|receive: dispatch peer commands) → events
        v
cross_border_* tables (tenant + organization scoped, updated_at, soft delete)
```

- **Module boundaries:** this module owns the consignment; `wms` owns stock and `purchasing` owns the order's commercial state. Peer calls are commands over the DI command bus with the request context minus the HTTP request.
- **Compatibility:** no installed contract changes; peers stay optional (a missing command registration is reported, never swallowed).

## User Journeys

### Journey J-CB-001 — Consolidate two orders into one consignment

1. Logistics opens 发运单 → 新建, picks the carrier/port and adds allocation lines from open purchase orders (product + remaining quantity shown), splits one order across two shipments if needed.
2. Save → draft. Over-allocation is rejected with the offending line named.
3. `发运` (depart) → number assigned, status `in_transit`, every allocated order still `placed` becomes `shipped`, first milestone recorded.
4. Milestones are advanced as the consignment moves; a regression attempt is rejected.

### Journey J-CB-002 — Receive into the overseas warehouse

1. Warehouse staff opens the shipment, confirms the destination warehouse/location, presses 收货.
2. Stock lands in `wms` (per allocation, variant resolved) and each purchase-order line's received quantity increases; the shipment becomes `received` and each allocation records what was received.
3. Failure path: a missing variant, a closed purchase order, or a rejected quantity leaves the shipment `in_transit` with the error shown; nothing is partially recorded without being reported.

## UI and Interaction Contracts

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/cross_border/shipments` | list, filter by status, open | `/api/cross_border/shipments` | module's own purchase-order list | `Page`, `PageBody`, `DataTable` | loading, empty, error, permission denied | REQ-CB-002, REQ-CB-010 |
| `/backend/cross_border/shipments/create` | create with allocation editor | `POST /api/cross_border/shipments` | module's own purchase-order form | `CrudForm` + custom allocation group | as above + validation | REQ-CB-003 |
| `/backend/cross_border/shipments/[id]` | header, allocations, milestones timeline, documents (upload), depart/receive/cancel | shipment + allocations + milestones + documents routes | module's own purchase-order detail | `Page`, `PageBody`, `DataTable`, `FormHeader`, `Dialog` | as above + conflict/transition errors | REQ-CB-004…007 |

- **Behaviour:** transitions render only when allowed by status; receive asks for confirmation and shows the per-line result; document upload uses the attachments flow; destructive actions confirmed.
- **Localization:** `cross_border.*` keys, zh + en.
- **Design system:** semantic tokens; status badges via `StatusBadge`; milestone timeline uses the shared `ActivityFeed` primitive.

## Data Models

### `cross_border_shipments`

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id`, `organization_id` | uuid | required, composite index |
| `number` | text | unique per (tenant, organization); assigned at depart |
| `status` | text | `draft` \| `in_transit` \| `received` \| `cancelled` |
| `carrier_name`, `forwarder_contact`, `departure_port` | text, nullable | free text; no provider coupling |
| `destination_warehouse_id`, `destination_location_id` | uuid, nullable | required at receive |
| `current_milestone` | text, nullable | mirrors the latest milestone row |
| `etd`, `eta` | date, nullable | |
| `departed_at`, `received_at`, `cancelled_at` | timestamptz, nullable | transition stamps |
| `cancel_reason` | text, nullable | required when cancelled |
| `notes` | text, nullable | |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | `updated_at` is the optimistic-lock version |

### `cross_border_shipment_allocations`

| Field | Type | Notes |
|---|---|---|
| `id`, `tenant_id`, `organization_id` | uuid | |
| `shipment_id` | uuid | FK within module |
| `purchase_order_id`, `purchase_order_line_id` | uuid | scalar references (no cross-module FK) |
| `purchase_order_number`, `product_snapshot` | text / jsonb | frozen display data |
| `quantity` | numeric(18,4) | > 0; sum per purchase-order line ≤ ordered quantity |
| `received_quantity` | numeric(18,4), nullable | set at receive |
| `created_at`, `updated_at` | timestamptz | |

### `cross_border_shipment_milestones`

| Field | Type | Notes |
|---|---|---|
| `id`, `tenant_id`, `organization_id` | uuid | |
| `shipment_id` | uuid | FK within module |
| `milestone` | text | one of the six stages |
| `occurred_at` | timestamptz | when it physically happened |
| `note` | text, nullable | |
| `recorded_by` | uuid, nullable | actor |

### `cross_border_export_documents`

| Field | Type | Notes |
|---|---|---|
| `id`, `tenant_id`, `organization_id` | uuid | |
| `shipment_id` | uuid | FK within module |
| `purchase_order_id` | uuid, nullable | optional per-order set |
| `doc_type` | text | enum of five types |
| `document_number` | text, nullable | |
| `issued_at` | date, nullable | |
| `attachment_id` | uuid, nullable | `attachments` module id |
| `note` | text, nullable | |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | |

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth | Notes |
|---|---|---|---|
| `GET/POST/PUT/DELETE` | `/api/cross_border/shipments` | `cross_border.shipments.view` / `.manage` | CRUD; create/update carry the allocation list |
| `GET` | `/api/cross_border/shipments/allocations?shipmentId=` | `.view` | read-only |
| `GET/POST` | `/api/cross_border/shipments/milestones?shipmentId=` | `.view` / `.manage` | POST advances (monotonic) |
| `GET/POST/PUT/DELETE` | `/api/cross_border/shipments/documents` | `.view` / `cross_border.documents.manage` | |
| `POST` | `/api/cross_border/shipments/depart` | `.manage` | `{ id }` → assigns number, advances orders |
| `POST` | `/api/cross_border/shipments/receive` | `.receive` | `{ id, warehouseId, locationId }` → `wms` + `purchasing` |
| `POST` | `/api/cross_border/shipments/cancel` | `.manage` | `{ id, reason }` |

Commands: `cross_border.shipments.create|update|delete|depart|receive|cancel`, `cross_border.shipments.advance-milestone`, `cross_border.documents.create|update|delete`.
Errors: 400 validation/scope, 403 feature denied, 404 out of scope, 409 optimistic-lock conflict, 422 domain rejection (over-allocation, illegal transition, milestone regression, peer command rejection).

## Events, Jobs, Notifications, and Cross-Module Flows

| Event | Producer | Consumer | Notes |
|---|---|---|---|
| `cross_border.shipment.created/updated/deleted` | this module | index, UI | |
| `cross_border.shipment.departed` | this module | notifications (later) | after the purchasing transitions succeed |
| `cross_border.shipment.milestone.recorded` | this module | notifications (later) | |
| `cross_border.shipment.received` | this module | notifications (later) | after `wms` + `purchasing` succeeded |
| `cross_border.shipment.cancelled` | this module | — | carries the reason |

Peer calls: `purchasing.purchase-orders.transition` (depart), `wms.inventory.receive` + `purchasing.purchase-orders.apply-receipt` (receive). All dispatched with the request context minus the HTTP request, and a rejected peer call aborts the operation with its message.

## Security, Privacy, and Compliance

- Feature-gated routes and pages; no role-name checks.
- Tenant/organization derived from the session; cross-organization reads and writes fail closed.
- Documents reference attachment ids; the attachment module owns storage, access rules, and retention.
- Free-text fields (carrier, port, notes, document numbers) are commercial data; no credentials or personal data are stored by this module.

## Integration Coverage

| Test ID | Level | Actions | Assertions |
|---|---|---|---|
| TEST-CB-001 | API | create shipment with two allocations from two orders → depart | number assigned, both orders `shipped`, first milestone present |
| TEST-CB-002 | API | allocate more than the ordered quantity; allocate the same line twice | 422 with the offending line; no partial write |
| TEST-CB-003 | API | advance milestones forward, then attempt a regression | forward ok; regression 422; `current_milestone` unchanged |
| TEST-CB-004 | API | receive with a valid warehouse/location | `wms` balance increases; purchase-order line `received_quantity` increases; shipment `received`; allocation received quantities recorded |
| TEST-CB-005 | security | second organization reads/writes the shipment; user without features | 404/403; no data leak |
| TEST-CB-006 | UI | list/create/detail in zh and en; narrow width; keyboard | canonical shells, full states, upload flow works |

## Implementation Phases

### Phase A — Shipments with allocations (independently shippable)

- **Deliverables:** module skeleton (`index.ts`, `acl.ts`, `setup.ts`, `events.ts`), entities + validators, `shipments` CRUD commands (create/update/delete) with allocation validation, routes, list/create pages, zh + en locales, migration (generated → reviewed → approved).
- **Exit gate:** an operator creates a draft shipment that consolidates lines from two purchase orders; over-allocation is rejected; nothing outside `cross_border_*` tables changed.

### Phase B — Depart, milestones, and document records

- **Deliverables:** `depart` command (+ peer `mark_shipped` dispatch), milestone command + history, documents commands + routes, detail page with timeline and documents.
- **Exit gate:** depart numbers the shipment and advances the allocated orders; milestones are monotonic; a document with an attachment is retrievable.

### Phase C — Receive into the overseas warehouse

- **Deliverables:** `receive` command dispatching `wms.inventory.receive` and `purchasing.purchase-orders.apply-receipt`, allocation received quantities, receive action in the UI, plus the new `purchasing.purchase-orders.apply-receipt` command.
- **Exit gate:** TEST-CB-004 green on a real stack; a rejected peer call leaves the shipment `in_transit`.

## Requirement Traceability

| Requirement | Surface | Contracts | Phase | Tests |
|---|---|---|---|---|
| REQ-CB-001 | registration | `src/modules.ts` | A | TEST-CB-006 |
| REQ-CB-002 | shipment header | shipments route | A/B | TEST-CB-001 |
| REQ-CB-003 | allocations | create/update | A | TEST-CB-002 |
| REQ-CB-004 | milestones | milestones route | B | TEST-CB-003 |
| REQ-CB-005 | depart | purchasing transition | B | TEST-CB-001 |
| REQ-CB-006 | receive | wms + purchasing commands | C | TEST-CB-004 |
| REQ-CB-007 | documents | documents route + attachments | B | TEST-CB-006 |
| REQ-CB-008/009/010 | all surfaces | metadata, scope, UI states | A–C | TEST-CB-005, TEST-CB-006 |

## Rollout, Migration, and Rollback

Migration generated by `yarn db:generate`, reviewed (four new tables, no drops), applied only after approval. Rollback: removing the module entry drops its routes/pages at the next `yarn generate`; tables and data remain. Peer calls are additive — disabling `cross_border` leaves `wms` and `purchasing` untouched.

## Risks and Tradeoffs

| Risk | Impact | Mitigation | Residual |
|---|---|---|---|
| Variant resolution picks an unintended variant for a product | stock lands on the wrong SKU | default variant first, else oldest active; the resolved variant id is recorded on the allocation | Products with several real variants need a variant-level allocation later |
| Peer command rejection mid-receive | partial receipt | receive dispatches per allocation and reports the first rejection; the shipment stays `in_transit` and re-running is idempotent per allocation (already-received allocations are skipped) | Manual reconciliation of a partially applied consignment |
| Manual milestones | stale transit state | milestone history + optional real-time feed later | Operator discipline |
| Over-consolidation across organizations | data leak | allocations are validated against purchase-order lines read with the same organization scope | — |

## Acceptance Criteria

- [ ] **AC-CB-001** — a shipment consolidating two purchase orders can be created, departed, and received.
- [ ] **AC-CB-002** — over-allocation and duplicate allocation of one line are rejected (422), with nothing partially written.
- [ ] **AC-CB-003** — milestones advance monotonically; a regression is rejected and the current milestone is unchanged.
- [ ] **AC-CB-004** — receiving increases `wms` balances and the purchase-order lines' received quantities by exactly the allocated amounts.
- [ ] **AC-CB-005** — cross-organization access fails closed on list, detail, and mutation paths.
- [ ] **AC-CB-006** — pages use canonical shells with complete states in zh and en; the validation gate passes.

## Final Compliance Report

| Check | Status | Evidence |
|---|---|---|
| Routed guides/skills reviewed | pass | `AGENTS.md`, `.ai/guides/{architecture,contracts,backend-ui}.md`, `om-spec-writing`, `om-module-scaffold` references |
| Data models, APIs, events, UI, tests internally consistent | pass | traceability rows |
| Platform-native reuse before custom code | pass | Reuse and Ownership Map (wms/purchasing/attachments seams) |
| Business questions answered by the owner | **blocked** | Q1–Q3 answered by reversible defaults, marked ⚠ in *Resolved assumptions* |

Verdict: `Ready for implementation` under recorded assumptions.

## Changelog

| Date | Change |
|---|---|
| 2026-09-21 | Initial spec; PRD Q1–Q3 resolved with reversible defaults (⚠ owner override welcome) |
| 2026-09-21 | Implemented and verified: 4 tables + migration applied; shipments/allocations/milestones/documents routes; commands with cross-module dispatch (`purchasing.purchase-orders.transition` on depart, `wms.inventory.receive` + `purchasing.purchase-orders.apply-receipt` on receive); UI (list/create/detail with allocation editor, milestone timeline, documents, receive dialog). Smoke: over-allocation 422, duplicate line 422, depart auto-advances orders to shipped, milestone regression 422, receive → wms balance 11.0000 + line receipts 6/5 + shipment received, documents CRUD. Gates: generate/typecheck/lint(0 errors, 0 new warnings)/ds:check green. |
