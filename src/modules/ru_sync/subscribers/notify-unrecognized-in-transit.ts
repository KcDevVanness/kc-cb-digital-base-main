import { createAlertNotification } from './alertNotification'

export const metadata = {
  event: 'ru_sync.alert.unrecognized_in_transit',
  persistent: true,
  id: 'ru_sync:unrecognized_in_transit-notification',
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
  await createAlertNotification('unrecognized_in_transit', payload, ctx, '/backend/ru-sync/sku-map')
}
