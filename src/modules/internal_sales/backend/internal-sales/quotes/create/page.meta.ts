export const metadata = {
  requireAuth: true,
  // The gate is the installed chain's own feature: this surface writes through
  // `/api/sales/{quotes,orders}`, which checks the same id, so declaring a second one here
  // would only create a permission that does not actually gate anything.
  requireFeatures: ['sales.quotes.manage'],
  pageTitle: 'New internal sales quote',
  pageTitleKey: 'internal_sales.form.quote.createTitle',
  pageGroup: 'Export operations — Internal sales',
  pageGroupKey: 'cross_border.nav.group.sales',
  pageOrder: 301,
  icon: 'file-text',
  breadcrumb: [
    { label: 'Internal sales quotes', labelKey: 'internal_sales.list.quote.title', href: '/backend/internal-sales/quotes' },
    { label: 'Create', labelKey: 'internal_sales.form.quote.createTitle' },
  ],
}

export default metadata
