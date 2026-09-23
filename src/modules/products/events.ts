import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Events emitted by the products module.
 *
 * `clientBroadcast` keeps open backend lists in sync without polling; payloads carry
 * identifiers and scope only.
 */
const events = [
  { id: 'products.type.created', label: 'Product Type Created', entity: 'product_type', category: 'crud', clientBroadcast: true },
  { id: 'products.type.updated', label: 'Product Type Updated', entity: 'product_type', category: 'crud', clientBroadcast: true },
  { id: 'products.type.deleted', label: 'Product Type Deleted', entity: 'product_type', category: 'crud', clientBroadcast: true },
  { id: 'products.category.created', label: 'Product Category Created', entity: 'product_category', category: 'crud', clientBroadcast: true },
  { id: 'products.category.updated', label: 'Product Category Updated', entity: 'product_category', category: 'crud', clientBroadcast: true },
  { id: 'products.category.deleted', label: 'Product Category Deleted', entity: 'product_category', category: 'crud', clientBroadcast: true },
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
