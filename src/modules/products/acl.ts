/**
 * The module's features.
 *
 * `products.prices.manage` is depended on by other modules (`purchasing`, `sourcing`), so it stays
 * even though the price surfaces are thin; the taxonomy features (`products.types.manage`,
 * `products.categories.manage`) retired with the app-owned taxonomy — categories now live in the
 * installed catalog, behind the catalog's own ACL.
 */
export const features = [
  { id: 'products.items.view', title: 'View products', module: 'products' },
  {
    id: 'products.items.manage',
    title: 'Manage products',
    module: 'products',
    dependsOn: ['products.items.view'],
  },
  {
    id: 'products.prices.manage',
    title: 'Manage product prices',
    module: 'products',
    dependsOn: ['products.items.view'],
  },
]

export default features
