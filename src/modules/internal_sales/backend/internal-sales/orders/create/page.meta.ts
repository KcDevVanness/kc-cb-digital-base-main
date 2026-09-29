export const metadata = {
  requireAuth: true,
  // The gate is the installed chain's own feature: this surface writes through
  // `/api/sales/{quotes,orders}`, which checks the same id, so declaring a second one here
  // would only create a permission that does not actually gate anything.
  requireFeatures: ['sales.orders.manage'],
  pageTitle: 'New Internal Sales Order (PO)',
  pageTitleKey: 'internal_sales.form.order.createTitle',
  pageGroup: 'Cross-Border',
  pageGroupKey: 'cross_border.nav.group',
  pageOrder: 311,
  icon: 'shopping-cart',
  breadcrumb: [
    { label: 'Internal sales orders (PO)', labelKey: 'internal_sales.list.order.title', href: '/backend/internal-sales/orders' },
    { label: 'Create', labelKey: 'internal_sales.form.order.createTitle' },
  ],
}

export default metadata
