/**
 * Products integration metadata.
 *
 * The spec drives the product master through its real HTTP surface (create, update, detail read)
 * and touches the database directly for exactly one precondition — a SKU the API can no longer
 * produce, which is what a migrated legacy code looks like.
 */
export const dependsOnModules = ['products']
