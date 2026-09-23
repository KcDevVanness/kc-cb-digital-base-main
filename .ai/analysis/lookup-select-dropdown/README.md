# LookupSelect → dropdown with a browsable first page (framework patch)

App-side requirement, rollout plan and acceptance criteria:
[`docs/prd/lookup-field-dropdown.md`](../../../docs/prd/lookup-field-dropdown.md),
[`docs/plans/lookup-field-dropdown.md`](../../../docs/plans/lookup-field-dropdown.md).

PR-ready patch for **`@open-mercato/ui` 0.8.0**, `backend/inputs/LookupSelect.tsx`, plus its
test file. Motivation: every reference field backed by `LookupSelect` could only be used by
someone who already knew the record — the control fetches nothing until `minQuery`
(default **2**) characters are typed, shows "Start typing to search.", and renders its
results as a tall inline card list that pushes the rest of the form down. New users cannot
browse what exists.

- `0001-lookup-select-dropdown.patch` — component + tests (this document's subject).
- `verify/` — harness that applies the patch to the installed 0.8.0 sources and runs the
  patched test file (see **Verification**).

## What changes

`LookupSelect` becomes a **dropdown**: the result list renders in a popover panel anchored to
the search box, and opening the control loads the first page — no typing required. Indexing,
server-side filtering, and every existing prop keep working.

| Behaviour | Before | After |
|---|---|---|
| Options before typing | none (needs `minQuery` characters, default 2) | panel opens on focus/click/`ArrowDown` and loads with an empty query |
| List presentation | inline list below the input (48px avatar cards, `max-h-80`) | `PopoverContent` anchored to the input, same card markup, `max-h-80` scroll container |
| Mount cost | default-gated fields sent no request; `minQuery={0}` callers sent one per mount | default variants send **no** request until the control is engaged; `minQuery={0}` callers now load on open instead of mount |
| After selecting | list stayed open, query stayed in the box | panel closes, query clears, the value shows in the summary line (or the host's own label) |
| `defaultOpen` | fetched on mount and rendered the list immediately | fetches on mount, panel still opens on intent (a self-opening floating panel over a dialog is worse) |
| Explicit `minQuery` ≥ 1 | type-to-search | unchanged: panel opens on the "type at least N characters" hint, no request below the threshold |
| `disabled` | list rendered, clear/action shielded | unchanged — a locked control renders the **inline** presentation, because it cannot open a panel and must show its selection |
| Static `options` | only rendered when `minQuery` allowed | rendered as soon as the panel opens |

New/changed public surface:

- `variant?: 'dropdown' | 'inline'` (default `'dropdown'`). `inline` is the previous
  presentation, kept for hosts that lay the list out in normal flow (chips + picker) and for
  a locked control.
- `minQuery` default `2 → 0`. Documented on the prop: at the default, opening the panel is a
  search with an empty query; an explicit threshold keeps type-to-search.
- No new i18n keys. New props are optional, so no caller has to change.

## Why the data layer needs no change

Every lookup route already answers an empty query with a bounded first page — verified per
route in the investigation (`pageSize` is clamped to 1..100 by `makeCrudRoute`;
`buildAggregateSearchFilter` returns `null` for an empty term; the status-dictionary and
`/api/currencies/currencies/options` factories behave the same). The only reason options
never appeared was the component's own gate.

Call sites that stay type-to-search today (`LineItemDialog` product/line-status,
`warranty_claims` product, `staff` `CustomerPicker`) pass an explicit `minQuery` and keep
their intent; call sites that already pass `minQuery={0}` (sales payment/shipment dialogs,
eudr plots, warranty variants) simply load on open instead of on mount.

## Apply

```bash
# inside a framework checkout (paths are packages/ui/src/...)
git apply 0001-lookup-select-dropdown.patch
# or
patch -p1 < 0001-lookup-select-dropdown.patch
```

Then run the package's own gate for `@open-mercato/ui` (jest + lint + typecheck) and ship a
release; a standalone app consumes it by bumping `@open-mercato/ui`.

The diff is large on paper (742 changed lines) because the option-list markup moved into a
shared `listBody` block so both variants render one implementation; review the file rather
than the diff stat.

## Verification

`verify/verify.mjs` (no writes outside `.work/`):

1. copies the pristine `LookupSelect.tsx` / `LookupSelect.test.tsx` from
   `node_modules/@open-mercato/ui/src/backend/inputs/`,
2. `git init` + `git apply` the patch (proves a clean application to 0.8.0),
3. copies the two sibling primitives the component imports (`primitives/button.tsx`,
   `primitives/popover.tsx`),
4. runs the patched test file with jest (`verify/jest.config.cjs`, jsdom + this app's
   transformer and setup file).

```bash
node .ai/analysis/lookup-select-dropdown/verify/verify.mjs
# → Test Suites: 1 passed, Tests: 26 passed
```

What the suite pins:

- **new**: opening on focus / `ArrowDown` loads the first page with an empty query; no request
  before engagement; `defaultOpen` preloads without opening a panel; a selection closes the
  panel and stays readable; an explicit `minQuery` threshold still gates requests;
- **unchanged**: `onReady` stability (#2389), combobox/listbox/option semantics, ArrowDown +
  Enter selection, wrapping highlight, Escape clears the query without leaking to the dialog
  (#5456 review), selection visibility after collapse (#5481 review, incl. the "never render a
  raw id" rule from TC-EUDR-013), the legacy inline presentation, and every `disabled`
  guarantee (#5248).

Two environment notes for whoever runs these tests:

- **Drive the debounce with fake timers, as the sibling `ComboboxInput` suite already does.**
  With real timers, a mounted Radix Popper measures the jsdom event loop into a CPU spin
  (measured: 10.8s CPU for a 300ms window; `jest.useFakeTimers()` → 52ms). The five
  popover-interacting tests in the patched file therefore use
  `beforeEach(() => jest.useFakeTimers())` + `act(() => jest.advanceTimersByTime(250))`;
  tests that never open the panel keep real timers.
- The patched test file keeps the upstream `useT` mock, so label assertions use the English
  fallbacks (`Start typing to search.`, `Clear selection`).

## Acceptance criteria (reviewer / QA)

1. Create flow, empty database-aware field: focusing (or clicking, or `ArrowDown`) shows the
   first page of options with no typing; typing filters server-side with the existing 220 ms
   debounce.
2. Selecting closes the panel, clears the search box, and the chosen record stays readable
   afterwards (summary line or the host's own label) — never a raw UUID.
3. Keyboard: `ArrowDown`/`ArrowUp` move the highlight, `Enter`/`Space` select, `Escape` closes
   and clears the query without leaking to a surrounding dialog, `Tab` leaves the field.
4. A field with an explicit `minQuery` still sends nothing below the threshold and shows the
   threshold hint.
5. `disabled` fields render inline and stay inert (no list interaction, no clear, no action
   slot).
6. A page with several lookups fires no lookup request until a control is engaged.
7. Narrow width: the panel tracks the input width (`--radix-popover-trigger-width`) and stays
   scrollable; no layout shift of the surrounding form.

## Deliberately out of scope

- **No `input:` component-override handle.** `ComponentReplacementHandles` exposes only
  `page:`, `data-table:`, `crud-form:`, `section:`; no input/field handle exists and
  `LookupSelect.tsx` never calls `useRegisteredComponent`. A host that wants to swap this
  control still has to replace a whole page/form. Proposed follow-up (separate change, not in
  this patch): add `input: (handle: string) => \`input:${handle}\`` to
  `ComponentReplacementHandles` and split `LookupSelect` into a `LookupSelectView` host that
  resolves `input:lookup-select` through `useRegisteredComponent`, matching the `ui.detail`
  section hosts.
- **`crud-form:<entityId>` / `data-table:<tableId>` overrides stay inert.** Both only emit a
  `data-component-handle` marker; nothing consumes it. Out of scope here, worth a separate
  issue.
- **Server-side search for addresses and dictionary entries.** `GET /api/customers/addresses`
  and `GET /api/dictionaries/{id}/entries` have no `search` parameter, so those pickers filter
  the loaded page in the browser. A pre-typing dropdown works either way; adding `search` to
  those two list schemas would make their type-ahead consistent with the rest.
