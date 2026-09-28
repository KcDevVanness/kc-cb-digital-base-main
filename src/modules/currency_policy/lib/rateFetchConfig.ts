import type { EntityManager } from '@mikro-orm/postgresql'
import { CurrencyFetchConfig } from '@open-mercato/core/modules/currencies/data/entities'
import { OPEN_ER_API_SOURCE } from './providers/openErApi'

/**
 * Gives the app's rate provider a fetch-config row of its own.
 *
 * The installed `POST /api/currencies/fetch-rates` route records a run's outcome (`last_sync_at`,
 * `last_sync_status`, `last_sync_count`) **only for providers that already have a config row**, and a
 * fresh install seeds rows for the two built-in Polish providers alone. Without this seed the app's
 * provider would fetch perfectly and still be invisible on the 汇率抓取配置 page — the page an operator
 * opens to answer "is the rate feed alive?".
 *
 * Insert-only and idempotent, like every other seed in this app: an existing row is left exactly as the
 * operator configured it, because `is_enabled` and `sync_time` are theirs to set. A new row starts
 * enabled with the same 09:00 daily slot the other two carry, since this provider is the one this
 * deployment actually wants rates from.
 *
 * Note on the trigger: the installed `currencies` module ships no worker or scheduler, so a row's
 * `is_enabled`/`sync_time` describe intent for an external trigger. The fetch itself runs from the
 * 汇率抓取配置 page's button, `POST /api/currencies/fetch-rates`, or
 * `yarn mercato currencies fetch-rates --tenant <id> --org <id>`.
 */
export async function seedRateFetchConfig(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<void> {
  const existing = await em.findOne(CurrencyFetchConfig, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    provider: OPEN_ER_API_SOURCE,
  })
  if (existing) return

  const now = new Date()
  em.persist(
    em.create(CurrencyFetchConfig, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      provider: OPEN_ER_API_SOURCE,
      isEnabled: true,
      syncTime: '09:00',
      createdAt: now,
      updatedAt: now,
    }),
  )
  await em.flush()
}
