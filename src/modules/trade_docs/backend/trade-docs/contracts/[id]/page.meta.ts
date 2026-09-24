export const metadata = {
  requireAuth: true,
  requireFeatures: ['trade_docs.contracts.view'],
  pageTitle: 'Contract',
  pageTitleKey: 'trade_docs.contracts.page.title',
  pageGroup: 'Cross-Border',
  pageGroupKey: 'cross_border.nav.group',
  pageOrder: 322,
  breadcrumb: [
    { label: 'Contracts', labelKey: 'trade_docs.contracts.page.title', href: '/backend/trade-docs/contracts' },
    { label: 'Detail', labelKey: 'trade_docs.contracts.page.title' },
  ],
}

export default metadata
