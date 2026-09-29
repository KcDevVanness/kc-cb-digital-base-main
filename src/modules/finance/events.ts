import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Events emitted by the finance module.
 *
 * The `entity` string is not decoration: the platform composes a CRUD event id as
 * `<module>.<entity>.<action>`, so it is what makes the declared ids below the ones the commands
 * actually emit. Both tables are ordinary editable records, so all three past-tense actions
 * exist and fire only after the write committed.
 */
const events = [
  { id: 'finance.shipment_cost.created', label: 'Shipment Cost Created', entity: 'shipment_cost', category: 'crud' },
  { id: 'finance.shipment_cost.updated', label: 'Shipment Cost Updated', entity: 'shipment_cost', category: 'crud' },
  { id: 'finance.shipment_cost.deleted', label: 'Shipment Cost Deleted', entity: 'shipment_cost', category: 'crud' },
  { id: 'finance.expense.created', label: 'Period Expense Created', entity: 'expense', category: 'crud' },
  { id: 'finance.expense.updated', label: 'Period Expense Updated', entity: 'expense', category: 'crud' },
  { id: 'finance.expense.deleted', label: 'Period Expense Deleted', entity: 'expense', category: 'crud' },
  // 到期提醒 (FLOW-G2): one event per rule, emitted by the `finance due-reminders` command.
  { id: 'finance.reminder.payment_overdue', label: 'Payment Overdue Reminder', entity: 'reminder', category: 'custom' },
  { id: 'finance.reminder.shipment_overdue', label: 'Shipment Overdue Reminder', entity: 'reminder', category: 'custom' },
  { id: 'finance.reminder.stock_low', label: 'Stock Below Threshold Reminder', entity: 'reminder', category: 'custom' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'finance',
  events,
})

export type FinanceEventId = typeof events[number]['id']

export default eventsConfig
