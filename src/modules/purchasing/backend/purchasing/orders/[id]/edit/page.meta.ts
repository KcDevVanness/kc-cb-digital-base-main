export const metadata = {
  requireAuth: true,
  requireFeatures: ['purchasing.orders.manage'],
  pageTitle: 'Edit Purchase Order',
  pageTitleKey: 'purchasing.orders.edit.title',
  pageGroup: 'Purchasing',
  pageGroupKey: 'purchasing.nav.group',
  pageOrder: 213,
  breadcrumb: [
    { label: 'Purchase Orders', labelKey: 'purchasing.orders.page.title', href: '/backend/purchasing/orders' },
    { label: 'Edit', labelKey: 'purchasing.orders.edit.title' },
  ],
}

export default metadata
