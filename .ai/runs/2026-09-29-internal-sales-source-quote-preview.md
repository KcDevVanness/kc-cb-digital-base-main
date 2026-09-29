# Execution plan — source-quote preview drawer for internal-sales orders (2026-09-29)

The order form's 「来源报价单：QUOTE-…」 was a plain link to the quote's edit page. Following it from
an order that had just been loaded (or edited) threw away the operator's unsaved order. This run
turns that line into a read-only preview drawer on the current page.

## Goal

The module's order create/edit pages show which quote the order came from (REQ-003 of
`.ai/specs/2026-09-29-internal-sales-order-from-quote.md`). The affordance was
`<Link href={quoteEditHref(sourceQuote.id)}>` inside `QuoteLoadPanel`, so a glance at the source
quote cost the operator their unsaved order — the `CrudForm` dirty guard only turned that into a
prompt, it did not make the glance cheap. Operators also had no way to see *what* a quote contains
before loading it (`?fromQuote=` loads blind).

The platform already ships the right primitive: `@open-mercato/ui/primitives/drawer` — the side-sheet
whose own doc comment calls it the "contextual / non-blocking-feeling" surface for detail panes,
distinct from `Dialog`'s "modal / focused" use. The drawer reads the quote through the loader the
load action already uses, so nothing new is fetched and no write path is touched.

## Scope

- `src/modules/internal_sales/lib/quoteLoad.ts`: the draft carries the engine's own projection
  (`record`), and a new pure `sourceQuotePreviewFromDraft` maps it (number, buyer, currency, status,
  total, reference, comments, lines) for the drawer.
- `src/modules/internal_sales/components/QuoteLoadPanel.tsx`: the source line's number becomes a
  preview button (`LinkButton`, labelled 「预览来源报价单 QUOTE-…」) that opens a right-side `Drawer`
  (loading / error / empty-lines states, `MoneyAmount` for money, `DictionaryValue` for status);
  the drawer footer keeps the real navigation as an explicit 「打开报价单」 button. Both modes
  (create and edit) render it.
- `src/modules/internal_sales/lib/salesStatus.ts`: the status-dictionary key moves out of the table
  so the list column and the drawer cannot drift onto different dictionaries.
- `src/modules/internal_sales/i18n/{zh,en}.json`: seven new keys (aria label, loading, failed,
  missing, lines heading, open action, empty lines).
- `.ai/specs/2026-09-29-internal-sales-order-from-quote.md` (reuse-spec): REQ-003, J-003, the
  surface table, the mock, a risk row, TEST-003, AC-003 and a Changelog row.
- `src/modules/internal_sales/README.md`: the load section's source-record bullet and the smoke
  record.
- Non-goals: no new route, no API/command/entity change, no migration, no change to the load dialog
  or the list entry, no `production` promotion.

## Implementation Plan

### Phase 1: preview

- 1.1 Worktree `../kc-cb-digital-base-min-feat-source-quote-preview` on
  `feat/internal-sales-source-quote-preview` off `origin/dev`.
- 1.2 `QuoteDraft.record` + `sourceQuotePreviewFromDraft` (pure, total).
- 1.3 The drawer in `QuoteLoadPanel` + the status-key extraction + the seven i18n keys.
- 1.4 Unit tests for the preview mapping (empty quote must not show the loader's starter row).

### Phase 2: verify

- 2.1 `yarn generate`, `node scripts/check-lessons.mjs`, dictionary key parity, language-purity
  test, `yarn typecheck`, `yarn lint`, `yarn ds:check`, `npx jest src/modules/internal_sales`.
- 2.2 Live smoke on a dev server started from this worktree: order edit page → click the source
  number → drawer shows the quote's head and lines while the URL and the form's values stay
  unchanged; the footer 「打开报价单」 navigates on a clean form; zh and en both render.
- 2.3 Broad gate: `yarn test`, `yarn build`.

## Risks

- The drawer reads a quote the operator may not be allowed to see: failures are mapped in place
  (403 → permission message, 404 → "no longer there"), and the preview never blocks the form.
- The preview trigger replaced a link: the navigation still exists, one explicit click away, and the
  platform's dirty guard still intercepts it on a dirty form.
- The preview shows the quote's stored fields only (no computed totals): the status dictionary and
  `MoneyAmount` render exactly what the projection carries, with `—` for what it does not.

## Source doc

`.ai/specs/2026-09-29-internal-sales-order-from-quote.md` (REQ-003 / J-003, extended here);
`src/modules/internal_sales/README.md` (the module's surface contract).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles.

### Phase 1: preview

- [x] 1.1 Worktree + branch off `origin/dev` — 26219ed
- [x] 1.2 Draft carries the record; pure preview mapper — 26219ed
- [x] 1.3 Drawer + status key extraction + i18n keys — 26219ed
- [x] 1.4 Unit tests for the preview mapping — 26219ed

### Phase 2: verify

- [x] 2.1 Targeted checks — 26219ed
- [x] 2.2 Live smoke (drawer, no data loss, footer navigation, zh/en) — 26219ed
- [x] 2.3 Broad gate (`yarn test`, `yarn build`) — 26219ed
