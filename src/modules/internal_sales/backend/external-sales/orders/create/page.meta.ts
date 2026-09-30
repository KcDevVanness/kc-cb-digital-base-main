export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.orders.manage'],
  pageTitle: 'New external sales order (PO)',
  pageTitleKey: 'internal_sales.form.externalOrder.createTitle',
  pageGroup: 'Export operations — External sales',
  pageGroupKey: 'cross_border.nav.group.externalSales',
  pageOrder: 321,
  icon: 'globe',
  breadcrumb: [
    { label: 'External sales orders (PO)', labelKey: 'internal_sales.list.externalOrder.title', href: '/backend/external-sales/orders' },
    { label: 'Create', labelKey: 'internal_sales.form.externalOrder.createTitle' },
  ],
}

export default metadata
