export const metadata = {
  requireAuth: true,
  requireFeatures: ['products.categories.manage'],
  pageTitle: 'Edit Product Category',
  pageTitleKey: 'products.categories.form.editTitle',
  pageGroup: 'Products',
  pageGroupKey: 'products.nav.group',
  pageOrder: 322,
  navHidden: true,
  breadcrumb: [
    { label: 'Product taxonomy', labelKey: 'products.taxonomy.page.title', href: '/backend/products/taxonomy' },
    { label: 'Edit', labelKey: 'products.categories.form.editTitle' },
  ],
}

export default metadata
