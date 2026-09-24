/**
 * Purchasing integration metadata.
 *
 * The spec exercises the supplier product library through the real HTTP surface and then follows
 * the link into the two modules that consume it: `sourcing` (a quotation line feeds the library)
 * and `products` (the sync action writes the product master). All three must be present.
 */
export const dependsOnModules = ['purchasing', 'sourcing', 'products']
