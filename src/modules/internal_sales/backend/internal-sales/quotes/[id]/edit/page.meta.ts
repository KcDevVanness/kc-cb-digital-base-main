export const metadata = {
  requireAuth: true,
  // The gate is the installed chain's own feature: this surface writes through
  // `/api/sales/{quotes,orders}`, which checks the same id, so declaring a second one here
  // would only create a permission that does not actually gate anything.
  requireFeatures: ['sales.quotes.manage'],
  pageTitle: 'Edit sales quote',
  pageTitleKey: 'internal_sales.form.quote.editTitle',
  pageGroup: 'Export operations — Sales',
  pageGroupKey: 'cross_border.nav.group.sales',
  pageOrder: 302,
  icon: 'file-text',
  breadcrumb: [
    { label: 'Sales quotes', labelKey: 'internal_sales.list.quote.title', href: '/backend/internal-sales/quotes' },
    { label: 'Edit', labelKey: 'internal_sales.form.quote.editTitle' },
  ],
}

export default metadata
