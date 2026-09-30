---
title: "A picker loader that stores its result in the parent's state reloads forever"
modules: ["cross_border"]
areas: ["backend-ui", "framework-context"]
topics: ["combobox-input", "suggestions-loader", "react-effect", "render-loop", "option-sources"]
---

# A picker loader that stores its result in the parent's state reloads forever

**Context**: the shipment create page (`/backend/cross_border/shipments/create`) hosts two
allocation editors whose order picker is a `ComboboxInput` fed by an **inline arrow**
`loadSuggestions`, and the arrow ended with `setOrderOptions(next)` — the option list was kept in
`useState` so that adding a line could read the picked order's label back out of it.

**Problem**: `ComboboxInput` runs its load effect on `[disabled, input, loadSuggestions, touched]`.
Storing the payload in state made the editor re-render on **every** load, which minted a fresh
arrow identity, which re-ran the effect, which loaded again — a self-sustaining loop throttled only
by the component's 200 ms debounce: measured on the real page, **20 requests in 3 s** (two status
buckets per cycle) and the same for the sales picker. While a load is in flight the component
renders the "Loading suggestions…" line *instead of* the listbox, so the open dropdown alternated
between options and loading every ~300 ms and a click aimed at an option landed on a node that had
just been unmounted: the owner's report was 「下拉选择有无法选中闪烁」. Nothing was wrong on the
server or in the query — the picker was demolishing its own list.

**Rule**: a `loadSuggestions` prop must be **referentially stable**, and it must not deliver its
payload through state that re-renders the component that mints it:

```tsx
const orderOptionsRef = React.useRef<CrudFieldOption[]>([])   // read once, when a line is added
const loadOrderOptions = React.useCallback(async (query?: string) => {
  const next = await loadAllocatablePurchaseOrderOptions(errorMessage, query)
  orderOptionsRef.current = next
  return next
}, [t])                                                       // `t` from useT is stable
// <ComboboxInput loadSuggestions={loadOrderOptions} … />
```

The same shape applies to any option loader handed to a component as a prop: the destination
warehouse/location pickers on the same form needed the fix too, and the contract-picker row had to
become its own component (`ShipmentContractRow`) because a `useCallback` cannot live inside a
`.map()` of the same component that re-creates it.

**Why it is easy to miss**: the loader's identity only matters because *the parent re-renders*; a
callback that fetches and does nothing else (the pre-fix warehouse pickers) merely refetches on
whatever re-render comes its way, which reads as "a bit chatty" instead of broken. Adding one
`setState` to the same callback turns that chatter into an infinite loop.

**Verification**: on the fixed worktree, focusing the purchase-order picker issued 2 requests in a
3 s window (one per status bucket) instead of 20, the listbox stayed mounted with its 10 options
through 12 samples 150 ms apart (`options:10`, never `no-listbox`), and clicking an option filled
the input with its label. The sales picker behaved the same and its option click still landed.

**Applies to**: `src/modules/cross_border/components/ShipmentForm.tsx` (both allocation editors,
`ShipmentDestinationFields`, `ShipmentContractRow`, the contract-reference dialog's fallback
picker) and any future `ComboboxInput`/picker surface in this app that passes an option loader as a
prop — `loadSuggestions`, `loadOptions` on crud-form fields included. The installed component is
read-only (`node_modules/@open-mercato/ui/src/backend/inputs/ComboboxInput.tsx`,
`.ai/lessons/installed-inputs-have-no-component-override.md`), so the stable identity has to come
from the caller.
