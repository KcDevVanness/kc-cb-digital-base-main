# kc-cb-digital-base-min — Standalone App Agent Rules

<!-- CODEX_ENFORCEMENT_RULES_START -->
## Codex enforcement

Read and route through the rest of this file; its `Always`, `Never`, and Task Router sections are the authority for Codex too. They are stated once below rather than duplicated here, so this prelude costs the router no budget.

<!-- CODEX_ENFORCEMENT_RULES_END -->


Route first; never probe unmatched context.

## Always

- Route all axes; missing context: `yarn mercato agentic:init --update-harness`.
- Lessons: scan `.ai/lessons.md` tags; open/update one matching record + row.
- Delivery: one work unit = one worktree = one branch = one PR; commit per slice, run the gate, open the PR — never wait to be asked, never push `main`/`production`/`dev` (see Delivery Flow).
- App code: `src/modules/<id>/`; framework context only for named gaps.
- Derive trusted `tenantId` + `organizationId` and fail closed. Only an installed contract may use system scope (`organizationId: null`).
- Use commands/`makeCrudRoute`/`CrudForm`/`DataTable`, DI/events/UMES; effects stay post-commit.
- Put entities in `src/modules/<id>/data/entities.ts`; API routes need per-method `metadata` + `openApi`.
- Editable records expose `updated_at`/`updatedAt`; custom update/delete clients send the version and surface 409s.
- Run `yarn db:generate`, review scoped SQL/snapshot, and ask before applying it.
- Run `yarn generate` after discovery files/`src/modules.ts`/routes/pages/events/widgets/agents/tools/workflows change.
- Contract-surface changes (route/schema/ID/export/seam/signature/event payload/CLI) MUST read `.ai/guides/upstream/BACKWARD_COMPATIBILITY.md`; tenant/org scope alone is not a contract.
- Localize strings; use shared UI/tokens and cover loading/empty/error/conflict/keyboard/a11y.
- One string, one language: UI text goes through `t()` (English fallback); dictionary/seed labels and seed `name`/`description` carry a single language and the display name only, with a stored code rendered by the picker as `CODE — name`; printed/exported documents resolve their labels through `t()` at generation time. Never write 「供应商货号 Supplier code」-style pairs; `src/lib/i18n/__tests__/language-purity.test.ts` enforces it (rules: `docs/dev/i18n.md`).

## Ask First

- Ask before scope/architecture/public contracts/dependencies/ejection/canonical primitives; migrations/resets/DB targets; live credentials/providers; or weakening security/concurrency/retries/idempotency/audit/undo.

## Never

- Never leak tenants, trust payload scope, or treat missing scope as unrestricted.
- Never edit `node_modules`/`.mercato/generated/**`/generated facts/shipped migrations.
- Never use cross-module ORM relations; use IDs/snapshots/events/enrichers/extensions/optional DI.
- Never use raw admin `fetch`/`<form>`, ad hoc crypto/cache/queues, role-name guards, or direct mutations when helpers exist.
- Never hard-code user strings/status colors; expose secrets/transcripts; or guess answerable contracts.

## Validation

Broad: `yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test && yarn build`; integration: `yarn test:integration:ephemeral`. Never migrate to validate.
That broad run **is** the unit-PR gate: CI's `validate` runs those commands only for release targets (PRs based on `main`/`production`, pushes to `main`) and reports a green, out-of-scope verdict on PRs based on `dev` — so never flip a unit PR to ready without this local run, and never read that green as verification.

## Delivery Flow (default, every session)

One work unit = one module / one spec slice / one bug = one worktree = one branch = one PR = one agent.
The default is autonomous: claim, isolate, commit per slice, gate, PR — never wait for the user to ask.
Mechanics and the shared-file conflict list: `docs/dev/parallel-development.md`; PR/review machinery:
`.agents/skills/om-auto-create-pr/SKILL.md` plus the `.ai/skills/**` overrides (`om-auto-continue-pr`,
`om-auto-review-pr`) — read the skill before driving a PR by hand.

1. **Claim before the first edit.** `git worktree list` + `gh pr list --state open`: if the unit
   already has a branch/worktree/PR, continue that one (`om-auto-continue-pr`) instead of opening a
   second; the same module or spec slice is never worked twice in parallel.
2. **Isolate.** `git worktree add ../kc-cb-digital-base-min-<slug> -b feat/<slug> origin/dev`
   (bugfix `fix/<slug>`, process/tooling `chore/<slug>`), then `yarn install && yarn generate` and a
   `.env` copy with its own port block. Branch base is `origin/dev` — the integration trunk
   `.ai/agentic.config.json` names as `baseBranch`; unit PRs target `dev`. Two exceptions, each
   declared in the PR's `## Assumptions`: a hotfix or bootstrap change that must reach `main` now
   bases on `origin/main`, and a stack (child base = parent branch) is retargeted to `dev`
   (`gh pr edit <child> --base dev`) the moment the parent merges. Never point a PR at a branch that
   is already merged into `main` — everything merged into it afterwards stays out of `main`. Never
   work a unit inside another unit's tree; never nest worktrees.
3. **Commit per slice.** One coherent change per commit, conventional subject, the affected subset of
   `Validation` before each commit, push after every phase so an interrupted run is resumable. Other
   sessions' uncommitted files are read-only for you; never rewrite a pushed shared branch.
4. **Close out.** Broad gate (`Validation`) green; a docs-only change runs the relevant lint plus
   `node scripts/check-lessons.mjs` when a lesson changed.
5. **PR.** Open as a **draft** at the first push, flip to **ready** (`gh pr ready`) only when the gate
   is green and the Progress list is complete. Body MUST carry `Tracking plan:`/`Source doc:` (this
   tracker has no issues; the spec/run path is the requirement record — add `Closes #N`/`Refs #N` the
   day issues exist), `## Goal` (problem + root cause), `## What Changed`, `## Assumptions`,
   `## 🧪 Tests` (commands + result counts), `## 💥 Breaking Changes`, `## Rollback`, `## 📋 Progress`.
   Docs, specs and module READMEs ride in the same branch and PR as the code they describe; never a
   separate `docs/*` branch for the same unit.
6. **Clean up after the merge.** The remote branch is auto-deleted (`delete_branch_on_merge`); run
   `yarn branches:cleanup --apply` for the local branch and its clean worktree, and read its trunk
   rows: `carrying` on `dev` means the wave closes — open `dev → main` with a body listing the units,
   and once that merges reset the trunk with `git push --force-with-lease origin origin/main:dev`.
   `behind` and `diverged` are that report's next actions; never leave a trunk row unread. An
   integration branch (base of stacked PRs) is finished only when `git diff --diff-filter=A
   --name-only origin/main <branch>` is empty — land the remainder first, then delete it.
7. **Labels + disclosure.** Apply the pipeline/category/priority/risk labels from
   `.ai/agentic.config.json`; AI-authored commits carry an `[AI-Generated]` trailer in the body (never
   in the subject) and run comments open with the `🤖` marker.
8. **Never commit or push to `main`, `production` or `dev`** — every change enters through a PR; the
   only push a trunk accepts is the post-landing reset (`git push --force-with-lease origin
   origin/main:dev`), and the `main` admin bypass is not a shortcut for routine work.

## Three-Axis Context Assembler

Routes are additive: ownership says WHO; other axes say WHAT. Select every match.

`debugging` is additive. A scalar-ID/snapshot fix to persisted records or commands linked to an installed record MUST use `module-data` + `umes` and load `om-data-model-design` + `om-system-extension`.

`debugging` = reported bug/security/drift, not designed failure UI. Custom fields/entities = `umes` + `module-data` + `om-data-model-design`; editable round trips add `backend-ui`, requested coverage adds `testing`. Never infer work from specs/PRs.

Unified-override audits = `umes` only; add `architecture`/`framework-context` only for unresolved ownership or installed keys. Durable process/activity/user task = `module-data` + `ai-workflow`. Multi-stage waits/cancel/restart are durable; reminders and renewal/batch schedules are `module-data`.

`backend-ui`: replacing/wrapping, prop-transforming, menu-editing, or adding visible feedback adds `backend-ui`; merely hiding/toggling/rewiring installed UI does not.
Staff UI preview/report/bulk = `backend-ui`.
Existing installed form/table fields, filters, row/bulk actions without app persistence = `umes` + `backend-ui` only: read `crud-surfaces` + `quality-states`; do not load contracts, module-scaffold, or page/navigation.

`backend-ui`: UI skill `references/quality-states.md`; public/portal/responsive/a11y adds `frontend-and-design-system.md`.

### Axis 1 — Area/Ownership

| Route | Match | Context |
|---|---|---|
| `architecture` | Capability/ownership/field-vs-history choice, boundary, upgrade, override, or registry failure; routine discovery stays in its area | `.ai/guides/architecture.md` + named facts |
| `module-data` | App-owned domain/data/API | `src/modules/<id>/` + `.ai/guides/contracts.md`; add architecture only when ownership is unresolved |
| `umes` | Extend/replace installed behavior | `.ai/guides/extensions.md` + named facts |
| `backend-ui` | Authored/restyled rendered surface or browser UI state/session bootstrap | `.ai/guides/backend-ui.md` + host facts; host-provided integration credentials/health UI alone does not match |
| `integration` | Provider, spreadsheet/CSV/file I/O, sync/webhook/storage | `.ai/guides/integrations.md`; imports = `integration`; AI consuming files = `ai-workflow`, NEVER `integration` unless transport/storage changes |
| `ai-workflow` | Agent/tool/MCP/orchestrator/durable workflow | `.ai/guides/ai-workflows.md` + facts; schedules/queues/workers/retries/progress alone are `module-data` |
| `debugging` | Bug/security/drift/runtime inconsistency | `.ai/guides/testing-debugging.md` + affected areas |

API/command/record/status/event/UI changes/guards = `umes`; app persistence = `module-data`; installed guard without app persistence = `umes` only, so do not load contracts; read-only behavior/auth/dependents/customization = `framework-context` (alone: no extensions guide; report `installed-version`). Facts do not. Providers are published, never `packages/*`.

### Axis 2 — Work Units

Match every work-unit row; OPEN its skill before selection.

| Route | Work unit | Skill/context |
|---|---|---|
| `architecture` | Explain/choose module, UMES, package, eject | architecture; `om-help` for an unresolved or comparative choice across these mechanisms |
| `module-data` | Business slice or multi-seam domain/API/command fix | MUST load `om-module-scaffold` + its exact `.ai/skills/om-module-scaffold/references/business-one-shot-blueprints.md` key, which resolves units inside the slice, not ownership — an ownership/capability outline adds `architecture` |
| `spec-pr` | Spec/plan | Axis 3; phases+integration coverage (`integration-coverage`); no domain routes |
| `architecture` | Upgrade audit or disable built-in | troubleshooter + framework context, or trim skill + exact `src/modules.ts`/`package.json` |
| `architecture` + `integration` + `framework-context` | Provider superseded by installed capability | integration builder + exact framework context |
| `module-data` | Entity/link/validator/migration/encryption/lock/transaction | `om-data-model-design` + contracts |
| `module-data` | CRUD/API/command/OpenAPI/ACL/setup/mutation | `om-module-scaffold` + contracts |
| `backend-ui` | Form/table/page/renderer/middleware/nav/i18n/UI states | `om-backend-ui-design` + backend UI |
| `module-data` | Search/analytics/event/notification/message/worker/progress/cache/CLI | scaffold + contracts |
| `umes` | Fields/extension entities/links/enrichers/injection/interceptors/guards/subscribers/DOM/widgets/toggles/overrides | `om-system-extension` + extensions; choices load `mechanism-selector` + `extension-branches` |
| `integration` | Provider/credentials/health/webhook/files/client/reconciliation/package | `om-integration-builder` + integrations |
| `ai-workflow` | Agent/tool/MCP/OpenCode/Code Mode/orchestrator/AI file or content drafting/attachment/override | `om-create-ai-agent` + AI/workflows; MCP/OpenCode loads `surface-selector` + `ai_assistant` facts |
| `ai-workflow` | Workflow/activity/user task/idempotency/output/progress | `om-build-workflow` + AI/workflows |
| `testing` | REQUEST says test/coverage/prove, or verify by exercising API/browser/screen sizes/keyboard/screen-reader—not a fix's implicit regression duty or review/audit/config check | MUST read `.ai/guides/testing-debugging.md` + external `om-integration-tests` for integration/E2E/app tests |
| `debugging` | Reproduce/root-cause/minimal fix/regression oracle | `om-troubleshooter` + testing/debugging |
| `framework-context` | Exact installed contract still unknown | `.ai/guides/framework-contracts.md`, then bounded `om-framework-context`, last |
| `debugging` + `testing` | Add/fix recurring harness case/test | `om-evolve-harness` |

`framework-context`: resolve one named fact first. Use bounded source only if the guide leaves current behavior, authorization, dependents, or safest customization seam unresolved; never for “installed contracts” alone.

### Axis 3 — SDLC and Delivery

Spec gate before code: new capability/architecture/schema/API contract/cross-module/multi-phase -> spec first (`spec-first`); covering `.ai/specs` match -> reuse and update it (`reuse-spec`); bug fix/minor fix/docs/dependency/isolated refactor -> proceed (`direct`); only the request's explicit words waive a feature spec; workflow-changing ambiguity -> ask once (`ask`). Then `om-module-scaffold` starts at `src/modules/example/README.md`.

Read `.agents/skills/<id>/SKILL.md` AND any `.ai/skills/<id>/SKILL.md` override. Missing skill: `yarn install-skills`. Commit+ready PR MUST add `spec-pr`, read `.ai/skills/om-auto-create-pr/SKILL.md`, and keep task routes (`delivery-route-preserves-task-routes`).

| Route ID | Delivery need | Skill |
|---|---|---|
| `spec-pr` | Write/revise spec | MUST invoke `om-spec-writing` (OMH-005) + `.ai/guides/spec-delivery.md` |
| `spec-pr` | Local phases / whole-spec / PR / issue / review | `om-implement-spec` (OMH-006) / `om-auto-implement-spec` / `om-auto-create-pr` / `om-auto-fix-issue` / `om-auto-review-pr` |
| — | No PR/spec workflow | Do not load delivery skills |

### Token-Efficient Assembly Policy

- Load matched guides once, then only needed references/facts.
- Hard budgets: guide > skill > references; open a reference only for its named subject.
- `spec-pr` reads template via spec-delivery.
- Inspect app call sites before bounded `framework-context`.
- Additive page/form/table/conflict UI skips it.
- Never bulk-read guide, skill, fact, or source trees.

## Module-Specific Facts

Mechanisms: events/subscribers→events; long operation/progress→progress; provider settings/health/OAuth→integrations; sync/import→data_sync. Hosts: session/auth→auth; customer/contact/deal/pipeline→customers; product/price/stock/inventory→catalog; currency/money→currencies; cart/checkout/shopper→checkout; portal→portal+customer_accounts; quote/order/invoice/sales assistant→sales; notification→notifications; webhook/callback→webhooks; schedule/reminder→scheduler; workflow/activity/user task→workflows; assistant→ai_assistant; maintained query index/reindex→query_index; search convergence→search. staff/employee≠optional staff; audit/record-who≠audit_logs unless extended. App primitives skip api_docs/search/query_index unless changed. Big fact-sheets: read in sections.

<!-- om:module-guides:start -->
Enabled module facts: `api_docs`,`attachments`,`audit_logs`,`auth`,`catalog`,`configs`,`currencies`,`customers`,`dashboards`,`dictionaries`,`directory`,`entities`,`events`,`feature_toggles`,`notifications`,`query_index`,`sales`,`search`,`wms`.

Load `.ai/guides/modules/<id>/index.md` only for a targeted installed module/host; never preload all module facts.
<!-- om:module-guides:end -->

## Documentation

`docs/` is the human documentation home — Markdown, one folder per type: `dev/` setup and
architecture, `deploy/` build and ops, `prd/` requirements, `plans/` phased plans,
`pitfalls/` post-mortems, `ru-petkit/` the RU PETKIT integration contract, field mapping and
evidence. Each folder's `README.md` is its contract; `docs/README.md` indexes
them and states the `.ai/` vs `docs/` split — a pitfall belongs in exactly one of them.

A change that alters behavior, setup, a contract, or an operational step MUST update the
matching document in the same change.

Local run surface (dev port/`APP_URL`, compose services, demo accounts, form-urlencoded login):
`docs/dev/setup.md` — take ports from the `Local:` line the dev supervisor prints, not from prose.

### Status truth (this deployment)

- The authoritative state of a capability is its spec's `**Status**` line in `.ai/specs/`; the human
  overview is `docs/plans/README.md` → 规格状态板, and the per-slice evidence is the 进度 table in
  `docs/plans/cross-border-erp.md`. Shipping a phase updates, in the same change: the spec
  `**Status**` + one Changelog row, the plan's progress table, the affected `docs/dev/*`, and
  `src/modules/<id>/README.md`.
- Never write "done / not done" without re-runnable evidence (a `file:line`, a generated registry, the
  real migration filename). A spec's `TEST-*` row counts only when the test artifact exists — record
  smoke-only evidence as smoke-only.
- Harness-managed files are regenerated by `yarn mercato agentic:init --update-harness`; never fix one
  directly: `.ai/guides/**`, `.ai/harness/**`, `.ai/skills/**`, `.ai/trackers/**`,
  `.ai/review-checklist.md`, and inside `.ai/specs/` only `README.md`, `SPEC-000-template.md` and
  `2026-08-06-reference-module-activation.md`. App-owned and safe to edit: `docs/**`,
  `src/modules/**`, `.ai/specs/2026-09-*.md`, `.ai/analysis/**`, `.ai/lessons/**` + `.ai/lessons.md`,
  this file.
- Parallel sessions share this working tree (worktree + PR rules: `docs/dev/parallel-development.md`).
  Run `git status` before touching a module you did not open, keep other people's uncommitted work
  intact, and write state as "as of this change" rather than a claim you did not verify in the tree.

### App ownership map (full map: `docs/dev/business-architecture.md`)

The business surfaces of this deployment are **app-owned** modules under `src/modules/<id>/`; they have
no `.ai/guides/modules/**` fact sheet — their contract is `src/modules/<id>/README.md` (surfaces,
commands, ACL, verification, rollback). The installed modules above stay enabled and are still the data
layer/engine for the same subjects, so load their facts for host/extension questions.

| Subject | App module | Bridge to installed |
|---|---|---|
| product master, categories, variants/SKU, three price tiers | `products` | `catalog` via the optional `catalog_product_id` link only |
| product code rules, the issuance ledger and the code parser (generate/parse/sequences) | `product_codes` | `dictionaries` (seeds `product_brand`/`product_category`); drives `purchasing`'s 生成 button |
| trading parties (buyer / branch / service provider) + bank block | `parties` | — (installed `customers` still serves the installed chain) |
| purchase/sales contracts, inbound/outbound invoices, dual-caliber amounts | `trade_docs` | — |
| supplier master, purchase orders, stage payments, order documents | `purchasing` | receipt write-back arrives from `cross_border` |
| supplier quotations + workbook import, supplier product library | `sourcing` | promotes through `products` commands |
| shipments, in-transit milestones, export documents | `cross_border` | `wms.inventory.receive`, `purchasing…apply-receipt` |
| collections per purchase order, tax refunds per container, order/container files | `export_finance` | read-only over `purchasing`/`cross_border`/`trade_docs` |
| shipment costs, landed-cost allocation, period expenses, payable/receivable/inventory-value/profit ledgers | `finance` | read-only over `purchasing`/`cross_border`/`trade_docs`/`products`/`sales`/`platform_ops` |
| internal quote/order screens | `internal_sales` | engine stays installed `sales` |
| marketplace channels, order mirrors, settlements, reconciliation | `platform_ops` | `integrations` + `data_sync` |
| the RU PETKIT contract as a `data_sync` provider: snapshot projection, per-endpoint cursors, RU-code → product map | `ru_sync` | `data_sync` provider `ru_petkit` + `integrations` credentials |
| read-only executive cockpit page + four dashboard widgets | `boss_cockpit` | reads the RU projections and CN ledgers read-only; no entity, no write path |
| currency dictionary route, FX/currency-policy reconciliation | `currency_policy` | `dictionaries`, `currencies` |
| auth-admin write-scope guards | `scope_guards` | `auth` command interceptors |
| the app-drawn sidebar tree (域 → 模块/台账 → 页面) and the chrome payload that drops the installed flat list | `nav_shell` | `auth` chrome payload + sidebar preferences; the tree is a display layer over each page's own `requireFeatures` |
| the company-order entry: order workbench (`/backend/orders`, aggregate list + fill stages) and the order detail hub (`/backend/orders/<id>`) | `order_hub` | reads `sales`/`purchasing`/`cross_border`/`trade_docs`/`export_finance` through their own routes; no entity, no write path of its own |
| attachment storage operations CLI (`audit`/`migrate`/`verify`/`rollback`/`prune-local`) | `storage_ops` | drives the installed `attachments` driver factory |

Installed admin pages for the ERP modules are `navHidden`: URLs stay resolvable, nothing is
authorized by hiding, and dropping a route with `null` breaks already-stored notification links
(`.ai/lessons/module-override-page-hide-needs-routes-domain.md`).

## Working Sequence

1. Route, then implement the smallest complete slice through real call sites.
2. Discovery change: run `yarn generate`; then the smallest gate/integration paths.
3. Close the unit: commit per slice, run the gate, drive the PR draft → ready (Delivery Flow).

Precedence: root→BC→installed `AGENTS.md`→facts; stop on skew/conflict; never guess.
