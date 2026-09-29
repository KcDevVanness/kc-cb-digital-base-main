import { createReminderNotification, type ReminderPayload, type ResolverContext } from './reminderNotification'

export const metadata = {
  event: 'finance.reminder.shipment_overdue',
  persistent: true,
  id: 'finance:finance.reminder.shipment_overdue-notification',
}

/** One of the three due-date reminders (FLOW-G2). */
export default async function handle(payload: ReminderPayload, ctx: ResolverContext): Promise<void> {
  await createReminderNotification('finance.reminder.shipment_overdue', payload, ctx, '/backend/purchasing/orders')
}
