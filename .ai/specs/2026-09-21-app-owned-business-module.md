# App-Owned Business Module — Self-Assembled Flow on Platform Primitives

**Date**: 2026-09-21
**Status**: Draft

> Skeleton under the `om-spec-writing` Open Questions gate. Everything decidable without the business input is complete and grounded: module shape, the platform primitives the app reuses, the invariants every entity/route must carry, the validation gate, and the phase skeleton. Business content that only the product owner can supply is left to the `Q-*` that unblocks it — no invented fields, states, or roles.

## TLDR

Build the app's own modules in `src/modules/<id>/` **only where the platform has no capability**, on top of the shipped trunk it does have. Owner-confirmed business (2026-09-21): 国内供应商采购 → 卖给国外分公司（关联交易）→ 国外分公司跨境电商运营；核心是 ERP 流程与仓库商品流转。Re-assessment (`.ai/analysis/2026-09-21-business-model-reassessment.md`) shows the trunk already covers product master (with HS/CN code, country of origin, weight, dimensions, min-order/UoM fields), customers, the quote→order→shipment→return→invoice→credit-memo→payment chain, warehouse/ledger/reservation/movement operations, currencies, and organizations — so the app-owned build targets the **gaps only**: 采购（supplier → PO → 到货 → 应付）、跨境发运/在途与出口单证、平台订单履约与平台结算对账. Every module registers as `{ id, from: '@app' }` and consumes platform capabilities rather than re-implementing them: session-derived tenant/organization scope, ACL features, `makeCrudRoute` APIs with per-method `metadata`/`openApi`, `Page`/`PageBody`/`DataTable`/`CrudForm` surfaces, command-mediated mutations with interceptors/guards, typed events, notifications, queues/workers, search indexing, attachments, audit, and reviewed migrations. Platform connectors follow the installed `sync_akeneo` shape (`integrations` + `data_sync`). The installed modules stay enabled and untouched; see Q-008 for the per-module spec split.

## Open Questions

Blocking — each answer decides schema, API, or UI content, so implementation cannot start before they are resolved.

- **Q-001** — Chain v2 confirmed by the owner on 2026-09-21: 采购订单（对国内代理商）→ 供应商直发（无国内仓）→ 在途 → 海外仓收货 → 平台订单履约 → 平台结算. 出口单证（报关/装箱/商业发票）随发运生成。Sub-question Q-013.
- **Q-009** — RESOLVED as a requirement: one tenant, hierarchical organizations — 广州总部 as the root, 俄罗斯/东南亚分公司 as children. Visibility rule: HQ sees every subsidiary, subsidiaries see neither upward nor sideways. Mechanism confirmed in the installed platform (see *Resolved inputs* below); the ACL grants per user decide the accessible organization list.
- **Q-002** — For each document in the chain: which state machine (states, allowed transitions, who may trigger each), and which numbers/sequences are required?
- **Q-003** — Which fields are mandatory for each record — the ones the current tooling cannot express (the reason for building this at all) — and which of them are money/quantity/date/attachment/reference-to-another-record?
- **Q-004** — Who uses it: which roles, what may each do (view/create/approve/void), and does anything need a second person's confirmation?
- **Q-005** — Which reactions are required: notifications/reminders (trigger, threshold, recipient, channel, repeat policy), background/async work, scheduled jobs?
- **Q-006** — Does anything need to leave the system or come in: email, file/CSV import or export, external API, webhook, payment/shipping provider?
- **Q-007** — Must the installed `catalog`/`sales`/`wms` data be visible from the new module (read-only reference), or is the new module fully standalone at first?
- **Q-008** — RESOLVED 2026-09-21: this capability splits into three independently shippable specs — `purchasing` (written first: `.ai/specs/2026-09-21-purchasing-module.md`), `cross_border` (shipment/in-transit/export documents), `platform_ops` (marketplace connectors + settlement). This document keeps the shared platform decisions, invariants, and the split rationale.
- **Q-010** — Marketplace and logistics connectivity: platform API direct, platform export files, or a third-party ERP service? This fixes the `data_sync` adapter shape and where credentials live.
- **Q-011** — RESOLVED 2026-09-21: no approval flow, no payment terms/ageing. Payment is stage-based: 定金 (deposit) then 尾款 (balance), settled in full or in parts. 应付 is derived (order total − paid), not a separate ledger.
- **Q-012** — RESOLVED 2026-09-21: multi-language required (zh + en first; other locales after the flow is complete). EUDR out of scope (no EU sales). Carrier labels/tracking kept: use the forwarder's real-time feed when available, otherwise milestone-based tracking (已揽收/出口报关/在途/到港/清关/入海外仓).
- **Q-013** — RESOLVED 2026-09-21: no domestic consolidation, no returns-to-China → **no domestic warehouse node**; supplier ships direct, transit lives on the shipment document.
- **Q-014** — RESOLVED 2026-09-21: subsidiaries DO use this system, each seeing its own organization's data; occasional senior roles needing parts of HQ data will be decided later. Requirement: reserve the capability — likely a dedicated subsidiary dashboard/section so the architecture stays clean — via ACL organization grants (config, no code) and, if field-level partial sharing is ever needed, an app-owned shared-read route behind its own feature.

## Resolved inputs (owner-confirmed, 2026-09-21)

| Input | Decision | Consequence |
|---|---|---|
| Organization model | One tenant; hierarchical organizations — 广州总部 root, 俄罗斯/东南亚分公司 children | The platform's `directory` module already models exactly this tree |
| Visibility | HQ → all descendants; subsidiary → itself only (no upward, no lateral) | Installed mechanism: a user's ACL carries the accessible organization list, which is **expanded with `organization.descendant_ids`** before filtering; the shared CRUD factory consumes that set for every list/read |
| Domestic warehouse | None — goods go supplier → overseas warehouse directly | No domestic `wms` warehouse node with balances; the transit is an app-owned 发运/在途 document that lands in the overseas warehouse via `wms.inventory.receive` |
| Platform (marketplace) side | Subsidiaries run this system for their own organization; the marketplaces hold marketplace stock and listings and expose APIs | Platform is the source of truth for marketplace stock/listings; this system pulls data (orders, inventory, listings, settlement) through `data_sync`-shaped connectors. Pull-only mirror unless a later decision asks for stock push |
| Overseas warehouse (3PL) | Has an API, completeness unknown | **Our `wms` ledger is authoritative**; the 3PL API is a sync input, and mismatches become reconciliation items, never silent overwrites |
| Subsidiary-facing surface | Subsidiary users work in their own organization's scope; a dedicated subsidiary dashboard/section keeps their views clean, and senior roles that need parts of HQ data are granted by ACL organization grants later (config, not code) | Any field-level partial sharing that ACL grants cannot express becomes an app-owned read route behind its own feature — reserved, not built now |
| Procurement payment | No approval, no terms/ageing; 定金 then 尾款, paid in full or in parts | Order status carries a derived payment state (unpaid / deposit paid / partially paid / paid); no AP ledger entity |
| Language | zh + en now, other locales after the flow is complete | Product copy and UI strings use the module's locale overlays; `translations` covers product content |
| Compliance | EUDR not applicable (no EU sales) | `eudr` stays disabled; revisit only if sales regions change |
| Logistics tracking | Forwarder real-time feed when available, otherwise milestones (已揽收 / 出口报关 / 在途 / 到港 / 清关 / 入海外仓) | Shipment document stores the current milestone plus an event history; real-time feed is an optional enrichment |
| Intercompany settlement | Required (采购应付 / 内部结算价 / 平台回款 / 汇率) | Settlement records are app-owned; no shipped intercompany concept exists |

**Platform facts behind the visibility mechanism** (read this session from the installed packages):

- `Organization` carries `parent_id`, `root_id`, `tree_path`, `depth`, `ancestor_ids`, `child_ids`, `descendant_ids` (`@open-mercato/core/src/modules/directory/data/entities.ts`).
- `resolveOrganizationScope` loads the actor's ACL, takes its `organizations` list, and expands every entry with its descendants (`expandWithDescendants`, `@open-mercato/core/src/modules/directory/utils/organizationScope.ts`); `isSuperAdmin`/"all organizations" is the only unrestricted case.
- The shared CRUD factory accepts `organizationIds: string[]` from that scope, so app-owned routes built with `makeCrudRoute` inherit "own organization + descendants" filtering — 总部用户被授予总部组织即看到全部分公司数据，分公司用户只被授予自身则既看不到总部也看不到同级。


## Problem Statement

The business is cross-border trade plus e-commerce: the domestic entity buys from domestic suppliers, sells to its overseas subsidiaries (intercompany), and those subsidiaries sell on marketplaces. The pain is therefore not "the shipped chain is the wrong shape" but "the chain covers the trunk and stops before purchasing, cross-border transit/documentation, and marketplace settlement". The gap analysis with module-level evidence is recorded in `.ai/analysis/2026-09-21-business-model-reassessment.md`; the decision to build instead of extend/eject is the mechanism ladder's outcome, not a preference.

The shipped chain is product-master driven: `sales` requires `catalog`, quotes/orders reference catalog products by id and snapshot (`product_id`, `product_variant_id`, `catalog_snapshot`), and `wms` binds enrichers and API interceptors to catalog products and variants. Customizing the chain beyond additive extensions means either overriding surfaces one by one or ejecting the module and owning its upgrade merges — the trade-offs are recorded in `.ai/specs/2026-09-21-catalog-customization-and-eject-decision.md` and measured in `.ai/analysis/2026-09-21-catalog-eject-spike.md`. Building the app's own modules for the *missing* capabilities avoids both: the app owns code that ships in the app, the framework keeps owning its packages, and reuse keeps the trunk's invariants (库存台账、乐观锁、单据编号) instead of re-deriving them.

Two facts make this the cheap path rather than a rewrite:

- Platform capability coverage was verified: an app-owned module with entities, APIs, pages, commands, events, ACL, search, and migrations is the supported unit (`src/modules/example/README.md`, `references/surface-map.md`), and `currency_policy`/`scope_guards` already run that way in this app.
- The registry-level shrink was verified non-destructive: disabling installed business modules removes routes/nav/ACL/workers while producing **no migration and no data change** (`.ai/analysis/2026-09-21-disable-official-chain-drill.md`), so coexistence versus replacement stays an open, reversible choice.

## Overview and Success Measures

- **Primary outcome:** a named operator completes the company's real process end to end on the new module (create → progress through its states → closed), with every step gated by permissions and scoped to tenant/organization.
- **Leading indicators:** `yarn generate` registers module routes/pages/ACL/search without warnings; `yarn db:generate` output reviewed before any apply; every page renders its loading/empty/error/conflict/permission-denied states in zh.
- **Baseline:** zero app-owned business records; the flow today is either not supported by the shipped chain or is worked around outside the system.
- **Market / product reference:** mid-market ERP suites keep the master-data master and the document chain separate, with each document owning its state machine and its audit trail; adopted — separate master records, explicit state transitions, immutable posted documents. Rejected — a single do-everything table with a status string.

## Goals

- **REQ-001** — The capability lives in an app-owned module: `src/modules/<id>/` with `{ id: '<id>', from: '@app' }` in `src/modules.ts`; no installed file, generated file, or shipped migration is edited.
- **REQ-002** — Every record carries trusted `tenant_id`/`organization_id` derived from the session, fails closed when absent, and is never read or written unscoped.
- **REQ-003** — Every user-editable record exposes `updated_at`/version; every update/delete path surfaces optimistic-lock conflicts as conflicts (no silent last-write-wins).
- **REQ-004** — Mutations go through commands with validation (`data/validators.ts`); app-guard logic lives in command interceptors / mutation guards, never in ad-hoc route code.
- **REQ-005** — Every API route uses `makeCrudRoute` (or a guarded custom route) with per-method `metadata` (auth + feature) and `openApi`; every page declares its feature gate in `page.meta.ts`.
- **REQ-006** — Admin surfaces use the canonical shells (`Page`, `PageBody`, `DataTable`, `CrudForm`) with semantic tokens, full state coverage, keyboard/a11y behaviour, and narrow-width layout — no raw tables/forms/fetch, no hard-coded status colours or user strings.
- **REQ-007** — All user-visible text is localized; the app ships `zh` and `en` overlays now (further locales land after the flow is complete) and falls back to the packaged locale for anything not yet translated.
- **REQ-008** — Cross-record references store the target id plus a display snapshot where history must survive target changes; no cross-module ORM relation is introduced.
- **REQ-009** — Schema changes are produced by `yarn db:generate`, reviewed (scoped SQL + snapshot), and applied only after approval; deactivation or rollback never drops data.
- **REQ-010** — Each capability lands with self-contained integration coverage (API path + UI path + denial path), and the configured validation gate passes (`yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test`).
- **REQ-011** — External data (marketplace orders/inventory/listings/settlement, overseas-warehouse receipts and movements) arrives through `integrations` + `data_sync`-shaped connectors keyed by external id, with idempotent upserts; the app's `wms` ledger remains authoritative for stock, and every discrepancy becomes a reconciliation item rather than a silent overwrite.
- **REQ-012** — Visibility follows the organization tree: a caller granted the HQ organization sees its own organization plus every descendant; a caller granted only a subsidiary sees that subsidiary and nothing above or beside it. No route, enricher, export, or connector may widen the scope beyond the ACL-derived organization set.
- **REQ-013** — Subsidiary users get a surface of their own (dashboard/section) that shows only their organization's data; widening for a senior role happens through ACL organization grants, and any field-level partial sharing that grants cannot express is implemented as its own feature-gated read route rather than an ad-hoc exception.
- **REQ-014** — Procurement payments are stage-based (定金/尾款, paid in full or in parts): the order exposes a derived payment state and outstanding balance, and no approval or ageing workflow is introduced.

## Non-goals

- Re-implementing what the trunk already provides: product master (with its export fields), customer master, the intercompany sales document chain, warehouse ledgers/reservations/movements, currencies, organizations. Those are reused, never rebuilt.
- Modifying or ejecting installed modules; the catalog/sales/wms decision stays in its own spec.
- Marketplace connectors written as bespoke API clients outside `integrations` + `data_sync`; the installed `sync_akeneo` module is the reference shape.
- Cross-module ORM relations, shared transactions with installed tables, or reading another module's entities without an explicit seam (id/snapshot, event, extension table, optional DI).
- Running seed/demo data in the app database, or granting new ACL features to roles as part of this change (fail closed by default).
- Providers, integrations, AI agents, or portal surfaces unless Q-005/Q-006 name them — each is its own routed capability with its own skill.
- A general migration off the installed chain: this spec builds the app's flow; retirement of the shipped flow is a separate decision.

## Proposed Solution

One app-owned module, built as vertical slices. Each slice = entity + validators + command(s) + API route(s) + admin page(s) + ACL feature + i18n + tests, in that order, so every phase leaves a working, demoable step.

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| App-owned module, framework stays untouched | Zero upgrade tax; the app's code is the app's to change | Extend/override the shipped chain | Cannot express a different document model without ejecting the module and owning its merges |
| Commands for every mutation | Validation, interception, audit and undo come for free; routes stay thin | Direct ORM writes in route handlers | Loses interception/audit/undo and invites scope bugs |
| Id + display snapshot for references | History survives a renamed/deleted target; no cross-module coupling | ORM relations across modules | Prohibited platform-wide; couples lifecycles |
| Source of truth for master data stays open (Q-007) | Keeps the first slice shippable without integrating | Duplicating a product master immediately | Would add dual-write risk before the flow even works |

## Domain Vocabulary and Business Rules

_Pending Q-001 and Q-002._ Invariants that hold regardless of the domain:

| Term / invariant | Rule | Source of truth | Failure behaviour |
|---|---|---|---|
| scoped record | every row carries tenant + organization from the session | this module | request fails closed (401/403); never an unscoped read |
| versioned record | `updated_at` (or a version column) changes on every edit | this module's entities | concurrent edit → conflict response, no silent overwrite |
| document history | a posted/closed document's business values are immutable; corrections are new documents or explicit reversal | this module's commands | command rejects the mutation |
| reference snapshot | stored reference keeps id + display snapshot | this module | target deleted/renamed → history still renders |

## Users, Permissions, and Scope

_Pending Q-004._ Naming and default posture are fixed: one feature per capability pair `<module>.<entity>.view` / `.manage` (plus `.approve`/`.void` where the domain needs them), declared in `acl.ts`, enforced by route `metadata` and `page.meta.ts`, granted manually — every new feature starts ungranted and unreachable.

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| (pending Q-004) | | organization (session-derived) | `<module>.<entity>.*` |

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Provided by | Integration seam |
|---|---|---|---|
| Auth, session, tenant/organization resolution | reuse | `auth` + `directory` | request context / session helpers |
| Permission declaration and enforcement | reuse | ACL + route `metadata` + `page.meta.ts` | feature ids |
| CRUD API + OpenAPI | reuse | `makeCrudRoute` | per-method `metadata`/`openApi` |
| Admin shell, tables, forms, states, tokens | reuse | `@open-mercato/ui` (`Page`, `PageBody`, `DataTable`, `CrudForm`) | component contracts |
| Mutation pipeline (validate/intercept/guard/audit/undo) | reuse | command bus + interceptors + `data/guards.ts` | command ids |
| Events / subscribers / notifications | reuse | `events` + `notifications` | typed event ids |
| Background work and progress | reuse (only if Q-005 needs it) | queue workers + progress | worker contracts |
| Search and indexing | reuse (only for list-heavy records) | `query_index` + `search.ts` | search entity ids |
| Files/attachments | reuse (only if Q-003/Q-006 need them) | `attachments` | attachment links |
| Audit trail | reuse | `audit_logs` | command metadata |
| Schema evolution | reuse | `yarn db:generate` → review → `yarn db:migrate` | migrations + snapshot |
| Business records and flow | **app-own** | this module | — |

## Architecture and Data Flow

```text
/backend/<module>/**  (Page + DataTable + CrudForm, feature-gated)
        |  shared API helpers (apiCall)
        v
/api/<module>/**      (makeCrudRoute, per-method metadata + openApi, scope from session)
        |
        v
commands/<entity>.ts  (validate → interceptors/guards → persist → event)
        |
        +--> <module>.<entity>.<action> events --> subscribers / notifications / workers / index
        |
        v
data/entities.ts  (tenant + organization scoped, updated_at, soft-delete policy)
```

- **Module boundaries:** the module owns its records and their state machines; anything outside is referenced by id + snapshot.
- **Extension points kept open:** widget injection spots, enrichers, guards and component overrides stay available for later adjustments, so the module does not need to be re-opened for additive changes.
- **Compatibility:** nothing in the installed contract set changes; `yarn generate` output is the only shared artifact touched.

## User Journeys

_Pending Q-001, Q-002, Q-004._ Shape each journey must follow: operator opens the module's list → creates/advances a record → system responds with the new state and any side effect (notification, task) → recoverable failures are conflict (concurrent edit), denied permission (no navigation entry, 403 on API), and invalid transition (rejected with a message, state unchanged).

## UI and Interaction Contracts

_Pending Q-003, Q-004._ Fixed now: admin pages under `backend/**/page.tsx` (+ `page.meta.ts` for the feature gate and navigation), tabular lists via `DataTable`, record editing via `CrudForm`, reads via shared API helpers, states for loading/empty/error/conflict/success/permission-denied, light/dark and narrow-width verification, zh strings through the module overlay. Reference implementation: the capability rows of `src/modules/example/references/surface-map.md` (read only the rows whose capability matches; never copy the tree).

## Data Models

_Pending Q-003._ Mandatory shape for every app-owned entity: `id` (uuid), `tenant_id` + `organization_id` (uuid, composite scope indexes), `created_at`/`updated_at`, display/snapshot fields where the record is referenced by others, and an explicit soft-delete or immutable-after-post policy. Sensitive fields (if any) get an encryption map entry, no ad-hoc crypto.

## API, Command, and Error Contracts

_Pending Q-003._ Conventions fixed now: routes `/api/<module>/<entity>` via `makeCrudRoute` with per-method `metadata` (`requireAuth`, `requireFeatures`) and `openApi` schemas; mutations through `<module>.<entity>.create|update|delete` (plus domain transitions) executed by the command bus; standard errors — 400 validation, 401 unauthenticated, 403 feature denied, 404 out of scope or missing, 409 optimistic-lock conflict, 422 domain-rule rejection.

## Events, Jobs, Notifications, and Cross-Module Flows

_Pending Q-005._ Event ids follow `<module>.<entity>.<past-tense-action>`; subscribers are typed and idempotent; notification types are declared, gated, and localized; long-running work becomes a worker with progress, never a blocking request.

## Security, Privacy, and Compliance

- **Authorization:** feature ids only, never role names; UI hiding is never the control — the route denies independently.
- **Tenant isolation:** every read/write filters on session tenant + organization and fails closed; no system-scope path is introduced.
- **Sensitive data:** any PII or commercial data identified in Q-003 is classified, encrypted where required, redacted in logs, and covered by the module's retention/audit posture.
- **Abuse and failure modes:** enumeration (scoped 404s), replay/duplicate submit (idempotency on command or unique scoped key), concurrent edit (lock + conflict response), destructive actions (command-gated, audited, reversible or explicitly confirmed).

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | API integration | tenant + org, user with the feature | create → read → update → transition the record | persisted state, version bump, expected event | REQ-004, REQ-005 |
| TEST-002 | security | same records, user without the feature; second tenant | read/write attempts | 403 / scoped 404, no data leak in list or detail | REQ-002, REQ-005 |
| TEST-003 | concurrency | two sessions editing one record | simultaneous update | second write gets a conflict, no lost update | REQ-003 |
| TEST-004 | UI | privileged user, zh locale | exercise list + form states, light/dark, narrow width, keyboard | canonical components, complete states, no raw strings/colours | REQ-006, REQ-007 |
| TEST-005 | flow (per journey) | records positioned before each transition | drive the state machine | allowed transitions succeed, forbidden ones rejected with state unchanged | REQ-004, REQ-010 |
| TEST-006 | migration/rollback | worktree copy | `yarn db:generate` → review → apply; then rollback drill | scoped SQL only, no drops of existing tables, reversible | REQ-009 |

## Implementation Phases

### Phase 0 — Spec gate (this document)

- **Depends on:** none
- **Outcome:** scope, entities, states, roles, and reactions are fixed; the document leaves `Draft`.
- **Deliverables:** answered Open Questions; `Ready for implementation` status with the traceability table complete.
- **Exit gate:** no blocking question open; each requirement maps to a phase, a test, and an acceptance criterion.

### Phase 1 — Module skeleton and the first vertical slice (pending Q-001, Q-003)

- **Depends on:** Phase 0 exit gate
- **Outcome:** the module exists, registers, and one record can be created, listed, edited, and permission-gated end to end.
- **Deliverables:** `index.ts`, `acl.ts`, `setup.ts`, `data/{entities,validators}.ts`, one `api/**/route.ts`, `backend/**/{page.tsx,page.meta.ts}`, `translations.ts` + `i18n/zh.json`, first migration (generated, reviewed, approved), TEST-001/002/004 for that entity.
- **Validation:** `yarn generate`, review `yarn db:generate` output, focused tests, browser pass over the slice.
- **Exit gate:** an operator with the feature completes create/list/edit; a user without it sees no navigation and gets 403; no installed file changed.

### Phases 2+ — one phase per document/state-machine step, then reactions (pending Q-002, Q-005, Q-006)

- **Depends on:** previous phase exit gate
- **Outcome:** each phase adds one complete step of the real process (a document, a transition, an approval, a notification).
- **Deliverables:** per phase — entities/commands/routes/pages for that step, its ACL features, its events and subscribers, its tests.
- **Exit gate:** the journey step works end to end with its own evidence; prior steps still pass.

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | module registration | `src/modules.ts` entry | 1 | TEST-001 | AC-001 |
| REQ-002 | all surfaces | scope columns + filters | 1 | TEST-002 | AC-002 |
| REQ-003 | edit paths | version column | 1 | TEST-003 | AC-003 |
| REQ-004 | mutations | commands + interceptors | 1+ | TEST-001, TEST-005 | AC-004 |
| REQ-005 | API + pages | route `metadata`, `page.meta.ts` | 1+ | TEST-002 | AC-005 |
| REQ-006 | admin surfaces | canonical shells | 1+ | TEST-004 | AC-006 |
| REQ-007 | all text | i18n overlay | 1+ | TEST-004 | AC-007 |
| REQ-008 | references | id + snapshot | 2+ | TEST-005 | AC-008 |
| REQ-009 | schema | migrations + snapshot | 1+ | TEST-006 | AC-009 |
| REQ-010 | whole module | integration tests | 1+ | TEST-001…TEST-006 | AC-010 |

Extension-surface traceability rows (added surface → reference file in `src/modules/example/**` → mechanism classification) are completed per phase when Q-001…Q-003 fix the concrete surfaces; inventing them now would fabricate the plan.

## Rollout, Migration, and Rollback

No database object changes before Phase 1's reviewed migration. Rollback per phase: revert the module's routes/pages (deleting the files removes them from the registry at the next `yarn generate`); migrations are never edited or reverted destructively — tables stay, and the registry decides what runs. Deployment, if any, follows the app's existing build/deploy path; this spec introduces no new runtime service unless Q-005/Q-006 require one.

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| Scope creep into a second master-data system | Two sources of truth for the same entity | Q-007 decides the reference policy per record; references by id + snapshot only | Reconciliation effort if the installed chain is later retired |
| Business rules underspecified at phase boundaries | Rework of schema/state machine | Phase 0 gate plus per-phase exit gates; transitions tested before the next phase starts | Late discovery of an unmodelled state |
| Optimistic-lock and idempotency gaps on rapid multi-user edits | Lost updates, duplicate documents | TEST-003 plus scoped unique keys on document numbers | Operational duplicate cleanup |
| Permission model drift (feature ids invented ad hoc) | Un-grantable or over-broad access | One naming convention, declared in `acl.ts`, enforced in both route and page | Grant mistakes by admins |
| i18n/a11y treated as polish | Untranslated or inaccessible surfaces ship | REQ-006/REQ-007 are phase exit criteria, not a closing task | Long-tail copy outside the overlay |
| Installed modules left enabled but unused | Confusing navigation for operators | The shrink drill is already proven reversible; decide after the first vertical slice lands | Operator confusion until then |

## Acceptance Criteria

- [ ] **AC-001** — the module appears in the registry as `from: '@app'`; no installed file, generated file, or shipped migration was edited.
- [ ] **AC-002** — cross-tenant and cross-organization reads/writes fail closed on every path (API and page).
- [ ] **AC-003** — concurrent edits produce a conflict, never a silent overwrite.
- [ ] **AC-004** — every mutation is command-mediated and interceptable; forbidden transitions leave state unchanged.
- [ ] **AC-005** — every route declares per-method auth + feature metadata and OpenAPI; every page declares its gate.
- [ ] **AC-006** — surfaces use canonical shells with complete loading/empty/error/conflict/keyboard/a11y/narrow-width/light-dark coverage.
- [ ] **AC-007** — no hard-coded user-facing string or status colour; zh overlay covers the shipped surfaces.
- [ ] **AC-008** — references render display names/snapshots; raw ids never appear in the UI.
- [ ] **AC-009** — migrations are generated, reviewed, and approved; rollback never drops existing data.
- [ ] **AC-010** — each phase ships with self-contained integration coverage and the validation gate passes.

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | `AGENTS.md`, `.ai/guides/{architecture,contracts,backend-ui,spec-delivery}.md`, `om-spec-writing` |
| Data models, APIs, events, UI, and tests are internally consistent | blocked | pending Q-001…Q-003 |
| Every workflow completes end to end without a catch-all integration phase | blocked | phases 2+ depend on Q-001/Q-002 |
| Platform-native reuse and extension points were chosen before custom code | pass | Reuse and Ownership Map |
| UI contracts identify references, canonical components, and theme/state coverage | blocked | pending Q-003/Q-004 |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | partial | Phase 0/1 complete; 2+ depend on the answers |

Verdict: `Blocked — Q-001 through Q-008 unanswered`.

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-001 | Primary records and the chain between them | product owner | yes | pending |
| Q-002 | State machines, transitions, numbering | product owner | yes | pending |
| Q-003 | Mandatory fields and their types | product owner | yes | pending |
| Q-004 | Roles and per-role capabilities | product owner | yes | pending |
| Q-005 | Notifications/reminders and background work | product owner | yes | pending |
| Q-006 | External integrations (files, email, APIs, providers) | product owner | yes | pending |
| Q-007 | Visibility of installed catalog/sales data from the new module | product owner + architect | yes | pending |
| Q-008 | One capability or several (split test) | architect | yes | **resolved 2026-09-21**: three independently shippable specs — `purchasing` (no external dependency, first), `cross_border` (shipment/in-transit/export documents), `platform_ops` (marketplace connectors + settlement) |
| Q-009 | Multi-entity model and master-data sharing across organizations | product owner + architect | yes | **resolved 2026-09-21**: one tenant, HQ root + subsidiary children, descendant-only visibility; mechanism verified in `directory` |
| Q-010 | Marketplace/logistics connectivity: API, files, or third-party service | product owner | yes | **partly answered**: both sides expose APIs; pull-model mirror confirmed; adapter shape and credential location still open |
| Q-011 | Procurement payment model | product owner | no | **resolved**: 定金/尾款, full or partial, no approval, no ageing |
| Q-012 | Language, compliance, logistics tracking | product owner | no | **resolved**: zh + en first; EUDR out; tracking = real-time if available else milestones |
| Q-013 | Domestic physical handling before export | product owner | no | **resolved**: none → no domestic warehouse node |
| Q-014 | Subsidiary access to the system and to shared master data | product owner | no | **resolved**: subsidiaries use the system within their own organization; senior-role widening by ACL grants later; field-level sharing reserved as a feature-gated read route |

## Changelog

| Date | Change |
|---|---|
| 2026-09-21 | Initial skeleton: platform reuse map, mandatory invariants, phase skeleton, test matrix; Open Questions gate opened |
| 2026-09-21 | Re-scoped after the owner confirmed the real business model (domestic purchasing → overseas subsidiaries → marketplace e-commerce): trunk reused, build targets the gaps only; Q-001 retargeted, Q-009…Q-012 added |
| 2026-09-21 | Owner answers applied: chain v2 (no domestic warehouse), organization/visibility mechanism verified against the installed `directory` + CRUD-factory scope path, platform/3PL treated as sync inputs with the app's `wms` ledger authoritative; REQ-011/REQ-012 added, Q-013/Q-014 opened |
