export const metadata = {
  requireAuth: true,
  requireFeatures: ['trade_docs.documents.view'],
  pageTitle: 'Proforma invoices',
  pageTitleKey: 'trade_docs.documents.kind.proforma',
  pageGroup: 'Cross-Border',
  pageGroupKey: 'cross_border.nav.group',
  pageOrder: 350,
  icon: 'file-text',
  breadcrumb: [
    { label: 'Proforma invoices', labelKey: 'trade_docs.documents.kind.proforma' },
  ],
}

export default metadata
