# Execution plan — fix the dead back/cancel links on the internal-sales edit page (2026-09-29)

`/backend/internal-sales/{quotes,orders}/[id]/edit` renders three navigational links that all
addressed the page the operator was already on, so a click did nothing: the header 「← 返回」 and
the header/footer 「取消」. This run points them at the module's list href and removes the helper
name that produced the trap.

## Goal

Operator report (2026-09-29, live quote edit page): "这三个按钮点击无效" — the header 「← 返回」 plus
both 「取消」 buttons do nothing. Root cause: `EditForm` in
`src/modules/internal_sales/components/InternalSalesForm.tsx` passed
`backHref={documentDetailHref(kind, documentId)}` and the same value for `cancelHref`, and
`documentDetailHref` returns `` `${listHrefFor(kind)}/${documentId}/edit` `` — the edit page itself.
The module ships no detail view, so the edit page *is* the document's page and the link target was
its own URL; `Next`'s `<Link>` to the current route navigates nowhere. The create form one function
below already used the correct target (`listHrefFor`).

## Scope

- `src/modules/internal_sales/components/InternalSalesForm.tsx`: edit-page `backHref`/`cancelHref`
  → `listHrefFor(kind)`; rename the misleading `documentDetailHref` → `documentEditHref` and
  correct its stale "installed pages answer 404" comment (the module README's 2026-09-22 correction
  records that the installed dynamic pages answer again; the module stays on its own edit page by
  choice).
- `src/modules/internal_sales/README.md`: the behavior note under 「与官方动态页的关系」.
- `.ai/lessons/edit-page-is-not-its-own-back-target.md` + its `.ai/lessons.md` catalog row.
- `src/modules/internal_sales/components/InternalSalesTable.tsx`: its hand-built
  `/backend/internal-sales/orders/${id}/edit` redirect and its own list-href ternary now call the
  shared helpers, so the module has one place where those routes are written down.
- `.ai/runs/2026-09-29-internal-sales-edit-nav.md` (this file) — the run record the PR tracks.
- Review follow-ups found by the independent pass on this PR (Phase 3):
  `src/modules/internal_sales/backend/internal-sales/{quotes,orders}/{create,[id]/edit}/page.meta.ts`
  breadcrumbs pointed at the **installed** sales lists while naming a neutral label; the buyer picker's
  five strings (`internal_sales.form.buyer.*`) were missing from both module dictionaries, so the
  Chinese UI rendered the component's English fallbacks; `internal_sales.page.title` becomes unused
  with the breadcrumb fix and is removed from both dictionaries (key sets stay aligned).
- Non-goals: no new per-document detail page (that would be a feature, not this bug fix); no change
  to the create page's post-save redirect (it correctly lands on the new document's edit page); no
  change to which rows/actions the table renders; no migration, no data change.

## Implementation Plan

### Phase 1: fix

- 1.1 Worktree `../kc-cb-digital-base-min-fix-internal-sales-edit-nav` on
  `fix/internal-sales-edit-nav` off `origin/dev`.
- 1.2 `backHref`/`cancelHref` of `EditForm` → `listHrefFor(kind)`, matching `CreateForm` and the
  other app-owned edit surfaces (`products`, `parties`, `finance`).
- 1.3 Rename `documentDetailHref` → `documentEditHref` (three usages, all in the same file: the
  post-create redirect plus the two edit-page targets) and rewrite its doc comment to state the
  hazard.
- 1.4 README behavior note; lesson record + catalog row (count 51 → 52).
- 1.5 `InternalSalesTable`: the post-convert redirect and the list href call `documentEditHref` /
  `listHrefFor` instead of repeating the route strings.

### Phase 2: verify

- 2.1 Targeted: `yarn generate`, `node scripts/check-lessons.mjs`, `yarn typecheck`, `yarn lint`,
  `yarn ds:check`, `npx jest src/modules/internal_sales`.
- 2.2 Smoke on a second dev server started from this worktree (`APP_URL=http://localhost:3120`):
  open the edit page of a real document, read the rendered `href` of all three links (they must
  address `/backend/internal-sales/{quotes,orders}`, never `…/<id>/edit`), click 「取消」 and watch
  the URL leave the edit page.
- 2.3 Gate: `yarn test`, `yarn build`.

### Phase 3: review follow-ups

- 3.1 The four create/edit breadcrumbs name and link to this module's own list
  (`internal_sales.list.{quote,order}.title` → `/backend/internal-sales/{quotes,orders}`).
- 3.2 Buyer picker strings in both module dictionaries
  (`internal_sales.form.buyer.{relatedOrgPrefix,externalPrefix,selectPlaceholder,orgLoadFailed,partyLoadFailed}`),
  and drop the then-unused `internal_sales.page.title`; `yarn generate` refreshes the shards.
- 3.3 Verify: dictionary key-set parity, language-purity test, `yarn i18n:check-hardcoded`, the full
  gate, and a browser smoke that reads the rendered breadcrumb href and the picker's Chinese labels.

## Risks

- A wrong target would now navigate away from unsaved edits: every app-owned edit form was checked
  and none points back at the route that renders it (`products`, `parties`, `finance`,
  `cross_border`, `platform_ops`, `export_finance` and this module's `CreateForm` use their list;
  `purchasing`'s purchase-order edit form uses its document detail page, which is also non-self) —
  and `CrudForm` installs a capture-phase dirty guard that prompts before any same-origin
  navigation while the form is dirty, so the change cannot silently drop edits.
- Review pass (independent read-only agent, 2026-09-29): no correctness finding; the remaining
  findings were documentation accuracy (fixed in this run), a hand-built href copy in the table
  (1.5), a pre-existing breadcrumb that points at the installed sales list, and a pre-existing
  missing-i18n-key gap in the buyer picker — both recorded on the PR as follow-ups, not fixed here.
- Naming-only rename: `documentDetailHref` was imported nowhere else (checked repo-wide, including
  tests).

## Source doc

`src/modules/internal_sales/README.md` (surface + navigation contract of the six internal-sales
pages); requirement record `.ai/specs/2026-09-22-products-and-trade-docs.md` Phase 6.

## Progress

PR: #29

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles.

### Phase 1: fix

- [x] 1.1 Worktree + branch off `origin/dev` — 2c2f3ea
- [x] 1.2 Point the edit page's back/cancel at the list href — b04123c
- [x] 1.3 Rename `documentDetailHref` → `documentEditHref` — b04123c
- [x] 1.4 README note + lesson record + catalog row — b04123c
- [x] 1.5 Route the table's hrefs through the shared helpers — bdf148c

### Phase 2: verify

- [x] 2.1 Targeted checks (generate, lessons, typecheck, lint, ds:check, jest) — b04123c
- [x] 2.2 Live smoke: rendered hrefs + click-through on the worktree dev server — b04123c
- [x] 2.3 Broad gate (`yarn test`, `yarn build`) — bdf148c

### Phase 3: review follow-ups

- [x] 3.1 Breadcrumbs → this module's lists — aed8b82
- [x] 3.2 Buyer picker keys in both dictionaries; drop `internal_sales.page.title` — aed8b82
- [x] 3.3 Verify (key-set parity, purity test, gate, browser smoke) — aed8b82
