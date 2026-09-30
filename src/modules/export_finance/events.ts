import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Events emitted by the export-finance module.
 *
 * The `entity` string is not decoration: the platform composes a CRUD event id as
 * `<module>.<entity>.<action>`, so it is what makes the declared ids below the ones the commands
 * actually emit.
 *
 * The two anchor events exist only in their `updated` form: the save commands upsert, and a
 * subscriber's interest is "this order's collection / this container's refund changed", not
 * whether the row was inserted or rewritten. They fire only after the write committed.
 */
const events = [
  { id: 'export_finance.collections.updated', label: 'Collection Record Updated', entity: 'collections', category: 'crud', clientBroadcast: true },
  { id: 'export_finance.refunds.updated', label: 'Tax Refund Record Updated', entity: 'refunds', category: 'crud', clientBroadcast: true },
  { id: 'export_finance.collection-documents.created', label: 'Collection Document Created', entity: 'collection-documents', category: 'crud' },
  { id: 'export_finance.collection-documents.updated', label: 'Collection Document Updated', entity: 'collection-documents', category: 'crud' },
  { id: 'export_finance.collection-documents.deleted', label: 'Collection Document Deleted', entity: 'collection-documents', category: 'crud' },
  { id: 'export_finance.refund-documents.created', label: 'Refund Document Created', entity: 'refund-documents', category: 'crud' },
  { id: 'export_finance.refund-documents.updated', label: 'Refund Document Updated', entity: 'refund-documents', category: 'crud' },
  { id: 'export_finance.refund-documents.deleted', label: 'Refund Document Deleted', entity: 'refund-documents', category: 'crud' },
  // 逾期提醒 (Phase 4·B): one event per rule, emitted by the `export-finance overdue-reminders`
  // command right before the notification of the same condition is raised.
  { id: 'export_finance.reminder.collection_overdue', label: 'Collection Overdue Reminder', entity: 'reminder', category: 'custom' },
  { id: 'export_finance.reminder.refund_overdue', label: 'Tax Refund Overdue Reminder', entity: 'reminder', category: 'custom' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'export_finance',
  events,
})

export type ExportFinanceEventId = typeof events[number]['id']

export default eventsConfig
