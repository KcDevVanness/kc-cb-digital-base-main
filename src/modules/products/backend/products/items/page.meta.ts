export const metadata = {
  requireAuth: true,
  requireFeatures: ['products.items.view'],
  pageTitle: 'Products',
  pageTitleKey: 'products.items.page.title',
  pageGroup: 'Products',
  pageGroupKey: 'products.nav.group',
  pageOrder: 300,
  icon: 'package',
  breadcrumb: [
    { label: 'Products', labelKey: 'products.items.page.title' },
  ],
}

export default metadata
