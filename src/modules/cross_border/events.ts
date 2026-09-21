import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Events emitted by the cross-border module. Lifecycle events fire only after the peer calls
 * they depend on succeeded (depart → purchasing transitions, receive → wms + purchasing), so a
 * subscriber never sees a state the system did not actually reach.
 */
const events = [
  { id: 'cross_border.shipment.created', label: 'Shipment Created', entity: 'shipment', category: 'crud', clientBroadcast: true },
  { id: 'cross_border.shipment.updated', label: 'Shipment Updated', entity: 'shipment', category: 'crud', clientBroadcast: true },
  { id: 'cross_border.shipment.deleted', label: 'Shipment Deleted', entity: 'shipment', category: 'crud', clientBroadcast: true },
  { id: 'cross_border.shipment.departed', label: 'Shipment Departed', entity: 'shipment', category: 'lifecycle', clientBroadcast: true },
  { id: 'cross_border.shipment.milestone_recorded', label: 'Shipment Milestone Recorded', entity: 'shipment', category: 'lifecycle', clientBroadcast: true },
  { id: 'cross_border.shipment.received', label: 'Shipment Received', entity: 'shipment', category: 'lifecycle', clientBroadcast: true },
  { id: 'cross_border.shipment.cancelled', label: 'Shipment Cancelled', entity: 'shipment', category: 'lifecycle', clientBroadcast: true },
  { id: 'cross_border.export_document.created', label: 'Export Document Created', entity: 'export_document', category: 'crud' },
  { id: 'cross_border.export_document.updated', label: 'Export Document Updated', entity: 'export_document', category: 'crud' },
  { id: 'cross_border.export_document.deleted', label: 'Export Document Deleted', entity: 'export_document', category: 'crud' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'cross_border',
  events,
})

export type CrossBorderEventId = typeof events[number]['id']

export default eventsConfig
