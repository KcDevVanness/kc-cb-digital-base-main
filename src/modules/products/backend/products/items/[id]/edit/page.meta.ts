export const metadata = {
  requireAuth: true,
  requireFeatures: ['products.items.manage'],
  pageTitle: 'Edit product',
  pageTitleKey: 'products.items.form.editTitle',
  pageGroup: 'Products',
  pageGroupKey: 'products.nav.group',
  pageOrder: 302,
  navHidden: true,
  breadcrumb: [
    { label: 'Products', labelKey: 'products.items.page.title', href: '/backend/products/items' },
    { label: 'Edit', labelKey: 'products.items.form.editTitle' },
  ],
}

export default metadata
