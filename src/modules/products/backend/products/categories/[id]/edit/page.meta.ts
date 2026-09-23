export const metadata = {
  requireAuth: true,
  requireFeatures: ['products.categories.manage'],
  pageTitle: 'Edit Product Category',
  pageTitleKey: 'products.categories.form.editTitle',
  pageGroup: 'Products',
  pageGroupKey: 'products.nav.group',
  pageOrder: 322,
  breadcrumb: [
    { label: 'Product Categories', labelKey: 'products.categories.page.title', href: '/backend/products/categories' },
    { label: 'Edit', labelKey: 'products.categories.form.editTitle' },
  ],
}

export default metadata
