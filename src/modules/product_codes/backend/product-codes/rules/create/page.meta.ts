export const metadata = {
  requireAuth: true,
  requireFeatures: ['product_codes.rules.manage'],
  pageTitle: 'Create product code rule',
  pageTitleKey: 'product_codes.form.createTitle',
  pageGroup: 'Product master',
  pageGroupKey: 'products.nav.group',
  pageOrder: 301,
  navHidden: true,
  breadcrumb: [
    { label: 'Product code rules', labelKey: 'product_codes.page.title', href: '/backend/product-codes/rules' },
    { label: 'Create', labelKey: 'product_codes.form.createTitle' },
  ],
}

export default metadata
