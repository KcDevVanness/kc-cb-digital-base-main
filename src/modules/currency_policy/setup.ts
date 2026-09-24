import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { applyCurrencyPolicy } from './lib/apply'
import { seedRateFetchConfig } from './lib/rateFetchConfig'

const logger = createLogger('currency_policy').child({ component: 'setup' })

/**
 * Reconciles both currency stores to `lib/policy.ts` after the seeds that own them:
 * `enabledModules` in `src/modules.ts` lists this module last, so `customers`
 * (currency dictionary, every ISO code) and `currencies` (FX master) have already
 * written their defaults by the time this hook runs. `yarn mercato seed:defaults
 * --module currency_policy` re-runs just this step when a scope needs repair.
 */
export const setup: ModuleSetupConfig = {
  seedDefaults: async (ctx) => {
    const outcome = await applyCurrencyPolicy(ctx.em, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
    logger.info('Currency policy applied', {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      currenciesCreated: outcome.created,
      currenciesUpdated: outcome.updated,
      currenciesDeactivated: outcome.deactivated,
      dictionaryCreated: outcome.dictionaryCreated,
      entriesAdded: outcome.entriesAdded,
      entriesUpdated: outcome.entriesUpdated,
      entriesRemoved: outcome.entriesRemoved,
    })

    await seedRateFetchConfig(ctx.em, { tenantId: ctx.tenantId, organizationId: ctx.organizationId })
  },
}

export default setup
