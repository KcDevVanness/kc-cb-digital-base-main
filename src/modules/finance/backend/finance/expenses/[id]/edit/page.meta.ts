export const metadata = {
  requireAuth: true,
  requireFeatures: ['finance.expenses.manage'],
  pageTitle: 'Edit expense',
  pageTitleKey: 'finance.expenses.form.editTitle',
  pageGroup: 'Finance',
  pageGroupKey: 'export_finance.nav.group',
  pageOrder: 430,
  breadcrumb: [
    { label: 'Period expenses', labelKey: 'finance.expenses.page.title', href: '/backend/finance/expenses' },
    { label: 'Edit expense', labelKey: 'finance.expenses.form.editTitle' },
  ],
}

export default metadata
