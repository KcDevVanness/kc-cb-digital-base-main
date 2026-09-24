/**
 * Product-codes integration metadata.
 *
 * The suite drives the module's own HTTP surface only: rules, generation, parsing and the issuance
 * panel. It deliberately does not touch `purchasing` — the form that calls it is covered by that
 * module's own specs.
 */
export const dependsOnModules = ['product_codes']
