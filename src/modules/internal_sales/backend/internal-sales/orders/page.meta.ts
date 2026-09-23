export const metadata = {
  requireAuth: true,
  // The gate is the installed chain's own feature: this list reads `/api/sales/{quotes,orders}`,
  // which checks the same id, so declaring a second one here would gate nothing.
  requireFeatures: ['sales.order.view'],
  pageTitle: 'Internal sales orders',
  pageTitleKey: 'internal_sales.list.order.title',
  pageGroup: 'Cross-Border',
  pageGroupKey: 'cross_border.nav.group',
  pageOrder: 310,
  icon: 'shopping-cart',
  breadcrumb: [
    { label: 'Internal sales orders', labelKey: 'internal_sales.list.order.title' },
  ],
}

export default metadata
