---
title: "A picker whose value comes from a record needs resolveLabel, not the component's fallback"
modules: ["platform", "internal_sales", "products"]
areas: ["backend-ui", "debugging", "framework-context"]
topics: ["combobox-input", "preselected-value", "resolve-label", "strict-mode", "effect-cancellation", "raw-uuid"]
---

# A picker whose value comes from a record needs resolveLabel, not the component's fallback

**Context**: `ComboboxInput` renders the current `value` as the input text, so a value with no label
in its option sources paints the raw record id. Two live reports (2026-09-29): the internal-sales
order form's quote picker showed the quote's **uuid** every time the load dialog was reopened after a
load, and the products form's catalog-link picker showed the catalog product's uuid on every edit of
a product that has a link. Measured: on the unfixed build both fields held the raw uuid indefinitely;
with the fix the quote picker settles on `QUOTE-20260929-00024 — 俄罗斯 AB 有限公司` and the catalog
picker on `APC-1790572931 — Alloc probe catalog 1790572`.

**Problem**: `ComboboxInput` documents an eager fallback for exactly this case — with no
`resolveLabel` it pulls the first page of `loadSuggestions()` and looks for the value. That fallback
does **not** survive React StrictMode's double-invoked effect: the first run starts the fetch and
sets `eagerFallbackLoadedValueRef`, the cleanup cancels it, and the second run returns early because
the ref already holds that value — so the fetch result is discarded and the raw value stays. The
request is visible in the network log, which makes it look like the loader is broken rather than the
component's fallback. (`resolveLabel` has no such ref guard, which is why every picker that already
passed it — the buyer picker, the shipment warehouse/location pickers — never showed this.)

**Rule**: whenever a form sets a picker's value from a record (a loaded document, a stored foreign
key, a URL parameter) rather than from the user clicking an option, pass `resolveLabel` (or a
`seedOptions` entry built from the record's own label). The resolver must produce the *same* label the
option list produces, so a value cannot render two ways; resolve it by id through the same mapper the
option loader uses. Do not rely on the eager fallback, and do not "fix" it by editing
`node_modules` — the framework copy is read-only (report it upstream instead).

**Applies to**: every `ComboboxInput` in an app module — `internal_sales` (quote picker, line product
picker, buyer picker), `products` (catalog link), `purchasing` (line product picker), `trade_docs`
(contract/invoice/document pickers), `cross_border` (warehouse, location, purchase-order pickers),
`sourcing` (section picker, whose value *is* its label) — and any future picker added to them. Audit
list and the two fixed sites: `.ai/runs/2026-09-29-combobox-preselected-labels.md`.
