# `nav_shell` — the app-owned sidebar navigation tree

The backend sidebar is drawn by this module instead of by the shell's built-in flat list: 域 → 模块 →
页面, in the order the business reads it (公司订单 → 财务 → 经营概览 → 仓储与库存 → 平台运营 →
数据同步 → 基础数据 → 系统). See
[`.ai/specs/2026-10-08-order-centric-entry.md`](../../../../.ai/specs/2026-10-08-order-centric-entry.md)
(Phase 1) for the requirement record and `docs/dev/navigation.md` for the operator-facing notes.

公司订单 is the app's entry for order work: the workbench (`/backend/orders`) plus four read-only
ledgers — 采购单台账 / 合同台账 / 单据台账 / 发运台账 — where an order's blocks are looked up. The
业务办理 domain is retired: its pages are now the filling layer, reached from an order detail's blocks
and from the ledger entries, not from the sidebar. Supplier master data and supplier quotations live
under 基础数据.

No entity, no migration, no ACL feature: this is a **display layer**. Every page keeps its own
`requireFeatures` gate, and the tree only decides what is *shown*.

## Surfaces

| Surface | What it does |
|---|---|
| `lib/navTree.ts` | The tree configuration — the single source of truth. A page entry names only its `href`; its label, icon and filter features come from the page's own `page.meta.ts` through the route manifest. A leaf may also name an `iconName` for a page whose metadata carries a ReactNode icon (no name string) — see the icon rule below. `TREE_EXCLUDED` lists the navigable pages that deliberately stay out of the tree, each with a reason. |
| `lib/buildNavTree.ts` | Pure builder: config → chrome-shaped groups, effective-feature filter, role preference → default adoption → user preference, then `itemOrder`. |
| `api/chrome/route.ts` | `GET /api/nav_shell/chrome` — the installed chrome payload with `groups: []`. The shell reads this instead of `/api/auth/admin/nav`, so the built-in flat list renders nothing while brand, roles, `grantedFeatures`, the settings/profile sections and their path prefixes stay exactly as installed. |
| `api/tree/route.ts` | `GET /api/nav_shell/tree` — `{ groups, featureFiltered }`, scoped to the caller, uncached. |
| `components/SidebarNavTree.tsx` | The client tree: collapsible domains and module nodes, active-path highlighting and auto-expansion, a search box, hidden-entry skipping, icon-only compact mode (`useSidebarCollapse()`), and loading/empty/error(+retry) states. |
| `widgets/injection/sidebar-tree` | Mounts the tree at the `backend:sidebar:nav` spot (desktop). |
| `src/app/(backend)/backend/layout.tsx` | Points `adminNavApi` at `/api/nav_shell/chrome` and passes the same component to `mobileSidebarSlot` — the mobile drawer deliberately does not render injection spots, so the slot is the only way in there. |
| `src/modules/auth/backend/sidebar-customization/` | Shadows the installed customization page so the editor edits **this** tree (its `groups` prop). The page body is app-owned; `page.meta.ts` is mirrored from the installed one — an app shadow that ships no `page.meta.ts` publishes the route with `undefined` metadata and silently loses the `auth.sidebar.manage` gate. |

## Adding a page to the navigation

1. Add `{ href: '/backend/…' }` to the right node in `NAV_TREE` (or to `TREE_EXCLUDED` with a reason).
2. Run `yarn generate` (the page's `page.meta.ts` feeds the manifest the tree reads) and
   `yarn jest --config jest.config.cjs src/modules/nav_shell`.

`lib/__tests__/navTree.coverage.test.ts` fails when a page the manifest publishes as navigable
(static path, main context, not `navHidden`) is registered neither in `NAV_TREE` nor in
`TREE_EXCLUDED`, and when either list names a page the manifest does not publish. Retired work
surfaces (e.g. the per-trade-type order lists) are registered in `TREE_EXCLUDED` with their reason,
so re-adding one to the tree without a decision fails loudly.

## Preferences and permissions

- **Order and shape** (`buildNavTree`): effective-feature filter → role preference →
  `adoptSidebarDefaults` (label becomes default) → user preference → `itemOrder` → drop empty nodes.
  Same order as `resolveBackendChromePayload` (`@open-mercato/core/modules/auth/lib/backendChrome.tsx`).
- **Preference keys**: a domain is keyed by its node id (`tree:orders`), an app-owned node by its
  explicit id (`tree:module:*` for a business area, `tree:ledger:*` for a company-order ledger), a page
  by its `href` — so legacy item-level preferences keep working and a node cannot collide with its
  first page.
- **Icons**: a page's own metadata wins when it names its icon (a string). An installed page whose
  `icon` is a ReactNode yields no name, so the config's `iconName` covers it — this is how the seven
  系统 entries get icons (e.g. `/backend/users` → `users`).
- **Feature filter**: a page whose `requireFeatures` the caller does not hold is *removed* (not
  marked), and a node left without a visible page disappears with it. A superadmin is treated as
  unrestricted and the response says `featureFiltered: false`; the client then skips its own re-check
  against `grantedFeatures` instead of hiding entries the server kept.
- **`hidden` is marked, not dropped**, so the customization editor can offer "show again". Note the
  platform semantics this module reproduces: `applySidebarPreference` recomputes `hidden` from the
  settings it is given, so a user with their own layout sees their own hidden list, not the union
  with the role's.
- **`itemOrder` is applied here.** The installed renderer persists it and never reads it back; without
  this pass, reordering items inside a domain would save and do nothing. The customization editor
  supports drag-reordering at the top level of a domain only (nested entries support hide/rename),
  which is the granularity this module applies.

## Known limitations

- **The shell's own nav search box is inert.** The shell renders its `SearchInput` above the sidebar
  and filters the built-in groups — which this module blanks — so typing in it does nothing. The tree
  ships its own search box directly below it. Removing the shell's box needs a framework prop
  (`AppShell` renders it unconditionally when not compact); until then the app's box is the working
  one. `appShell.searchNavPlaceholder` vs `nav_shell.search.placeholder` is the quickest way to tell
  them apart in a screenshot.
- **Settings-context pages** (`/backend/users`, `/backend/roles`, `/backend/directory/*`,
  `/backend/entities/*`) are in the tree, but the shell switches to its settings sidebar while you are
  on them, so the tree disappears until you navigate back to a main-context page. That is the shell's
  own behaviour, not a tree state.
- **Group-level legacy preferences** (`*.nav.group` keys) no longer match: domain ids are `tree:*`
  now. Item-level (href) preferences are unaffected. Re-set the order/labels in
  `/backend/sidebar-customization`.

## Verification

```bash
yarn jest --config jest.config.cjs src/modules/nav_shell
curl -s -b "$COOKIE" http://localhost:3100/api/nav_shell/chrome | jq '.groups'          # []
curl -s -b "$COOKIE" http://localhost:3100/api/nav_shell/tree | jq '.groups[].name'     # the 8 domains
```

Browser: the sidebar shows the 8 domains with no duplicate flat list, folds/unfolds at every level,
highlights the active page, filters on a keyword, renders icon-only when the shell is collapsed, and
renders inside the mobile drawer below 420px. A user whose only grant is
`cross_border.shipments.view` sees 公司订单 → 发运台账 and nothing else, and a direct visit to
`/backend/finance/payables` is still refused by the page gate.

## Rollback

Revert the module and the two wiring lines: `adminNavApi="/api/nav_shell/chrome"` →
`"/api/auth/admin/nav"` and drop `mobileSidebarSlot` in `src/app/(backend)/backend/layout.tsx`, remove
the `nav_shell` entry from `src/modules.ts`, and delete
`src/modules/auth/backend/sidebar-customization/`. The built-in flat list returns unchanged —
`nav.groupOrder` and every page's `pageGroup` were never touched.
