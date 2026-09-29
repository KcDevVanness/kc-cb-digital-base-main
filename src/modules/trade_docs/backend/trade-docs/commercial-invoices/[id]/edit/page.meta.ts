export const metadata = {
  requireAuth: true,
  requireFeatures: ['trade_docs.documents.manage'],
  pageTitle: 'Edit commercial invoice',
  pageTitleKey: 'trade_docs.documents.form.editTitleCommercial',
  pageGroup: 'Cross-Border',
  pageGroupKey: 'cross_border.nav.group',
  pageOrder: 363,
  breadcrumb: [
    { label: 'Commercial invoices', labelKey: 'trade_docs.documents.kind.commercial', href: '/backend/trade-docs/commercial-invoices' },
    { label: 'Edit', labelKey: 'trade_docs.documents.form.editTitleCommercial' },
  ],
}

export default metadata
