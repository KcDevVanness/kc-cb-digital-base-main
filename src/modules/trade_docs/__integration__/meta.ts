/**
 * Trade documents integration metadata.
 *
 * The PI spec drives `trade_docs` and the `parties` master data its snapshot reads. The CI spec
 * additionally walks the whole export chain through the real APIs — the shipment and its purchase
 * and sales allocations (`cross_border`), the committed purchase order behind a purchase allocation
 * (`purchasing`), the internal sales order lines a sales allocation points at (`sales`, bridged
 * through the app-owned product master) and the installed catalog product that bridges them
 * (`catalog`, `products`). All of them have to be present for the suite to be discovered.
 */
export const integrationMeta = {
  dependsOnModules: ['trade_docs', 'parties', 'cross_border', 'purchasing', 'sales', 'catalog', 'products'],
}
