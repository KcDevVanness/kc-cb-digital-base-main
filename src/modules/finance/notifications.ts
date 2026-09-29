import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

/**
 * 到期提醒 notification types (FLOW-G2): 逾期未付款 / 逾期未发运 / 库存低于阈值.
 *
 * The reminder evaluation is a command (`yarn mercato finance due-reminders`) rather than a hidden
 * timer — this deployment has no scheduler module enabled, and a reminder nobody can explain is
 * worse than no reminder. Re-running the command refreshes one notification per condition because
 * each carries the condition as its `groupKey`.
 */
export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'finance.reminder.payment_overdue',
    module: 'finance',
    titleKey: 'finance.notifications.paymentOverdue.title',
    bodyKey: 'finance.notifications.paymentOverdue.body',
    icon: 'banknote',
    severity: 'warning',
    channels: ['in_app'],
    actions: [
      {
        id: 'open-payables',
        labelKey: 'finance.notifications.action',
        variant: 'outline',
        icon: 'external-link',
        href: '/backend/finance/payables',
      },
    ],
    linkHref: '/backend/finance/payables',
    expiresAfterHours: 168,
  },
  {
    type: 'finance.reminder.shipment_overdue',
    module: 'finance',
    titleKey: 'finance.notifications.shipmentOverdue.title',
    bodyKey: 'finance.notifications.shipmentOverdue.body',
    icon: 'truck',
    severity: 'warning',
    channels: ['in_app'],
    actions: [
      {
        id: 'open-orders',
        labelKey: 'finance.notifications.action',
        variant: 'outline',
        icon: 'external-link',
        href: '/backend/purchasing/orders',
      },
    ],
    linkHref: '/backend/purchasing/orders',
    expiresAfterHours: 168,
  },
  {
    type: 'finance.reminder.stock_low',
    module: 'finance',
    titleKey: 'finance.notifications.stockLow.title',
    bodyKey: 'finance.notifications.stockLow.body',
    icon: 'package',
    severity: 'warning',
    channels: ['in_app'],
    actions: [
      {
        id: 'open-inventory',
        labelKey: 'finance.notifications.action',
        variant: 'outline',
        icon: 'external-link',
        href: '/backend/finance/inventory-value',
      },
    ],
    linkHref: '/backend/finance/inventory-value',
    expiresAfterHours: 168,
  },
]

export default notificationTypes
