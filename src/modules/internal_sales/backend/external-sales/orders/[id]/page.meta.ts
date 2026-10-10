export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.order.view'],
  pageTitle: 'Sales order',
  pageTitleKey: 'internal_sales.hub.title',
  pageGroup: 'Export operations — External sales',
  pageGroupKey: 'cross_border.nav.group.externalSales',
  pageOrder: 311,
  navHidden: true,
  breadcrumb: [
    { label: 'External sales orders (PO)', labelKey: 'internal_sales.list.externalOrder.title', href: '/backend/external-sales/orders' },
    { label: 'Order', labelKey: 'internal_sales.hub.title' },
  ],
}

export default metadata
