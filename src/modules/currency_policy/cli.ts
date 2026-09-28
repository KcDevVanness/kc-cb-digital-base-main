import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import type { RateFetchingService } from '@open-mercato/core/modules/currencies/services/rateFetchingService'
import { applyCurrencyPolicy } from './lib/apply'
import { CURRENCY_REGION_LABELS, POLICY_CURRENCIES } from './lib/policy'

function parseArgs(args: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg.startsWith('--')) continue
    const [key, inlineValue] = arg.slice(2).split('=')
    if (inlineValue !== undefined) {
      parsed[key] = inlineValue
      continue
    }
    const next = args[index + 1]
    if (next && !next.startsWith('--')) {
      parsed[key] = next
      index += 1
      continue
    }
    parsed[key] = true
  }
  return parsed
}

const applyCommand: ModuleCli = {
  command: 'apply',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantFilter =
      typeof args.tenant === 'string' ? args.tenant : typeof args.tenantId === 'string' ? args.tenantId : ''
    const organizationFilter =
      typeof args.org === 'string' ? args.org : typeof args.organizationId === 'string' ? args.organizationId : ''

    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    const organizations = await em.find(Organization, { deletedAt: null }, { populate: ['tenant'] as const })
    const targets = organizations.filter((organization) => {
      if (tenantFilter && String(organization.tenant.id) !== tenantFilter) return false
      if (organizationFilter && String(organization.id) !== organizationFilter) return false
      return true
    })

    if (targets.length === 0) {
      console.error('No organization matched. Usage: yarn mercato currency_policy apply [--tenant <id>] [--org <id>]')
      return
    }

    console.log(`🪙 Applying the currency policy to ${targets.length} organization(s)`)
    for (const organization of targets) {
      const tenantId = String(organization.tenant.id)
      const organizationId = String(organization.id)
      const outcome = await applyCurrencyPolicy(em, { tenantId, organizationId })
      console.log(`  🏢 ${organization.name} (tenant=${tenantId} org=${organizationId})`)
      console.log(`     currencies created:  ${outcome.created.join(', ') || 'none'}`)
      console.log(`     currencies updated:  ${outcome.updated.join(', ') || 'none'}`)
      console.log(`     currencies disabled: ${outcome.deactivated.join(', ') || 'none'}`)
      console.log(`     currency dictionary: ${outcome.dictionaryCreated ? 'created' : 'kept'}`)
      console.log(`     dictionary entries:  added ${outcome.entriesAdded.join(', ') || 'none'}`)
      console.log(`                          updated ${outcome.entriesUpdated.join(', ') || 'none'}`)
      console.log(`                          removed ${outcome.entriesRemoved.join(', ') || 'none'}`)
    }
    console.log(`  ✅ policy holds ${POLICY_CURRENCIES.length} currencies across ${Object.values(CURRENCY_REGION_LABELS).join(' · ')}`)
  },
}

const fetchRatesCommand: ModuleCli = {
  command: 'fetch-rates',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantFilter =
      typeof args.tenant === 'string' ? args.tenant : typeof args.tenantId === 'string' ? args.tenantId : ''
    const organizationFilter =
      typeof args.org === 'string' ? args.org : typeof args.organizationId === 'string' ? args.organizationId : ''
    const providerArg = typeof args.provider === 'string' ? args.provider : ''
    const dateArg = typeof args.date === 'string' ? args.date : ''
    const date = dateArg ? new Date(dateArg) : new Date()
    if (Number.isNaN(date.getTime())) {
      console.error(`Not a date: ${dateArg}. Usage: yarn mercato currency_policy fetch-rates [--tenant <id>] [--org <id>] [--date YYYY-MM-DD] [--provider OPEN_ER_API]`)
      return
    }

    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    // The container's service is the one that carries the **registered** providers, including this
    // module's `OPEN_ER_API`. The installed `currencies fetch-rates` CLI builds its own service with the
    // two built-in Polish providers only, so it can never fetch a CNY pair in this deployment — this
    // command exists to be the cron-friendly trigger that does.
    const fetchService = container.resolve<RateFetchingService>('rateFetchingService')

    const organizations = await em.find(Organization, { deletedAt: null }, { populate: ['tenant'] as const })
    const targets = organizations.filter((organization) => {
      if (tenantFilter && String(organization.tenant.id) !== tenantFilter) return false
      if (organizationFilter && String(organization.id) !== organizationFilter) return false
      return true
    })
    if (targets.length === 0) {
      console.error(
        'No organization matched. Usage: yarn mercato currency_policy fetch-rates [--tenant <id>] [--org <id>] [--date YYYY-MM-DD] [--provider OPEN_ER_API]',
      )
      return
    }

    console.log(`💱 Fetching exchange rates for ${targets.length} organization(s) on ${date.toISOString().slice(0, 10)}`)
    let failed = 0
    for (const organization of targets) {
      const tenantId = String(organization.tenant.id)
      const organizationId = String(organization.id)
      const result = await fetchService.fetchRatesForDate(
        date,
        { tenantId, organizationId },
        providerArg ? { providers: [providerArg] } : {},
      )
      console.log(`  🏢 ${organization.name} (tenant=${tenantId} org=${organizationId})`)
      console.log(`     rates stored: ${result.totalFetched}`)
      for (const [provider, outcome] of Object.entries(result.byProvider)) {
        console.log(`     ${provider}: ${outcome.count}${outcome.errors?.length ? ` (errors: ${outcome.errors.join('; ')})` : ''}`)
      }
      for (const error of result.errors) console.log(`     ⚠️  ${error}`)
      if (result.errors.length > 0) failed += 1
    }
    console.log(failed === 0 ? '  ✅ fetch complete' : `  ⚠️  ${failed} organization(s) reported errors`)
  },
}

const commands: ModuleCli[] = [applyCommand, fetchRatesCommand]

export default commands
