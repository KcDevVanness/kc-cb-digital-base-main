export const metadata = {
  requireAuth: true,
  requireFeatures: ['trade_docs.documents.view'],
  pageTitle: 'Commercial invoice',
  pageTitleKey: 'trade_docs.documents.kind.commercial',
  pageGroup: 'Export operations — Export documents',
  pageGroupKey: 'cross_border.nav.group.documents',
  pageOrder: 362,
  breadcrumb: [
    { label: 'Commercial invoices', labelKey: 'trade_docs.documents.kind.commercial', href: '/backend/trade-docs/commercial-invoices' },
    { label: 'Detail', labelKey: 'trade_docs.documents.kind.commercial' },
  ],
}

export default metadata
