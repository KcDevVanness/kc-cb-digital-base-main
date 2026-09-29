export const metadata = {
  requireAuth: true,
  // The rows are the shipment's export documents, so the read gate is the shipment read gate;
  // registering/editing/deleting a document is gated separately by the API on
  // `cross_border.documents.manage` and the page hides those controls when the role lacks it.
  requireFeatures: ['cross_border.shipments.view'],
  pageTitle: 'Packing lists (PL)',
  pageTitleKey: 'cross_border.packingLists.page.title',
  pageGroup: 'Export operations — Shipping',
  pageGroupKey: 'cross_border.nav.group.shipping',
  pageOrder: 345,
  icon: 'file-text',
  breadcrumb: [
    { label: 'Packing lists (PL)', labelKey: 'cross_border.packingLists.page.title' },
  ],
}

export default metadata
