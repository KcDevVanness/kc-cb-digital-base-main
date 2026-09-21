export const metadata = {
  requireAuth: true,
  requireFeatures: ['cross_border.shipments.view'],
  pageTitle: 'Shipments',
  pageTitleKey: 'cross_border.shipments.page.title',
  pageGroup: 'Cross-Border',
  pageGroupKey: 'cross_border.nav.group',
  pageOrder: 220,
  icon: 'truck',
  breadcrumb: [
    { label: 'Shipments', labelKey: 'cross_border.shipments.page.title' },
  ],
}

export default metadata
