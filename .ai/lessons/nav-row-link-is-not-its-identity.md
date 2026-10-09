---
title: "A sidebar row's link is not its identity: mark the open page, bold the path above it"
modules: ["nav_shell", "platform"]
areas: ["backend-ui"]
topics: ["navigation", "sidebar", "active-state", "branch-row", "href-prefix"]
---

# A sidebar row's link is not its identity: mark the open page, bold the path above it

**Context**: The app-drawn sidebar tree (`src/modules/nav_shell`) marks the open page. After the
company-order domain became four levels (公司订单 → 订单工作台 → 采购 / 出口销售 / 合同与单据 /
发运与装箱 → 页面), opening `/backend/purchasing/orders` lit three rows at once — 采购单 (the page),
采购 (its group) and 订单工作台 (the group above it) — and the owner read that as "which page am I on"
being unanswerable.

**Problem**: A branch row's `href` is not its own address. `buildNavTree.buildBranch` hands a node
without a page of its own the href of its first surviving child, so 采购 and 采购单 publish the same
`/backend/purchasing/orders`. A renderer that keys one `active` state off `selfActive ||
hasActiveDescendant` therefore cannot tell the row that *is* the page from the rows that merely
contain it, and the defect scales with depth: every level added above a page adds one more marked row.

**Rule**: Keep two states, not one: the deepest row that publishes the open page carries the marker
(bar + filled background), and every row above it is only bolded. Resolve it once from the pathname in
a pure module (`nav_shell/lib/navActive.ts`: `active` / `on-path` / `idle`) and let the row styles and
the domain-header emphasis both read that — a header that keeps a second "active" treatment re-creates
the same ambiguity one level up.

**Applies to**: `src/modules/nav_shell/**` (tree config, renderer, `lib/navActive.ts`); any
self-drawn navigation whose rows carry a link target instead of an identity — the same trap hits a
breadcrumb built from a branch that links at its first child.
