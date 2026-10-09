export const metadata = {
  requireAuth: true,
  requireFeatures: ['order_hub.manage'],
  pageTitle: 'New company order',
  pageTitleKey: 'order_hub.companyOrders.create.title',
  pageGroup: 'Company orders',
  pageGroupKey: 'nav_shell.tree.domain.orders',
  pageOrder: 102,
  icon: 'clipboard-list',
  // Reached from the workbench's "create" action, never from the sidebar: the tree carries the
  // workbench, and a create entry for every domain would double its length.
  navHidden: true,
  breadcrumb: [
    { label: 'Order workbench', labelKey: 'order_hub.workbench.title', href: '/backend/orders' },
    { label: 'New company order', labelKey: 'order_hub.companyOrders.create.title' },
  ],
}

export default metadata
