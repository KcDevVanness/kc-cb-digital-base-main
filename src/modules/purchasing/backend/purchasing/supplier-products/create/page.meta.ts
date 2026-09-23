export const metadata = {
  requireAuth: true,
  requireFeatures: ['purchasing.supplier-products.manage'],
  pageTitle: 'New supplier product',
  pageTitleKey: 'purchasing.supplierProducts.form.createTitle',
  pageGroup: 'Purchasing',
  pageGroupKey: 'purchasing.nav.group',
  pageOrder: 206,
  icon: 'plus',
  breadcrumb: [
    { label: 'Supplier products', labelKey: 'purchasing.supplierProducts.page.title', href: '/backend/purchasing/supplier-products' },
    { label: 'Create', labelKey: 'purchasing.supplierProducts.form.createTitle' },
  ],
}

export default metadata
