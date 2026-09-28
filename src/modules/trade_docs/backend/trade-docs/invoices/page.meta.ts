export const metadata = {
  requireAuth: true,
  requireFeatures: ['trade_docs.invoices.view'],
  pageTitle: 'Tax invoice ledger',
  pageTitleKey: 'trade_docs.invoices.page.title',
  pageGroup: 'Finance',
  pageGroupKey: 'export_finance.nav.group',
  pageOrder: 420,
  icon: 'receipt',
  breadcrumb: [
    { label: 'Tax invoice ledger', labelKey: 'trade_docs.invoices.page.title' },
  ],
}

export default metadata
