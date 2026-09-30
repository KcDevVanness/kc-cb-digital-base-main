export const metadata = {
  requireAuth: true,
  // The report reads the installed quote/order tables through this module's own route, gated on the
  // same view feature the quote list uses.
  requireFeatures: ['sales.quote.view'],
  pageTitle: 'Quote conversion',
  pageTitleKey: 'internal_sales.conversion.page.title',
  pageGroup: 'Export operations — Internal sales',
  pageGroupKey: 'cross_border.nav.group.sales',
  pageOrder: 320,
  icon: 'trending-up',
  breadcrumb: [
    { label: 'Quote conversion', labelKey: 'internal_sales.conversion.page.title' },
  ],
}

export default metadata
