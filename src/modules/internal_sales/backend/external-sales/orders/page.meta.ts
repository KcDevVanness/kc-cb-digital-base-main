export const metadata = {
  requireAuth: true,
  // Same gate as the internal entry: this page reads `/api/sales/orders` (plural feature id).
  requireFeatures: ['sales.order.view'],
  pageTitle: 'External sales orders (PO)',
  pageTitleKey: 'internal_sales.list.externalOrder.title',
  pageGroup: 'Export operations — External sales',
  pageGroupKey: 'cross_border.nav.group.externalSales',
  pageOrder: 320,
  icon: 'globe',
  breadcrumb: [
    { label: 'External sales orders (PO)', labelKey: 'internal_sales.list.externalOrder.title' },
  ],
}

export default metadata
