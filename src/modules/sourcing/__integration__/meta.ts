/**
 * Sourcing integration metadata.
 *
 * The spec exercises the supplier product library through the real HTTP surface and then follows
 * the link into the two modules that consume it: `purchasing` (an order line may reference a
 * library row) and `products` (the sync action writes the product master). All three modules must
 * therefore be present.
 */
export const dependsOnModules = ['sourcing', 'purchasing', 'products']
