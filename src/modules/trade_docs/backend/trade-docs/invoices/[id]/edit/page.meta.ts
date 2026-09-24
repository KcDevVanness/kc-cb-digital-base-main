export const metadata = {
  requireAuth: true,
  requireFeatures: ['trade_docs.invoices.manage'],
  pageTitle: 'Invoice',
  pageTitleKey: 'trade_docs.invoices.form.editTitle',
  pageGroup: 'Cross-Border',
  pageGroupKey: 'cross_border.nav.group',
  pageOrder: 332,
  breadcrumb: [
    { label: 'Invoices', labelKey: 'trade_docs.invoices.page.title', href: '/backend/trade-docs/invoices' },
    { label: 'Edit', labelKey: 'trade_docs.invoices.form.editTitle' },
  ],
}

export default metadata
