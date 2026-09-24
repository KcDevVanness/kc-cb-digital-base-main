export const metadata = {
  requireAuth: true,
  requireFeatures: ['products.types.manage'],
  pageTitle: 'Create Product Line',
  pageTitleKey: 'products.types.form.createTitle',
  pageGroup: 'Products',
  pageGroupKey: 'products.nav.group',
  pageOrder: 311,
  navHidden: true,
  breadcrumb: [
    { label: 'Product taxonomy', labelKey: 'products.taxonomy.page.title', href: '/backend/products/taxonomy' },
    { label: 'Create', labelKey: 'products.types.form.createTitle' },
  ],
}

export default metadata
