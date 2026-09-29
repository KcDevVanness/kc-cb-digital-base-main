import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Events emitted by the ru_sync module.
 *
 * The pull is a data-plane job, not a CRUD surface, so these are lifecycle events: one per finished
 * endpoint pull and one per failed one. `ru_sync.pull_failed` is what the notification type of the
 * same id listens to.
 */
const events = [
  { id: 'ru_sync.pull.completed', label: 'RU Pull Completed', entity: 'pull', category: 'lifecycle' },
  { id: 'ru_sync.pull.failed', label: 'RU Pull Failed', entity: 'pull', category: 'lifecycle' },
  { id: 'ru_sync.sku_map.updated', label: 'RU SKU Map Updated', entity: 'sku_map', category: 'crud' },
  // 四预警: the threshold crossings the pull evaluates. One event per kind so a notification type
  // can be subscribed to exactly the alert it announces.
  { id: 'ru_sync.alert.stockout', label: 'RU Stockout Alert', entity: 'alert', category: 'custom' },
  { id: 'ru_sync.alert.overstock', label: 'RU Overstock Alert', entity: 'alert', category: 'custom' },
  { id: 'ru_sync.alert.drr_threshold', label: 'RU ДРР Threshold Alert', entity: 'alert', category: 'custom' },
  { id: 'ru_sync.alert.unrecognized_in_transit', label: 'RU Unrecognized In-Transit Alert', entity: 'alert', category: 'custom' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'ru_sync',
  events,
})

export type RuSyncEventId = typeof events[number]['id']

export default eventsConfig
