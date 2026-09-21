export const features = [
  { id: 'purchasing.suppliers.view', title: 'View suppliers', module: 'purchasing' },
  {
    id: 'purchasing.suppliers.manage',
    title: 'Manage suppliers',
    module: 'purchasing',
    dependsOn: ['purchasing.suppliers.view'],
  },
  { id: 'purchasing.orders.view', title: 'View purchase orders', module: 'purchasing' },
  {
    id: 'purchasing.orders.manage',
    title: 'Manage purchase orders',
    module: 'purchasing',
    dependsOn: ['purchasing.orders.view'],
  },
  {
    id: 'purchasing.payments.manage',
    title: 'Record purchase payments',
    module: 'purchasing',
    dependsOn: ['purchasing.orders.view'],
  },
]

export default features
