export const metadata = {
  requireAuth: true,
  // The read this page performs goes to `/api/sales/orders`, whose installed route gates on the
  // **plural** id `sales.orders.view` — this page declares the singular `sales.order.view`, so the
  // two do not match. A superadmin passes through `userHasAllFeatures`' isSuperAdmin bypass; a
  // non-superadmin role must be granted the plural id as well until this is reconciled.
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
