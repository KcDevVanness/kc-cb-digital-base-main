export const metadata = {
  requireAuth: true,
  // The gate is the installed chain's own feature: this surface writes through
  // `/api/sales/{quotes,orders}`, which checks the same id, so declaring a second one here
  // would only create a permission that does not actually gate anything.
  requireFeatures: ['sales.orders.manage'],
  pageTitle: 'Edit Internal Sales Order',
  pageTitleKey: 'internal_sales.form.order.editTitle',
  pageGroup: 'Cross-Border',
  pageGroupKey: 'cross_border.nav.group',
  pageOrder: 312,
  icon: 'shopping-cart',
  breadcrumb: [
    { label: 'Internal sales list', labelKey: 'internal_sales.page.title', href: '/backend/sales/orders' },
    { label: 'Edit', labelKey: 'internal_sales.form.order.editTitle' },
  ],
}

export default metadata
