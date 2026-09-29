# Execution plan — internal-sales dictionary hygiene (2026-09-29)

Two dictionary-level defects in `internal_sales` after the navigation wave landed (#29 + #30): one
value my own PR changed without claiming it, and one key that no code reads.

## Goal

1. **Restore the sentence case of the English create title.** `internal_sales.form.quote.createTitle`
   was `"New internal sales quote"` on `main@5aaf5a6`; the fuzzy edit that removed the dead
   `internal_sales.page.title` key also rewrote this line to `"New Internal Sales Quote"`. Nothing in
   that PR claimed the change, and the en UI now reads Title Case beside its sentence-case siblings
   (`form.quote.editTitle` = "Edit internal sales quote", `form.order.createTitle` = "New internal
   sales order (PO)") and beside every other `*.form.createTitle` in the repo (`purchasing`,
   `parties`, `products`). The key is user-visible in a served locale: sidebar item, page title,
   breadcrumb leaf, list create button and empty-state label.
2. **Drop the second dead dictionary key.** `internal_sales.form.customerLoadFailed` has no reader
   anywhere in `src/`, `docs/` or `.ai/` — the buyer picker reports its failures through
   `internal_sales.form.buyer.partyLoadFailed`, which #29 added. Same class as
   `internal_sales.page.title`, which #29 removed.

## Scope

- `src/modules/internal_sales/i18n/en.json`: restore the sentence-case value.
- `src/modules/internal_sales/i18n/{en,zh}.json`: remove `internal_sales.form.customerLoadFailed`
  from both (key sets stay identical).
- `.ai/runs/2026-09-29-internal-sales-i18n-hygiene.md` (this file) — the run record the PR tracks.
- Non-goals: no code change, no new key, no change to any other module's dictionary, no
  `production` promotion (that is an explicit deploy action, not part of this unit).

## Implementation Plan

### Phase 1: fix

- 1.1 Worktree `../kc-cb-digital-base-min-fix-internal-sales-i18n` on `fix/internal-sales-i18n` off
  `origin/dev` (`7f48198`, the wave landing).
- 1.2 Restore `"New internal sales quote"`; delete the dead key from both dictionaries.
- 1.3 `yarn generate` so the locale shards pick the change up.

### Phase 2: verify

- 2.1 `node scripts/check-lessons.mjs`, dictionary key parity, language-purity test,
  `yarn typecheck`, `yarn lint`, `yarn ds:check`, `npx jest src/modules/internal_sales`.
- 2.2 Broad gate: `yarn test`, `yarn build`.
- 2.3 Rendered check: the en value is what the module's own i18n file now holds and the zh value is
  untouched; the removed key has no reader (repo-wide grep), so no string can fall back to a raw key.

## Risks

- A reader for the deleted key could exist outside the repo's tracked paths (an operator's saved
  browser state cannot reference an i18n key, and no code path reads it) — grep covers `src/`,
  `docs/` and `.ai/`.
- The value revert is cosmetic and en-only; the zh string is unchanged.

## Source doc

`docs/dev/i18n.md` (module dictionaries, key-set parity, English fallbacks) and
`src/modules/internal_sales/README.md` (the module's i18n surface).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles.

### Phase 1: fix

- [ ] 1.1 Worktree + branch off `origin/dev`
- [ ] 1.2 Restore the value; delete the dead key
- [ ] 1.3 `yarn generate`

### Phase 2: verify

- [ ] 2.1 Targeted checks
- [ ] 2.2 Broad gate (`yarn test`, `yarn build`)
- [ ] 2.3 Rendered/dictionary check
