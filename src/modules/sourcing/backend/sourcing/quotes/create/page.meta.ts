export const metadata = {
  requireAuth: true,
  requireFeatures: ['sourcing.quotes.manage'],
  pageTitle: 'New quotation',
  pageTitleKey: 'sourcing.quotes.create.page.title',
  pageGroup: 'Purchasing',
  pageGroupKey: 'purchasing.nav.group',
  pageOrder: 221,
  icon: 'plus',
  breadcrumb: [
    { label: 'Supplier quotations', labelKey: 'sourcing.quotes.page.title', href: '/backend/sourcing/quotes' },
    { label: 'New quotation', labelKey: 'sourcing.quotes.create.page.title' },
  ],
}

export default metadata
