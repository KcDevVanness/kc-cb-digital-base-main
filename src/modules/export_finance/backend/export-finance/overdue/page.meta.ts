export const metadata = {
  requireAuth: true,
  // The page's own gate is the money-collection side; the refund section withdraws itself when the
  // viewer cannot read the container files (the page never hides an authorization failure behind a
  // missing section, it simply asks for what it shows).
  requireFeatures: ['export_finance.orders.view'],
  pageTitle: 'Overdue worklist',
  pageTitleKey: 'export_finance.overdue.page.title',
  pageGroup: 'Finance',
  pageGroupKey: 'export_finance.nav.group',
  pageOrder: 450,
  icon: 'alert-triangle',
  breadcrumb: [
    { label: 'Overdue worklist', labelKey: 'export_finance.overdue.page.title' },
  ],
}

export default metadata
