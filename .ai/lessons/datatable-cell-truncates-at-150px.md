---
title: "DataTable truncates every cell at 150px, and a right-aligned child's overflow hides without a tooltip"
modules: ["purchasing", "platform"]
areas: ["backend-ui", "framework-context"]
topics: ["data-table", "column-width", "truncation", "tooltip", "table-cell", "column-meta"]
---

# DataTable truncates every cell at 150px, and a right-aligned child's overflow hides without a tooltip

**Context**: the supplier library list's 本公司报价 cell (`/backend/purchasing/supplier-products`) stacks
three lines in one right-aligned column since 2026-09-24: the amount, its `≈ ¥…` line
(`MoneyAmount`) and a legend naming where the number is edited — `取自商品档案（内部结算价）`,
**156px** at `text-xs`. The legend lost its head on screen: no ellipsis, no wrap, and hovering the
cell showed no tooltip, so nothing on the page could recover the text. Measured in the dev server's
DOM: `span` 156×16 inside a wrapper of `max-width: 150px` with `overflow: hidden; white-space:
nowrap`, label box starting 6px left of the wrapper's box.

**Problem**: `DataTable` (`@open-mercato/ui/backend/DataTable`) renders **every** cell through
`TruncatedCell` unless the column opts out, and `getColumnTruncateConfig` falls back to
`{ maxWidth: "150px", truncate: true }` for any column whose meta sets no width. The wrapper carries
`overflow-hidden text-ellipsis whitespace-nowrap`, which gives three traps:

- The 150px cap is per **cell**, not per line, and it is narrower than plenty of app labels (the zh
  legend above is 156px; the asset is a fixed string, so this is not a font accident).
- `TruncatedCell` decides `isTruncated` — and therefore whether to wrap the content in a tooltip —
  from `wrapper.scrollWidth > wrapper.clientWidth`. A right-aligned flex column (`items-end`) pushes
  its excess **outside the wrapper's own box**, so the wrapper does not scroll: `scrollWidth` equals
  `clientWidth`, the tooltip never fires, and `text-overflow: ellipsis` (which applies to the
  wrapper's own text) never renders either. The clip is silent.
- "Just let it wrap" is worse, not a fix: with `truncate: false` and no `whitespace-nowrap`, the auto
  table layout squeezed that column to **102px** and rendered the 13-character legend as **four**
  lines. Wrapping is only acceptable for prose columns.

**Rule**: a cell that stacks more than one line — amount + `≈ ¥…` + legend, code + name, value + hint
— must declare `meta: { truncate: false }` **and** keep its own content unbreakable
(`whitespace-nowrap` on the cell's container), so the column sizes to its widest line and no literal
in any locale can be silently clipped. Leave the truncating default on single-line text columns,
where the tooltip does work. Never "fix" a clipped stacked cell by shortening only the current
locale's string: the cap stays at 150px and the next locale or a slightly different font clips again.

**Applies to**: every app-owned `DataTable` column. The concrete instance is
`src/modules/purchasing/components/SupplierProductsTable.tsx` (the 本公司报价 column: `truncate: false`
plus a `whitespace-nowrap` cell). Any other stacked cell built on `MoneyAmount` — the 供应商供货价 cell
in the same file, `PurchaseOrderDetail`'s line cells, `ContainerFileDetail`'s money columns — fits
150px only because its dynamic lines are short today; the same trap arms itself the moment a fixed
label joins them.
