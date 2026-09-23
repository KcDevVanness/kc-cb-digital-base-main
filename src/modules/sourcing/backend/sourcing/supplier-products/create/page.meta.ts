export const metadata = {
  requireAuth: true,
  requireFeatures: ['sourcing.supplier-products.manage'],
  pageTitle: 'New supplier product',
  pageTitleKey: 'sourcing.supplierProducts.form.createTitle',
  pageGroup: 'Purchasing',
  pageGroupKey: 'purchasing.nav.group',
  pageOrder: 206,
  icon: 'plus',
  breadcrumb: [
    { label: 'Supplier products', labelKey: 'sourcing.supplierProducts.page.title', href: '/backend/sourcing/supplier-products' },
    { label: 'Create', labelKey: 'sourcing.supplierProducts.form.createTitle' },
  ],
}

export default metadata
