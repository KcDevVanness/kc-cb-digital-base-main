import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { normalizeDictionaryValue } from '@open-mercato/core/modules/dictionaries/lib/utils'

/**
 * Payment terms a contract can carry (付款方式). `value` is what the contract prints — the picker
 * suggests these, and an operator may still type the wording a specific deal was signed with — so
 * the seeds are the phrasings this business already uses, not codes.
 *
 * One language per entry: a dictionary label cannot switch with the reader's locale, so a seed that
 * needs an English wording for a specific deal is typed on that deal, not carried beside the
 * Chinese one (see `docs/dev/i18n.md`).
 */
export const PAYMENT_TERM_SEEDS = [
  { value: '30% 定金 + 70% 尾款', label: '30% 定金 + 70% 尾款', position: 10 },
  { value: '30% 定金 + 70% 见提单副本付款', label: '30% 定金 + 70% 见提单副本付款', position: 20 },
  { value: '100% 预付', label: '100% 预付', position: 30 },
  { value: '即期信用证', label: '即期信用证', position: 40 },
  { value: '60 天账期', label: '60 天账期', position: 50 },
] as const

/** Modes of transport a contract ships by (运输方式). */
export const SHIPPING_METHOD_SEEDS = [
  { value: '海运', label: '海运', position: 10 },
  { value: '空运', label: '空运', position: 20 },
  { value: '铁路', label: '铁路', position: 30 },
  { value: '快递', label: '快递', position: 40 },
  { value: '陆运', label: '陆运', position: 50 },
] as const

export const PAYMENT_TERM_DICTIONARY_KEY = 'payment_terms'
export const SHIPPING_METHOD_DICTIONARY_KEY = 'shipping_method'

type DictionarySeedEntry = { value: string; label: string; position: number }
type DictionarySeed = {
  key: string
  name: string
  description: string
  entries: readonly DictionarySeedEntry[]
}

const DICTIONARY_SEEDS: readonly DictionarySeed[] = [
  {
    key: PAYMENT_TERM_DICTIONARY_KEY,
    name: 'Payment terms',
    description: 'Payment terms offered on purchase and sales contracts',
    entries: PAYMENT_TERM_SEEDS,
  },
  {
    key: SHIPPING_METHOD_DICTIONARY_KEY,
    name: 'Shipping methods',
    description: 'Modes of transport offered on contracts',
    entries: SHIPPING_METHOD_SEEDS,
  },
]

/**
 * ACL defaults for newly created tenants.
 *
 * `superadmin`/`admin` receive the features so the first operator can work without a bootstrap
 * deadlock; `employee` is deliberately left ungranted.
 */
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['trade_docs.*'],
    admin: ['trade_docs.*'],
  },
  /**
   * Seeds the contract header's dictionaries (payment terms, shipping methods) once per
   * organization. Insert-only and idempotent: re-running
   * `yarn mercato seed:defaults --module trade_docs` never duplicates a dictionary or an entry, and
   * an entry the operator edited or added is left exactly as it is.
   */
  async seedDefaults(ctx) {
    const em = ctx.em
    const now = new Date()

    for (const seed of DICTIONARY_SEEDS) {
      let dictionary = await em.findOne(Dictionary, {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        key: seed.key,
      })
      if (!dictionary) {
        dictionary = em.create(Dictionary, {
          key: seed.key,
          name: seed.name,
          description: seed.description,
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId,
          isSystem: true,
          isActive: true,
          managerVisibility: 'default',
          createdAt: now,
          updatedAt: now,
        })
        em.persist(dictionary)
      }

      const existing = await em.find(DictionaryEntry, {
        dictionary,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
      })
      const known = new Set(existing.flatMap((entry) => [entry.value, entry.normalizedValue]))
      for (const entry of seed.entries) {
        const normalizedValue = normalizeDictionaryValue(entry.value)
        if (known.has(entry.value) || known.has(normalizedValue)) continue
        known.add(entry.value)
        known.add(normalizedValue)
        em.persist(
          em.create(DictionaryEntry, {
            dictionary,
            tenantId: ctx.tenantId,
            organizationId: ctx.organizationId,
            value: entry.value,
            normalizedValue,
            label: entry.label,
            color: null,
            icon: null,
            position: entry.position,
            isDefault: false,
            createdAt: now,
            updatedAt: now,
          }),
        )
      }
      await em.flush()
    }
  },
}

export default setup
