import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

/**
 * The one notification this module raises: a failed pull.
 *
 * The pull is the module's whole job, and a silent failure means the cockpit keeps showing yesterday
 * and the day before as if they were today — so this type is not opt-out
 * (`nonOptOut: true`) and it links straight to the health page, where the cursor, the last run and
 * the failure are visible together.
 */
const ALERT_TYPES: NotificationTypeDefinition[] = [
  {
    type: 'ru_sync.alert.stockout',
    module: 'ru_sync',
    titleKey: 'ru_sync.notifications.stockout.title',
    bodyKey: 'ru_sync.notifications.stockout.body',
    icon: 'triangle-alert',
    severity: 'error',
    nonOptOut: true,
    channels: ['in_app'],
    actions: [
      { id: 'open-plan', labelKey: 'ru_sync.notifications.alert.action', variant: 'outline', icon: 'external-link' },
    ],
    linkHref: '/backend/finance/payables',
    expiresAfterHours: 72,
  },
  {
    type: 'ru_sync.alert.overstock',
    module: 'ru_sync',
    titleKey: 'ru_sync.notifications.overstock.title',
    bodyKey: 'ru_sync.notifications.overstock.body',
    icon: 'package',
    severity: 'warning',
    channels: ['in_app'],
    actions: [
      { id: 'open-cockpit', labelKey: 'ru_sync.notifications.alert.action', variant: 'outline', icon: 'external-link' },
    ],
    linkHref: '/backend/boss-cockpit',
    expiresAfterHours: 168,
  },
  {
    type: 'ru_sync.alert.drr_threshold',
    module: 'ru_sync',
    titleKey: 'ru_sync.notifications.drr.title',
    bodyKey: 'ru_sync.notifications.drr.body',
    icon: 'trending-up',
    severity: 'warning',
    nonOptOut: true,
    channels: ['in_app'],
    actions: [
      { id: 'open-cockpit', labelKey: 'ru_sync.notifications.alert.action', variant: 'outline', icon: 'external-link' },
    ],
    linkHref: '/backend/boss-cockpit',
    expiresAfterHours: 168,
  },
  {
    type: 'ru_sync.alert.unrecognized_in_transit',
    module: 'ru_sync',
    titleKey: 'ru_sync.notifications.unrecognized.title',
    bodyKey: 'ru_sync.notifications.unrecognized.body',
    icon: 'help-circle',
    severity: 'info',
    channels: ['in_app'],
    actions: [
      { id: 'open-map', labelKey: 'ru_sync.notifications.alert.action', variant: 'outline', icon: 'external-link' },
    ],
    linkHref: '/backend/ru-sync/sku-map',
    expiresAfterHours: 168,
  },
]

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'ru_sync.pull_failed',
    module: 'ru_sync',
    titleKey: 'ru_sync.notifications.pullFailed.title',
    bodyKey: 'ru_sync.notifications.pullFailed.body',
    icon: 'refresh-ccw',
    severity: 'error',
    nonOptOut: true,
    channels: ['in_app'],
    actions: [
      {
        id: 'open-health',
        labelKey: 'ru_sync.notifications.pullFailed.action',
        variant: 'outline',
        icon: 'external-link',
        href: '/backend/ru-sync/health',
      },
    ],
    linkHref: '/backend/ru-sync/health',
    expiresAfterHours: 168,
  },
  ...ALERT_TYPES,
]

export default notificationTypes
