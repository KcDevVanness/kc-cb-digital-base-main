export const metadata = {
  requireAuth: true,
  requireFeatures: ['export_finance.orders.view'],
  pageTitle: 'Order file',
  pageTitleKey: 'export_finance.orders.page.title',
  pageGroup: 'Finance',
  pageGroupKey: 'export_finance.nav.group',
  pageOrder: 401,
  icon: 'file-text',
  breadcrumb: [
    { label: 'Order file', labelKey: 'export_finance.orders.page.title', href: '/backend/export-finance/orders' },
  ],
}

export default metadata
