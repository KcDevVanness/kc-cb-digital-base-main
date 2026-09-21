# Catalog Customization and Eject Decision

**Date**: 2026-09-21
**Status**: Draft

> Skeleton under the `om-spec-writing` Open Questions gate. The decidable parts (ownership map, preserved-contract register, mechanism ladder, risks, rollback) are complete and grounded in the generated facts sheet. Sections that depend on the business deltas carry the exact blocking question ID (`Q-00x`) instead of invented content. Status stays `Draft` until every `Q` is answered.

## TLDR

The app runs the installed `catalog` module (12 entities, 9 backend pages, 24 commands, 18 events, 7 ACL features) and wants to change parts of it: remove capabilities it does not use, reshape product forms and list layouts, add company-specific reminders, and bend the product workflow toward actual business practice. This specification decides *where* each such change lands — an app-side UMES contribution, a `src/modules.ts` override, or a full eject of the module into `src/modules/<id>/` app ownership — and records exactly what an eject would cost, what it must preserve, and how it is rolled back. No product behavior changes in Phase 0.

## Open Questions

Blocking — answers determine the architecture, so implementation cannot start before they are resolved.

> Pointer: the owner's business model was re-confirmed on 2026-09-21 (国内采购 → 海外分公司 → 跨境电商). Re-assessment `.ai/analysis/2026-09-21-business-model-reassessment.md` concludes that the shipped catalog is **reused** — it already carries HS/CN codes, country of origin, weight, dimensions, hazmat/lithium flags, min-order and UoM-conversion fields — so the eject path below is not needed, and the open questions here narrow to "which optional catalog surfaces do we hide or extend".

- **Q-001** — Which shipped catalog capabilities must disappear (pages, widgets, commands, AI tools/agents, CLI seeds, bulk-delete worker, low-stock notification)? Name them, or state "hide from navigation only" vs "remove entirely".
- **Q-002** — What reminders/notifications are required: trigger (`catalog.product.stock_low`? low-margin? missing data?), condition thresholds, recipient (role/feature/user), channel (in-app notification type, email, both), and repeat/cool-down behavior?
- **Q-003** — Which product-form and product-list changes are required: field additions/changes/removals, layout order, required/validation rules, and whether the added fields are app-private data (own entity/extension) or belong on the product record?
- **Q-004** — Does any requirement change the catalog **entity model** — a new column on a catalog table, changed semantics of an existing column, dropped column, or a new first-class entity the shipped model cannot express? (This single answer decides whether an eject is mandatory.)
- **Q-005** — Must the installed order-to-cash chain stay usable as shipped: quotes → orders → shipments → invoices → payments with WMS inventory behavior attached to products? (Answer "no" only if the app is replacing that chain.)
- **Q-006** — Do the existing 7 ACL features (`catalog.products.view/manage`, `catalog.categories.view/manage`, `catalog.variants.manage`, `catalog.pricing.manage`, `catalog.settings.manage`) remain the permission surface, or do the new flows need new feature IDs (which pulls in `auth` overlay work and role re-granting)?
- **Q-007** — Is one capability being bundled here, or several independently deployable ones? (Per `om-spec-writing`, a bundle must be split — e.g. "remove unused capabilities", "reminder flows", and "eject catalog" are three separately shippable changes with different risk.)

## Problem Statement

`AGENTS.md` and the module registry make the app's ownership model explicit: `catalog` is installed from `@open-mercato/core@0.8.0` and enabled in `src/modules.ts`, the app owns only a `zh` locale overlay (`src/modules/catalog/i18n/zh.json`) plus one override disabling `catalog.injection.product-seo`. When a requirement does not fit the shipped product flow, three different answers are technically possible and they are not interchangeable:

1. **UMES contribution** — app files under `src/modules/<app_module>/`, catalog records and code untouched, framework upgrades free.
2. **`src/modules.ts` override** — supported keys exist for catalog routes, widgets, events, workers, notifications, AI agents/tools, ACL features, DI, CLI, and setup; catalog code untouched, upgrades free.
3. **Eject** — `yarn mercato eject catalog` copies the module into app ownership; the app then owns its code, its upgrade merges, and its compatibility contract with `sales`, `wms`, and any other installed consumer. `catalog` declares `ejectable: true` (`.ai/guides/modules/catalog/owned-contract-module-metadata.md`).

Choosing wrong is expensive in both directions: extending when the requirement needed ownership leaves the requirement unmet and produces workarounds; ejecting when extension sufficed transfers upgrade ownership permanently for no benefit. The evidence needed to choose — the mountable UI surfaces, the override keys, and the exact set of things that must keep working — exists in generated facts but has never been assembled into one decision for this app.

## Overview and Success Measures

- **Primary outcome:** every catalog change request has a recorded mechanism (`UMES` | `override` | `eject`) with the evidence for rejecting the cheaper options, and the app runs the correct one.
- **Leading indicators:** a classification table with no `unresolved` rows; `yarn generate` clean after each applied change; still zero edits under `node_modules` or shipped migrations.
- **Baseline:** zero app-owned code on the catalog path except one locale overlay and one widget-disable override.
- **Market / product reference:** Odoo and ERPNext both keep a product master as the single source of truth for downstream documents and extend it per deployment; both pay for heavy customization with upgrade-merge work on every release. Adopted: keep one product master, preserve document references, extend before forking. Rejected: maintaining a parallel product master (duplicate identity, dual writes).

## Goals

- **REQ-001** — Every requested catalog change is classified against the mechanism ladder and implemented with the smallest mechanism that satisfies it; escalating to eject requires a recorded justification that names the failed smaller option.
- **REQ-002** — If an eject happens, the app preserves the full stable-contract set listed in *API, Command, and Error Contracts* and *Data Models* — identifiers, paths, payload shapes, events, ACL features, DI tokens — so installed consumers keep working without changes.
- **REQ-003** — An eject records the upstream version merged from (`@open-mercato/core 0.8.0`), the exact rollback procedure, and the standing obligation to merge upstream catalog changes on every framework upgrade.
- **REQ-004** — Unwanted shipped capabilities are removed by the cheapest mechanism that removes them (navigation/route/widget override) before any consideration of code deletion.
- **REQ-005** — Reminder flows are implemented on platform primitives (typed subscribers, notification types, workflow/user-task) in an app-owned module, never by modifying installed subscribers.
- **REQ-006** — Whatever the final mechanism set, `yarn generate` stays warning-free, every affected route keeps its fail-closed feature gate, and no tenant/organization scope rule changes.

## Non-goals

- Changing `sales` or `wms` behavior, records, or invariants; both keep consuming catalog by ID and snapshot.
- Editing `node_modules/@open-mercato/**`, generated files, or shipped migrations — never permitted.
- Building a parallel product master owned by the app (documented below as a rejected alternative).
- Enabling modules that are currently off (`documents`, `eudr`, `portal`, `checkout`, `workflows`, `data_sync`, …).
- Authoring Chinese translations for new UI beyond what the new surfaces need.
- Any change to ACL grants, roles, or scope derivation as part of this decision.

## Proposed Solution

Adopt an explicit three-step escalation with mandatory evidence at each step:

1. **UMES first** (`om-system-extension`, `.ai/guides/extensions.md`). The catalog host families that are already `FROZEN` and mountable are: `crud-form:catalog.product` (`render-widget`, `lifecycle-handler`, `component-replacement`), `crud-form:catalog.product:fields` (`field-widget`), `crud-form:catalog.product:header`, `data-table:catalog.products.list` (`component-replacement`, plus `:columns`, `:filters`, `:row-actions`, `:bulk-actions`, `:toolbar`, `:header`, `:footer`, `:search-trailing`), `data-table:catalog.categories.list` (same family), plus entity-level `response-enricher`, `query-enricher`, and `mutation-guard` on every catalog entity row in the facts sheet, `entity-extension` on the ten entities that list it (`catalog_product` and `catalog_product_variant` are marked capability-only in the incoming-contributions sheet, so an extension-table design must be verified against the installed `data/extensions.ts` before it is relied on), and async/sync subscribers on all 18 `catalog.*` events. Together these cover field additions, list customization, layout sections, computed reads, post-commit reactions, and reminders without touching catalog code.
2. **Overrides second.** Supported keys exist for catalog: 9 route pages, 3 widgets (`catalog.injection.product-seo`, `catalog.injection.product-bulk-delete`, `catalog.injection.merchandising-assistant-trigger`), the worker `catalog:product-bulk-delete`, the subscriber `catalog:low-stock-notification`, the notification type `catalog.product.low_stock`, 2 AI agents and 29 AI tools, 7 ACL features, 4 CLI commands, DI tokens (`catalogPricingService`, `CatalogProduct`, `CatalogProductPrice`), and the module's `setup` hooks — every key `disable-replace` except the three `setup` hooks, which are `replace` (`.ai/guides/modules/catalog/exact-override-targets.md`). Anything removable by a key MUST be removed this way.
3. **Eject last** (`om-eject-and-customize`), only for requirements that neither layer can express — in practice: changes to the entity model or to invariants baked into shipped commands/validators, or removal of code paths the module owns (Q-004 decides whether that is true here).

### Measured eject behaviour (spike, 2026-09-21)

An isolated worktree ran the full eject path (`yarn mercato eject catalog` → `yarn generate` → ORM probes → `yarn typecheck`). Full evidence: `.ai/analysis/2026-09-21-catalog-eject-spike.md`. What matters for this decision:

- **Eject is a faithful copy.** 159 files / 2.2 MB land in `src/modules/catalog/`; 9 backend pages and 12 API routes are registered from the copy; the registry entry flips to `@app` with its `overrides` block intact.
- **The predicted duplicate-metadata hazard did not occur.** Installed `sales` still imports the package copy of the catalog entities, but MikroORM resolves both class objects onto **one** metadata entry keyed by entity name, mapping to the same tables; queries through the package class work and instantiate the app copy's class. Caveat: this depends on class/export names staying identical — renaming an entity in the copy is a contract change (REQ-002), not a refactor.
- **New, concrete trap: 33 self-referencing package imports across 6 copied UI files** (the product edit/create pages and the variants pages import their own form components through `@open-mercato/core/modules/catalog/components/...`). Eject does not rewrite absolute package specifiers, so editing those components in the copy changes nothing until the specifiers are repointed. Any Phase 3 plan must include that repointing step.
- **No build regression.** `yarn generate` and `yarn typecheck` behave exactly as before the eject (the OpenAPI schema-fallback warning and the `scope_guards` spec error are both pre-existing).

The spike proves owning the copy is *possible*; it does not show it is *necessary* — that is still Q-004.

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| Escalate UMES → override → eject, with a recorded rejection reason per step | Preserves the app's upgrade path as long as possible; the decision gate is a documented skill contract, not a style preference | Eject first, then simplify | Transfers upgrade ownership for the whole module (12 entities, 9 pages, 24 commands, 2 agents, 29 AI tools) before proving any of it is needed |
| Treat the catalog stable-contract set as immutable if ejecting | `sales` requires `catalog`, imports `CatalogOffer`/`CatalogPriceKind`, and stores `product_id`/`product_variant_id` + `catalog_snapshot` on order and quote lines; `wms` binds enrichers to `catalog:catalog_product`/`catalog_product_variant` and intercepts `POST/PUT /api/catalog/products` and `/api/catalog/variants` | Eject and rename/reshape freely | Silently breaks order-to-cash and inventory profile sync |
| Keep `catalog` as product master for this decision round | Product identity is the join key for six installed modules; one owner avoids dual-write reconciliation | App-owned parallel product master (own entities + own UI), bridge into catalog | Duplicate identity, projection/dual-write risk, and the shipped `sales`/`wms` still read catalog — the requirement would not actually be met |
| Remove unwanted capabilities by override key where one exists | `overrides.*` is the supported disable contract; no code ownership | Delete the code after eject | Buys nothing the key does not, at permanent upgrade cost |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| preserved contract | Any identifier listed in *API, Command, and Error Contracts* / *Data Models*; it MUST NOT change while `sales`/`wms` are enabled | generated facts + installed packages 0.8.0 | consumer breaks at runtime; treated as a defect |
| ejectable | Module metadata flag; `catalog`, `sales`, `wms`, `customers`, `currencies` are `ejectable: true` | `.ai/guides/modules/catalog/owned-contract-module-metadata.md` | ejection is technically possible, still gated by approval |
| override key | A `src/modules.ts` `entry.overrides` path; `null` disables, a value replaces | `src/modules.ts` + exact-override-targets facts | unknown/typo key must be caught by `yarn generate`; an ineffective key is a defect |
| ejected module | Module whose source lives in `src/modules/catalog/` and is registered `{ id: 'catalog', from: '@app' }` | this spec | upstream fixes stop arriving; merges become manual |
| safe removal | Removing a capability via navigation/route/widget/AI-tool key while its data and API stay | this spec | hidden UI with a live API is acceptable only where the feature is genuinely unused; authorization is never replaced by hiding |
| reminder flow | App-owned typed subscriber + notification type (and optionally a durable workflow/user task) reacting to a catalog event | `events:`, `notifications:` facts | missing recipient/feature gate must fail closed and log, never broadcast |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| administrator | decide and record the mechanism per request; approve ejection | organization | `catalog.settings.manage` for catalog config surfaces |
| product manager | manage products/categories/variants/prices on the final surfaces | organization (session-derived) | `catalog.products.*`, `catalog.categories.*`, `catalog.variants.manage`, `catalog.pricing.manage` |
| operations staff | receive/inspect the reminder flows | organization | inherits the gate of the surface that raised the notification |
| developer | apply UMES/override changes, run generate, review migration output | local | none (no grant carried by code changes) |

Trusted `tenantId`/`organizationId` continue to come from the authenticated session; this specification introduces no system-scope path and no scope relaxation.

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| Product/variant/category/price master | reuse (extend if Q-003/Q-004 demand) | `catalog` | entity extensions, enrichers, guards, form/list hosts | single owner of product identity for `sales`, `wms` |
| Product form and list layout | extend | `catalog` hosts + app module | `crud-form:catalog.product*`, `data-table:catalog.products.list*` | mountable, `FROZEN`, no code ownership |
| Unwanted shipped surfaces | reuse with removal | `catalog` | `overrides.routes.pages`, `overrides.widgets.injection`, `overrides.ai.*`, `overrides.cli` | supported disable contract |
| Reminder/notification flows | app-own | new app module | `subscribers/`, `notifications.ts`, `catalog.*` events, workflow primitives | installed subscribers must stay untouched |
| Inventory-catalog coupling | reuse | `wms` → `catalog` | `wms.catalog-products.inventory-profile-sync` interceptors, `wms.catalog-product-inventory` enrichers | must keep resolving after any change |
| Product master code itself | reuse, or app-own only via eject | `catalog` | `yarn mercato eject catalog` | Phase 3, approval-gated |

## Architecture and Data Flow

```text
change request
  -> mechanism classification (this spec)
       -> UMES app module  (src/modules/<app_module>/**)
       -> override key     (src/modules.ts entry.overrides)
       -> eject            (src/modules/catalog/**, from: '@app')
  -> yarn generate -> registry (routes, nav, ACL, workers, i18n)
  -> runtime: /backend/catalog/** -> /api/catalog/** -> catalog commands -> catalog tables
                                    |
                                    +-> catalog.* events -> sales / wms / index / app subscribers
                                    +-> wms interceptors on POST/PUT products|variants
```

- **Module boundaries:** catalog remains the owner of product identity and pricing resolution; app modules own only their own records and reactions.
- **Extension points:** the host families and override keys enumerated in *Proposed Solution*; installed consumers (`wms` enrichers/interceptors, `sales` imports, `documents` entity extensions when enabled) keep resolving against unchanged IDs.
- **Alternatives considered:** parallel product master (rejected above); wholesale page replacement *before* host-based extension (a supported `overrides.routes.pages` option, but it discards the shipped form lifecycle and its wms field injection unless deliberately rebuilt).
- **Compatibility:** no installed contract is modified by Phases 1–2; Phase 3 preserves every ID in the preserved-contract register.

## User Journeys

### Journey J-001 — Classify and implement a catalog change (developer)

1. A change request arrives; it is written into the classification table with the affected surface named from the generated facts.
2. The cheapest mechanism is chosen; the two more expensive ones are rejected in writing.
3. The app module/override is implemented; `yarn generate` runs; the affected route is exercised in the browser with the relevant grant and without it.
4. Failure path: a request that no UMES host or override key can express is escalated to Phase 3 with the evidence attached; it does not silently become a workaround.

### Journey J-002 — Eject catalog (Phase 3 only, Q-004 = yes)

1. The eject decision record names the requirement, the installed version, the failed smaller options, and the assumed obligations.
2. Owner approves explicitly; `yarn mercato eject catalog` lands the source under `src/modules/catalog/`, and registration becomes `{ id: 'catalog', from: '@app' }`.
3. `yarn generate`, then catalog pages, `POST/PUT /api/catalog/products`, and the wms field injection are re-verified; contract tests from *Integration Coverage* run.
4. Rollback: delete `src/modules/catalog/`, restore the registry entry to `from: '@open-mercato/core'`, regenerate — tables and data are untouched because identifiers never changed.

## UI and Interaction Contracts

_Pending Q-001, Q-003._ The mechanism inventory is fixed now: product form work mounts on `crud-form:catalog.product` (`:fields`, `:header`), product list work on `data-table:catalog.products.list` (`:columns`, `:filters`, `:row-actions`, `:bulk-actions`, `:toolbar`, `:search-trailing`, `:header`, `:footer`), category list work on the matching `data-table:catalog.categories.list` family. Any app-authored page follows `.ai/guides/backend-ui.md` with `Page`/`PageBody`/`DataTable`/`CrudForm` and the shared API helpers.

## Data Models

No schema change is proposed by this specification. Under Phase 3, ownership (not shape) of these 12 tables transfers to the app; identifiers and table names are part of the preserved contract:

| Entity ID | Table | Custom fields | Editable |
|---|---|---|---|
| `catalog:catalog_product` | `catalog_products` | yes | yes |
| `catalog:catalog_product_variant` | `catalog_product_variants` | yes | yes |
| `catalog:catalog_product_price` | `catalog_product_variant_prices` | yes | yes |
| `catalog:catalog_product_category` | `catalog_product_categories` | no | yes |
| `catalog:catalog_product_category_assignment` | `catalog_product_category_assignments` | no | yes |
| `catalog:catalog_product_tag` | `catalog_product_tags` | no | yes |
| `catalog:catalog_product_tag_assignment` | `catalog_product_tag_assignments` | no | yes |
| `catalog:catalog_offer` | `catalog_product_offers` | no | yes |
| `catalog:catalog_price_kind` | `catalog_price_kinds` | no | yes |
| `catalog:catalog_option_schema_template` | `catalog_product_option_schemas` | no | yes |
| `catalog:catalog_product_unit_conversion` | `catalog_product_unit_conversions` | no | yes |
| `catalog:catalog_product_variant_relation` | `catalog_product_variant_relations` | no | yes |

Column-level changes (if Q-004 asks for them) are a separate schema change with its own migration review; shipped package migrations are never edited — new app migrations are added after an eject.

## API, Command, and Error Contracts

Preserved contract set — unchanged by Phases 1–2, mandatory to preserve in Phase 3:

- **Routes:** `/api/catalog/products`, `/api/catalog/variants`, `/api/catalog/settings` (+ the module's remaining API paths); 24 domain commands `catalog.products.{create,update,delete}`, `catalog.variants.{create,update,delete}`, `catalog.categories.*`, `catalog.offers.*`, `catalog.prices.*`, `catalog.priceKinds.*`, `catalog.optionSchemas.*`, `catalog.product-unit-conversions.*`.
- **API interceptor bridges that installed consumers depend on:** `api-route:catalog/products:POST|PUT:api-interceptor-bridge` and `api-route:catalog/variants:POST|PUT:api-interceptor-bridge` (bound by `wms.catalog-products.inventory-profile-sync` / `wms.catalog-variants.inventory-profile-sync`) — payload shape and method set MUST stay compatible.
- **Events (18):** `catalog.product.{created,updated,deleted,stock_low}`, `catalog.variant.*`, `catalog.category.*`, `catalog.price.*`, `catalog.pricing.resolve.{before,after}`, `catalog.product_unit_conversion.*`.
- **ACL features (7):** `catalog.products.view|manage`, `catalog.categories.view|manage`, `catalog.variants.manage`, `catalog.pricing.manage`, `catalog.settings.manage`.
- **DI tokens:** `catalogPricingService`, `CatalogProduct`, `CatalogProductPrice`.
- **Background surfaces:** worker `catalog:product-bulk-delete`, subscriber `catalog:low-stock-notification`, notification type `catalog.product.low_stock` (each individually overridable if Q-001 removes them).
- **Search:** 8 indexed catalog entities; removing an entity from `search.ts` requires a reindex decision.

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| `catalog.product.created/updated/deleted` | `catalog` | index, browser clients (`clientBroadcast`), app subscribers | index refresh; UI refresh; app reminder logic | platform event contract (retried, idempotent consumers) |
| `catalog.product.stock_low` | `catalog` | `catalog:low-stock-notification` (overridable), app subscribers | low-stock notification | delivered through the installed notification contract |
| product/variant create/update via API | `catalog` | `wms` interceptors | inventory-profile sync | must not be broken by payload/lifecycle changes |
| app reminder flows (Q-002) | app module subscribers | notification types / workflow | in-app and/or email notices | app-owned; idempotent by design key |

## Security, Privacy, and Compliance

- **Authorization:** unchanged — every route keeps its shipped feature gate; app-injected actions reuse the host's guarded APIs, and hiding a surface is never a substitute for authorization.
- **Tenant isolation:** unchanged — app code derives scope from the session and fails closed; enrichers and subscribers filter tenant/organization explicitly.
- **Sensitive data:** catalog holds no PII beyond free-text descriptions; an eject must not widen reads, and app-owned extension records store no copied PII.
- **Abuse and failure modes:** the relevant new risks are silent contract drift after an eject (mitigated by the contract tests) and unaudited removal of a capability that another module still calls (mitigated by REQ-001's written rejection evidence and by `yarn generate` inspection).

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | build/generate | each applied mechanism set | `yarn generate` | exits 0; expected registrations appear; no installed file changed | REQ-001, REQ-006 |
| TEST-002 | UI smoke | signed-in admin, catalog grants | open `/backend/catalog/products` and the affected form/list | host extensions/layout render; disabled contributions absent; loading/empty/error and light/dark/narrow verified | REQ-004 |
| TEST-003 | API security | user without `catalog.products.view` | GET/POST `/api/catalog/products` | 403 fail-closed; no navigation entry; no data leak | REQ-006 |
| TEST-004 | cross-module (phase 3 only) | ejected catalog + `wms` enabled | `POST`/`PUT /api/catalog/products` and `/api/catalog/variants` | wms inventory-profile sync still runs; product read returns wms-enriched fields | REQ-002 |
| TEST-005 | regression (phase 3 only) | ejected catalog + `sales` enabled | create product → quote → order | line stores product id + `catalog_snapshot`; pricing resolves via `catalogPricingService` | REQ-002 |
| TEST-006 | rollback (phase 3 only) | worktree copy | delete `src/modules/catalog/`, restore registry entry, `yarn generate` | registry back to `@open-mercato/core`; routes/pages intact; tables untouched | REQ-003 |

## Implementation Phases

### Phase 0 — Facts and classification (this round)

- **Depends on:** none
- **Outcome:** module facts exist for the enabled business modules and every requested change has a mechanism row.
- **Why this order / value delivered:** classification without facts is guesswork; facts sheets are cheap and already generated.
- **Deliverables:** refreshed `.ai/guides/modules/{catalog,sales,wms,customers,currencies,dictionaries,feature_toggles}/**`; this decision document.
- **Independent slices / estimated commits:** one commit (harness facts + spec).
- **Requirements closed:** REQ-001 (classification framework)
- **Tests:** TEST-001
- **Validation:** `yarn generate` after the harness refresh
- **Exit gate:** every requested change has a row; no row reads `unresolved`.

### Phase 1 — App-side extensions and removals (pending Q-001…Q-003, Q-006)

- **Depends on:** Phase 0 exit gate and the answers to Q-001…Q-003
- **Outcome:** requested UI/field/removal changes are live without owning catalog code.
- **Deliverables:** app module with widget injections/enrichers/subscribers, `src/modules.ts` override keys, `zh` strings for new UI.
- **Requirements closed:** REQ-004, REQ-005
- **Tests:** TEST-001, TEST-002, TEST-003

### Phase 2 — Reminder and workflow flows (pending Q-002)

- **Depends on:** Phase 1 (event and notification surfaces must be final first)
- **Outcome:** company-specific reminders fire on real catalog events with correct recipients and gates.
- **Deliverables:** typed subscribers, notification types/handlers, optional durable workflow.
- **Requirements closed:** REQ-005
- **Tests:** TEST-002, TEST-003

### Phase 3 — Eject catalog (only if Q-004 = yes; explicit approval required)

- **Depends on:** Q-004, Q-005 answers and written approval
- **Outcome:** the module is app-owned with the preserved contract intact.
- **Deliverables:** `yarn mercato eject catalog`, registration change, upstream-version record, merge/rollback procedure in `docs/dev/`.
- **Requirements closed:** REQ-002, REQ-003
- **Tests:** TEST-004, TEST-005, TEST-006

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-001 classification | mechanism ladder | Phase 0 | TEST-001 | AC-001 |
| REQ-002 | J-002 | preserved-contract register | Phase 3 | TEST-004, TEST-005 | AC-002 |
| REQ-003 | J-002 rollback | registry + migrations untouched | Phase 3 | TEST-006 | AC-003 |
| REQ-004 | removals | `overrides.*` keys | Phase 1 | TEST-001, TEST-002 | AC-004 |
| REQ-005 | reminder flows | `catalog.*` events, notification types | Phase 2 | TEST-002, TEST-003 | AC-005 |
| REQ-006 | all phases | feature gates, scope | Phases 1–3 | TEST-001, TEST-003 | AC-006 |

Extension-surface traceability rows (per added surface, with its `src/modules/example/**` reference file, phase, own test, and mechanism classification) are added when Phase 1's surface list is fixed by Q-001…Q-003 — the reference-module mapping requires the concrete surface, and inventing rows now would fabricate the plan.

## Rollout, Migration, and Rollback

Phases 1–2 change no database object: no `yarn db:generate` output, no migration, no reindex. Phase 3 changes code ownership only — identifiers and tables are identical, so no migration is generated either; the ejected module keeps its shipped migration set and snapshot. Rollback for any app-side contribution is deleting the app module/override key; rollback for an eject is the registry+directory revert in J-002 step 4. A later column-level change (Q-004) is a separate spec with its own reviewed migration and its own rollback.

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| Ejecting more than the requirement needs | Permanent manual merge work on every `@open-mercato/core` upgrade | REQ-001 rejection evidence; decision record per requirement | Merge cost grows with drift; accepted if Q-004 forces the eject |
| Silent contract drift after an eject (renamed route/field/event/class) | `sales` order/quote lines, `wms` interceptors, search index break at runtime; class renames also break the ORM's name-based unification of the app and package copies | Preserved-contract register + TEST-004/TEST-005; `yarn generate` inspection; measured behaviour recorded in `.ai/analysis/2026-09-21-catalog-eject-spike.md` | Runtime-only failures that tests do not model |
| Copied UI files that import their own components through the package path (33 specifiers in 6 files) | Edits to those components silently have no effect in the running app | Repoint the specifiers to the local files as the first Phase 3 step, then re-verify the affected pages (TEST-002) | Other self-references not yet discovered by grep, e.g. inside dynamic imports added later |
| Overriding a surface another module still needs (e.g. disabling the bulk-delete worker while a page still triggers it) | User-visible failure with no server-side gate | Check `incoming-installed-contributions.md` + wms/sales dependents before disabling | Third-party contributions unknown to facts |
| Reminder flows amplifying one event (repeats, storms) | Notification spam, queue load | Explicit condition + cool-down per Q-002; idempotency key on the subscriber | Business-rule tuning after launch |
| App extension records diverging from catalog records | Stale or orphaned app data | Scalar host ID + full scope, orphan policy, no copied PII | Accepted for app-private enrichment |
| Facts staleness after a framework upgrade | Wrong IDs in later decisions | Facts carry a version stamp (`@open-mercato/core 0.8.0`); re-run `--update-harness` on upgrade | Low |

## Acceptance Criteria

- [ ] **AC-001** — Every requested catalog change has a row with a chosen mechanism and a written reason for rejecting the more expensive options.
- [ ] **AC-002** — If ejected: `POST/PUT /api/catalog/products`, product read enrichment, and the quote→order line snapshot all still work unchanged (TEST-004, TEST-005).
- [ ] **AC-003** — If ejected: rollback restores the package registration and all catalog routes with tables and data intact (TEST-006).
- [ ] **AC-004** — Every removed capability is removed through a supported override key, verified absent in the running UI, with `yarn generate` clean.
- [ ] **AC-005** — Reminder flows deliver to the intended recipients only, inside trusted tenant/organization scope, with a documented repeated-fire policy.
- [ ] **AC-006** — Every affected route still fails closed without its grant (TEST-003), and `yarn generate && yarn typecheck && yarn lint && yarn ds:check` passes.

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | `AGENTS.md`, `.ai/guides/{architecture,extensions,spec-delivery}.md`, `om-spec-writing`, `om-eject-and-customize` |
| Data models, APIs, events, UI, and tests are internally consistent | partial | preserved-contract register is complete; per-delta UI/data rows pending Q-001…Q-004 |
| Every workflow completes end to end without a catch-all integration phase | blocked | Phase 1–3 deliverables cannot be listed before the deltas are known |
| Platform-native reuse and extension points were chosen before custom code | pass | mechanism ladder + host/override inventory |
| UI contracts identify references, canonical components, and theme/state coverage | blocked | `Pending Q-001, Q-003` |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | partial | Phases 0 and 3 are complete; 1–2 pending the deltas |

Verdict: `Blocked — Q-001 through Q-007 unanswered`.

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-001 | Which shipped catalog capabilities must be removed or hidden? | product owner | yes | pending |
| Q-002 | Reminder/notification rules: trigger, threshold, recipient, channel, repeat policy | product owner | yes | pending |
| Q-003 | Product form/list changes: fields, layout, validation, and where added data lives | product owner | yes | pending |
| Q-004 | Does any requirement change the catalog entity model? (decides eject) | product owner + architect | yes | pending |
| Q-005 | Must the shipped order-to-cash and WMS product coupling stay usable? | product owner | yes | pending |
| Q-006 | Do the 7 existing ACL features remain the permission surface? | product owner | no | pending |
| Q-007 | Is this one capability or several independently deployable ones? | architect | yes | pending |

## Changelog

| Date | Change |
|---|---|
| 2026-09-21 | Initial skeleton: mechanism ladder, preserved-contract register, eject impact, risks, phases; Open Questions gate opened |
| 2026-09-21 | Eject spike executed in an isolated worktree; measured evidence recorded, duplicate-metadata hazard disproved, self-referencing-import trap added to risks |
