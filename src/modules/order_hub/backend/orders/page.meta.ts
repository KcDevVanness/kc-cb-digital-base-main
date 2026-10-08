export const metadata = {
  requireAuth: true,
  requireFeatures: ['order_hub.view'],
  pageTitle: 'Order workbench',
  pageTitleKey: 'order_hub.workbench.title',
  pageGroup: 'Company orders',
  pageGroupKey: 'nav_shell.tree.domain.orders',
  pageOrder: 100,
  icon: 'clipboard-list',
  // The sidebar draws this page from the app's own tree (`nav_shell`), so the page's own metadata
  // stays out of the built-in list; the route itself remains resolvable for stored links.
  navHidden: true,
  breadcrumb: [
    { label: 'Order workbench', labelKey: 'order_hub.workbench.title' },
  ],
}

export default metadata
