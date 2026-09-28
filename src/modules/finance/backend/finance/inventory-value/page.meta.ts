export const metadata = {
  requireAuth: true,
  requireFeatures: ['finance.ledger.view'],
  pageTitle: 'Inventory value',
  pageTitleKey: 'finance.inventoryValue.page.title',
  pageGroup: 'Executive overview',
  pageGroupKey: 'executive_overview.nav.group',
  pageOrder: 330,
  icon: 'warehouse',
  breadcrumb: [
    { label: 'Inventory value', labelKey: 'finance.inventoryValue.page.title' },
  ],
}

export default metadata
