export const metadata = {
  requireAuth: true,
  // The gate is the installed chain's own feature: this surface writes through
  // `/api/sales/{quotes,orders}`, which checks the same id, so declaring a second one here
  // would only create a permission that does not actually gate anything.
  requireFeatures: ['sales.quotes.manage'],
  pageTitle: 'New sales quote',
  pageTitleKey: 'internal_sales.form.quote.createTitle',
  pageGroup: 'Export operations — Sales',
  pageGroupKey: 'cross_border.nav.group.sales',
  pageOrder: 301,
  icon: 'file-text',
  breadcrumb: [
    { label: 'Sales quotes', labelKey: 'internal_sales.list.quote.title', href: '/backend/internal-sales/quotes' },
    { label: 'Create', labelKey: 'internal_sales.form.quote.createTitle' },
  ],
}

export default metadata
