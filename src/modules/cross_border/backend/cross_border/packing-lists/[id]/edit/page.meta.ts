export const metadata = {
  requireAuth: true,
  requireFeatures: ['cross_border.documents.manage'],
  pageTitle: 'Edit packing list (PL)',
  pageTitleKey: 'cross_border.packingLists.form.editTitle',
  pageGroup: 'Export operations — Shipping',
  pageGroupKey: 'cross_border.nav.group.shipping',
  pageOrder: 348,
  navHidden: true,
  breadcrumb: [
    { label: 'Packing lists (PL)', labelKey: 'cross_border.packingLists.page.title', href: '/backend/cross_border/packing-lists' },
    { label: 'Edit', labelKey: 'cross_border.packingLists.form.editTitle' },
  ],
}

export default metadata
