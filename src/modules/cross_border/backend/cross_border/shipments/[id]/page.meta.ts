export const metadata = {
  requireAuth: true,
  requireFeatures: ['cross_border.shipments.view'],
  pageTitle: 'Shipment',
  pageTitleKey: 'cross_border.shipments.page.title',
  pageGroup: 'Cross-Border',
  pageGroupKey: 'cross_border.nav.group',
  pageOrder: 222,
  breadcrumb: [
    { label: 'Shipments', labelKey: 'cross_border.shipments.page.title', href: '/backend/cross_border/shipments' },
  ],
}

export default metadata
