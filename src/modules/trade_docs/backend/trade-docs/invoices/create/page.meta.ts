export const metadata = {
  requireAuth: true,
  requireFeatures: ['trade_docs.invoices.manage'],
  pageTitle: 'Create Invoice',
  pageTitleKey: 'trade_docs.invoices.form.createTitle',
  pageGroup: 'Cross-Border',
  pageGroupKey: 'cross_border.nav.group',
  pageOrder: 331,
  breadcrumb: [
    { label: 'Invoices', labelKey: 'trade_docs.invoices.page.title', href: '/backend/trade-docs/invoices' },
    { label: 'Create', labelKey: 'trade_docs.invoices.form.createTitle' },
  ],
}

export default metadata
