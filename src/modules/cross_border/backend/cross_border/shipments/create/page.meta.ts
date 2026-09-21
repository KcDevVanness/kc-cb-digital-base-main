export const metadata = {
  requireAuth: true,
  requireFeatures: ['cross_border.shipments.manage'],
  pageTitle: 'Create Shipment',
  pageTitleKey: 'cross_border.shipments.form.createTitle',
  pageGroup: 'Cross-Border',
  pageGroupKey: 'cross_border.nav.group',
  pageOrder: 221,
  breadcrumb: [
    { label: 'Shipments', labelKey: 'cross_border.shipments.page.title', href: '/backend/cross_border/shipments' },
    { label: 'Create', labelKey: 'cross_border.shipments.form.createTitle' },
  ],
}

export default metadata
