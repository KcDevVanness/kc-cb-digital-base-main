export const metadata = {
  requireAuth: true,
  requireFeatures: ['products.items.manage'],
  pageTitle: 'Create Product',
  pageTitleKey: 'products.items.form.createTitle',
  pageGroup: 'Products',
  pageGroupKey: 'products.nav.group',
  pageOrder: 301,
  breadcrumb: [
    { label: 'Products', labelKey: 'products.items.page.title', href: '/backend/products/items' },
    { label: 'Create', labelKey: 'products.items.form.createTitle' },
  ],
}

export default metadata
