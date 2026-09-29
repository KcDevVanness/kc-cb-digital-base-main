export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.orders.manage'],
  pageTitle: 'Edit external sales order',
  pageTitleKey: 'internal_sales.form.externalOrder.editTitle',
  pageGroup: 'Cross-Border',
  pageGroupKey: 'cross_border.nav.group',
  pageOrder: 322,
  icon: 'globe',
  breadcrumb: [
    { label: 'External sales orders', labelKey: 'internal_sales.list.externalOrder.title', href: '/backend/external-sales/orders' },
    { label: 'Edit', labelKey: 'internal_sales.form.externalOrder.editTitle' },
  ],
}

export default metadata
