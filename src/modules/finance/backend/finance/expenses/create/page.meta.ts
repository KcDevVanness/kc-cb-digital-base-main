export const metadata = {
  requireAuth: true,
  requireFeatures: ['finance.expenses.manage'],
  pageTitle: 'Record expense',
  pageTitleKey: 'finance.expenses.form.createTitle',
  pageGroup: 'Finance',
  pageGroupKey: 'export_finance.nav.group',
  pageOrder: 429,
  breadcrumb: [
    { label: 'Period expenses', labelKey: 'finance.expenses.page.title', href: '/backend/finance/expenses' },
    { label: 'Record expense', labelKey: 'finance.expenses.form.createTitle' },
  ],
}

export default metadata
