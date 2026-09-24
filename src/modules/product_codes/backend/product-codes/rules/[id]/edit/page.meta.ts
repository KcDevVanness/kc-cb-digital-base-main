export const metadata = {
  requireAuth: true,
  requireFeatures: ['product_codes.rules.manage'],
  pageTitle: 'Edit product code rule',
  pageTitleKey: 'product_codes.form.editTitle',
  pageGroup: 'Product master',
  pageGroupKey: 'products.nav.group',
  pageOrder: 302,
  navHidden: true,
  breadcrumb: [
    { label: 'Product code rules', labelKey: 'product_codes.page.title', href: '/backend/product-codes/rules' },
    { label: 'Edit', labelKey: 'product_codes.form.editTitle' },
  ],
}

export default metadata
