# Platform Ops — 平台订单镜像 / 平台结算 / 对账

**Date**: 2026-09-21
**Status**: Implemented (Phases A + B) — Phase C (transport seam) is not started and waits on PRD Q4

> **As-shipped deltas (2026-09-23).** Phases A and B shipped on 2026-09-21 (`platform_ops` registered, one
> migration for 5 tables, channels/orders/settlements/reconciliation routes + pages, commands incl. idempotent
> `orders.ingest` and `settlements.import`); the Status line still said `Ready for implementation`.
> Phase C has **no** `di.ts`, adapter or file-drop endpoint — the module's API/import paths are the only entry
> points today. **Test evidence:** no automated tests exist under `src/modules/platform_ops/**`; the acceptance
> evidence is the manual smoke in [`docs/plans/cross-border-erp.md`](../../docs/plans/cross-border-erp.md)
> (阶段四) — the TEST-PO-* rows below are intended oracles, not committed artifacts.

> Phase 4 of [`docs/plans/cross-border-erp.md`](../../docs/plans/cross-border-erp.md); requirements C-1…C-3 and D-1…D-4 of [`docs/prd/cross-border-erp.md`](../../docs/prd/cross-border-erp.md).
> PRD question Q4 (platform connectivity: API / files / third-party) is unresolved; per the spec-writing autonomous defaults the landing point is built first and the transport is left as a seam (⚠ owner override welcome).

## Resolved assumptions (autonomous defaults)

| PRD question | Chosen answer | Why reversible |
|---|---|---|
| **Q4** 平台对接形态 | Build the **landing point** first: idempotent `ingest`/`import` commands that take already-fetched platform data (JSON payloads) and reconcile it. The transport — a `data_sync` adapter streaming from the platform API, a file drop, or a third-party service — is added later and calls the same commands. ⚠ | The commands are the contract; adding an adapter or a file endpoint changes no schema and no command input |
| **Q5** 跨组织主数据分发 | Out of scope here; each channel and its mirrors belong to one organization (a subsidiary's store), and HQ sees them through the organization tree. ⚠ | A later distribution feature is additive |
| **Q6** 提醒规则 | Out of scope here (Phase 5). | — |

## TLDR

Give the platform side of the business a record: which storefronts exist, what the platform says was ordered and paid, what it actually paid out after fees, and where the platform's numbers disagree with ours. The system is the **mirror and the reconciler**, never the marketplace: platform stock and listings stay authoritative there, and every mismatch becomes a reconciliation item instead of a silent overwrite.

## Problem Statement

Marketplace orders, payouts and fees currently exist only inside each platform's back office. Nothing in the system can answer "did the platform pay us what it says we earned", "which orders never made it into our records", or "what did this storefront actually take this month" — the two sources of truth have never been compared, and the settlement statement (gross, commission, net) is the only place the difference is visible.

## Overview and Success Measures

- **Primary outcome:** for any storefront and period, an operator can see the platform's orders, the payout that followed, and the reconciliation items the comparison produced.
- **Leading indicators:** re-importing the same payload creates no duplicate rows; every settlement line either matches a mirrored order or produces exactly one reconciliation item.
- **Baseline:** no platform records exist.

## Goals

- **REQ-PO-001** — The module lives in `src/modules/platform_ops/`, registered `{ id: 'platform_ops', from: '@app' }`; no installed file, generated file, or shipped migration is edited.
- **REQ-PO-002** — Channels (a storefront binding: platform, external account, currency, organization) are organization-scoped records with a unique code per organization.
- **REQ-PO-003** — Order mirrors are keyed by `(channel, external order id)`: re-ingesting the same order updates the mirror instead of duplicating it, and reports `created` / `updated` / `unchanged` counts.
- **REQ-PO-004** — Settlements carry the platform's own statement identity (`(channel, external settlement id)`), a period, gross/fee/net amounts in the settlement currency, and their per-order lines; importing the same settlement twice is idempotent.
- **REQ-PO-005** — Importing a settlement compares each line against the order mirrors and raises exactly one reconciliation item per problem: order missing locally, amount mismatch, or duplicate line. Items are never created twice for the same `(channel, external ref, kind)`.
- **REQ-PO-006** — Reconciliation items can be resolved or ignored by an operator with a note; both actions are commands with an audit trail, and a resolved item never silently reappears (a new mismatch creates a new item).
- **REQ-PO-007** — Money is stored as decimal strings with an explicit currency; no FX conversion happens here (currencies module owns rates).
- **REQ-PO-008** — Every route uses `makeCrudRoute` or a guarded command route with per-method `metadata` + `openApi`; every page declares its feature in `page.meta.ts`; mutations go through commands.
- **REQ-PO-009** — All reads and writes derive tenant + organization from the session and fail closed; the organization tree rules apply unchanged.
- **REQ-PO-010** — Admin surfaces use the canonical shells with full state coverage, zh + en strings, semantic tokens; each phase ships with self-contained integration tests and passes the validation gate.

## Non-goals

- Writing anything back to a platform (no stock push, no listing management, no price updates).
- Fetching from a platform API in this slice: the transport is a later, additive seam (Q4).
- FX conversion, tax accounting, or general-ledger postings.
- Replacing the marketplace's own inventory/listing flow — the mirror is read-only by design.

## Proposed Solution

```text
platform (API / file / third party)
        │  (transport added later)
        v
platform_ops.channels.create ─► platform_ops.orders.ingest   (idempotent by channel + external id)
                               platform_ops.settlements.import (idempotent by channel + external id)
                                        │
                                        ├─► order mirror rows (status, totals, fees)
                                        ├─► settlement header + lines (gross / fee / net)
                                        └─► reconciliation items (missing_in_erp | amount_mismatch | duplicate)
                                                     │
                                          resolve / ignore (command, audited)
```

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected |
|---|---|---|---|
| Landing point = commands taking JSON payloads | The transport is undecided (Q4); commands are the stable contract an adapter, a file importer, or a third party can all call | Build a `data_sync` adapter first | The adapter contract is large (cursors, streams, run parameters) and would hard-code a transport the owner has not chosen |
| Mirror keyed by `(channel, external id)` with a unique constraint | Idempotency must survive a retry, a re-import and a concurrent import | Upsert by “latest row wins” | Duplicates accumulate invisibly |
| Reconciliation items are first-class records, never log lines | An operator has to work them: resolve with a note, or ignore | Only log mismatches | Nothing to act on, nothing to audit |
| Platform is authoritative for its own numbers | The mirror must show what the platform claims, otherwise reconciliation compares two guesses | Overwrite platform numbers with ours | Destroys the evidence the reconciliation exists to produce |
| No write-back to the platform | The marketplace owns stock and listings (owner-confirmed) | Push stock from `wms` | Dual-write, conflicts, and no requirement behind it |

## Domain Vocabulary and Business Rules

| Term / invariant | Rule | Source of truth | Failure behaviour |
|---|---|---|---|
| channel | one storefront binding (platform + external account + currency) owned by one organization | this module | duplicate code per organization → 409 |
| order mirror | our read-only copy of a platform order | platform payload | re-ingest updates, never duplicates |
| settlement | the platform's payout statement for a period | platform payload | same external id → idempotent update |
| settlement line | one order's contribution to a payout (gross, fee, net) | platform payload | a line without a mirror → `missing_in_erp` |
| reconciliation item | a specific disagreement awaiting an operator decision | this module | one per `(channel, external ref, kind)`; resolved items stay resolved |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| HQ finance | import settlements, work the reconciliation queue, read everything | organization = HQ (+ descendants) | `platform_ops.settlements.manage`, `platform_ops.reconciliation.manage` |
| subsidiary operator | read their own storefront's orders and settlements | organization = own only | `platform_ops.channels.view`, `platform_ops.settlements.view` |
| viewer | read-only | per grant | `platform_ops.channels.view`, `platform_ops.settlements.view`, `platform_ops.reconciliation.view` |

## Reuse and Ownership Map

| Capability | Reuse / app-own | Provided by | Seam |
|---|---|---|---|
| External id mapping, provider registry | reuse (available, not required by this slice) | `integrations` | `externalIdMappingService` |
| Streaming import/export runs, cursors, progress | reuse (later transport) | `data_sync` | `DataSyncAdapter` registration in `di.ts` |
| Currencies and rates | reuse | `currencies` | currency codes only; no conversion here |
| Shipment linkage (which consignment fulfilled an order) | reuse | `cross_border` | scalar shipment id + number snapshot |
| Channel, order mirror, settlement, reconciliation | **app-own** | this module | — |

## Architecture and Data Flow

```text
/backend/platform_ops/{channels,orders,settlements,reconciliation}   Page + DataTable + CrudForm
        v
/api/platform_ops/{channels,orders,settlements,reconciliation}
        v
commands/*  validate → scope → idempotent upsert → reconciliation pass → events
        v
platform_ops_* tables (tenant + organization scoped, updated_at, soft delete where editable)
```

## User Journeys

### Journey J-PO-001 — Import a settlement and clear the queue

1. Finance opens 结算单 → 导入, pastes or uploads the platform's settlement payload for a storefront and period.
2. The command upserts the settlement and its lines, matches lines against order mirrors, and reports `created` / `updated` / `reconciliation items raised`.
3. Finance opens 对账 with the open items, resolves each with a note (or ignores a known one), and the queue empties.
4. Failure path: an unknown channel or a malformed payload is rejected before anything is written; re-importing the same settlement changes nothing.

### Journey J-PO-002 — Ingest platform orders

1. A connector (later) or an operator posts a batch of platform orders for a channel.
2. Each order is upserted by `(channel, external id)`; the response reports per-batch counts.
3. Re-posting the same batch reports `unchanged` and writes nothing.

## UI and Interaction Contracts

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/platform_ops/channels` | list/create/edit storefronts | `/api/platform_ops/channels` | module's own purchasing supplier list | `Page`, `PageBody`, `DataTable`, `CrudForm` | loading, empty, error, conflict, permission denied | REQ-PO-002 |
| `/backend/platform_ops/orders` | read-only mirror list, filter by channel/status | `/api/platform_ops/orders` | module's own shipment list | `Page`, `PageBody`, `DataTable` | as above | REQ-PO-003 |
| `/backend/platform_ops/settlements` | list + detail with lines, import dialog | `/api/platform_ops/settlements{,/lines,/import}` | module's own purchase-order detail | `Page`, `PageBody`, `DataTable`, `Dialog` | as above + import errors | REQ-PO-004, REQ-PO-005 |
| `/backend/platform_ops/reconciliation` | queue with resolve/ignore dialogs | `/api/platform_ops/reconciliation{,/resolve,/ignore}` | module's own lists | `Page`, `PageBody`, `DataTable`, `Dialog` | as above | REQ-PO-006 |

## Data Models

### `platform_ops_channels`

| Field | Type | Notes |
|---|---|---|
| `id`, `tenant_id`, `organization_id` | uuid | required |
| `name`, `code` | text | unique per (tenant, organization) |
| `platform` | text | free text (`amazon`, `shopee`, `lazada`, `tiktok`, …) — no provider coupling |
| `external_account_id` | text, nullable | the storefront id inside the platform |
| `currency_code` | text | settlement currency |
| `is_active`, `notes` | boolean / text | |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | |

### `platform_ops_order_mirrors`

| Field | Type | Notes |
|---|---|---|
| `id`, `tenant_id`, `organization_id` | uuid | |
| `channel_id` | uuid | FK within module |
| `external_order_id` | text | unique per (channel) |
| `status`, `currency_code` | text | as reported by the platform |
| `gross_amount`, `fee_amount`, `net_amount` | numeric(18,4) | |
| `placed_at` | timestamptz, nullable | |
| `shipment_id`, `shipment_number` | uuid / text, nullable | set when a consignment fulfilled it |
| `raw` | jsonb, nullable | the payload as received (evidence) |
| `synced_at` | timestamptz | last successful ingest |

### `platform_ops_settlements`

| Field | Type | Notes |
|---|---|---|
| `id`, `tenant_id`, `organization_id`, `channel_id` | uuid | |
| `external_settlement_id` | text | unique per (channel) |
| `period_start`, `period_end` | date | |
| `currency_code` | text | |
| `gross_amount`, `fee_amount`, `net_amount` | numeric(18,4) | |
| `status` | text | `imported` \| `reconciled` |
| `received_at` | timestamptz, nullable | payout date |
| `raw` | jsonb, nullable | |

### `platform_ops_settlement_lines`

| Field | Type | Notes |
|---|---|---|
| `id`, `tenant_id`, `organization_id`, `settlement_id` | uuid | |
| `external_order_id` | text | |
| `order_mirror_id` | uuid, nullable | resolved match |
| `gross_amount`, `fee_amount`, `net_amount` | numeric(18,4) | |

### `platform_ops_reconciliation_items`

| Field | Type | Notes |
|---|---|---|
| `id`, `tenant_id`, `organization_id`, `channel_id` | uuid | |
| `kind` | text | `missing_in_erp` \| `amount_mismatch` \| `duplicate_line` |
| `external_ref` | text | the order or settlement id involved |
| `settlement_id`, `order_mirror_id` | uuid, nullable | context |
| `expected_amount`, `actual_amount` | numeric(18,4), nullable | |
| `currency_code` | text, nullable | |
| `status` | text | `open` \| `resolved` \| `ignored` |
| `note`, `resolved_at`, `resolved_by` | text / timestamptz / uuid | |

Uniqueness: `(channel, external_ref, kind, status = open)` is enforced in the command (a resolved item does not block a new one).

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth | Notes |
|---|---|---|---|
| `GET/POST/PUT/DELETE` | `/api/platform_ops/channels` | `platform_ops.channels.view` / `.manage` | CRUD |
| `GET` | `/api/platform_ops/orders` | `.view` | mirror list (`channelId`, `status`, `search`) |
| `POST` | `/api/platform_ops/orders/ingest` | `platform_ops.channels.manage` | `{ channelId, orders: [...] }` → `{ created, updated, unchanged }` |
| `GET` | `/api/platform_ops/settlements` | `.view` | list |
| `GET` | `/api/platform_ops/settlements/lines?settlementId=` | `.view` | lines |
| `POST` | `/api/platform_ops/settlements/import` | `platform_ops.settlements.manage` | `{ channelId, settlement: {…}, lines: [...] }` → counts + raised items |
| `GET` | `/api/platform_ops/reconciliation` | `platform_ops.reconciliation.view` | queue (default `status=open`) |
| `POST` | `/api/platform_ops/reconciliation/resolve` | `.manage` | `{ id, note }` |
| `POST` | `/api/platform_ops/reconciliation/ignore` | `.manage` | `{ id, note }` |

Commands: `platform_ops.channels.create|update|delete`, `platform_ops.orders.ingest`, `platform_ops.settlements.import`, `platform_ops.reconciliation.resolve|ignore`.
Errors: 400 validation/scope, 403 feature denied, 404 out of scope, 409 conflict (duplicate channel code), 422 domain rejection (unknown channel, malformed payload, already-resolved item).

## Events, Jobs, Notifications, and Cross-Module Flows

| Event | Producer | Consumer | Notes |
|---|---|---|---|
| `platform_ops.channel.created/updated/deleted` | this module | index, UI | |
| `platform_ops.orders.ingested` | this module | notifications (later) | carries per-batch counts |
| `platform_ops.settlement.imported` | this module | notifications (later) | carries counts + raised reconciliation items |
| `platform_ops.reconciliation.raised` | this module | notifications (later) | one per item |
| `platform_ops.reconciliation.resolved` | this module | audit | carries the note |

## Security, Privacy, and Compliance

- Feature-gated routes and pages; no role-name checks.
- Tenant/organization from the session; a channel belonging to another organization is invisible and unreadable (404), not merely hidden.
- Platform payloads may contain buyer-adjacent data: only what reconciliation needs is projected into columns, the full payload is stored in `raw` for evidence and never rendered in lists.
- No platform credentials are stored by this module; when a transport is added, credentials belong to `integrations` (`integrationCredentialsService`), encrypted.

## Integration Coverage

| Test ID | Level | Actions | Assertions |
|---|---|---|---|
| TEST-PO-001 | API | create channel → ingest 2 orders → re-ingest the same payload | first ingest `created: 2`; second `unchanged: 2`; one row per order |
| TEST-PO-002 | API | import a settlement whose lines match, mismatch, and reference an unknown order | settlement + lines stored once; exactly one item per problem kind; re-import raises nothing new |
| TEST-PO-003 | API | resolve an item, then re-import the same settlement | resolved item stays resolved; no new item for the same `(channel, ref, kind)` while open |
| TEST-PO-004 | security | second organization reads/writes the channel; user without features | 404/403; no data leak |
| TEST-PO-005 | UI | channels/orders/settlements/reconciliation in zh and en; narrow width; keyboard | canonical shells, full states, import + resolve dialogs work |

## Implementation Phases

### Phase A — Channels and the order mirror

- **Deliverables:** module skeleton (`index.ts`, `acl.ts`, `setup.ts`, `events.ts`), channel + order-mirror entities and validators, channel CRUD commands, `orders.ingest` command (idempotent upsert), routes, channels + orders pages, zh + en locales, migration (generated → reviewed → approved).
- **Exit gate:** TEST-PO-001 green; a re-ingested batch writes nothing and reports `unchanged`.

### Phase B — Settlements and reconciliation

- **Deliverables:** settlement + line + reconciliation entities, `settlements.import` command with the comparison pass, `reconciliation.resolve|ignore` commands, routes, settlements list/detail + reconciliation queue pages.
- **Exit gate:** TEST-PO-002 and TEST-PO-003 green; the queue is actionable end to end.

### Phase C — Transport seam (after Q4)

- **Deliverables:** whichever transport the owner picks — a `data_sync` adapter registered in `di.ts`, a file-drop endpoint, or a third-party bridge — calling the existing `ingest`/`import` commands. No schema or command change.
- **Exit gate:** a real platform payload reaches the same commands and the mirror/reconciliation results match a manual import.

## Requirement Traceability

| Requirement | Surface | Contracts | Phase | Tests |
|---|---|---|---|---|
| REQ-PO-001 | registration | `src/modules.ts` | A | TEST-PO-005 |
| REQ-PO-002 | channels | channels route | A | TEST-PO-004 |
| REQ-PO-003 | order mirror | orders ingest | A | TEST-PO-001 |
| REQ-PO-004 | settlements | settlements import | B | TEST-PO-002 |
| REQ-PO-005 | reconciliation pass | import command | B | TEST-PO-002 |
| REQ-PO-006 | resolve/ignore | reconciliation routes | B | TEST-PO-003 |
| REQ-PO-007 | money | entity fields | A/B | TEST-PO-002 |
| REQ-PO-008/009/010 | all surfaces | metadata, scope, UI states | A/B | TEST-PO-004, TEST-PO-005 |

## Rollout, Migration, and Rollback

`integrations` and `data_sync` are enabled alongside this module (registry-only change; their package migrations add tables). This module's migration is generated, reviewed (no drops), and applied after approval. Rollback: removing the registry entries drops the routes/pages at the next `yarn generate`; tables and data remain.

## Risks and Tradeoffs

| Risk | Impact | Mitigation | Residual |
|---|---|---|---|
| Platform payload shape varies per marketplace | Adapter/import mapping drift | The landing command takes a normalized shape; per-platform mapping belongs to the transport | Manual mapping work when the transport lands |
| Reconciliation noise (many small fee mismatches) | Operators ignore the queue | Items are grouped by kind; ignore is a first-class action with a note | Tuning thresholds later |
| Storing raw payloads | Storage growth, incidental personal data | `raw` is evidence-only, never rendered in lists; retention is a later decision | Accepted for now |
| No transport yet | Data arrives only by hand | Explicitly scoped as Phase C; the commands are the seam | Manual imports until Q4 is answered |

## Acceptance Criteria

- [ ] **AC-PO-001** — a channel is created, orders are ingested, and re-ingesting the same batch reports `unchanged` with no new rows.
- [ ] **AC-PO-002** — importing a settlement twice stores it once and raises no duplicate reconciliation items.
- [ ] **AC-PO-003** — a missing order, an amount mismatch, and a duplicate line each raise exactly one item of the right kind.
- [ ] **AC-PO-004** — resolving an item with a note is audited and the item never reopens by itself.
- [ ] **AC-PO-005** — cross-organization access fails closed on list, detail, and mutation paths.
- [ ] **AC-PO-006** — pages use canonical shells with complete states in zh and en; the validation gate passes.

## Final Compliance Report

| Check | Status | Evidence |
|---|---|---|
| Routed guides/skills reviewed | pass | `AGENTS.md`, `.ai/guides/{architecture,contracts,backend-ui}.md`, `data_sync/AGENTS.md` (adapter contract), `om-spec-writing` |
| Data models, APIs, events, UI, tests internally consistent | pass | traceability rows |
| Platform-native reuse before custom code | pass | Reuse and Ownership Map (`integrations`, `data_sync` left as the transport seam) |
| Business questions answered by the owner | **blocked** | Q4 defaulted (⚠ in *Resolved assumptions*); Q5/Q6 out of scope |

Verdict: `Implemented (Phases A + B); Phase C open on PRD Q4`.

## Changelog

| Date | Change |
|---|---|
| 2026-09-21 | Initial spec; PRD Q4 resolved with the reversible "landing point first" default (⚠ owner override welcome) |
| 2026-09-21 | Phases A+B implemented and verified: 5 tables + migration applied; `integrations` + `data_sync` enabled and migrated; channels/orders/settlements/lines/reconciliation routes; commands (channel CRUD, idempotent `orders.ingest`, `settlements.import` with the comparison pass, `reconciliation.resolve|ignore`); UI (channels list/create/edit, orders mirror list, settlements list/detail + import dialog, reconciliation queue with note dialogs). Smoke: ingest `created:2` → replay `unchanged:2`; import `lines:3, raised:2, linked:1` → replay `raised:0`; resolve+ignore → replay still `raised:0` (no resurrection). Gates green; platform_ops contributes 0 lint warnings. Phase C (transport) waits on Q4. |
| 2026-09-23 | Status → `Implemented (Phases A + B)`; Phase C restated as not started (no `di.ts`, no adapter, no file-drop endpoint) and the acceptance evidence recorded as manual smoke. |
