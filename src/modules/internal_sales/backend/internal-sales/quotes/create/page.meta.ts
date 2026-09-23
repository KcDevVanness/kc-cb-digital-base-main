export const metadata = {
  requireAuth: true,
  // The gate is the installed chain's own feature: this surface writes through
  // `/api/sales/{quotes,orders}`, which checks the same id, so declaring a second one here
  // would only create a permission that does not actually gate anything.
  requireFeatures: ['sales.quotes.manage'],
  pageTitle: 'New Internal Sales Quote',
  pageTitleKey: 'internal_sales.form.quote.createTitle',
  pageGroup: 'Cross-Border',
  pageGroupKey: 'cross_border.nav.group',
  pageOrder: 301,
  icon: 'file-text',
  breadcrumb: [
    { label: 'Internal sales list', labelKey: 'internal_sales.page.title', href: '/backend/sales/quotes' },
    { label: 'Create', labelKey: 'internal_sales.form.quote.createTitle' },
  ],
}

export default metadata
