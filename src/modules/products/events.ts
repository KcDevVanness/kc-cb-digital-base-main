import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Events emitted by the products module.
 *
 * Nothing here is emitted any more: a product write goes through the installed catalog's commands
 * (`lib/store.ts` → `catalog.products.*` / `catalog.variants.*` / `catalog.prices.*`), which is what
 * fires the platform's `catalog.product.*` / `catalog.variant.*` / `catalog.price.*` events, audit
 * trail and index side effects. The four app-level ids below survive only because existing
 * subscribers and open backend lists reference them; a new listener should follow the catalog events.
 *
 * `clientBroadcast` keeps open backend lists in sync without polling; payloads carry
 * identifiers and scope only.
 */
const events = [
  { id: 'products.item.created', label: 'Product Created', entity: 'product', category: 'crud', clientBroadcast: true },
  { id: 'products.item.updated', label: 'Product Updated', entity: 'product', category: 'crud', clientBroadcast: true },
  { id: 'products.item.deleted', label: 'Product Deleted', entity: 'product', category: 'crud', clientBroadcast: true },
  { id: 'products.prices.updated', label: 'Product Prices Updated', entity: 'product_price', category: 'crud', clientBroadcast: true },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'products',
  events,
})

export type ProductsEventId = typeof events[number]['id']

export default eventsConfig
