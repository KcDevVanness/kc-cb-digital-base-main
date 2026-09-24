---
title: "A CrudForm column:2 group is a 3fr sidebar; row editors and their grids follow the container"
modules: ["purchasing", "products", "trade_docs", "internal_sales", "cross_border"]
areas: ["backend-ui", "framework-context"]
topics: ["crud-form", "form-groups", "column-layout", "row-editors", "container-queries", "responsive"]
---

# A CrudForm column:2 group is a 3fr sidebar; row editors and their grids follow the container

**Context**: The supplier product library's 价格 group (a price-rows editor: kind × currency × minimum
quantity × unit price × active per row) was declared `column: 2` and rendered unusable — the owner
reported "UI布局很局促". Measured in the dev app at a 1440px viewport: the `CrudForm` group grid is
`grid-cols-1 lg:grid-cols-[7fr_3fr]`, so column 2 occupied **389px**, and the row's five controls came
out **73px / 73px / 45px / 45px / 45px** wide — the 价格类型 select truncated its value to 「供应」, the
启用 checkbox label wrapped to two lines, and the delete icon sat against the card edge.

**Problem**: `CrudFormGroup.column` accepts only `1 | 2` — there is **no full-width group**, and column 2
is declared and documented as the sidebar rail (`sortableGroups` is column-1 only "by design"). A rows
editor is therefore unusable in column 2, but nothing errors: the form renders, the fields work, and the
damage only shows at real widths. Two further traps sit next to it:

1. The viewport breakpoint that looks like the fix (`md:grid-cols-12`) is not one: the row's available
   width comes from the card it is drawn in, not from `window.innerWidth`. Below `lg` the form collapses
   to **one** column — the same 12-column row then lives in a ~330px card and is cramped again on a
   phone or a narrow laptop window.
2. Shortening labels or dropping controls to make the rail fit is the wrong direction: REQ-SPL-015
   requires every abbreviation (PK/KC, MOQ, G.W/N.W) spelled out, so the content cannot shrink to the
   column.

**Rule**: A group that renders **rows** (a line/price/allocation editor, anything with more than ~3
controls per row) goes in **column 1** — the placement every existing rows editor in this app uses
(`purchase orders`, `trade_docs` contracts and invoices, `internal_sales`, `cross_border` shipment
allocations). Column 2 is for narrow, scalar field groups only. Then make the row grid follow its
**container**, not the viewport: mark the row wrapper `@container` and switch on container widths
(`@md` pairs the pickers, then the numbers; `@3xl` restores the single-line 12-column row). Container
queries are core in Tailwind v4, so no plugin, and the DS check accepts them (named sizes only —
`@min-[…px]:` arbitrary values are rejected by `yarn ds:check`).

Verify by measuring, not by looking at the source: read the row card's width, the container's
`containerType`, and each cell's `getBoundingClientRect().width` in the browser at ~1440, ~1100 and
~390px, and confirm the select renders its full value.

**Applies to**: `src/modules/**/components/*Form.tsx` that pass `groups` to `CrudForm` (app-owned
modules: `purchasing`, `products`, `trade_docs`, `internal_sales`, `cross_border`, `platform_ops`,
`parties`), the installed `CrudForm` group layout (`grid-cols-1 lg:grid-cols-[7fr_3fr]`), and
`docs/dev/business-architecture.md`-mapped forms whenever a group gains a row editor.
