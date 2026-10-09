export const metadata = {
  requireAuth: true,
  // Same gate as the list this page is opened from, and the same singular/plural caveat recorded
  // there: the reads behind it (`/api/sales/orders`, `/api/sales/order-lines`) gate on the plural
  // `sales.orders.view`, so a non-superadmin role needs that id as well.
  requireFeatures: ['sales.order.view'],
  pageTitle: 'Sales order',
  pageTitleKey: 'internal_sales.hub.title',
  pageGroup: 'Export operations — Internal sales',
  pageGroupKey: 'cross_border.nav.group.sales',
  pageOrder: 311,
  // Reached from the list (and from the purchase order's source link), never from the sidebar: the
  // tree carries the lists, and a hub for every order would double its length.
  navHidden: true,
  breadcrumb: [
    { label: 'Internal sales orders (PO)', labelKey: 'internal_sales.list.order.title', href: '/backend/internal-sales/orders' },
    { label: 'Order', labelKey: 'internal_sales.hub.title' },
  ],
}

export default metadata
