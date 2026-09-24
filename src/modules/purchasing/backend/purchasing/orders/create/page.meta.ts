export const metadata = {
  requireAuth: true,
  requireFeatures: ['purchasing.orders.manage'],
  pageTitle: 'Create Purchase Order',
  pageTitleKey: 'purchasing.orders.form.createTitle',
  pageGroup: 'Purchasing',
  pageGroupKey: 'purchasing.nav.group',
  pageOrder: 211,
  breadcrumb: [
    { label: 'Purchase Orders', labelKey: 'purchasing.orders.page.title', href: '/backend/purchasing/orders' },
    { label: 'Create', labelKey: 'purchasing.orders.form.createTitle' },
  ],
}

export default metadata
