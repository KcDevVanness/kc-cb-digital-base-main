export const metadata = {
  requireAuth: true,
  requireFeatures: ['finance.costs.manage'],
  pageTitle: 'Edit cost',
  pageTitleKey: 'finance.shipmentCosts.form.editTitle',
  pageGroup: 'Finance',
  pageGroupKey: 'export_finance.nav.group',
  pageOrder: 423,
  breadcrumb: [
    { label: 'Shipment costs', labelKey: 'finance.shipmentCosts.page.title', href: '/backend/finance/shipment-costs' },
    { label: 'Edit cost', labelKey: 'finance.shipmentCosts.form.editTitle' },
  ],
}

export default metadata
