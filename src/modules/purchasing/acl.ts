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
  // The supplier product library (the supplier-side goods list the buyer orders from). `promote`
  // depends on the product master's own write features, so a purchasing-only role cannot grant
  // itself master-data writes.
  { id: 'purchasing.supplier-products.view', title: 'View supplier products', module: 'purchasing' },
  {
    id: 'purchasing.supplier-products.manage',
    title: 'Manage supplier products',
    module: 'purchasing',
    dependsOn: ['purchasing.supplier-products.view'],
  },
  {
    id: 'purchasing.supplier-products.promote',
    title: 'Sync supplier products into the product master',
    module: 'purchasing',
    dependsOn: ['purchasing.supplier-products.view', 'products.items.manage', 'products.prices.manage'],
  },
]

export default features
