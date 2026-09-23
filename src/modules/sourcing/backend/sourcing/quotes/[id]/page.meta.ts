export const metadata = {
  requireAuth: true,
  requireFeatures: ['sourcing.quotes.view'],
  pageTitle: 'Quotation review',
  pageTitleKey: 'sourcing.quotes.detail.page.title',
  pageGroup: 'Purchasing',
  pageGroupKey: 'purchasing.nav.group',
  pageOrder: 222,
  icon: 'file-spreadsheet',
  breadcrumb: [
    { label: 'Supplier quotations', labelKey: 'sourcing.quotes.page.title', href: '/backend/sourcing/quotes' },
    { label: 'Quotation review', labelKey: 'sourcing.quotes.detail.page.title' },
  ],
}

export default metadata
