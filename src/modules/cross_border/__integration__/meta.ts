/**
 * Cross-border integration metadata.
 *
 * The contract-link suite drives `cross_border` and the masters it reads: the purchase order and
 * its line (`purchasing`), the app-owned product master (`products`) and the installed catalog
 * product that bridges an allocation to stock (`catalog`), plus the contracts themselves
 * (`trade_docs`). All of them have to be present for the suite to be discovered.
 */
export const dependsOnModules = ['cross_border', 'purchasing', 'products', 'catalog', 'trade_docs']
