export const features = [
  { id: 'products.items.view', title: 'View products', module: 'products' },
  {
    id: 'products.items.manage',
    title: 'Manage products',
    module: 'products',
    dependsOn: ['products.items.view'],
  },
  {
    id: 'products.types.manage',
    title: 'Manage product types',
    module: 'products',
    dependsOn: ['products.items.view'],
  },
  {
    id: 'products.categories.manage',
    title: 'Manage product categories',
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
