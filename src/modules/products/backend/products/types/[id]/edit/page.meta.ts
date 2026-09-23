export const metadata = {
  requireAuth: true,
  requireFeatures: ['products.types.manage'],
  pageTitle: 'Edit Product Line',
  pageTitleKey: 'products.types.form.editTitle',
  pageGroup: 'Products',
  pageGroupKey: 'products.nav.group',
  pageOrder: 312,
  navHidden: true,
  breadcrumb: [
    { label: 'Product taxonomy', labelKey: 'products.taxonomy.page.title', href: '/backend/products/taxonomy' },
    { label: 'Edit', labelKey: 'products.types.form.editTitle' },
  ],
}

export default metadata
