export const metadata = {
  requireAuth: true,
  requireFeatures: ['purchasing.suppliers.manage'],
  pageTitle: 'Edit Supplier',
  pageTitleKey: 'purchasing.suppliers.form.editTitle',
  pageGroup: 'Purchasing',
  pageGroupKey: 'purchasing.nav.group',
  pageOrder: 202,
  breadcrumb: [
    { label: 'Suppliers', labelKey: 'purchasing.suppliers.page.title', href: '/backend/purchasing/suppliers' },
    { label: 'Edit', labelKey: 'purchasing.suppliers.form.editTitle' },
  ],
}

export default metadata
