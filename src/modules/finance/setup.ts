import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { normalizeDictionaryValue } from '@open-mercato/core/modules/dictionaries/lib/utils'
import { FINANCE_EXPENSE_TYPE_DICTIONARY_KEY, SHIPMENT_COST_TYPE_DICTIONARY_KEY } from './lib/dictionaries'

/**
 * The cost types a container can carry. `value` is the code stored on the fee row, `label` what the
 * picker and the lists show — one language, the display name only: the picker renders the stored
 * code in front of it (`CODE — name`).
 */
export const SHIPMENT_COST_TYPE_SEEDS = [
  { value: 'ocean_freight', label: '海运', position: 10 },
  { value: 'air_freight', label: '空运', position: 20 },
  { value: 'rail_freight', label: '铁路', position: 30 },
  { value: 'inland_freight', label: '内陆运输', position: 40 },
  { value: 'customs_clearance', label: '报关', position: 50 },
  { value: 'insurance', label: '保险', position: 60 },
  { value: 'duty', label: '关税', position: 70 },
  { value: 'warehousing', label: '仓储', position: 80 },
  { value: 'other', label: '其他', position: 90 },
] as const

/** Period-expense kinds; unlike a container cost these are not tied to a shipment. */
export const FINANCE_EXPENSE_TYPE_SEEDS = [
  { value: 'advertising', label: '广告费', position: 10 },
  { value: 'platform_fee', label: '平台费', position: 20 },
  { value: 'logistics', label: '物流费', position: 30 },
  { value: 'warehousing', label: '仓储费', position: 40 },
  { value: 'bank_charge', label: '银行手续费', position: 50 },
  { value: 'office', label: '办公费', position: 60 },
  { value: 'payroll', label: '人工', position: 70 },
  { value: 'other', label: '其他', position: 80 },
] as const

type DictionarySeed = {
  key: string
  name: string
  description: string
  entries: readonly { value: string; label: string; position: number }[]
}

const DICTIONARY_SEEDS: readonly DictionarySeed[] = [
  {
    key: SHIPMENT_COST_TYPE_DICTIONARY_KEY,
    name: '柜费用类型',
    description: 'Shipment cost types recorded per container',
    entries: SHIPMENT_COST_TYPE_SEEDS,
  },
  {
    key: FINANCE_EXPENSE_TYPE_DICTIONARY_KEY,
    name: '期间费用类型',
    description: 'Period expense types recorded per reporting period',
    entries: FINANCE_EXPENSE_TYPE_SEEDS,
  },
]

/**
 * ACL defaults for newly created tenants.
 *
 * `superadmin`/`admin` receive the module so the first operator can work without a bootstrap
 * deadlock; `employee` is deliberately left ungranted — whether a warehouse or purchasing role may
 * read cost and margin figures is an operational decision this module must not make on the
 * tenant's behalf. `yarn mercato auth sync-role-acls` applies the defaults to existing
 * organizations.
 */
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['finance.*'],
    admin: ['finance.*'],
  },
  /**
   * Seeds the module's dictionaries once per organization. Insert-only and idempotent per
   * dictionary: re-running `yarn mercato seed:defaults --module finance` never duplicates a
   * dictionary or an entry, and an entry the operator has edited is left exactly as it is.
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
