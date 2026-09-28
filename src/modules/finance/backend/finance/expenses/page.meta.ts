export const metadata = {
  requireAuth: true,
  requireFeatures: ['finance.expenses.view'],
  pageTitle: 'Period expenses',
  pageTitleKey: 'finance.expenses.page.title',
  pageGroup: 'Finance',
  pageGroupKey: 'export_finance.nav.group',
  pageOrder: 428,
  icon: 'receipt',
  breadcrumb: [
    { label: 'Period expenses', labelKey: 'finance.expenses.page.title' },
  ],
}

export default metadata
