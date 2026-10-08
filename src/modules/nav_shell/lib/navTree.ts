/**
 * The app's sidebar information architecture: 域 → 模块 → 页面, in the order the business reads it.
 *
 * Single source of truth for `SidebarNavTree` (the rendered tree) and for
 * `/api/nav_shell/tree` (the payload it renders). A page entry names only its `href`: its label,
 * its filter features and its icon are resolved from the page's own `page.meta.ts` through the
 * generated route manifest (`lib/buildNavTree.ts`), so a page title is never duplicated here and the
 * installed `requireFeatures` value stays the only gate. `lib/__tests__/navTree.coverage.test.ts`
 * fails when a navigable page is registered neither in `NAV_TREE` nor in `TREE_EXCLUDED`.
 *
 * Domains become chrome *groups* (their id is the preference key for group order/label). Module
 * nodes become chrome *items with children*: the chrome item contract requires an `href`, so a
 * module node carries the href of its first page and the renderer treats it as an expand/collapse
 * toggle rather than a link. Module nodes therefore need an explicit `id` (`tree:module:*`) — with
 * the href as the key they would collide with the first child page's preference key.
 *
 * Labels for domains and module nodes live in this module's catalogs (`nav_shell.tree.*`); page
 * entries use the page's own `titleKey` (zh + en already ship for every page in the tree).
 */

export type NavTreeLeaf = {
  /** Backend page path as it appears in the route manifest (`/backend/...`). */
  href: string
}

export type NavTreeBranch = {
  /** Preference key of this node; must not collide with a page href. */
  id: string
  labelKey: string
  iconName?: string
  children: NavTreeChild[]
}

export type NavTreeChild = NavTreeLeaf | NavTreeBranch

export type NavTreeNode = {
  /** Preference key of the domain (chrome group id). */
  id: string
  labelKey: string
  iconName?: string
  children: NavTreeChild[]
}

export function isNavTreeBranch(child: NavTreeChild): child is NavTreeBranch {
  return Array.isArray((child as NavTreeBranch).children)
}

export const NAV_TREE: NavTreeNode[] = [
  {
    id: 'tree:orders',
    labelKey: 'nav_shell.tree.domain.orders',
    iconName: 'clipboard-list',
    children: [
      // The workbench leads the domain: it is the screen the operator opens first, and the three
      // lists are where they go to work on one kind.
      { href: '/backend/orders' },
      { href: '/backend/internal-sales/orders' },
      { href: '/backend/external-sales/orders' },
      { href: '/backend/purchasing/orders' },
    ],
  },
  {
    id: 'tree:operations',
    labelKey: 'nav_shell.tree.domain.operations',
    iconName: 'handshake',
    children: [
      {
        id: 'tree:module:purchasing',
        labelKey: 'nav_shell.tree.module.purchasing',
        iconName: 'package',
        children: [
          { href: '/backend/purchasing/suppliers' },
          { href: '/backend/purchasing/supplier-products' },
          { href: '/backend/sourcing/quotes' },
        ],
      },
      {
        id: 'tree:module:export-sales',
        labelKey: 'nav_shell.tree.module.exportSales',
        iconName: 'globe',
        children: [
          { href: '/backend/internal-sales/quotes' },
          { href: '/backend/external-sales/quotes' },
        ],
      },
      {
        id: 'tree:module:contracts',
        labelKey: 'nav_shell.tree.module.contracts',
        iconName: 'file-text',
        children: [
          { href: '/backend/trade-docs/contracts' },
          { href: '/backend/trade-docs/proformas' },
          { href: '/backend/trade-docs/commercial-invoices' },
          { href: '/backend/trade-docs/invoices' },
        ],
      },
      {
        id: 'tree:module:shipping',
        labelKey: 'nav_shell.tree.module.shipping',
        iconName: 'truck',
        children: [
          { href: '/backend/cross_border/shipments' },
          { href: '/backend/cross_border/packing-lists' },
        ],
      },
    ],
  },
  {
    id: 'tree:finance',
    labelKey: 'nav_shell.tree.domain.finance',
    iconName: 'banknote',
    children: [
      { href: '/backend/export-finance/orders' },
      { href: '/backend/export-finance/containers' },
      { href: '/backend/export-finance/overdue' },
      { href: '/backend/finance/shipment-costs' },
      { href: '/backend/finance/landed-costs' },
      { href: '/backend/finance/expenses' },
      { href: '/backend/finance/payables' },
      { href: '/backend/finance/receivables' },
    ],
  },
  {
    id: 'tree:executive',
    labelKey: 'nav_shell.tree.domain.executive',
    iconName: 'gauge',
    children: [
      { href: '/backend/boss-cockpit' },
      { href: '/backend/finance/profit-loss' },
      { href: '/backend/finance/sku-margin' },
      { href: '/backend/finance/inventory-value' },
    ],
  },
  {
    id: 'tree:warehouse',
    labelKey: 'nav_shell.tree.domain.warehouse',
    iconName: 'warehouse',
    children: [
      { href: '/backend/wms' },
      { href: '/backend/wms/inventory' },
      { href: '/backend/wms/warehouses' },
      { href: '/backend/wms/zones' },
      { href: '/backend/wms/locations' },
      { href: '/backend/wms/lots' },
      { href: '/backend/wms/movements' },
      { href: '/backend/wms/reservations' },
    ],
  },
  {
    id: 'tree:platform',
    labelKey: 'nav_shell.tree.domain.platform',
    iconName: 'boxes',
    children: [
      { href: '/backend/platform_ops/channels' },
      { href: '/backend/platform_ops/orders' },
      { href: '/backend/platform_ops/settlements' },
      { href: '/backend/platform_ops/reconciliation' },
    ],
  },
  {
    id: 'tree:sync',
    labelKey: 'nav_shell.tree.domain.sync',
    iconName: 'refresh-cw',
    children: [
      { href: '/backend/ru-sync/sku-map' },
      { href: '/backend/ru-sync/health' },
    ],
  },
  {
    id: 'tree:master_data',
    labelKey: 'nav_shell.tree.domain.masterData',
    iconName: 'book',
    children: [
      { href: '/backend/products/items' },
      { href: '/backend/products/taxonomy' },
      { href: '/backend/product-codes/rules' },
      { href: '/backend/parties' },
      { href: '/backend/our-parties' },
      { href: '/backend/dictionaries' },
    ],
  },
  {
    id: 'tree:system',
    labelKey: 'nav_shell.tree.domain.system',
    iconName: 'settings',
    children: [
      { href: '/backend/users' },
      { href: '/backend/roles' },
      { href: '/backend/directory/organizations' },
      { href: '/backend/directory/tenants' },
      { href: '/backend/entities/user' },
      { href: '/backend/entities/system' },
      { href: '/backend/storage/attachments' },
    ],
  },
]

/**
 * Navigable pages that are deliberately **not** in the tree. Every entry carries the reason, and
 * `navTree.coverage.test.ts` requires the union of `NAV_TREE` + `TREE_EXCLUDED` to cover every page
 * the route manifest publishes as navigable (static path, main context, not `navHidden`).
 *
 * Categories, all reached from their list page or from the shell itself:
 * - `create` forms: entered from the list page's primary action, never from the sidebar;
 * - installed CRM / catalog / sales surfaces this deployment supersedes with app-owned modules —
 *   kept resolvable (stored notification links and bookmarks still open) but out of the new
 *   information architecture;
 * - settings-context admin pages that are not `navHidden` but live in the settings sidebar.
 */
export const TREE_EXCLUDED: ReadonlyArray<{ href: string; reason: string }> = [
  // Create forms — always entered from the list page that owns the action.
  { href: '/backend/catalog/categories/create', reason: 'create form of the installed catalog list' },
  { href: '/backend/catalog/products/create', reason: 'create form of the installed catalog list' },
  { href: '/backend/cross_border/shipments/create', reason: 'create form of the shipment list' },
  { href: '/backend/currencies/create', reason: 'create form of the currency list (settings sidebar)' },
  { href: '/backend/customers/companies/create', reason: 'create form of the installed company list' },
  { href: '/backend/customers/deals/create', reason: 'create form of the installed deal list' },
  { href: '/backend/customers/people/create', reason: 'create form of the installed people list' },
  { href: '/backend/entities/user/create', reason: 'create form of the custom-entity list (settings sidebar)' },
  { href: '/backend/exchange-rates/create', reason: 'create form of the exchange-rate list (settings sidebar)' },
  { href: '/backend/external-sales/orders/create', reason: 'create form of the external sales order list' },
  { href: '/backend/external-sales/quotes/create', reason: 'create form of the external sales quote list' },
  { href: '/backend/feature-toggles/global/create', reason: 'create form of the feature toggle list (settings sidebar)' },
  { href: '/backend/finance/expenses/create', reason: 'create form of the expense list' },
  { href: '/backend/finance/shipment-costs/create', reason: 'create form of the shipment cost list' },
  { href: '/backend/internal-sales/orders/create', reason: 'create form of the internal sales order list' },
  { href: '/backend/internal-sales/quotes/create', reason: 'create form of the internal sales quote list' },
  { href: '/backend/platform_ops/channels/create', reason: 'create form of the channel list' },
  { href: '/backend/purchasing/orders/create', reason: 'create form of the purchase order list' },
  { href: '/backend/purchasing/supplier-products/create', reason: 'create form of the supplier product list' },
  { href: '/backend/purchasing/suppliers/create', reason: 'create form of the supplier list' },
  { href: '/backend/roles/create', reason: 'create form of the role list (settings sidebar)' },
  { href: '/backend/sourcing/quotes/create', reason: 'create form of the supplier quote list' },
  { href: '/backend/trade-docs/commercial-invoices/create', reason: 'create form of the commercial invoice list' },
  { href: '/backend/trade-docs/contracts/create', reason: 'create form of the contract list' },
  { href: '/backend/trade-docs/invoices/create', reason: 'create form of the tax invoice list' },
  { href: '/backend/trade-docs/proformas/create', reason: 'create form of the proforma invoice list' },
  { href: '/backend/users/create', reason: 'create form of the user list (settings sidebar)' },

  // Installed surfaces superseded by app-owned modules. Kept resolvable, out of the tree.
  { href: '/backend/catalog/categories', reason: 'installed catalog categories — superseded by /backend/products/taxonomy' },
  { href: '/backend/catalog/products', reason: 'installed catalog products — superseded by /backend/products/items' },
  { href: '/backend/customers/companies', reason: 'installed CRM companies — this deployment trades through /backend/parties' },
  { href: '/backend/customers/deals', reason: 'installed CRM deals — no deal pipeline in this deployment' },
  { href: '/backend/customers/people', reason: 'installed CRM people — this deployment trades through /backend/parties' },
  { href: '/backend/customers/deals/map', reason: 'installed CRM deal map' },
  { href: '/backend/customers/deals/pipeline', reason: 'installed CRM deal pipeline' },
  { href: '/backend/calendar', reason: 'installed CRM interaction calendar' },
  { href: '/backend/customer-tasks', reason: 'installed CRM tasks' },
  { href: '/backend/sales/orders', reason: 'installed sales order entry — superseded by the trade-type entry lists' },
  { href: '/backend/sales/quotes', reason: 'installed sales quote entry — superseded by the trade-type entry lists' },
  { href: '/backend/sales/documents/create', reason: 'installed sales document composer' },
  { href: '/backend/sales/channels', reason: 'installed sales channels — channels are seeded per trade type' },
  { href: '/backend/sales/channels/create', reason: 'installed sales channel form' },
  { href: '/backend/sales/channels/offers', reason: 'installed sales channel offers' },
  { href: '/backend/config/customers/deals', reason: 'installed CRM pipeline stage configuration' },
]
