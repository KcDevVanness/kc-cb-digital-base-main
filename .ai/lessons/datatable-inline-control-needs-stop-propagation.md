---
title: "A control inside a clickable DataTable row must stop the click from reaching the row"
modules: ["platform", "purchasing", "products", "dictionaries"]
areas: ["backend-ui", "debugging"]
topics: ["data-table", "row-click", "inline-actions", "stop-propagation", "smoke-test"]
---

# A control inside a clickable DataTable row must stop the click from reaching the row

**Context**: Phase 8 of the supplier product library put two actions inside the 商品 column's cell —
a 建商品档案 button and a 关联已有商品 button. Typecheck, lint and the unit tests were green, the
buttons rendered with the right labels, and the row action in the `⋯` menu worked. In the browser,
clicking the *inline* button opened the library row's edit page instead: the row's own click handler
(`DataTable`'s row click) fired alongside the button's `onClick`, so the confirm dialog never
resolved and the promote request was never sent.

**Problem**: The row click is a React handler on the row element, and cell content is not opt-out by
default — every control a cell renders inherits the row's action. Static checks cannot catch it: the
button exists, its handler is registered, and the failing interaction only appears when a real click
bubbles. The same trap hits links (a product link inside the cell also opened the row's edit page)
and would hit a checkbox, switch or inline combobox.

**Rule**: Any interactive control rendered inside a `DataTable` cell — button, link, checkbox,
switch, picker — calls `event.stopPropagation()` in its own handler, and the smoke test clicks every
new inline control rather than only asserting that it renders. The repo's convention is already
visible in `DictionariesLibrary.tsx` and `ProductCategoriesTable.tsx`.

**Applies to**: `columns[].cell` renderers in `src/modules/**/components/*Table.tsx` that add
actions, filters or references; any change that moves a row action from the `⋯` menu into a cell.
See `.ai/specs/2026-09-22-supplier-product-library.md` (Phase 8, `SupplierProductsTable.tsx`).
