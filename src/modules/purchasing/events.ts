import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Events emitted by the purchasing module.
 *
 * `clientBroadcast` keeps open backend lists in sync without polling; the payload
 * carries identifiers and scope only, never supplier contact data.
 */
const events = [
  { id: 'purchasing.supplier.created', label: 'Supplier Created', entity: 'supplier', category: 'crud', clientBroadcast: true },
  { id: 'purchasing.supplier.updated', label: 'Supplier Updated', entity: 'supplier', category: 'crud', clientBroadcast: true },
  { id: 'purchasing.supplier.deleted', label: 'Supplier Deleted', entity: 'supplier', category: 'crud', clientBroadcast: true },
  { id: 'purchasing.purchase_order.created', label: 'Purchase Order Created', entity: 'purchase_order', category: 'crud', clientBroadcast: true },
  { id: 'purchasing.purchase_order.updated', label: 'Purchase Order Updated', entity: 'purchase_order', category: 'crud', clientBroadcast: true },
  { id: 'purchasing.purchase_order.deleted', label: 'Purchase Order Deleted', entity: 'purchase_order', category: 'crud', clientBroadcast: true },
  { id: 'purchasing.purchase_order.placed', label: 'Purchase Order Placed', entity: 'purchase_order', category: 'lifecycle', clientBroadcast: true },
  { id: 'purchasing.purchase_order.shipped', label: 'Purchase Order Shipped', entity: 'purchase_order', category: 'lifecycle', clientBroadcast: true },
  { id: 'purchasing.purchase_order.received', label: 'Purchase Order Received', entity: 'purchase_order', category: 'lifecycle', clientBroadcast: true },
  { id: 'purchasing.purchase_order.closed', label: 'Purchase Order Closed', entity: 'purchase_order', category: 'lifecycle', clientBroadcast: true },
  { id: 'purchasing.purchase_order.cancelled', label: 'Purchase Order Cancelled', entity: 'purchase_order', category: 'lifecycle', clientBroadcast: true },
  { id: 'purchasing.purchase_payment.recorded', label: 'Purchase Payment Recorded', entity: 'purchase_payment', category: 'crud', clientBroadcast: true },
  { id: 'purchasing.purchase_payment.deleted', label: 'Purchase Payment Deleted', entity: 'purchase_payment', category: 'crud', clientBroadcast: true },
  // The supplier product library.
  { id: 'purchasing.supplier_product.created', label: 'Supplier Product Created', entity: 'supplier_product', category: 'crud', clientBroadcast: true },
  { id: 'purchasing.supplier_product.updated', label: 'Supplier Product Updated', entity: 'supplier_product', category: 'crud', clientBroadcast: true },
  { id: 'purchasing.supplier_product.deleted', label: 'Supplier Product Deleted', entity: 'supplier_product', category: 'crud', clientBroadcast: true },
  { id: 'purchasing.supplier_product_prices.updated', label: 'Supplier Product Prices Updated', entity: 'supplier_product_prices', category: 'crud', clientBroadcast: true },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'purchasing',
  events,
})

export type PurchasingEventId = typeof events[number]['id']

export default eventsConfig
