export const metadata = {
  requireAuth: true,
  requireFeatures: ['sourcing.supplier-products.manage'],
  pageTitle: 'Edit supplier product',
  pageTitleKey: 'sourcing.supplierProducts.form.editTitle',
  pageGroup: 'Purchasing',
  pageGroupKey: 'purchasing.nav.group',
  pageOrder: 207,
  icon: 'package-search',
  breadcrumb: [
    { label: 'Supplier products', labelKey: 'sourcing.supplierProducts.page.title', href: '/backend/sourcing/supplier-products' },
    { label: 'Edit', labelKey: 'sourcing.supplierProducts.form.editTitle' },
  ],
}

export default metadata
