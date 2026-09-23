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
    // The promotion writes the product master *and* feeds the supplier product library, which
    // `purchasing` owns; the grant is explicit so a sourcing-only role cannot acquire either write
    // by holding this one feature.
    dependsOn: [
      'sourcing.quotes.view',
      'products.items.manage',
      'products.prices.manage',
      'purchasing.supplier-products.manage',
    ],
  },
]

export default features
