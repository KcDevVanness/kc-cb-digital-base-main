import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Events emitted by the trade documents module.
 *
 * The event-id segment after the module id is the `CrudEventsConfig.entity` value, so these ids
 * are what the data engine emits (`trade_docs.contract.issued`, …). `clientBroadcast` keeps open
 * lists in sync without polling; payloads carry identifiers and scope only.
 */
const events = [
  { id: 'trade_docs.contract.created', label: 'Contract Created', entity: 'contract', category: 'crud', clientBroadcast: true },
  { id: 'trade_docs.contract.updated', label: 'Contract Updated', entity: 'contract', category: 'crud', clientBroadcast: true },
  { id: 'trade_docs.contract.deleted', label: 'Contract Deleted', entity: 'contract', category: 'crud', clientBroadcast: true },
  { id: 'trade_docs.contract.issued', label: 'Contract Issued', entity: 'contract', category: 'lifecycle', clientBroadcast: true },
  { id: 'trade_docs.contract.signed', label: 'Contract Signed', entity: 'contract', category: 'lifecycle', clientBroadcast: true },
  { id: 'trade_docs.contract.closed', label: 'Contract Closed', entity: 'contract', category: 'lifecycle', clientBroadcast: true },
  { id: 'trade_docs.contract.cancelled', label: 'Contract Cancelled', entity: 'contract', category: 'lifecycle', clientBroadcast: true },
  { id: 'trade_docs.contract.document.generated', label: 'Contract Document Generated', entity: 'contract', category: 'lifecycle', clientBroadcast: true },
  { id: 'trade_docs.invoice.created', label: 'Invoice Created', entity: 'invoice', category: 'crud', clientBroadcast: true },
  { id: 'trade_docs.invoice.updated', label: 'Invoice Updated', entity: 'invoice', category: 'crud', clientBroadcast: true },
  { id: 'trade_docs.invoice.deleted', label: 'Invoice Deleted', entity: 'invoice', category: 'crud', clientBroadcast: true },
  { id: 'trade_docs.invoice.confirmed', label: 'Invoice Confirmed', entity: 'invoice', category: 'lifecycle', clientBroadcast: true },
  { id: 'trade_docs.invoice.voided', label: 'Invoice Voided', entity: 'invoice', category: 'lifecycle', clientBroadcast: true },
  { id: 'trade_docs.invoice.attached', label: 'Invoice Attachment Bound', entity: 'invoice', category: 'crud', clientBroadcast: true },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'trade_docs',
  events,
})

export type TradeDocsEventId = typeof events[number]['id']

export default eventsConfig
