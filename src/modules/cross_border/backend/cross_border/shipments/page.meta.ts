export const metadata = {
  requireAuth: true,
  requireFeatures: ['cross_border.shipments.view'],
  pageTitle: 'Shipments',
  pageTitleKey: 'cross_border.shipments.page.title',
  pageGroup: 'Export operations — Shipping',
  pageGroupKey: 'cross_border.nav.group.shipping',
  pageOrder: 340,
  icon: 'truck',
  breadcrumb: [
    { label: 'Shipments', labelKey: 'cross_border.shipments.page.title' },
  ],
}

export default metadata
