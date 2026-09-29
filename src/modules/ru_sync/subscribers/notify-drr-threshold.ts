import { createAlertNotification } from './alertNotification'

export const metadata = {
  event: 'ru_sync.alert.drr_threshold',
  persistent: true,
  id: 'ru_sync:drr_threshold-notification',
}

type Payload = {
  tenantId: string
  organizationId?: string | null
  groupKey?: string | null
  title?: string | null
  body?: string | null
  sourceEntityId?: string | null
}

type ResolverContext = { resolve: <T = unknown>(name: string) => T }

/**
 * One of the four threshold alerts. The dedupe rule (a repeating condition refreshes one
 * notification instead of piling up new ones) lives in `createAlertNotification`.
 */
export default async function handle(payload: Payload, ctx: ResolverContext): Promise<void> {
  await createAlertNotification('drr_threshold', payload, ctx, '/backend/boss-cockpit')
}
