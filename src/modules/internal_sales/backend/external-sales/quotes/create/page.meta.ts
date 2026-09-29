export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.quotes.manage'],
  pageTitle: 'New external sales quote',
  pageTitleKey: 'internal_sales.form.externalQuote.createTitle',
  pageGroup: 'Export operations — External sales',
  pageGroupKey: 'cross_border.nav.group.externalSales',
  pageOrder: 318,
  icon: 'globe',
  breadcrumb: [
    { label: 'External sales quotes', labelKey: 'internal_sales.list.externalQuote.title', href: '/backend/external-sales/quotes' },
    { label: 'Create', labelKey: 'internal_sales.form.externalQuote.createTitle' },
  ],
}

export default metadata
