export const metadata = {
  requireAuth: true,
  requireFeatures: ['finance.ledger.view'],
  pageTitle: 'Payables',
  pageTitleKey: 'finance.payables.page.title',
  pageGroup: 'Finance',
  pageGroupKey: 'export_finance.nav.group',
  pageOrder: 432,
  icon: 'banknote',
  breadcrumb: [
    { label: 'Payables', labelKey: 'finance.payables.page.title' },
  ],
}

export default metadata
