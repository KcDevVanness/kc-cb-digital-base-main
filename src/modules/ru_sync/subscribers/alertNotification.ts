import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { buildFeatureNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { notificationTypes } from '../notifications'
import type { RuAlertKind } from '../lib/alerts'

const logger = createLogger('ru_sync').child({ component: 'alert-notification' })

/**
 * 四预警 → 通知。
 *
 * One subscriber per alert event (the platform's convention: a subscriber declares the single event
 * it listens to). All four share this factory, so the dedupe rule is written once: the alert's
 * `groupKey` is the notification's `groupKey`, and the notification service refreshes an active
 * notification with the same `(recipient, type, groupKey)` instead of creating a second one. A
 * condition that holds for a week therefore stays **one** notification that keeps its numbers
 * current, rather than seven.
 */
type AlertPayload = {
  tenantId: string
  organizationId?: string | null
  groupKey?: string | null
  title?: string | null
  body?: string | null
  /** The subject of the alert (a SKU or a period) — carried in the title/body, never as a uuid. */
  sourceEntityId?: string | null
}

type ResolverContext = { resolve: <T = unknown>(name: string) => T }

const ALERT_FEATURE: Record<RuAlertKind, string> = {
  stockout: 'ru_sync.view',
  overstock: 'ru_sync.view',
  drr_threshold: 'ru_sync.view',
  unrecognized_in_transit: 'ru_sync.view',
}

export async function createAlertNotification(
  kind: RuAlertKind,
  payload: AlertPayload,
  ctx: ResolverContext,
  linkHref: string,
): Promise<void> {
  try {
    const notificationService = resolveNotificationService(ctx)
    const typeDef = notificationTypes.find((type) => type.type === `ru_sync.alert.${kind}`)
    if (!typeDef) return

    const input = buildFeatureNotificationFromType(typeDef, {
      requiredFeature: ALERT_FEATURE[kind],
      titleVariables: { title: payload.title ?? kind },
      bodyVariables: { body: payload.body ?? '' },
      sourceEntityType: 'ru_sync:alert',
      // No `sourceEntityId`: the column is a uuid, and an alert's subject is a SKU or a period.
      // Its identity — which is what the dedupe needs — is the `groupKey`.
      groupKey: payload.groupKey ?? kind,
      linkHref,
    })
    await notificationService.createForFeature(input, {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  } catch (error) {
    logger.error('Failed to raise an alert notification', { kind, err: error })
  }
}
