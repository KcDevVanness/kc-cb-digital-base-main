# App-owned Product Variants (SKU level)

**Date**: 2026-09-22
**Status**: Implemented — Phases 1–2 shipped and verified 2026-09-22; Phase 3 (wms cutover) stays deferred to the wms round

> **As-shipped deltas (2026-09-23).** Two contract claims in the body are wrong:
> 1. `GET /api/products/items` (list) does **not** return `variants[]` — its `listFields` projection carries no
>    variants. Variants are returned by the aggregate read `GET /api/products/items/[id]`
>    (`{ item: { …, variants: [] } }`).
> 2. The `search.ts` deliverable does not exist; the product indexer is the default CRUD indexer.
> The Final Compliance Report's `Ready for implementation` verdict and the unchecked acceptance boxes predate
> delivery; the shipped evidence is the Changelog row.

> Owner decisions this spec implements: `docs/dev/business-architecture.md` (已定决策与依据 →
> SKU/变体归属 = 自建进 `products`, 2026-09-22).
> Gate answers applied: Q-V-000 split confirmed · Q-V-001 **minimal SKU first**, extra fields to be
> supplied at review · Q-V-002 product-level price tiers kept (variant-level override stays additive)
> · Q-V-003 / Q-V-004 / Q-V-005 / Q-V-007 **parked** — the owner is not yet running the wms flow and
> asked for them to be recorded here (see *Deferred — the wms round*) · Q-V-006 `catalog` stays
> registered.
> Independent of [`.ai/specs/2026-09-22-app-owned-party-master.md`](2026-09-22-app-owned-party-master.md).

## TLDR

Give the app-owned `products` module a variant (SKU) dimension in its minimal form — code, name,
barcode, status, default marker, free-form attributes — authored as part of the product aggregate and
editable in the product form. This closes a live gap: stock is booked at variant level while only the
installed `catalog` has variants, and the official variant pages are already hidden, so **today there
is no surface in the app that can create a SKU**. The shipping/receipt cutover (letting
`cross_border` book stock against app-owned variants) is deliberately **not** in this spec's ready
scope: the owner is deferring the wms flow to a later round, and the parked decisions with their
measured evidence are recorded below so that round starts from facts instead of re-discovery.

## Problem Statement

1. **One product master is split across two tables.** `products_products` owns identity, categories
   and the three price tiers; variants live in `catalog_product_variants`, reachable only through
   the optional link column `products_products.catalog_product_id`
   (`src/modules/products/components/ProductForm.tsx:540` reads `/api/catalog/products` to fill it).
2. **SKU creation has no surface today.** The 2026-09-22 hide set
   `/backend/catalog/products/[id]`, `/backend/catalog/products/[productId]/variants/create` and
   `.../variants/[variantId]` to `null` in `src/modules.ts`; variants can otherwise only be created
   through `catalog.variants.create` (`catalog/commands/variants.ts:594`) or
   `POST /api/catalog/variants`. So the app depends on a variant dimension it can no longer maintain
   through a UI.
3. **Stock is variant-level, and the current bridge is load-bearing.**
   `cross_border` receives goods by dispatching `wms.inventory.receive` with a variant resolved from
   the linked catalog product (`src/modules/cross_border/commands/shipments.ts:579` →
   `resolveDefaultVariantId`, `src/modules/cross_border/lib/purchasingReads.ts:118-128`); a product
   without one aborts the receipt with 422 (`shipments.ts:580-584`). Recorded as
   `.ai/lessons/stock-receipt-needs-variant-resolution.md`.
4. **What a cutover would have to satisfy (measured, for the later round).** `wms` stores
   `catalog_variant_id` as a **plain uuid without a cross-module FK** in
   `wms_product_inventory_profiles`, `wms_inventory_lots`, `wms_inventory_balances`,
   `wms_inventory_reservations`, `wms_inventory_movements` (`wms/data/entities.ts:184,220,268,312,398`),
   so a ledger row can hold an app-owned id; but the receive path reads the variant through the query
   engine (`wms/commands/inventory-actions.ts:429` queries `E.catalog.catalog_product_variant`) and
   requires a `wms_product_inventory_profiles` row per variant, which today is created by the wms
   interceptor bound to `POST/PUT /api/catalog/variants`
   (`.ai/specs/2026-09-21-catalog-customization-and-eject-decision.md`, superseded decision record → preserved-contract register).

## Overview and Success Measures

- **Primary outcome:** an operator opens a product, adds one or more SKUs (code + name, optionally
  barcode/attributes), marks one default, saves, and sees them listed — all inside the app's own
  product master, with no catalog page involved.
- **Leading indicators:** `GET /api/products/items` returns each product's variants; the option
  source `GET /api/products/variants/options` answers with display names for other modules; the
  product form's variants step round-trips add/edit/remove.
- **Baseline:** zero app-owned SKUs; variant identity exists only in `catalog`; no UI can create one.
- **Market / product reference:** Shopify/Odoo product→variant models. Adopted: product owns variants,
  variant code is the operational key, one default variant per product, attributes kept free-form
  until the business names them. Rejected (for now): the catalog-style option-schema + generated
  combination matrix — it needs a generator UI the requirement does not justify yet.

## Goals

- **REQ-V-001** — `products_variants` (entity `products:product_variant`) stores one row per SKU:
  `product_id` (same-module relation, cascade), `code` (unique per organization), `name`, `barcode`
  (nullable), `status` (`active | inactive`), `is_default`, `attributes` JSONB, `sort_order`,
  plus `tenant_id` / `organization_id` and `created_at` / `updated_at` / `deleted_at`.
- **REQ-V-002** — Variants are authored as part of the product aggregate: `POST/PUT /api/products/items`
  accepts `variants[]` and the command replaces the set (upsert by id, soft-delete missing), the same
  pattern the module already uses for price rows. Exactly one variant per product may be `is_default`.
- **REQ-V-003** — A product with variants is valid without a catalog link; `catalog_product_id` stays
  as the optional legacy/bridge column and is never required by the app's own paths.
- **REQ-V-004** — `GET /api/products/variants/options` is a scoped option source returning
  `{ value, label }` (product name + variant code/name) for pickers in other modules. It is authored
  now so the deferred cutover is a pure consumer change.
- **REQ-V-005** — The product form gains a variants step rendered from `lib/formLayout.ts` (the
  existing step seam), with the field whitelist for a variant living in one module file so the extra
  fields the owner will supply at review are a one-file edit.
- **REQ-V-006** — Variant columns join the module's search/index configuration
  (`search.ts`), and `zh`/`en` strings cover the new surface; no installed file is modified and
  `catalog` keeps its current registration and hidden pages.
- **REQ-V-007** — ACL/scope behaviour is unchanged: variants are gated by the existing
  `products.items.*` features and every read/write stays organization-scoped and fail-closed.

## Non-goals

- **Cutting `cross_border` / `wms` over to app-owned variants** — deferred by the owner to the wms
  round (see *Deferred — the wms round*). Until then the bridge (`catalog_product_id` → catalog
  variant) remains the only path that can book stock.
- Variant-level prices (product-level tiers stay authoritative), per-variant stock views, variant
  images/media, marketplace listing sync.
- Switching installed `sales` document lines to app variants; ejecting or editing `catalog`.
- Historical data rewrites of any kind (no `catalog_variant_id` backfill).

## Proposed Solution

```text
/backend/products/items/create|edit   (existing stepped form)
        └─ step 4 变体/SKU ──► POST/PUT /api/products/items  (variants[] replace semantics)
                                     └─ commands: products.items.create|update
                                            └─ products_products ──< products_variants
other modules (later) ──► GET /api/products/variants/options   (display name, scoped)
```

- One aggregate: product + prices + variants in a single command transaction, one optimistic-lock
  version, one audit trail — consistent with how prices already work.
- The variant field whitelist is data, not code spread: `lib/variantFields.ts` (mirroring
  `lib/formLayout.ts`), so review-time additions are one file plus a migration.
- `attributes` JSONB carries anything the owner adds before it earns a column.

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| Variants inside `products` | A SKU has no meaning without its product; one transactional owner for identity and variants | Separate `skus` module | Splits one aggregate across two modules and two migrations |
| Minimal SKU + `attributes` JSONB | Q-V-001: the owner will supply the real field set at review; a wrong column now costs a migration | Full catalog-style option schema + matrix | Needs a generator/template UI with no requirement behind it yet |
| Variants authored with the product aggregate | Matches the existing price `replace` pattern; one lock, one audit trail | Dedicated `/api/products/variants` CRUD | A second version to reconcile in one form; more surface than needed |
| Prices stay product-level | Q-V-002; `products_prices` unique key is `(product, tier, currency, min_quantity)` and the business prices per product today | Variant-level prices now | No requirement; additive later as an override row |
| Option source authored before its consumer | Makes the deferred wms cutover a consumer-only change | Author it during the wms round | Small now, and it is the seam the parked work needs |
| Keep `catalog` registered, pages hidden | `sales` requires `catalog`; its lines store catalog variant ids + snapshots | Deactivate/eject `catalog` | Generator fails `requires`; installed `sales`/`wms` break |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| variant / SKU | the sellable, stockable unit under a product | `products_variants` | — |
| variant code | operator-facing SKU code, unique per organization (including soft-deleted rows) | `products_variants.code` | duplicate → 409, no partial write |
| default variant | at most one per product; the one a later receipt resolves to when nothing more specific is chosen | `products_variants.is_default` | second default in one payload → 400 |
| replace semantics | the submitted `variants[]` is the new truth: existing ids upsert, missing ids soft-delete | the product command | unknown id for this product → 400 |
| catalog link | optional legacy bridge (`products_products.catalog_product_id`); never required by app paths | this module | — |
| scoped record | tenant + organization from the session; reads expand to descendants, writes act in the selected organization | this module | fail closed (401/403) |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| product manager | create/edit products with their variants | organization (session-derived) | existing `products.items.view` / `products.items.manage` |
| operator picking a SKU (later round) | read the option source | organization + descendants | `products.items.view` |
| user without a grant | no page, 403 on API | — | — |

No new ACL feature is introduced: variants are part of the product resource and inherit its gate.
Trusted scope comes from the session; no system-scope path is added.

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| Variant identity | **app-own** | `products` (extend) | — | The app owns the product master; variants belong to it |
| Product/price/category | reuse (unchanged) | `products` | existing routes/commands | No change to their contracts |
| Catalog variant data | reuse (read-only, legacy) | `catalog` | `catalog_product_id` bridge | Still required by installed `sales`; the cutover is deferred |
| SKU option source | app-own | `products` | `GET /api/products/variants/options` | One display-name source for later consumers |
| Search / index | reuse | `query_index`, `search` | `search.ts` config | No parallel index |
| Stock booking | **unchanged in this spec** | `wms` via `cross_border` | parked | Owner deferred the wms round |

## Architecture and Data Flow

- **Module boundaries:** `products` owns product identity, hierarchy, prices and now variants.
  Nothing else gains a variant reference in this spec; the option source is the only outward seam.
- **Extension points:** nothing installed is modified. `catalog` keeps its registration, its hidden
  pages and its API.
- **Alternatives considered:** storing variants as JSONB on the product row (rejected: no per-variant
  identity for later references, no uniqueness on code); a `catalog` variant mirror table
  (rejected: two masters again).
- **Compatibility:** the product payload gains an optional `variants[]`; existing clients that omit it
  are unaffected (omitted means "leave variants untouched", an explicit empty array means "remove
  all"). Existing price/category behaviour is unchanged.

## User Journeys

### Journey J-V-001 — Add SKUs to an existing product

1. Operator opens the product, goes to step 4 变体/SKU, presses 添加 SKU, enters code + name (barcode
   optional), marks the first as default, saves.
2. `PUT /api/products/items` replaces the variant set in the same transaction as the product update;
   the list shows the SKUs after reload.
3. Failure path: duplicate code → 409 naming the code; two defaults → 400; a stale product version →
   409 and the form keeps input.

### Journey J-V-002 — Remove a SKU that was never used

1. Operator removes the row and saves; the variant is soft-deleted, its code stays reserved.
2. Re-adding the same code later succeeds only after the soft-deleted row is restored or purged —
   documented behaviour, not a silent duplicate.

## UI and Interaction Contracts

Closest existing reference: the module's own stepped product form
(`src/modules/products/components/ProductForm.tsx` + `src/modules/products/lib/formLayout.ts`, whose
price-tier step is the pattern for a repeatable child table). Rules: `.ai/guides/backend-ui.md`.
Implementation must invoke `om-backend-ui-design`.

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/products/items/create`, `/[id]/edit` — step 4 变体/SKU | list SKUs of the product, add/remove rows, mark default, edit code/name/barcode | `POST/PUT /api/products/items` (`variants[]`) | the existing price-tier step of the same form | `CrudForm` + repeatable field group (no new shell) | validation error (duplicate code, two defaults), server error, conflict, empty (no SKUs yet) | REQ-V-002, REQ-V-005 |
| variant option source (consumed later) | feed pickers in other modules | `GET /api/products/variants/options` | `api.option-source-routes` reference | shared picker | loading, empty, error | REQ-V-004 |

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| product manager | existing 商品 group unchanged | none | login → 商品 → 打开商品 → 步骤 4, 3 clicks |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| variants step | "还没有 SKU" + 添加 SKU action; a product with no SKU stays valid | rows stack at narrow width | add/remove reachable by keyboard; Escape cancels an unsaved row; Cmd/Ctrl+Enter saves |

### Step 4 变体/SKU — layout

```text
┌────────────────────────────────────────────────────────────┐
│ 变体 / SKU                                     [添加 SKU]   │
├────────────────────────────────────────────────────────────┤
│ 编码* | 名称* | 条码 | 默认(单选) | 状态 | 操作(删除)        │
│ …repeatable rows…                                          │
├────────────────────────────────────────────────────────────┤
│ [上一步] [保存]                                             │
└────────────────────────────────────────────────────────────┘
```

- **Behavior:** duplicate codes and a second default are rejected client-side and again server-side;
  removing a row is local until save; the step participates in the form's first-error jump.
- **Responsive and accessibility:** each row's controls carry labels; the default radio group is
  announced; error summary focuses the offending field.
- **Localization:** `products.variants.*` keys in `src/modules/products/i18n/{zh,en}.json`.
- **Design-system and theming:** semantic tokens; `StatusBadge` for variant status; light/dark
  verified.

## Data Models

### `products_variants` (`products:product_variant`)

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | uuid, required | primary key | no | immutable |
| `tenant_id`, `organization_id` | uuid, required | composite scope index | no | trusted context only |
| `product_id` | uuid, required | index; same-module `@ManyToOne`, cascade delete | no | must belong to the same product in the payload |
| `code` | text, required | unique `(organization_id, code)` incl. soft-deleted | no | 1..64 chars; duplicate → 409 |
| `name` | text, required | — | no | 1..200 chars |
| `barcode` | text, nullable | index | no | free text (EAN/UPC not enforced yet) |
| `status` | text, default `active` | index | no | `active` \| `inactive` |
| `is_default` | boolean, default false | partial unique `(product_id) where is_default and deleted_at is null` | no | at most one per product |
| `attributes` | jsonb, nullable | — | no | free-form until the owner names the fields |
| `sort_order` | integer, default 0 | — | no | UI ordering only |
| `created_at`, `updated_at`, `deleted_at` | timestamps | `updated_at` = lock version | no | soft delete keeps the code reserved |

**Migration and retention:** one additive table + indexes; generated with `yarn db:generate`,
reviewed, applied only after approval. No existing object is altered; `catalog_*` is untouched.
Variant fields the owner adds at review land as additive columns through `lib/variantFields.ts` plus a
migration.

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| `POST` | `/api/products/items` (extended) | `products.items.manage` | product payload + optional `variants[]` | 201 + `products.item.created` (existing event) | 400 (duplicate code in payload, two defaults, unknown variant id), 409 (code taken, stale product) | REQ-V-002 |
| `PUT` | `/api/products/items` (extended) | `products.items.manage` | same + `id`, `updatedAt` | 200 + `products.item.updated` | 400/404/409 as above | REQ-V-002 |
| `GET` | `/api/products/items` (extended) | `products.items.view` | existing query | items include `variants[]` | 400/401/403 | REQ-V-001 |
| `GET` | `/api/products/variants/options` | `products.items.view` | `search`, `organizationId`, optional `productId` | `{ items: [{ value, label }] }` | 400/401/403 | REQ-V-004 |

No new command id is introduced: variants are written by the existing product commands, so
interceptors, audit and index bridges keep working unchanged. `variants` omitted → untouched;
`variants: []` → all soft-deleted.

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| product create/update carrying variants | `products` command | crud indexer, audit | index row refreshed with the variant summary | replace semantics are idempotent per payload |
| variant code conflict | command | — | none | rejected before any write |

No workers, jobs or notifications are added.

## Security, Privacy, and Compliance

- **Authorization:** existing `products.items.view` / `products.items.manage`; no new feature, no
  role-name checks.
- **Tenant isolation:** unchanged scope rules; the option source filters on the session organization
  and its descendants.
- **Sensitive data:** variant code/name/barcode are commercial identifiers, not personal data; no
  encryption map is added (consistent with the rest of `products`).
- **Abuse and failure modes:** duplicate codes rejected; replace semantics prevent orphan rows; stale
  writes rejected by the product's `updated_at`; no endpoint accepts a client-computed scope.

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-V-001 | integration (API) | product in an organization | create product with 2 variants (one default), update replacing one and adding one, then `variants: []` | codes unique per organization; replace leaves no duplicates; soft-deleted codes stay reserved; product reads back with variants | REQ-V-001, REQ-V-002 |
| TEST-V-002 | security | second organization, user without `products.items.*` | cross-organization read/write; option source without feature | fail closed 403/401; no leak; option source scoped | REQ-V-004, REQ-V-007 |
| TEST-V-003 | UI | product with and without variants, both permission states | add/edit/remove rows, duplicate code, two defaults, narrow width, light/dark | states render; first-error jump lands on the offending row; conflict keeps input | REQ-V-005, REQ-V-006 |
| TEST-V-004 | integration (deferred) | see *Deferred — the wms round* | receipt against an app-owned variant | belongs to Phase 3; not part of ready scope | — |

## Implementation Phases

### Phase 1 — Entity, command and API support

- **Depends on:** none
- **Outcome:** variants can be created, replaced and read through the product API, scoped and
  validated.
- **Why this order / value delivered:** the model and its guards are what every later surface and the
  deferred cutover consume.
- **Deliverables:** `src/modules/products/data/entities.ts` (+`products_variants`),
  `data/validators.ts`, `commands/items.ts`, `api/items/route.ts` payload extension,
  `lib/variantFields.ts`, migration, `search.ts` update.
- **Independent slices / estimated commits:** entity+migration · validators+command · route payload.
- **Requirements closed:** REQ-V-001…REQ-V-003, REQ-V-007
- **Tests:** TEST-V-001, TEST-V-002
- **Validation:** `yarn generate`, `yarn typecheck`, focused jest, API smoke.
- **Exit gate:** variants round-trip through the API; duplicate code and two defaults rejected; no
  installed file changed.

### Phase 2 — Variants step and option source

- **Depends on:** Phase 1 exit gate
- **Outcome:** an operator maintains SKUs in the product form; other modules can pick a SKU by
  display name.
- **Deliverables:** `lib/formLayout.ts` (step 4), `components/ProductForm.tsx` variants step,
  `api/variants/options/route.ts`, `i18n/{zh,en}.json`.
- **Independent slices / estimated commits:** form step · option source.
- **Requirements closed:** REQ-V-004…REQ-V-006
- **Tests:** TEST-V-003
- **Validation:** browser pass (light/dark, narrow, keyboard), `yarn ds:check`.
- **Exit gate:** a product with SKUs is maintainable end to end in the UI, in zh and en.

### Phase 3 — wms / cross_border cutover (deferred)

- **Depends on:** the owner's wms round, and the answers to Q-V-003/004/005/007 below.
- **Outcome:** stock receipts resolve variants from `products_variants`.
- **Deliverables:** `cross_border` variant resolution, a wms inventory-profile creation path for
  app-owned variants, legacy-row policy, and the option source wired into the allocation UI.
- **Exit gate:** not part of this spec's ready scope.

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Extension surface (reference → exact file) | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|---|
| REQ-V-001 | J-V-001 | `products_variants` | `data.entities` → `src/modules/example/data/entities.ts` | 1 | TEST-V-001 | AC-V-001 |
| REQ-V-002 | J-V-001, J-V-002 | product command + `variants[]` | `commands.write` → `src/modules/example/commands/todos.ts` | 1 | TEST-V-001 | AC-V-002 |
| REQ-V-003 | J-V-001 | `catalog_product_id` stays optional | `data.entities` → `src/modules/example/data/entities.ts` | 1 | TEST-V-001 | AC-V-003 |
| REQ-V-004 | J-V-001 | `GET /api/products/variants/options` | `api.option-source-routes` → `src/modules/example/api/tags/route.ts` | 2 | TEST-V-002 | AC-V-004 |
| REQ-V-005 | J-V-001 | form step + `lib/variantFields.ts` | `ui.page-shell` → `src/modules/example/backend/todos/page.tsx` | 2 | TEST-V-003 | AC-V-005 |
| REQ-V-006 | J-V-001 | `search.ts`, i18n | `search.module-config` → `src/modules/example/search.ts`; `module.i18n-catalogs` → `src/modules/example/i18n/en.json` | 1, 2 | TEST-V-003 | AC-V-005 |
| REQ-V-007 | J-V-001 | existing ACL + scope | `module.acl-features` → `src/modules/example/acl.ts` | 1 | TEST-V-002 | AC-V-006 |
| — (deferred) | receipt path | `cross_border` → `wms.inventory.receive` | parked | 3 | TEST-V-004 | not in ready scope |

## Rollout, Migration, and Rollback

- **Migration boundary:** one additive table; `yarn db:generate` → review → `yarn db:migrate` after
  approval. No backfill, no rewrite of catalog data.
- **Rollout order:** Phase 1 (inert API) → Phase 2 (UI). The deferred Phase 3 changes nothing until
  its own spec/round.
- **Rollback:** de-register nothing; the table can stay unused (the payload extension is optional).
  Removing Phase 2's step is a `formLayout.ts` edit. Dropping the table is a separate, explicit data
  change.

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| Two variant identities coexist (`products_variants` vs `catalog_product_variants`) until the cutover | An operator may create a SKU in one place and look for it in the other | The catalog pages are hidden; the app-owned surface is the only SKU UI; the bridge column is documented as legacy | Reports reading catalog variants will not see app SKUs |
| Minimal SKU fields may miss what the business needs | A migration per field batch | `attributes` JSONB absorbs unknowns; `lib/variantFields.ts` makes column additions one file | Data typed into `attributes` may need migrating to columns later |
| Replace semantics can delete a variant an operator did not intend to touch | Lost SKU rows (soft-deleted) | Codes stay reserved; row removal is explicit in the UI; `updated_at` conflict guard | A concurrent edit still replaces the whole set (accepted, consistent with prices) |
| Deferred cutover leaves the receipt path on the bridge | Receipts keep requiring a catalog link | The parked questions carry the measured evidence so the wms round starts from facts | Operators must keep the legacy link until then |

## Acceptance Criteria

- [ ] **AC-V-001** — A product stores 0..n SKUs; each has a unique code per organization and at most
  one is default.
- [ ] **AC-V-002** — Saving `variants[]` replaces the set without duplicates; omitting the field
  leaves variants untouched; duplicate codes and two defaults are rejected with readable errors.
- [ ] **AC-V-003** — A product with SKUs and no catalog link saves and reads back normally.
- [ ] **AC-V-004** — `GET /api/products/variants/options` returns scoped display names and rejects an
  unprivileged caller.
- [ ] **AC-V-005** — The variants step renders from `lib/formLayout.ts`, round-trips add/edit/remove,
  and every new string is localized in zh and en.
- [ ] **AC-V-006** — Scope and feature behaviour is unchanged: cross-organization access fails closed;
  no installed file was modified.
- [ ] **AC-V-007** — Every affected API and UI path has self-contained integration coverage and the
  configured validation gate passes.

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | root `AGENTS.md`, `docs/dev/business-architecture.md`, `.ai/guides/backend-ui.md`, lessons `stock-receipt-needs-variant-resolution`, `module-api-path-is-directory-name` |
| Data models, APIs, events, UI, and tests are internally consistent | pass | Data Models ↔ API contracts ↔ TEST-V-001…003 ↔ Phases 1–2 |
| Every workflow completes end to end without a catch-all integration phase | pass for Phases 1–2 | Phase 3 is explicitly deferred and excluded from ready scope |
| Platform-native reuse and extension points were chosen before custom code | pass | Extends `products`; no installed file touched; `catalog` untouched |
| UI contracts identify references, canonical components, and theme/state coverage | pass | Existing stepped form + repeatable group; full state list |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | Phases 1–2; Phase 3 blocked on the wms round |

**Verdict:** `Blocked — Phase 3 (wms / cross_border cutover) deferred to the wms round; Phases 1–2 are
ready for implementation.`

## Deferred — the wms round

Parked 2026-09-22 by the owner ("先把前期业务流程打通，后续再打通 wms"). Each item below carries the
evidence already measured, so that round starts from facts. Nothing here is invented scope; the
questions are recorded, not answered.

| ID | Parked question | Measured evidence (already gathered) |
|---|---|---|
| Q-V-003 | How does stock land: pass **app-owned** variant ids to `wms.inventory.receive`, or keep a bridge variant per SKU in `catalog`? | Ledger columns are plain uuids with no cross-module FK (`wms/data/entities.ts:184,220,268,312,398`) → either id fits the column. But the receive path reads `E.catalog.catalog_product_variant` through the query engine (`wms/commands/inventory-actions.ts:429`) and requires a `wms_product_inventory_profiles` row (`loadProfileForVariant`), which the installed interceptor only creates on `POST/PUT /api/catalog/variants`. Passing app ids therefore needs our own profile-creation path and accepts that wms's own label/SKU resolution falls back to a bare id for our variants. |
| Q-V-004 | Legacy rows: leave historical `catalog_product_id` / `catalog_variant_id` values alone, or backfill a variant map? | wms balances aggregate on `(warehouse, location, catalog_variant_id, lot, serial)`; a backfill changes what "the same SKU" means for existing balances. |
| Q-V-005 | Purchase and shipment granularity: keep product-level purchase-order lines with the variant decided at shipment allocation (today), or move lines to variant level? | `purchasing_purchase_order_lines.product_id` is product-level; `cross_border` resolves the variant at receive time (`resolveDefaultVariantId`). |
| Q-V-007 | Does a new SKU get its wms inventory profile at creation time (so the first receipt cannot 422), and who creates it — `products` dispatching a wms command, or an app-side subscriber? | The profile is what `loadProfileForVariant` looks up; without it the receipt path cannot book stock. |
| Q-V-008 | After the cutover, does `catalog` still need a variant per SKU for installed `sales` document lines (which store catalog variant ids + snapshots)? | `.ai/specs/2026-09-21-catalog-customization-and-eject-decision.md` (superseded decision record: preserved-contract register): `sales` lines store `product_variant_id` + `catalog_snapshot`; `wms` binds enrichers/interceptors to catalog products and variants. |

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-V-001b | The extra SKU fields to be supplied at review — which columns earn a place next to `code`/`name`/`barcode`? | owner | no | pending — supplied at review; `attributes` JSONB holds them meanwhile |
| Q-V-003…Q-V-005, Q-V-007, Q-V-008 | See *Deferred — the wms round* | owner + architect | yes for Phase 3 only | deferred 2026-09-22 |
| Q-V-009 | Should soft-deleted variant codes be reusable (purge path) or permanently reserved? | owner | no | pending — reserved by default |

## Changelog

| Date | Change |
|---|---|
| 2026-09-22 | Initial skeleton: measured `wms`/`catalog`/`cross_border` evidence, outline, decision table, Open Questions gate |
| 2026-09-22 | Gate answered and spec completed for Phases 1–2: minimal SKU with an `attributes` seam (Q-V-001), product-level prices kept (Q-V-002), `catalog` registration unchanged (Q-V-006); the wms cutover questions (Q-V-003/004/005/007) are parked in *Deferred — the wms round* with their measured evidence, and Phase 3 is excluded from ready scope |
| 2026-09-22 | Phases 1–2 **implemented and verified**. Shipped: `products_variants` (migration `Migration20260922092240_products.ts`, applied — scope/unique/partial-unique-default indexes, cascade FK), `productVariantSchema` + `variants[]` on the product create/update schemas, persistence inside the existing `products.items.create|update` commands with replace semantics (soft delete for removed ids, unknown id 400, duplicate code in payload 400, second default 400, organization-wide code check incl. soft-deleted rows → 409), `lib/variantFields.ts` as the field-whitelist seam, `GET /api/products/items/[id]` (aggregate read for the edit form), `GET /api/products/variants/options`, the appended step 4 `变体/SKU` in the product form with `components/VariantsEditor.tsx`, and 18 `products.variants.*` keys in both locales. Evidence: `yarn generate` registers `/api/products/items/[id]` + `/api/products/variants/options` and the four-step form; `yarn typecheck`, `npx eslint src/modules/products`, `yarn test` (17 suites/167 tests) and `yarn ds:check` clean; **browser**: the edit form loads with four steps, the variants step renders its empty state, adding a SKU (code/name/barcode + default) and saving persisted a `products_variants` row — read back through `GET /api/products/items/[id]` (`{code: 'KEEPER-F3YP-BLK', isDefault: true}`) and offered by the option source as `Good line · KEEPER-F3YP-BLK — Good line 黑色`. Not verified in this round: the wms receipt path (Phase 3, deferred) |
| 2026-09-23 | Two contract claims corrected: the items **list** projection carries no `variants[]` (only the aggregate read does) and the `search.ts` deliverable does not exist; the pre-delivery compliance verdict marked as history. |
