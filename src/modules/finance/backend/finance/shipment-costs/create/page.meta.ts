export const metadata = {
  requireAuth: true,
  requireFeatures: ['finance.costs.manage'],
  pageTitle: 'Record cost',
  pageTitleKey: 'finance.shipmentCosts.form.createTitle',
  pageGroup: 'Finance',
  pageGroupKey: 'export_finance.nav.group',
  pageOrder: 422,
  breadcrumb: [
    { label: 'Shipment costs', labelKey: 'finance.shipmentCosts.page.title', href: '/backend/finance/shipment-costs' },
    { label: 'Record cost', labelKey: 'finance.shipmentCosts.form.createTitle' },
  ],
}

export default metadata
