export const metadata = {
  requireAuth: true,
  // The read this page performs goes to `/api/sales/quotes`, whose installed route gates on the
  // **plural** id `sales.quotes.view` — this page declares the singular `sales.quote.view`, so the
  // two do not match. A superadmin passes through `userHasAllFeatures`' isSuperAdmin bypass; a
  // non-superadmin role must be granted the plural id as well until this is reconciled.
  requireFeatures: ['sales.quote.view'],
  pageTitle: 'Sales quotes',
  pageTitleKey: 'internal_sales.list.quote.title',
  pageGroup: 'Export operations — Sales',
  pageGroupKey: 'cross_border.nav.group.sales',
  pageOrder: 300,
  icon: 'file-text',
  breadcrumb: [
    { label: 'Sales quotes', labelKey: 'internal_sales.list.quote.title' },
  ],
}

export default metadata
