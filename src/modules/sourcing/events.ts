import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Events emitted by the sourcing module.
 *
 * `clientBroadcast` keeps an open quotation list and review console in sync without polling;
 * payloads carry identifiers and scope only, never supplier prices.
 */
const events = [
  { id: 'sourcing.quote.created', label: 'Quotation Created', entity: 'quote', category: 'crud', clientBroadcast: true },
  { id: 'sourcing.quote.updated', label: 'Quotation Updated', entity: 'quote', category: 'crud', clientBroadcast: true },
  { id: 'sourcing.quote.approved', label: 'Quotation Approved', entity: 'quote', category: 'crud', clientBroadcast: true },
  { id: 'sourcing.quote.archived', label: 'Quotation Archived', entity: 'quote', category: 'crud', clientBroadcast: true },
  { id: 'sourcing.quote.deleted', label: 'Quotation Deleted', entity: 'quote', category: 'crud', clientBroadcast: true },
  { id: 'sourcing.quote.promoted', label: 'Quotation Lines Promoted', entity: 'quote', category: 'crud', clientBroadcast: true },
  { id: 'sourcing.quote_line.updated', label: 'Quotation Line Updated', entity: 'quote_line', category: 'crud', clientBroadcast: true },
  {
    id: 'sourcing.supplier_product.created',
    label: 'Supplier Product Created',
    entity: 'supplier_product',
    category: 'crud',
    clientBroadcast: true,
  },
  {
    id: 'sourcing.supplier_product.updated',
    label: 'Supplier Product Updated',
    entity: 'supplier_product',
    category: 'crud',
    clientBroadcast: true,
  },
  {
    id: 'sourcing.supplier_product.deleted',
    label: 'Supplier Product Deleted',
    entity: 'supplier_product',
    category: 'crud',
    clientBroadcast: true,
  },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'sourcing',
  events,
})

export type SourcingEventId = typeof events[number]['id']

export default eventsConfig
