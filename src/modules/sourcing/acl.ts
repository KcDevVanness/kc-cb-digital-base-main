/**
 * Sourcing features.
 *
 * `sourcing.promote.run` depends on the product features the promotion actually writes
 * through: promoting a quotation line creates or updates a product and replaces its price
 * set, so a sourcing-only role must not be able to grant itself master-data writes.
 */
export const features = [
  { id: 'sourcing.quotes.view', title: 'View supplier quotations', module: 'sourcing' },
  {
    id: 'sourcing.quotes.manage',
    title: 'Manage supplier quotations',
    module: 'sourcing',
    dependsOn: ['sourcing.quotes.view'],
  },
  {
    id: 'sourcing.import.run',
    title: 'Import supplier quotation workbooks',
    module: 'sourcing',
    dependsOn: ['sourcing.quotes.view'],
  },
  {
    id: 'sourcing.promote.run',
    title: 'Promote quotation lines into the product master',
    module: 'sourcing',
    dependsOn: ['sourcing.quotes.view', 'products.items.manage', 'products.prices.manage'],
  },
  { id: 'sourcing.supplier-products.view', title: 'View supplier products', module: 'sourcing' },
  {
    id: 'sourcing.supplier-products.manage',
    title: 'Manage supplier products',
    module: 'sourcing',
    dependsOn: ['sourcing.supplier-products.view'],
  },
  {
    id: 'sourcing.supplier-products.promote',
    title: 'Sync supplier products into the product master',
    module: 'sourcing',
    dependsOn: ['sourcing.supplier-products.view', 'products.items.manage', 'products.prices.manage'],
  },
]

export default features
