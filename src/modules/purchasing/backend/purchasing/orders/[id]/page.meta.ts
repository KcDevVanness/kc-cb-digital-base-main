export const metadata = {
  requireAuth: true,
  requireFeatures: ['purchasing.orders.view'],
  pageTitle: 'Purchase Order',
  pageTitleKey: 'purchasing.orders.page.title',
  pageGroup: 'Purchasing',
  pageGroupKey: 'purchasing.nav.group',
  pageOrder: 212,
  breadcrumb: [
    { label: 'Purchase Orders', labelKey: 'purchasing.orders.page.title', href: '/backend/purchasing/orders' },
  ],
}

export default metadata
