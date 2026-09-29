export const metadata = {
  requireAuth: true,
  requireFeatures: ['trade_docs.documents.manage'],
  pageTitle: 'Create commercial invoice',
  pageTitleKey: 'trade_docs.documents.form.createTitleCommercial',
  pageGroup: 'Cross-Border',
  pageGroupKey: 'cross_border.nav.group',
  pageOrder: 361,
  breadcrumb: [
    { label: 'Commercial invoices', labelKey: 'trade_docs.documents.kind.commercial', href: '/backend/trade-docs/commercial-invoices' },
    { label: 'Create', labelKey: 'trade_docs.documents.form.createTitleCommercial' },
  ],
}

export default metadata
