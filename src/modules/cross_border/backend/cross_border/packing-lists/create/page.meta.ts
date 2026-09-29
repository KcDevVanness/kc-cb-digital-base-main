export const metadata = {
  requireAuth: true,
  requireFeatures: ['cross_border.documents.manage'],
  pageTitle: 'Create packing list (PL)',
  pageTitleKey: 'cross_border.packingLists.form.createTitle',
  pageGroup: 'Export operations — Shipping',
  pageGroupKey: 'cross_border.nav.group.shipping',
  pageOrder: 346,
  navHidden: true,
  breadcrumb: [
    { label: 'Packing lists (PL)', labelKey: 'cross_border.packingLists.page.title', href: '/backend/cross_border/packing-lists' },
    { label: 'Create', labelKey: 'cross_border.packingLists.form.createTitle' },
  ],
}

export default metadata
