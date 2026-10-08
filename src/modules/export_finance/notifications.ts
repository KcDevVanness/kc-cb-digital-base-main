import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

/**
 * 逾期提醒 notification types — the money that is late, told to the people who watch it.
 *
 * This mirrors the shape the `finance` module already uses for its due reminders (PRD Q6: three
 * rules, three types, run by a command rather than a timer): one type per rule, `in_app` as the
 * channel, and the recipients resolved by **feature** through `createForFeature` — holders of
 * `export_finance.orders.view` / `export_finance.cabinets.view`, i.e. the finance team the worklist
 * belongs to. Whether a person wants them, and on which channel, is their own notification
 * preference; nothing here re-invents that.
 *
 * Both types point at the 逾期清单, which is where the reminder's subject can be acted on.
 */
export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'export_finance.reminder.collection_overdue',
    module: 'export_finance',
    titleKey: 'export_finance.notifications.collectionOverdue.title',
    bodyKey: 'export_finance.notifications.collectionOverdue.body',
    icon: 'banknote',
    severity: 'warning',
    channels: ['in_app'],
    actions: [
      {
        id: 'open-overdue-worklist',
        labelKey: 'export_finance.notifications.action',
        variant: 'outline',
        icon: 'external-link',
        href: '/backend/export-finance/overdue',
      },
    ],
    linkHref: '/backend/export-finance/overdue',
    expiresAfterHours: 168,
  },
  {
    type: 'export_finance.reminder.refund_overdue',
    module: 'export_finance',
    titleKey: 'export_finance.notifications.refundOverdue.title',
    bodyKey: 'export_finance.notifications.refundOverdue.body',
    icon: 'alert-triangle',
    severity: 'warning',
    channels: ['in_app'],
    actions: [
      {
        id: 'open-overdue-worklist',
        labelKey: 'export_finance.notifications.action',
        variant: 'outline',
        icon: 'external-link',
        href: '/backend/export-finance/overdue',
      },
    ],
    linkHref: '/backend/export-finance/overdue',
    expiresAfterHours: 168,
  },
]

export default notificationTypes
