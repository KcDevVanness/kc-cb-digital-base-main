export const metadata = {
  requireAuth: true,
  // Company orders are a first-class resource now; the gate is the module's own read feature. The
  // old hub predated the root entity and borrowed the sales order's read feature because the reads
  // behind it (`/api/sales/orders`, `/api/sales/order-lines`) gate on the plural
  // `sales.orders.view` — this page no longer reads those tables directly.
  requireFeatures: ['order_hub.view'],
  pageTitle: 'Company order',
  pageTitleKey: 'order_hub.detail.title',
  pageGroup: 'Company orders',
  pageGroupKey: 'nav_shell.tree.domain.orders',
  pageOrder: 101,
  // Reached from the workbench row (and from the redirected old URLs), never from the sidebar: the
  // tree carries the workbench, and a hub for every order would double its length.
  navHidden: true,
  breadcrumb: [
    { label: 'Order workbench', labelKey: 'order_hub.workbench.title', href: '/backend/orders' },
    { label: 'Company order', labelKey: 'order_hub.detail.title' },
  ],
}

export default metadata
