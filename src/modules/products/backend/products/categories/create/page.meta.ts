export const metadata = {
  requireAuth: true,
  requireFeatures: ['products.categories.manage'],
  pageTitle: 'Create Product Category',
  pageTitleKey: 'products.categories.form.createTitle',
  pageGroup: 'Products',
  pageGroupKey: 'products.nav.group',
  pageOrder: 321,
  breadcrumb: [
    { label: 'Product Categories', labelKey: 'products.categories.page.title', href: '/backend/products/categories' },
    { label: 'Create', labelKey: 'products.categories.form.createTitle' },
  ],
}

export default metadata
