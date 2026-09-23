export const metadata = {
  requireAuth: true,
  requireFeatures: ['products.types.manage'],
  pageTitle: 'Edit Product Type',
  pageTitleKey: 'products.types.form.editTitle',
  pageGroup: 'Products',
  pageGroupKey: 'products.nav.group',
  pageOrder: 312,
  breadcrumb: [
    { label: 'Product Types', labelKey: 'products.types.page.title', href: '/backend/products/types' },
    { label: 'Edit', labelKey: 'products.types.form.editTitle' },
  ],
}

export default metadata
