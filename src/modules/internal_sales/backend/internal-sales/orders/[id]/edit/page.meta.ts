export const metadata = {
  requireAuth: true,
  // The gate is the installed chain's own feature: this surface writes through
  // `/api/sales/{quotes,orders}`, which checks the same id, so declaring a second one here
  // would only create a permission that does not actually gate anything.
  requireFeatures: ['sales.orders.manage'],
  pageTitle: 'Edit internal sales order (PO)',
  pageTitleKey: 'internal_sales.form.order.editTitle',
  pageGroup: 'Export operations — Internal sales',
  pageGroupKey: 'cross_border.nav.group.sales',
  pageOrder: 312,
  icon: 'shopping-cart',
  breadcrumb: [
    { label: 'Internal sales orders (PO)', labelKey: 'internal_sales.list.order.title', href: '/backend/internal-sales/orders' },
    { label: 'Edit', labelKey: 'internal_sales.form.order.editTitle' },
  ],
}

export default metadata
