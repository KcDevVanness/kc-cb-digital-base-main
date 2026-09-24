export const metadata = {
  requireAuth: true,
  requireFeatures: ['purchasing.orders.view'],
  pageTitle: 'Purchase Orders',
  pageTitleKey: 'purchasing.orders.page.title',
  pageGroup: 'Purchasing',
  pageGroupKey: 'purchasing.nav.group',
  pageOrder: 210,
  icon: 'package',
  breadcrumb: [
    { label: 'Purchase Orders', labelKey: 'purchasing.orders.page.title' },
  ],
}

export default metadata
