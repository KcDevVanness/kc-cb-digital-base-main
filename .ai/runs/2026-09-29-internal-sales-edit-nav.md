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
- `.ai/runs/2026-09-29-internal-sales-edit-nav.md` (this file) — the run record the PR tracks.
- Non-goals: no new per-document detail page (that would be a feature, not this bug fix); no change
  to the create page's post-save redirect (it correctly lands on the new document's edit page); no
  change to list/table navigation; no migration, no data change.

## Implementation Plan

### Phase 1: fix

- 1.1 Worktree `../kc-cb-digital-base-min-fix-internal-sales-edit-nav` on
  `fix/internal-sales-edit-nav` off `origin/dev`.
- 1.2 `backHref`/`cancelHref` of `EditForm` → `listHrefFor(kind)`, matching `CreateForm` and the
  other app-owned edit surfaces (`products`, `parties`, `finance`).
- 1.3 Rename `documentDetailHref` → `documentEditHref` (2 call sites in the same file) and rewrite
  its doc comment to state the hazard.
- 1.4 README behavior note; lesson record + catalog row (count 51 → 52).

### Phase 2: verify

- 2.1 Targeted: `yarn generate`, `node scripts/check-lessons.mjs`, `yarn typecheck`, `yarn lint`,
  `yarn ds:check`, `npx jest src/modules/internal_sales`.
- 2.2 Smoke on a second dev server started from this worktree (`APP_URL=http://localhost:3120`):
  open the edit page of a real document, read the rendered `href` of all three links (they must
  address `/backend/internal-sales/{quotes,orders}`, never `…/<id>/edit`), click 「取消」 and watch
  the URL leave the edit page.
- 2.3 Gate: `yarn test`, `yarn build`.

## Risks

- A wrong target would now navigate away from unsaved edits: verified against `CreateForm` and five
  other app-owned edit forms, all of which use the list href, and by the smoke click in 2.2.
- Naming-only rename: `documentDetailHref` was imported nowhere else (checked repo-wide, including
  tests).

## Source doc

`src/modules/internal_sales/README.md` (surface + navigation contract of the six internal-sales
pages); requirement record `.ai/specs/2026-09-22-products-and-trade-docs.md` Phase 6.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles.

### Phase 1: fix

- [ ] 1.1 Worktree + branch off `origin/dev`
- [ ] 1.2 Point the edit page's back/cancel at the list href
- [ ] 1.3 Rename `documentDetailHref` → `documentEditHref`
- [ ] 1.4 README note + lesson record + catalog row

### Phase 2: verify

- [ ] 2.1 Targeted checks (generate, lessons, typecheck, lint, ds:check, jest)
- [ ] 2.2 Live smoke: rendered hrefs + click-through on the worktree dev server
- [ ] 2.3 Broad gate (`yarn test`, `yarn build`)
