export const metadata = {
  requireAuth: true,
  requireFeatures: ['trade_docs.documents.view'],
  pageTitle: 'Commercial invoices',
  pageTitleKey: 'trade_docs.documents.kind.commercial',
  pageGroup: 'Cross-Border',
  pageGroupKey: 'cross_border.nav.group',
  pageOrder: 360,
  icon: 'file-text',
  breadcrumb: [
    { label: 'Commercial invoices', labelKey: 'trade_docs.documents.kind.commercial' },
  ],
}

export default metadata
