import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { normalizeDictionaryValue } from '@open-mercato/core/modules/dictionaries/lib/utils'

/**
 * Marketplaces a channel can sell on (平台). `value` is the lowercase code the channel stores — the
 * value already used for `amazon` / `ozon` — and `label` is what the operator reads.
 */
export const CHANNEL_PLATFORM_SEEDS = [
  { value: 'amazon', label: '亚马逊', position: 10 },
  { value: 'ozon', label: 'Ozon', position: 20 },
  { value: 'tiktok_shop', label: 'TikTok Shop', position: 30 },
  { value: 'temu', label: 'Temu', position: 40 },
  { value: 'shein', label: 'SHEIN', position: 50 },
  { value: 'shopify', label: 'Shopify', position: 60 },
  { value: 'ebay', label: 'eBay', position: 70 },
  { value: 'walmart', label: '沃尔玛', position: 80 },
] as const

export const CHANNEL_PLATFORM_DICTIONARY_KEY = 'channel_platform'

/**
 * ACL defaults for newly created tenants. `superadmin`/`admin` receive the module so the first
 * operator can work; orders and settlements still only enter through an explicit ingest or import.
 */
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['platform_ops.*'],
    admin: ['platform_ops.*'],
  },
  /**
   * Seeds the platform dictionary once per organization so a new channel picks its marketplace
   * instead of typing it. Insert-only and idempotent: re-running
   * `yarn mercato seed:defaults --module platform_ops` never duplicates the dictionary or an entry,
   * and a marketplace the operator added is left alone.
   */
  async seedDefaults(ctx) {
    const em = ctx.em
    const now = new Date()

    let dictionary = await em.findOne(Dictionary, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      key: CHANNEL_PLATFORM_DICTIONARY_KEY,
    })
    if (!dictionary) {
      dictionary = em.create(Dictionary, {
        key: CHANNEL_PLATFORM_DICTIONARY_KEY,
        name: 'Sales platforms',
        description: 'Marketplaces offered on platform channels',
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
    for (const seed of CHANNEL_PLATFORM_SEEDS) {
      const normalizedValue = normalizeDictionaryValue(seed.value)
      if (known.has(seed.value) || known.has(normalizedValue)) continue
      known.add(seed.value)
      known.add(normalizedValue)
      em.persist(
        em.create(DictionaryEntry, {
          dictionary,
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId,
          value: seed.value,
          normalizedValue,
          label: seed.label,
          color: null,
          icon: null,
          position: seed.position,
          isDefault: false,
          createdAt: now,
          updatedAt: now,
        }),
      )
    }
    await em.flush()
  },
}

export default setup
