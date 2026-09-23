export const features = [
  { id: 'export_finance.orders.view', title: 'View the order file (business and finance)', module: 'export_finance' },
  { id: 'export_finance.cabinets.view', title: 'View the container file and its tax refund', module: 'export_finance' },
  {
    id: 'export_finance.manage',
    title: 'Manage collections, tax refunds and their documents',
    module: 'export_finance',
    dependsOn: ['export_finance.orders.view', 'export_finance.cabinets.view'],
  },
]

export default features
