export const metadata = {
  requireAuth: true,
  requireFeatures: ['trade_docs.invoices.manage'],
  pageTitle: 'Invoice',
  pageTitleKey: 'trade_docs.invoices.form.editTitle',
  pageGroup: 'Finance',
  pageGroupKey: 'export_finance.nav.group',
  pageOrder: 422,
  breadcrumb: [
    { label: 'Invoices', labelKey: 'trade_docs.invoices.page.title', href: '/backend/trade-docs/invoices' },
    { label: 'Edit', labelKey: 'trade_docs.invoices.form.editTitle' },
  ],
}

export default metadata
