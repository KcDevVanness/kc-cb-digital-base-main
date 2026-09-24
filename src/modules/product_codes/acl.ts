/**
 * Feature IDs for the product-codes module.
 *
 * Generation is its own feature on purpose: a buyer issues codes from the supplier product form, and
 * that must not require the right to rewrite the rules those codes are built from.
 */
export const features = [
  { id: 'product_codes.rules.view', title: 'View product code rules', module: 'product_codes' },
  {
    id: 'product_codes.rules.manage',
    title: 'Manage product code rules',
    module: 'product_codes',
    dependsOn: ['product_codes.rules.view'],
  },
  {
    id: 'product_codes.codes.generate',
    title: 'Generate product codes',
    module: 'product_codes',
    dependsOn: ['product_codes.rules.view'],
  },
]

export default features
