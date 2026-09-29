export const metadata = {
  requireAuth: true,
  requireFeatures: ['trade_docs.documents.view'],
  pageTitle: 'Proforma invoice',
  pageTitleKey: 'trade_docs.documents.kind.proforma',
  pageGroup: 'Export operations — Export documents',
  pageGroupKey: 'cross_border.nav.group.documents',
  pageOrder: 352,
  breadcrumb: [
    { label: 'Proforma invoices', labelKey: 'trade_docs.documents.kind.proforma', href: '/backend/trade-docs/proformas' },
    { label: 'Detail', labelKey: 'trade_docs.documents.kind.proforma' },
  ],
}

export default metadata
