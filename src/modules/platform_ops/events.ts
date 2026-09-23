import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Events emitted by the platform-ops module.
 *
 * The ingest/import counts travel in the payload so a subscriber can report "12 orders, 3
 * mismatches" without re-querying, and `reconciliation.raised` fires per item so a queue
 * subscriber can notify once per problem rather than once per batch.
 */
const events = [
  { id: 'platform_ops.channel.created', label: 'Platform Channel Created', entity: 'channel', category: 'crud', clientBroadcast: true },
  { id: 'platform_ops.channel.updated', label: 'Platform Channel Updated', entity: 'channel', category: 'crud', clientBroadcast: true },
  { id: 'platform_ops.channel.deleted', label: 'Platform Channel Deleted', entity: 'channel', category: 'crud', clientBroadcast: true },
  { id: 'platform_ops.orders.ingested', label: 'Platform Orders Ingested', entity: 'order_mirror', category: 'lifecycle', clientBroadcast: true },
  { id: 'platform_ops.settlement.imported', label: 'Platform Settlement Imported', entity: 'settlement', category: 'lifecycle', clientBroadcast: true },
  { id: 'platform_ops.reconciliation.raised', label: 'Reconciliation Item Raised', entity: 'reconciliation_item', category: 'lifecycle', clientBroadcast: true },
  { id: 'platform_ops.reconciliation.resolved', label: 'Reconciliation Item Resolved', entity: 'reconciliation_item', category: 'lifecycle', clientBroadcast: true },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'platform_ops',
  events,
})

export type PlatformOpsEventId = typeof events[number]['id']

export default eventsConfig
