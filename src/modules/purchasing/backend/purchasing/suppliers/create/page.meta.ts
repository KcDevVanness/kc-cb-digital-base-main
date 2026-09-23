export const metadata = {
  requireAuth: true,
  requireFeatures: ['purchasing.suppliers.manage'],
  pageTitle: 'Create Supplier',
  pageTitleKey: 'purchasing.suppliers.form.createTitle',
  pageGroup: 'Purchasing',
  pageGroupKey: 'purchasing.nav.group',
  pageOrder: 201,
  breadcrumb: [
    { label: 'Suppliers', labelKey: 'purchasing.suppliers.page.title', href: '/backend/purchasing/suppliers' },
    { label: 'Create', labelKey: 'purchasing.suppliers.form.createTitle' },
  ],
}

export default metadata
