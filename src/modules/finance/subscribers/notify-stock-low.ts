import { createReminderNotification, type ReminderPayload, type ResolverContext } from './reminderNotification'

export const metadata = {
  event: 'finance.reminder.stock_low',
  persistent: true,
  id: 'finance:finance.reminder.stock_low-notification',
}

/** One of the three due-date reminders (FLOW-G2). */
export default async function handle(payload: ReminderPayload, ctx: ResolverContext): Promise<void> {
  await createReminderNotification('finance.reminder.stock_low', payload, ctx, '/backend/finance/inventory-value')
}
