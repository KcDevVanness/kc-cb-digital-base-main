export const metadata = {
  requireAuth: true,
  requireFeatures: ['order_hub.manage'],
  pageTitle: 'Edit company order',
  pageTitleKey: 'order_hub.companyOrders.edit.title',
  pageGroup: 'Company orders',
  pageGroupKey: 'nav_shell.tree.domain.orders',
  pageOrder: 103,
  icon: 'clipboard-list',
  // Reached from the hub's edit action, never from the sidebar: a hub already exists for every
  // order, so an edit entry per record would leave the tree unbounded.
  navHidden: true,
  breadcrumb: [
    { label: 'Order workbench', labelKey: 'order_hub.workbench.title', href: '/backend/orders' },
    { label: 'Edit company order', labelKey: 'order_hub.companyOrders.edit.title' },
  ],
}

export default metadata
