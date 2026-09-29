export const metadata = {
  requireAuth: true,
  requireFeatures: ['finance.costs.view'],
  pageTitle: 'Shipment costs',
  pageTitleKey: 'finance.shipmentCosts.page.title',
  pageGroup: 'Finance',
  pageGroupKey: 'export_finance.nav.group',
  pageOrder: 420,
  icon: 'truck',
  breadcrumb: [
    { label: 'Shipment costs', labelKey: 'finance.shipmentCosts.page.title' },
  ],
}

export default metadata
