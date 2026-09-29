export const metadata = {
  requireAuth: true,
  requireFeatures: ['trade_docs.documents.manage'],
  pageTitle: 'Edit proforma invoice',
  pageTitleKey: 'trade_docs.documents.form.editTitleProforma',
  pageGroup: 'Export operations — Export documents',
  pageGroupKey: 'cross_border.nav.group.documents',
  pageOrder: 353,
  breadcrumb: [
    { label: 'Proforma invoices', labelKey: 'trade_docs.documents.kind.proforma', href: '/backend/trade-docs/proformas' },
    { label: 'Edit', labelKey: 'trade_docs.documents.form.editTitleProforma' },
  ],
}

export default metadata
