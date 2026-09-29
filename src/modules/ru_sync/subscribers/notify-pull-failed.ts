import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { buildFeatureNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { notificationTypes } from '../notifications'

const logger = createLogger('ru_sync').child({ component: 'notify-pull-failed' })

export const metadata = {
  event: 'ru_sync.pull.failed',
  persistent: true,
  id: 'ru_sync:pull-failed-notification',
}

type PullFailedPayload = {
  tenantId: string
  organizationId?: string | null
  endpoint?: string | null
  message?: string | null
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

/**
 * A failed pull is the one thing this module must never swallow: the cockpit would keep showing the
 * last good snapshot as if it were today's. The notification is raised for the feature's holders
 * (`ru_sync.view`) and links to the health page, where the endpoint, the cursor and the error are
 * visible together.
 */
export default async function handle(payload: PullFailedPayload, ctx: ResolverContext) {
  try {
    const notificationService = resolveNotificationService(ctx)
    const typeDef = notificationTypes.find((type) => type.type === 'ru_sync.pull_failed')
    if (!typeDef) return

    const input = buildFeatureNotificationFromType(typeDef, {
      requiredFeature: 'ru_sync.view',
      bodyVariables: {
        endpoint: payload.endpoint ?? 'unknown',
        message: payload.message ?? 'Unknown error',
      },
      sourceEntityType: 'ru_sync:pull',
      // The endpoint is a name, not a uuid, and `source_entity_id` is a uuid column — the identity
      // this notification needs for dedupe is the endpoint-keyed `groupKey`.
      groupKey: `pull_failed:${payload.endpoint ?? 'unknown'}`,
      linkHref: '/backend/ru-sync/health',
    })

    await notificationService.createForFeature(input, {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  } catch (error) {
    logger.error('Failed to raise the RU pull-failure notification', { err: error })
  }
}
