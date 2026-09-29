export const metadata = {
  requireAuth: true,
  requireFeatures: ['trade_docs.contracts.manage'],
  pageTitle: 'Edit Contract',
  pageTitleKey: 'trade_docs.contracts.form.editTitle',
  pageGroup: 'Export operations — Contracts',
  pageGroupKey: 'cross_border.nav.group.contracts',
  pageOrder: 323,
  breadcrumb: [
    { label: 'Contracts', labelKey: 'trade_docs.contracts.page.title', href: '/backend/trade-docs/contracts' },
    { label: 'Edit', labelKey: 'trade_docs.contracts.form.editTitle' },
  ],
}

export default metadata
