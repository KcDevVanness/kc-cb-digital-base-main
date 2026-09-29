export const metadata = {
  requireAuth: true,
  requireFeatures: ['trade_docs.documents.manage'],
  pageTitle: 'Create proforma invoice',
  pageTitleKey: 'trade_docs.documents.form.createTitleProforma',
  pageGroup: 'Cross-Border',
  pageGroupKey: 'cross_border.nav.group',
  pageOrder: 351,
  breadcrumb: [
    { label: 'Proforma invoices', labelKey: 'trade_docs.documents.kind.proforma', href: '/backend/trade-docs/proformas' },
    { label: 'Create', labelKey: 'trade_docs.documents.form.createTitleProforma' },
  ],
}

export default metadata
