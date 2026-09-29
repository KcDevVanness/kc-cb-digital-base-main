import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { buildFeatureNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { notificationTypes } from '../notifications'

const logger = createLogger('finance').child({ component: 'reminder-notification' })

/**
 * The shared body of the three reminder subscribers: the payload's `groupKey` becomes the
 * notification's, so a condition that stays true refreshes one notification instead of stacking a
 * new copy every time the command runs.
 */
export type ReminderPayload = {
  tenantId: string
  organizationId?: string | null
  groupKey?: string | null
  title?: string | null
  body?: string | null
  /** The subject of the reminder — an order id when there is one, a SKU otherwise. */
  sourceEntityId?: string | null
}

export type ResolverContext = { resolve: <T = unknown>(name: string) => T }

export async function createReminderNotification(
  type: string,
  payload: ReminderPayload,
  ctx: ResolverContext,
  linkHref: string,
): Promise<void> {
  try {
    const notificationService = resolveNotificationService(ctx)
    const typeDef = notificationTypes.find((candidate) => candidate.type === type)
    if (!typeDef) return
    const input = buildFeatureNotificationFromType(typeDef, {
      requiredFeature: 'finance.ledger.view',
      titleVariables: { title: payload.title ?? type },
      bodyVariables: { body: payload.body ?? '' },
      sourceEntityType: 'finance:reminder',
      // `source_entity_id` is a uuid column and a stock reminder's subject is a SKU, so the
      // notification's identity is the `groupKey` alone.
      groupKey: payload.groupKey ?? type,
      linkHref,
    })
    await notificationService.createForFeature(input, {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  } catch (error) {
    logger.error('Failed to raise a due reminder', { type, err: error })
  }
}
