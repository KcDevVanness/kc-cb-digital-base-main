export const metadata = {
  requireAuth: true,
  requireFeatures: ['products.types.manage'],
  pageTitle: 'Create Product Type',
  pageTitleKey: 'products.types.form.createTitle',
  pageGroup: 'Products',
  pageGroupKey: 'products.nav.group',
  pageOrder: 311,
  breadcrumb: [
    { label: 'Product Types', labelKey: 'products.types.page.title', href: '/backend/products/types' },
    { label: 'Create', labelKey: 'products.types.form.createTitle' },
  ],
}

export default metadata
