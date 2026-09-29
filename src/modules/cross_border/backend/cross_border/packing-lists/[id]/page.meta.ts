export const metadata = {
  requireAuth: true,
  requireFeatures: ['cross_border.shipments.view'],
  pageTitle: 'Packing list',
  pageTitleKey: 'cross_border.packingLists.page.title',
  pageGroup: 'Export operations — Shipping',
  pageGroupKey: 'cross_border.nav.group.shipping',
  pageOrder: 347,
  navHidden: true,
  breadcrumb: [
    { label: 'Packing lists (PL)', labelKey: 'cross_border.packingLists.page.title', href: '/backend/cross_border/packing-lists' },
    { label: 'Packing list', labelKey: 'cross_border.packingLists.page.title' },
  ],
}

export default metadata
