export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.quotes.manage'],
  pageTitle: 'Edit external sales quote',
  pageTitleKey: 'internal_sales.form.externalQuote.editTitle',
  pageGroup: 'Export operations — External sales',
  pageGroupKey: 'cross_border.nav.group.externalSales',
  pageOrder: 319,
  icon: 'globe',
  breadcrumb: [
    { label: 'External sales quotes', labelKey: 'internal_sales.list.externalQuote.title', href: '/backend/external-sales/quotes' },
    { label: 'Edit', labelKey: 'internal_sales.form.externalQuote.editTitle' },
  ],
}

export default metadata
