export const metadata = {
  requireAuth: true,
  // The gate is the installed chain's own feature: this surface writes through
  // `/api/sales/{quotes,orders}`, which checks the same id, so declaring a second one here
  // would only create a permission that does not actually gate anything.
  requireFeatures: ['sales.quotes.manage'],
  pageTitle: 'Edit Internal Sales Quote',
  pageTitleKey: 'internal_sales.form.quote.editTitle',
  pageGroup: 'Cross-Border',
  pageGroupKey: 'cross_border.nav.group',
  pageOrder: 302,
  icon: 'file-text',
  breadcrumb: [
    { label: 'Internal sales list', labelKey: 'internal_sales.page.title', href: '/backend/sales/quotes' },
    { label: 'Edit', labelKey: 'internal_sales.form.quote.editTitle' },
  ],
}

export default metadata
