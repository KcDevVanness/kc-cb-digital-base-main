export const metadata = {
  requireAuth: true,
  requireFeatures: ['products.categories.manage'],
  pageTitle: 'Create Product Category',
  pageTitleKey: 'products.categories.form.createTitle',
  pageGroup: 'Products',
  pageGroupKey: 'products.nav.group',
  pageOrder: 321,
  navHidden: true,
  breadcrumb: [
    { label: 'Product taxonomy', labelKey: 'products.taxonomy.page.title', href: '/backend/products/taxonomy' },
    { label: 'Create', labelKey: 'products.categories.form.createTitle' },
  ],
}

export default metadata
