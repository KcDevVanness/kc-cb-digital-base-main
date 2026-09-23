export const metadata = {
  requireAuth: true,
  // The gate is the installed chain's own feature: this list reads `/api/sales/{quotes,orders}`,
  // which checks the same id, so declaring a second one here would gate nothing.
  requireFeatures: ['sales.quote.view'],
  pageTitle: 'Internal sales quotes',
  pageTitleKey: 'internal_sales.list.quote.title',
  pageGroup: 'Cross-Border',
  pageGroupKey: 'cross_border.nav.group',
  pageOrder: 300,
  icon: 'file-text',
  breadcrumb: [
    { label: 'Internal sales quotes', labelKey: 'internal_sales.list.quote.title' },
  ],
}

export default metadata
