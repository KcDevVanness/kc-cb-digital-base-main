# App-owned Party Master (`parties`)

**Date**: 2026-09-22
**Status**: Implemented — Phases 1–3 shipped and verified 2026-09-22 (Phase 4 remains deferred on Q-P-004)

> Owner decisions this spec implements: `docs/dev/business-architecture.md` (已定决策与依据 →
> 交易对手方主数据 = 自建 `parties`; 开放问题 → `parties` 的建模与迁移路径, 2026-09-22).
> Gate answers applied: Q-P-000 split confirmed · Q-P-001 subsidiaries **included** ·
> Q-P-002 greenfield, no data migration, test data written fresh · Q-P-003 field list supplied by the
> owner · Q-P-004 deferred behind a reversible seam · Q-P-005 currency pickers re-pointed ·
> Q-P-006 keep `supplier | customer` · Q-P-007 encryption follows the recommendation below.
> Independent of [`.ai/specs/2026-09-22-product-variants.md`](2026-09-22-product-variants.md).

## TLDR

Author an app-owned `parties` module as the single counterparty master for every trading party this
business has — overseas buyers, overseas subsidiaries (分公司, which are also the internal-sale
counterparty), and service providers (货代 / 报关行 / 银行 / 认证机构). A party carries exactly the
block the business already uses on its paperwork: 客户名称, 联系人, 联系人电话, 地址, 城市, 邮箱, and
one or more bank blocks (Beneficiary Bank / Beneficiary Number / SWIFT CODE / Bank add), plus role
rows that say what the party *is* in a given deal. `trade_docs` stops reading `customers/companies`
for the counterparty picker; the five currency dropdowns stop depending on a `customers`-hosted
route. Because this is still the development stage, **no data migration is performed** — `customers`
rows are not carried over and test data is written through the new module. `customers` stays
registered (its funnel pages are already hidden) because `sales` declares
`requires: catalog, customers, dictionaries` and the internal-sale chain keeps writing
customer-scoped documents.

## Problem Statement

1. **Half the installed CRM is unusable here.** `customer_deal`, `customer_pipeline*`,
   `customer_deal_stage_transition`, `/backend/calendar`, `/backend/customer-tasks` model lead
   generation (拓客); this is an internal foreign-trade department executing orders for group
   companies. Those pages are already hidden (`navHidden` / `null` in `src/modules.ts`).
2. **The remaining half does not fit the parties we have.** `customer_entity` + person/company
   profiles carry 25 entities, 8 field-level encryption maps and 21 ACL features for a CRM model
   whose lifecycle (lead → deal → won) is not ours. A forwarder, a broker and a bank are not CRM
   companies; their attributes (tracking, declarations, accounts) have no home there.
3. **The seam is already load-bearing.** `trade_docs` reads `GET /api/customers/companies` as the
   customer side of its counterparty picker (`src/modules/trade_docs/components/formOptions.ts:16`,
   used by `ContractForm.tsx` / `InvoiceForm.tsx`), and five app surfaces read
   `GET /api/customers/dictionaries/currency` — a route hosted by `customers`, gated by
   `customers.people.view`, whose data actually lives in the `dictionaries` module
   (`docs/dev/business-architecture.md` → 自建模块对官方模块的消费清单).
4. **The paperwork block is the requirement.** Export contracts and invoices print a fixed party
   block (name, contact, phone, address, city, email) and a bank block (Beneficiary Bank,
   Beneficiary Number, SWIFT CODE, Bank add) — the owner supplied exactly this list at the gate.

## Overview and Success Measures

- **Primary outcome:** an operator creates a party (buyer, branch or service provider) on
  `/backend/parties` with its contact, address and bank block, and picks it as the counterparty when
  issuing a `trade_docs` contract or invoice — without touching `customers`.
- **Leading indicators:** `GET /api/parties` returns scoped rows with decrypted display names;
  `GET /api/parties/options` feeds the `trade_docs` picker; the five currency dropdowns list the same
  16 codes as before, now from an app-owned option source; no new navigation entry appears under
  CRM.
- **Baseline:** counterparties come from `customers.companies`; service providers have no record at
  all; five currency pickers break if `customers` is ever deregistered.
- **Market / product reference:** Odoo's `res.partner` (one partner table + type flags + child
  address/bank records) and ERPNext's Party/Contact/Address/Bank Account. Adopted: a single party
  table with role rows and a bank child table, display-name pickers, snapshot on documents. Rejected:
  SAP-style separate customer/vendor masters (duplicate identity for one legal entity) and a
  per-kind table set (a party changes kind between deals).

## Goals

- **REQ-P-001** — `parties` is registered in `src/modules.ts` (`from: '@app'`) and owns
  `parties_parties`, `parties_roles`, `parties_bank_accounts`; every row carries `tenant_id` +
  `organization_id` derived from the session and `updated_at` as the optimistic-lock version.
- **REQ-P-002** — A party stores exactly the owner-supplied block: `code` (unique per
  organization), `name` (客户名称), `country_code`, `status`, `contact_name` (联系人),
  `contact_phone` (联系人电话), `email` (邮箱), `address_line1` (地址), `city` (城市), plus zero or
  more bank rows (`beneficiary_bank` 银行, `account_number` Beneficiary Number, `swift_code`
  SWIFT CODE, `bank_address` Bank add, one marked default).
- **REQ-P-003** — Role rows are free-form within a fixed vocabulary: `buyer` | `consignee` |
  `branch` | `forwarder` | `broker` | `bank` | `certifier`. A branch party is a first-class party
  (Q-P-001), and one party may hold several roles.
- **REQ-P-004** — The party's sensitive columns are encrypted at rest through a module-owned
  encryption map, mirroring the installed `customers` precedent; `code`, `country_code`, `status`
  and role values stay plain for indexing and list filtering.
- **REQ-P-005** — `GET /api/parties/options` is a scoped option source (display name + code, no raw
  ids in the UI) that `trade_docs` uses for the `customer` side of its counterparty picker; the
  stored `counterparty_kind` vocabulary stays `supplier | customer` (Q-P-006) and buyers/branches map
  to `customer`.
- **REQ-P-006** — The five currency pickers (`products`, `purchasing` ×2, `trade_docs`,
  `platform_ops`) read an app-owned currency option source backed by the `dictionaries` module, and
  no longer depend on a `customers`-hosted route or on `customers.people.view` (Q-P-005).
- **REQ-P-007** — No data migration: `customers` tables and historical document snapshots are
  untouched; the operator writes test data through the new module (Q-P-002). The `customers` module
  stays registered and keeps serving the internal-sale chain.
- **REQ-P-008** — Service-provider-specific attributes are deferred (Q-P-004): `parties_roles`
  carries a nullable `attributes` JSONB reserved for them, and no per-kind table is authored in this
  spec.
- **REQ-P-009** — The module ships list/create/edit/detail pages under `/backend/parties` with the
  canonical shell, localized zh/en strings, and complete loading/empty/error/conflict/permission
  states; create/edit/detail are `navHidden`.
- **REQ-P-010** — ACL features `parties.view` and `parties.manage` gate every route and page;
  ungranted users get 403 and no navigation entry (fail closed).

## Non-goals

- Migrating or deleting `customers` data; editing installed packages, generated files or shipped
  migrations.
- Re-pointing installed `sales` documents at `parties` — `sales` stores its customer reference on its
  own tables and is not forked by this spec. The internal-sale counterparty keeps living in
  `customers`; `parties` records the branch as a party for our own documents and pickers.
- Per-kind service-provider tables, tracking/label integration, bank integrations (Q-P-004).
- `purchasing_purchase_order_lines.customer_id` (introduced by
  [`.ai/specs/2026-09-22-order-file-and-export-finance.md`](2026-09-22-order-file-and-export-finance.md)
  REQ-A1): it keeps the scalar-id + snapshot contract, so re-pointing it at `parties` is a
  one-constant change owned by whichever spec lands second.
- Product/variant work (separate spec), and any `wms` behaviour.

## Proposed Solution

An app-owned `parties` module with three tables and one option source:

```text
/backend/parties (list, create, edit, detail)
        │  CrudForm / DataTable  →  /api/parties            (makeCrudRoute, commands)
        │                              └─ parties_parties ── parties_roles
        │                                                 └─ parties_bank_accounts
trade_docs counterparty picker ────► /api/parties/options      (display name + code, scoped)
five currency dropdowns ───────────► /api/currency_policy/currencies (dictionaries-backed)
```

- The party is one aggregate: roles and bank accounts are submitted with the party payload and
  replaced inside the same command (upsert + deactivate-missing), the pattern
  `products` already uses for its price rows.
- References stay scalar id + snapshot (`AGENTS.md`: no cross-module ORM relations), matching
  `trade_docs`' existing `counterparty_id` / `counterparty_snapshot`.
- The currency option source lives in `currency_policy`, the app module that already owns the
  currency dictionary policy and already `requires: currencies, dictionaries, customers`.

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| One `parties` table + role rows + bank child rows | One legal entity can be buyer *and* branch *and* consignee; the bank block is the only part that is genuinely multi-valued | Table per party kind; roles as a text column on the party | Duplicate identity; a text column cannot express "forwarder *and* broker" with per-role attributes |
| Bank block as a child table, one row marked default | Buyers change banks; the invoice block must name one | Columns on the party | A second account forces a schema change |
| Roles and bank accounts written by the party command | One transactional aggregate, one optimistic-lock version, one audit trail | Separate CRUD routes per child | Three versions to reconcile in one form; more surface than the requirement needs |
| Deferred attributes as nullable `attributes` JSONB on the role row | Q-P-004 is open; a nullable column is additive and reversible | Per-kind extension tables now | Builds a model for a requirement nobody has specified yet |
| No data migration (greenfield) | Owner: development stage, data can be wiped, test data written fresh | Migrate `customers.companies` with an id map | Decrypt → re-encrypt of 5 encrypted columns plus id remapping for zero business value at this stage |
| Keep `supplier \| customer` in `trade_docs` | The stored value drives existing list filters and is part of the document contract; role detail belongs to `parties` | Add a third kind | Contract change with no requirement behind it |
| Currency pickers read an app-owned option source | Removes the last `customers`-hosted dependency from five surfaces and drops the `customers.people.view` gate | Keep calling `/api/customers/dictionaries/currency` | Leaves `customers` load-bearing for pages that have nothing to do with CRM |
| Encrypt the party block | Mirrors the installed precedent (`customers` encrypts address/company/person/contact fields) and protects bank details, which are payment-fraud sensitive | Plain columns | A database dump would expose counterparty bank accounts |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| party | one legal entity we trade with or through | `parties_parties` | — |
| party code | operator-facing short code, unique per organization, plain text | `parties_parties.code` | duplicate → 409, no partial write |
| role | what the party is in a deal: `buyer` \| `consignee` \| `branch` \| `forwarder` \| `broker` \| `bank` \| `certifier` | `parties_roles.role` | unknown value → 400 |
| branch party | a group subsidiary; also the counterparty of the internal sale (whose documents stay in `customers`) | this module + `customers` | — |
| default bank account | at most one per party; the block printed on documents | `parties_bank_accounts.is_default` | second default in one payload → 400 |
| party snapshot | display copy frozen on a document at issue time | consumer module (`trade_docs`, …) | renaming the party never rewrites issued documents |
| greenfield | no `customers` row is read, copied or deleted by this module | this spec | — |
| scoped record | every row carries tenant + organization from the session; reads expand to descendant organizations, writes act in the selected one | this module | fail closed (401/403); never an unscoped read |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| operator (单证/采购) | create, edit, list, pick parties | organization (session-derived, descendant reads) | `parties.view`, `parties.manage` |
| administrator | grant the features to roles; no UI of its own | organization | `auth.roles.manage` (installed) |
| user without a grant | no navigation entry, 403 on API | — | — |
| `trade_docs` operator | picks a party in the counterparty field | inherits `trade_docs` features + `parties.view` | `trade_docs.contracts.manage`, `parties.view` |

Trusted `tenantId` / `organizationId` come from the authenticated session on every path; the module
performs no system-scope operation. `parties.acl.ts` declares `dependsOn: ['currencies.view']` for
the currency option source's consumer side only if the implementation gates that route with an
installed feature (see API contracts).

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| Party identity, roles, bank block | **app-own** | `parties` (new) | — | The CRM model does not fit; the block is business-specific |
| Currency codes | reuse | `dictionaries` | scoped read + app-owned option route | One authority for currency codes; already the store behind every picker |
| Currency master / FX | reuse | `currencies` | scalar `currency_code` on bank rows when needed | Already owned; `currency_policy` reconciles it |
| Organization scope & visibility | reuse | `directory` | `resolveOrganizationScopeForRequest` | Established scope mechanism |
| Attachments (scans) | reuse (later) | `attachments` | attachment id on a party or document | Only if a party needs stored scans; not required by this spec |
| Audit / search | reuse | `audit_logs`, `query_index`, `search` | command audit + `search.ts` config | No parallel logging or index |
| Internal-sale counterparty | reuse (unchanged) | `customers` | scalar id on installed `sales` tables | `sales` is not forked by this spec |
| Document-side counterparty snapshot | reuse (unchanged) | `trade_docs` | `counterparty_id` + `counterparty_snapshot` | Keeps issued documents immutable |

## Architecture and Data Flow

```text
operator ──► /backend/parties (DataTable + CrudForm)
                 │  apiCall → /api/parties (makeCrudRoute)
                 │                 └─ commands: parties.parties.create|update|delete
                 │                        ├─ parties_parties
                 │                        ├─ parties_roles        (replace semantics)
                 │                        └─ parties_bank_accounts (replace semantics, one default)
                 │                 └─ events: parties.party.created|updated|deleted → crud indexer
                 └─ picker ──► /api/parties/options  (scoped, display name + code)

trade_docs contract/invoice form ──► /api/parties/options        (replaces customers/companies)
products | purchasing ×2 | trade_docs | platform_ops ──► /api/currency_policy/currencies
                                                          └─ scoped read of dictionaries
```

- **Module boundaries:** `parties` owns counterparty identity, its roles and its bank block. It does
  not own documents, prices, or currency codes, and it never reads another module's tables at
  command time except the scoped `dictionaries` read behind the currency option source.
- **Extension points:** nothing installed is modified. The currency option source is added to
  `currency_policy` (an app module) rather than overriding a `customers` route, so no installed
  contract changes; `customers`' route stays available for anything still calling it.
- **Alternatives considered:** putting the party master inside `trade_docs` (rejected: three modules
  need counterparties); overriding the `customers` dictionary route to point at `dictionaries`
  (rejected: an override replaces a route we would then have to maintain, and the gate is still a
  `customers` feature).
- **Compatibility:** `trade_docs` keeps `counterparty_id` / `counterparty_snapshot` and its
  `supplier | customer` vocabulary; historical snapshots keep rendering. `customers` behaviour is
  unchanged. The five currency pickers keep the same option shape (`value` = code, `label` = label)
  so their forms do not change.

## User Journeys

### Journey J-001 — Create a buyer and use it on a contract

1. Operator opens `/backend/parties`, presses 新建, fills 客户名称/联系人/联系人电话/邮箱/地址/城市,
   adds the bank block (Beneficiary Bank, Beneficiary Number, SWIFT CODE, Bank add) and selects the
   roles `buyer` (a branch would add `branch`).
2. Save → `POST /api/parties` creates the party, its roles and its default bank account in one
   transaction; the list shows the new row with its display name.
3. Operator opens `trade_docs` → 新建合同, types a few characters in 对方, and the picker (fed by
   `/api/parties/options`) offers the party by display name; the snapshot is stored on the contract.
4. Failure path: duplicate `code` → 409 with the code named, form keeps input; missing
   `parties.manage` → 403 and the page shows the permission state; a stale edit → 409 conflict.

### Journey J-002 — Record a service provider without building its integration

1. Operator creates a party with role `forwarder` (name, contact, address, no bank block).
2. The party is immediately usable as a picker option and in filters; its forwarder-specific fields
   stay absent until Q-P-004 is answered (the `attributes` column is present but unused).

### Journey J-003 — Currency dropdown still works without CRM

1. A user without any `customers.*` grant opens `/backend/products/items/create`.
2. The 币种 dropdown lists the same 16 codes as before, now served by
   `/api/currency_policy/currencies`; nothing calls a `customers`-hosted route.

## UI and Interaction Contracts

Closest existing app-owned reference: `/backend/purchasing/suppliers`
(`src/modules/purchasing/backend/purchasing/suppliers/page.tsx` +
`src/modules/purchasing/components/SuppliersTable.tsx` / `SupplierForm.tsx` — a master with a
contact block and a currency picker). Rules: `.ai/guides/backend-ui.md` (canonical shell, DataTable,
CrudForm, shared API helpers, semantic tokens, complete states). Implementation must invoke
`om-backend-ui-design`.

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/parties` | list parties (code, name, country, roles, default bank label), search/filter, create action, row → edit/detail | `GET /api/parties` | `/backend/purchasing/suppliers` | `Page`, `PageBody`, `DataTable` + `RowActions`, `StatusBadge` for `status` | loading, empty, error, permission denied, conflict on delete | REQ-P-001, REQ-P-009, REQ-P-010 |
| `/backend/parties/create` | create a party: identity + contact/address + roles + bank block | `POST /api/parties` | `SupplierForm.tsx` | `CrudForm` with grouped fields | validation error, server error, duplicate code (409), permission denied | REQ-P-002, REQ-P-003 |
| `/backend/parties/[id]/edit` | edit, clear nullable fields, delete | `PUT/DELETE /api/parties` | `SupplierForm.tsx` | `CrudForm` + `updatedAt` conflict handling + confirm dialog | conflict (409), cleared field round-trip, delete confirmation | REQ-P-002, REQ-P-009 |
| `/backend/parties/[id]` | read-only detail incl. bank block and roles | `GET /api/parties` | `purchasing` supplier detail | `Page`, `PageBody`, `SectionHeader` | loading, error, permission denied | REQ-P-009 |
| picker field in `trade_docs` contract/invoice forms | select counterparty by display name | `GET /api/parties/options` | existing `formOptions.ts` picker | shared picker + `apiCall` | loading, empty, error | REQ-P-005 |

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| 单证/采购 operator | 基础数据 → 交易对手方 (`parties.nav.group`) | none in this spec | login → 交易对手方 → 新建, 2 clicks |
| administrator | 配置 → 角色权限 (installed) | none | login → 角色, grant `parties.*` |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| `/backend/parties` | localized "还没有交易对手方" + 新建 action | table collapses to the shared narrow layout | row actions reachable by keyboard; search focus order preserved |
| party form | group headings 基本信息 / 联系与地址 / 角色 / 银行信息 | fields stack at narrow width | Cmd/Ctrl+Enter submit, Escape cancel, first invalid field focused |

### `/backend/parties` — 交易对手方

```text
┌──────────────────────────────────────────────────────────────┐
│ 交易对手方                                    [新建交易对手方] │
│ [搜索 编码]                            [编码 ⇅] [状态]        │
├──────────────────────────────────────────────────────────────┤
│ DataTable: 编码 | 名称 | 国家 | 联系人 | 状态 | 操作          │
├──────────────────────────────────────────────────────────────┤
│ 分页 / 列设置 / 导出                                          │
└──────────────────────────────────────────────────────────────┘
```

Roles and the bank block are shown on the **detail** page, not in the list: the CRUD factory projects a
single table, so a child-row column would need a bespoke aggregate read (recorded as a follow-up in the
Changelog rather than built speculatively).

- **Behavior:** server-side search/sort/pagination through the factory; delete behind
  `useConfirmDialog`; a 409 surfaces as the shared conflict message and keeps the form open.
- **Responsive and accessibility:** focus order follows the visual order; icon-only controls carry
  accessible labels; the roles multi-select announces selection changes.
- **Localization:** `parties.*` keys in `src/modules/parties/i18n/{zh,en}.json`; no literal strings.
- **Design-system and theming:** semantic tokens and `StatusBadge` only; light and dark verified;
  no hard-coded palette values.

## Data Models

### `parties_parties` (`parties:party`)

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | uuid, required | primary key | no | immutable |
| `tenant_id`, `organization_id` | uuid, required | composite scope index | no | trusted context only |
| `code` | text, required | unique per organization (incl. soft-deleted) | no | duplicate → 409 |
| `name` | text, required | — | **yes** (客户名称) | 1..200 chars |
| `country_code` | text, nullable | index | no | ISO-3166 alpha-2 when set |
| `status` | text, default `active` | index | no | `active` \| `inactive` |
| `contact_name` | text, nullable | — | **yes** | — |
| `contact_phone` | text, nullable | — | **yes** | — |
| `email` | text, nullable | — | **yes** | basic shape check |
| `address_line1` | text, nullable | — | **yes** (地址) | — |
| `address_line2` | text, nullable | — | **yes** | additive, for 楼层/房间 |
| `city` | text, nullable | — | **yes** (城市) | — |
| `created_at`, `updated_at`, `deleted_at` | timestamps | `updated_at` = lock version | no | soft delete |

### `parties_roles` (`parties:party_role`)

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | uuid, required | primary key | no | immutable |
| `tenant_id`, `organization_id` | uuid, required | composite scope index | no | trusted context only |
| `party_id` | uuid, required | index, same-module `@ManyToOne` (cascade delete) | no | — |
| `role` | text, required | unique `(party, role)` | no | one of the seven values |
| `attributes` | jsonb, nullable | — | no | reserved for Q-P-004; unused in this spec |
| `created_at`, `updated_at` | timestamps | — | no | replace semantics inside the party command |

### `parties_bank_accounts` (`parties:party_bank_account`)

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | uuid, required | primary key | no | immutable |
| `tenant_id`, `organization_id` | uuid, required | composite scope index | no | trusted context only |
| `party_id` | uuid, required | index, same-module `@ManyToOne` (cascade delete) | no | — |
| `beneficiary_bank` | text, required | — | **yes** (Beneficiary Bank) | — |
| `account_number` | text, required | — | **yes** (Beneficiary Number) | no format assumption (IBAN/local mixed) |
| `swift_code` | text, nullable | — | **yes** (SWIFT CODE) | 8 or 11 chars when set |
| `bank_address` | text, nullable | — | **yes** (Bank add) | — |
| `is_default` | boolean, default false | partial unique `(party) where is_default` | no | at most one per party |
| `created_at`, `updated_at`, `deleted_at` | timestamps | — | no | soft delete |

**Migration and retention:** three new tables with indexes only — no drop, no alter of existing
objects; generated with `yarn db:generate`, reviewed, and applied only after explicit approval
(`yarn db:migrate`). Soft delete keeps history; encrypted columns are listed in the module's
`encryption.ts` map so reads decrypt and writes encrypt automatically. Because encrypted columns
cannot back a database-level unique index, a plaintext sort or a `LIKE` filter (`.ai/guides/contracts.md`
forbids `$ilike` on an encrypted column), `code` is the unique lookup key and the list filters on
`code` / `country_code` / `status` **only**; searching by 客户名称 is deliberately deferred and tracked
as Q-P-008 (it needs either a plaintext projection or hash-sibling columns).

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| `GET` | `/api/parties` | auth + `parties.view` | factory query (`search`, `page`, `pageSize`, `status`, `countryCode`) | `{ items, totalCount }` with decrypted party fields (roles/bank rows come from the detail read) | 400 malformed, 401/403 | REQ-P-001, REQ-P-009 |
| `GET` | `/api/parties/[id]` | auth + `parties.view` | path id (uuid) | `{ item }` — party + `roles[]` + `bankAccounts[]` + `updatedAt` | 400 malformed/scope, 404 unknown, 401/403 | REQ-P-002, REQ-P-009 |
| `POST` | `/api/parties` | auth + `parties.manage` | party payload incl. `roles[]`, `bankAccounts[]` | 201 + `parties.party.created` | 400 validation, 403, 409 duplicate `code` / two defaults | REQ-P-002, REQ-P-003 |
| `PUT` | `/api/parties` | auth + `parties.manage` | same payload + `id`, `updatedAt` | 200 + `parties.party.updated` | 404, 409 optimistic-lock, 400 | REQ-P-002 |
| `DELETE` | `/api/parties` | auth + `parties.manage` | `id`, `updatedAt` | 200 + `parties.party.deleted` | 404, 409, 403 | REQ-P-009 |
| `GET` | `/api/parties/options` | auth + `parties.view` | `search` (code), `ids`, `organizationId` | `{ items: [{ value, label }] }`, `code — name` only | 400, 401/403 | REQ-P-005 |
| `GET` | `/api/currency_policy/currencies` | auth + `currencies.view` | — | `{ entries: [{ value, label }] }` read from `dictionaries` (kept in the pickers' existing shape) | 400, 401/403 | REQ-P-006 |
| command | `parties.parties.create` | via route | validated party payload | party id + event | transaction rolls back on any child failure | REQ-P-002 |
| command | `parties.parties.update` | via route | payload + `updatedAt` | event | 409 on stale version | REQ-P-002 |
| command | `parties.parties.delete` | via route | `id` + `updatedAt` | event | 409 on stale version; soft delete | REQ-P-009 |

All routes use `makeCrudRoute` except the two option sources, which are small custom guarded routes
(`api.custom-route` shape). Every route declares per-method `metadata` and `openApi`; roles and bank
accounts are replaced inside the party command (upsert + deactivate/soft-delete missing), so no
separate child endpoints exist.

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| `parties.party.created` / `.updated` / `.deleted` | `parties` commands | search index (crud indexer), audit trail | index row refreshed; audit entry per command | command-level idempotency: create is unique by `code`; update/delete guarded by `updatedAt` |
| party rename | `parties` command | — (documents keep snapshots) | none | issued documents are immutable by design |

No workers, no scheduled jobs, no notifications in this spec.

## Security, Privacy, and Compliance

- **Authorization:** `parties.view` / `parties.manage` on every route and page; no role-name checks.
  The currency option source is gated by the installed `currencies.view`.
- **Tenant isolation:** every read/write derives `tenantId` + `organizationId` from the session and
  fails closed; reads expand to descendant organizations, writes act in the selected organization
  (lesson `read-expands-writes-are-selected-org`).
- **Sensitive data:** the party block and the bank block are encrypted at rest through the module's
  encryption map (mirroring `customers`' 8 maps); no hand-rolled crypto; `code` stays plaintext so
  lookups, uniqueness and audit references keep working. Retention follows the platform's soft-delete
  policy; no credential or token is stored.
- **Abuse and failure modes:** duplicate codes rejected (409); a second default bank rejected (400);
  stale writes rejected (409); enumeration limited by scope + feature gates; no endpoint accepts a
  client-computed scope.

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | integration (API) | tenant + two organizations, operator with `parties.manage` | create a party with 2 roles + 2 bank accounts (one default), list, update (rename + replace banks), delete | 201/200; roles and banks replaced, not duplicated; list shows decrypted name; delete soft-deletes; events emitted | REQ-P-001…REQ-P-003, REQ-P-009 |
| TEST-002 | security | second organization + a user without `parties.*` | read/write across organizations; write without feature | 403/401 fail closed; no row leaks; no navigation entry | REQ-P-010 |
| TEST-003 | integration (encryption) | one party | read the raw row via a scoped Kysely query; read via API | ciphertext at rest, plaintext through the API; `code`/`country_code`/`status` plaintext | REQ-P-004 |
| TEST-004 | integration (pickers) | party + a `trade_docs` contract; user without any `customers.*` grant | create a contract picking the party; open the five currency dropdowns | contract stores id + snapshot; each dropdown lists the seeded codes from the app-owned route | REQ-P-005, REQ-P-006 |
| TEST-005 | UI | records + both permission states | list/create/edit/detail incl. clear a nullable field, conflict, narrow width, light/dark | states render; cleared field round-trips; conflict surfaces and keeps input | REQ-P-009 |

## Implementation Phases

### Phase 1 — Module, data model, API

- **Depends on:** none
- **Outcome:** parties can be created, listed, updated and deleted through the API with roles, bank
  accounts, scope, encryption and ACL in place.
- **Why this order / value delivered:** the data model and its guards are the contract everything
  else consumes; a wrong model is the only expensive mistake here.
- **Deliverables:** `src/modules/parties/{index.ts,acl.ts,setup.ts,data/entities.ts,data/validators.ts,encryption.ts,commands/parties.ts,api/parties/route.ts,api/parties/options/route.ts,events.ts,search.ts,i18n/{zh,en}.json}`; migration for three tables; `src/modules.ts` entry.
- **Independent slices / estimated commits:** entities+encryption · commands+validators · routes.
- **Requirements closed:** REQ-P-001…REQ-P-005, REQ-P-008, REQ-P-010
- **Tests:** TEST-001, TEST-002, TEST-003
- **Validation:** `yarn generate`, `yarn typecheck`, focused jest, API smoke against the dev database.
- **Exit gate:** a party with roles + two banks round-trips; cross-organization access fails closed;
  encrypted columns are ciphertext at rest; `yarn generate` lists the module.

### Phase 2 — Operator UI

- **Depends on:** Phase 1 exit gate
- **Outcome:** `/backend/parties` list/create/edit/detail usable end to end in zh and en.
- **Why this order / value delivered:** the master is only real once an operator can maintain it;
  the pickers in Phase 3 need data written through the UI.
- **Deliverables:** `src/modules/parties/backend/parties/{page.tsx,page.meta.ts}`, `.../create/**`, `.../[id]/edit/**`, `.../[id]/**`, `src/modules/parties/components/{PartiesTable.tsx,PartyForm.tsx}`.
- **Independent slices / estimated commits:** table · form · detail (one commit each is acceptable).
- **Requirements closed:** REQ-P-009
- **Tests:** TEST-005
- **Validation:** browser pass (light/dark, narrow width, keyboard), `yarn ds:check`.
- **Exit gate:** an operator creates, edits (including clearing a nullable field) and deletes a party
  from the UI; conflict and permission states are observable.

### Phase 3 — Switch the consumers

- **Depends on:** Phase 2 exit gate
- **Outcome:** `trade_docs` picks counterparties from `parties`, and the five currency dropdowns no
  longer touch a `customers`-hosted route.
- **Why this order / value delivered:** this is the step that removes the old dependency; it needs
  real party rows to verify against.
- **Deliverables:** `trade_docs/components/formOptions.ts` (`COMPANIES_API_PATH` →
  `parties/options`), `currency_policy/api/currencies/route.ts` + `currency_policy/acl.ts`
  dependency note, and the five `CURRENCY_DICTIONARY_URL` constants
  (`products/components/ProductForm.tsx`, `purchasing/components/PurchaseOrderForm.tsx`,
  `purchasing/components/SupplierForm.tsx`, `trade_docs/components/formOptions.ts`,
  `platform_ops/components/ChannelForm.tsx`).
- **Independent slices / estimated commits:** trade_docs picker · currency option route + five
  constant swaps.
- **Requirements closed:** REQ-P-005, REQ-P-006
- **Tests:** TEST-004
- **Validation:** `yarn generate`, focused jest, browser pass on a contract create form and one of
  the five currency dropdowns as a user without `customers.*`.
- **Exit gate:** no app surface calls `/api/customers/dictionaries/currency` or
  `/api/customers/companies`; both dropdowns and the counterparty picker behave as before.

### Phase 4 — Service-provider attributes (deferred, Q-P-004)

- **Depends on:** owner answers Q-P-004
- **Outcome:** forwarder/broker/bank-specific fields exist in whatever shape the answer picks.
- **Deliverables:** either role-`attributes` UI + validation, or additive per-kind tables.
- **Requirements closed:** REQ-P-008 (replaces the reserved-column approach)
- **Tests:** to be written with the answer.
- **Exit gate:** not part of this spec's ready scope; the reserved column ships unused in Phase 1.

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Extension surface (reference → exact file) | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|---|
| REQ-P-001 | J-001 | three tables, module registration | `data.entities` → `src/modules/example/data/entities.ts` | 1 | TEST-001 | AC-P-001 |
| REQ-P-002 | J-001 | `POST/PUT /api/parties`, `parties.parties.*` | `commands.write` → `src/modules/example/commands/todos.ts` | 1 | TEST-001 | AC-P-002 |
| REQ-P-003 | J-002 | `parties_roles`, role vocabulary | `data.entities` → `src/modules/example/data/entities.ts` | 1 | TEST-001 | AC-P-002 |
| REQ-P-004 | J-001 | `encryption.ts` map | `data.encryption-map` → `src/modules/example/encryption.ts` | 1 | TEST-003 | AC-P-003 |
| REQ-P-005 | J-001, J-003 | `GET /api/parties/options` | `api.option-source-routes` → `src/modules/example/api/tags/route.ts` | 1, 3 | TEST-004 | AC-P-004 |
| REQ-P-006 | J-003 | `GET /api/currency_policy/currencies` | `api.custom-route` → `src/modules/example/api/organizations/route.ts` | 3 | TEST-004 | AC-P-004 |
| REQ-P-007 | J-001 | greenfield, no migration | `module.setup-role-features` → `src/modules/example/setup.ts` | 1 | TEST-001 | AC-P-005 |
| REQ-P-008 | J-002 | `parties_roles.attributes` | `data.entities` → `src/modules/example/data/entities.ts` | 1 | TEST-001 | AC-P-005 |
| REQ-P-009 | J-001 | four pages | `ui.page-shell` → `src/modules/example/backend/todos/page.tsx` | 2 | TEST-005 | AC-P-006 |
| REQ-P-010 | J-001 | `acl.ts`, page metadata | `module.acl-features` → `src/modules/example/acl.ts` | 1 | TEST-002 | AC-P-007 |
| REQ-P-001…009 | module surfaces | CRUD factory routes | `api.crud-factory` → `src/modules/example/api/customer-priorities/route.ts` | 1 | TEST-001 | AC-P-001 |
| REQ-P-001, REQ-P-005 | index + i18n | `search.ts`, `i18n/*.json` | `search.module-config` → `src/modules/example/search.ts`; `module.i18n-catalogs` → `src/modules/example/i18n/en.json` | 1, 2 | TEST-001, TEST-005 | AC-P-006 |
| REQ-P-007 | test data | CLI seed | `module.cli-command` → `src/modules/example/cli.ts` | 1 | TEST-001 | AC-P-005 |

## Rollout, Migration, and Rollback

- **Migration boundary:** `yarn db:generate` produces additive statements for three tables; review
  the scoped SQL, then apply with `yarn db:migrate` after approval. No existing object is altered.
- **Test data:** the owner writes fresh parties through the UI/API (greenfield). An optional
  `yarn mercato parties seed-demo` writes an idempotent demo set keyed by `code`; it is a dev
  convenience, not a requirement.
- **Rollout order:** Phase 1 (inert API) → Phase 2 (UI) → Phase 3 (consumer switch, the only
  user-visible change for existing flows).
- **Rollback:** revert Phase 3 constants to the previous routes (one-line change per consumer);
  de-register the module to remove routes/pages/ACL (tables and data stay). Deleting the tables is a
  separate, explicit data change.

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| Encrypted party/bank columns cannot be uniquely indexed, sorted or `LIKE`-filtered | Search is limited to `code`; sorting is limited to plaintext columns | `code` is the unique key; filters restricted to plaintext columns; Q-P-008 tracks name search | A "search/sort by 客户名称" request needs a plaintext projection or hash siblings |
| Roles/bank accounts replaced inside the party command | A concurrent edit of one child overwrites the whole aggregate | `updated_at` optimistic lock on the party + 409 on stale writes | Two operators editing different banks of one party conflict (acceptable, visible) |
| `trade_docs` picker switch changes which master new documents reference | Historical documents keep snapshots; new ones point at parties | Snapshot frozen at issue; both pickers verified in TEST-004 | Operators must re-enter parties that only existed in `customers` (accepted: greenfield) |
| Service-provider attributes deferred | Forwarder/broker specifics are not modelled yet | Reserved `attributes` column; Q-P-004 owns the follow-up | A service-provider integration may later want its own table |
| Currency option source becomes a new dependency of five pages | A wrong gate breaks five dropdowns at once | Gate on the installed `currencies.view`; ACL `dependsOn` documented; TEST-004 covers it | Roles must be granted `currencies.view` (declared as a dependency) |

## Acceptance Criteria

- [ ] **AC-P-001** — An operator with `parties.manage` creates a party with roles and a default bank
  account through `/backend/parties`; the row is readable back with decrypted values and survives a
  reload.
- [ ] **AC-P-002** — A second bank account marked default and a duplicate `code` are both rejected
  with a readable error and no partial write; replacing roles/banks on update leaves no duplicates.
- [ ] **AC-P-003** — Party and bank sensitive columns are ciphertext in the database and plaintext
  through the API; `code`, `country_code`, `status` remain plaintext.
- [ ] **AC-P-004** — A `trade_docs` contract created after this change stores a party id +
  snapshot, and all five currency dropdowns work for a user with no `customers.*` grant.
- [ ] **AC-P-005** — No `customers` row was read, copied or deleted by this change; the module
  creates its three tables and nothing else.
- [ ] **AC-P-006** — Every listed backend surface matches its recorded reference, uses the canonical
  shell/components, and covers loading/empty/error/conflict/keyboard/a11y/responsive/light/dark.
- [ ] **AC-P-007** — A user without `parties.*` sees no navigation entry and receives 403 on both
  API and page; cross-organization reads/writes fail closed.
- [ ] **AC-P-008** — Every affected API and UI path has self-contained integration coverage and the
  configured validation gate passes.

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | root `AGENTS.md`, `docs/dev/business-architecture.md`, `.ai/guides/backend-ui.md`, `.ai/guides/extensions.md`, lessons `read-expands-writes-are-selected-org`, `module-api-path-is-directory-name`, `currency-dictionary-seeding` |
| Data models, APIs, events, UI, and tests are internally consistent | pass | Data Models ↔ API contracts ↔ TEST-001…005 ↔ phases |
| Every workflow completes end to end without a catch-all integration phase | pass | J-001/J-002/J-003 land in Phases 1–3; Phase 4 is explicitly deferred and out of ready scope |
| Platform-native reuse and extension points were chosen before custom code | pass | Reuse map: `dictionaries`, `directory`, `currencies`, `audit_logs`, `query_index`, `search`; no installed file touched |
| UI contracts identify references, canonical components, and theme/state coverage | pass | `/backend/purchasing/suppliers` reference, `DataTable`/`CrudForm`, full state list |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | Phases 1–3; Phase 4 gated on Q-P-004 |

**Verdict:** `Implemented` — Phases 1–3 shipped and verified 2026-09-22 (Phase 4 deferred by design on
Q-P-004). The rows above recording `Ready for implementation` were written before delivery and are kept as
history; see the Changelog row for the shipped evidence.

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-P-004 | Service-provider attributes: JSONB on the role row, per-kind extension tables, or `entities` custom fields? | owner + architect | no (Phase 4) | deferred 2026-09-22 — reserved `attributes` column ships unused |
| Q-P-008 | Should the list offer a plaintext searchable projection of 客户名称 (needed if operators must sort by name)? | owner | no | pending — plaintext `code` search is the shipped default |

## Changelog

| Date | Change |
|---|---|
| 2026-09-22 | Initial skeleton: problem evidence, outline, decision table, Open Questions gate |
| 2026-09-22 | Gate answered and spec completed: subsidiaries included (Q-P-001), greenfield with no data migration (Q-P-002), owner field list adopted as the party/bank block (Q-P-003), deferred attributes behind a reserved JSONB column (Q-P-004), currency pickers re-pointed (Q-P-005), `supplier \| customer` retained (Q-P-006), encryption mirroring `customers` (Q-P-007). Phases 1–3 ready; Phase 4 deferred |
| 2026-09-22 | Phases 1–3 **verified end to end**. Migration `Migration20260922090832_parties.ts` applied to the dev database (3 tables + 5 indexes incl. the partial unique default-bank index + 2 cascade FKs); `yarn mercato entities seed-encryption --tenant <id>` materialized the module's two encryption maps for the pre-existing tenant; `yarn mercato auth sync-role-acls` granted `parties.*` to the existing superadmin/admin roles (the installed grant check refuses a feature the actor does not hold, so a tenant whose roles predate the module cannot bootstrap it otherwise). Evidence: **integration** `src/modules/parties/__integration__/parties.spec.ts` 9/9 passed (aggregate round trip with roles + bank block, duplicate code 409, unknown role 400, two defaults 400, replace semantics, clear-to-null, stale version 409, option source + organization isolation, feature denial, currency option source, soft delete); **browser** (zh, light + dark, 1440px + 430px): list/create/detail/edit round trip incl. the bank block and role chips, the inline server rejection (`Beneficiary bank is required`), the undo flash bar, and the `trade_docs` contract form whose 对方 picker now lists the app-owned party as `客户: <code> — <name>` and whose 币种 select lists the seeded codes (network shows `/api/parties/options` and `/api/currency_policy/currencies`, and **no** `customers/dictionaries/currency` call). Two defects found and fixed during verification: the client components still called the pre-restructure path `parties/parties` (now `/api/parties`), and `trade_docs`' counterparty loader asked suppliers for `pageSize=200`, which the supplier list caps at 100 — the 400 aborted the whole picker before it could offer either kind |
| 2026-09-23 | Compliance verdict corrected to `Implemented` (Phases 1–3 shipped and verified; Phase 4 deferred on Q-P-004) and drifted deliverable paths replaced by a pointer to `src/modules/parties/README.md`. |
