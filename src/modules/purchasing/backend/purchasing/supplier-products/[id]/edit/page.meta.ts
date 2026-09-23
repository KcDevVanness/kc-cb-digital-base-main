export const metadata = {
  requireAuth: true,
  requireFeatures: ['purchasing.supplier-products.manage'],
  pageTitle: 'Edit supplier product',
  pageTitleKey: 'purchasing.supplierProducts.form.editTitle',
  pageGroup: 'Purchasing',
  pageGroupKey: 'purchasing.nav.group',
  pageOrder: 207,
  icon: 'package-search',
  breadcrumb: [
    { label: 'Supplier products', labelKey: 'purchasing.supplierProducts.page.title', href: '/backend/purchasing/supplier-products' },
    { label: 'Edit', labelKey: 'purchasing.supplierProducts.form.editTitle' },
  ],
}

export default metadata
