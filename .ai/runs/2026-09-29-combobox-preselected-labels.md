# Execution plan — pre-selected pickers rendered raw ids instead of labels (2026-09-29)

Two live reports of the same defect class: a `ComboboxInput` whose value is set from a record shows
the raw id. Fixed both sites, audited every other picker in the app, and recorded the trap.

## Goal

Operator report: on the internal-sales order form, after 「从报价单载入」 the load dialog's quote
picker shows the **quote uuid** when it is reopened (measured on the unfixed build: the uuid stays
for as long as the dialog is open). The same shape appeared in the products form's catalog-link
picker, which shows the catalog product's uuid on every edit of a product that has a link.

Root cause (both sites): the picker's value is set programmatically, the field has no label source
covering it, and `ComboboxInput`'s eager fallback — which would fetch the first page of options and
look the value up — is defeated by React StrictMode's double-invoked effect: the first run starts the
fetch and sets its `eagerFallbackLoadedValueRef`, the cleanup cancels that fetch, and the second run
returns early on the ref. The request is visible in the network log while the label never lands.
`resolveLabel` (the component's documented path for a pre-selected value) has no such guard, which is
why the pickers that already passed it — the buyer picker, the shipment warehouse/location pickers —
never showed the defect.

## Scope

- `src/modules/internal_sales/lib/quoteLoad.ts`: new `resolveQuoteLabel(id)` — the quote read by
  `id=`, mapped through the same `quoteOptionFromRecord` the option list uses.
- `src/modules/internal_sales/components/QuoteLoadPanel.tsx`: the quote picker passes
  `resolveLabel={resolveQuoteLabel}`.
- `src/modules/internal_sales/components/InternalSalesForm.tsx`: the line product picker passes a
  `resolveLabel` built on the existing `loadProductOption` by-id read (its `seedOptions` covers the
  normal case; this covers a loaded line whose snapshot label is empty).
- `src/modules/products/lib/catalogLink.ts` (new): `catalogLinkLabel(item)` (the `SKU — title`
  shaping, now shared by the option list and the resolver) and `resolveCatalogLinkLabel(value)`.
- `src/modules/products/components/ProductForm.tsx`: the catalog-link picker passes the resolver and
  imports the shared label shaping.
- `src/modules/products/lib/__tests__/catalogLink.test.ts`: five cases for the label shaping.
- `.ai/lessons/preselected-picker-value-needs-a-label-resolver.md` + catalog row; README notes in
  both modules.
- Audit (read-only, recorded in the PR body): all 12 `ComboboxInput` usages in `src/modules/**`.
- Non-goals: no change to `ComboboxInput` itself (framework source is read-only — the fallback gap is
  reported upstream in the lesson, not patched locally); no change to any other picker's behaviour.

## Implementation Plan

### Phase 1: fix

- 1.1 Worktree `../kc-cb-digital-base-min-fix-combobox-labels` on `fix/combobox-preselected-labels`
  off `origin/dev`.
- 1.2 `resolveQuoteLabel` + the quote picker wiring.
- 1.3 The catalog-link resolver module, the products wiring, the label-shaping test.
- 1.4 The line product picker's resolver; lesson + README notes.

### Phase 2: verify

- 2.1 Targeted: `yarn generate`, `node scripts/check-lessons.mjs`, `yarn typecheck`, `yarn lint`,
  `yarn ds:check`, `npx jest src/modules/products src/modules/internal_sales`.
- 2.2 Live smoke on a dev server started from this worktree, plus the **unfixed** build for the
  baseline: quote picker after a load (uuid → label), products catalog link (uuid → `SKU — title`).
- 2.3 Broad gate: `yarn test`, `yarn build`.

## Risks

- A resolver that throws would leave the raw value: both resolvers are called only for an uncovered
  value, return `''` when the record is gone, and are wrapped by the component's own `.catch`.
- An extra request per uncovered value: acceptable (one `id=` read), and it replaces a fetch the
  fallback would have made anyway.
- The parallel `feat/sales-trade-type` branch also edits `QuoteLoadPanel.tsx`; this diff is three
  lines there plus one new export, so the rebase is mechanical.

## Source doc

`.ai/lessons/preselected-picker-value-needs-a-label-resolver.md` (the rule this run establishes);
`src/modules/internal_sales/README.md` and `src/modules/products/README.md` (the affected surfaces).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles.

### Phase 1: fix

- [x] 1.1 Worktree + branch off `origin/dev` — 8c29872
- [x] 1.2 Quote picker resolver — 8c29872
- [x] 1.3 Catalog-link resolver + tests — 8c29872
- [x] 1.4 Line product picker resolver; lesson + README notes — 8c29872

### Phase 2: verify

- [x] 2.1 Targeted checks — 8c29872
- [x] 2.2 Live smoke (fixed vs unfixed) — 8c29872
- [x] 2.3 Broad gate (`yarn test`, `yarn build`) — 8c29872
