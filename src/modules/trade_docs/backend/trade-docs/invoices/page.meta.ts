export const metadata = {
  requireAuth: true,
  requireFeatures: ['trade_docs.invoices.view'],
  pageTitle: 'Invoices',
  pageTitleKey: 'trade_docs.invoices.page.title',
  pageGroup: 'Cross-Border',
  pageGroupKey: 'cross_border.nav.group',
  pageOrder: 330,
  icon: 'receipt',
  breadcrumb: [
    { label: 'Invoices', labelKey: 'trade_docs.invoices.page.title' },
  ],
}

export default metadata
