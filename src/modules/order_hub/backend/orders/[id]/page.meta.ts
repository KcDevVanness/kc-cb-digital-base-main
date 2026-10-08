export const metadata = {
  requireAuth: true,
  // The gate the hub carried at its old URLs: the reads behind it (`/api/sales/orders`,
  // `/api/sales/order-lines`) gate on the plural `sales.orders.view`, so a non-superadmin role needs
  // that id as well.
  requireFeatures: ['sales.order.view'],
  pageTitle: 'Sales order',
  pageTitleKey: 'order_hub.detail.title',
  pageGroup: 'Company orders',
  pageGroupKey: 'nav_shell.tree.domain.orders',
  pageOrder: 101,
  // Reached from the workbench row (and from the redirected old URLs), never from the sidebar: the
  // tree carries the workbench, and a hub for every order would double its length.
  navHidden: true,
  breadcrumb: [
    { label: 'Order workbench', labelKey: 'order_hub.workbench.title', href: '/backend/orders' },
    { label: 'Sales order', labelKey: 'order_hub.detail.title' },
  ],
}

export default metadata
