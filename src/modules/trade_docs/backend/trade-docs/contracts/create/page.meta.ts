export const metadata = {
  requireAuth: true,
  requireFeatures: ['trade_docs.contracts.manage'],
  pageTitle: 'Create Contract',
  pageTitleKey: 'trade_docs.contracts.form.createTitle',
  pageGroup: 'Cross-Border',
  pageGroupKey: 'cross_border.nav.group',
  pageOrder: 321,
  breadcrumb: [
    { label: 'Contracts', labelKey: 'trade_docs.contracts.page.title', href: '/backend/trade-docs/contracts' },
    { label: 'Create', labelKey: 'trade_docs.contracts.form.createTitle' },
  ],
}

export default metadata
