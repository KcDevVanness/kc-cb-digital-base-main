import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { normalizeDictionaryValue } from '@open-mercato/core/modules/dictionaries/lib/utils'
import { PRODUCT_BRAND_DICTIONARY_KEY, PRODUCT_CATEGORY_DICTIONARY_KEY } from './lib/dictionaryValues'

/**
 * The brand list — the brand a supplier item is sold under.
 *
 * A brand is a proper noun, so the label is the name itself and carries one language. `PK` is PetKit:
 * goods bought from PetKit are sold under that brand, and the same item sourced from a second factory
 * keeps it. SKUs are typed by hand since the code-issuance retirement, so this list is now a plain
 * vocabulary, not a code-prefix table.
 */
export const PRODUCT_BRAND_SEEDS = [
  { value: 'SP', label: 'Super pawers', position: 10 },
  { value: 'DK', label: 'DoKi', position: 20 },
  { value: 'PK', label: 'PetKit', position: 30 },
] as const

/**
 * The category letters the business already uses on its sheets; `product_category` also serves as the
 * 订单描述 code on the company order and the purchase order, so the list stays a small controlled one.
 */
export const PRODUCT_CATEGORY_SEEDS = [
  { value: 'CL', label: '猫砂', position: 10 },
  { value: 'TP', label: '尿片', position: 20 },
  { value: 'LB', label: '猫砂盆', position: 30 },
  { value: 'FD', label: '喂食器', position: 40 },
  { value: 'WD', label: '饮水机', position: 50 },
  { value: 'AC', label: '配件', position: 60 },
  { value: 'CLN', label: '清洁用品', position: 70 },
] as const

/**
 * Dictionary seeding only: the code-issuance machinery (rules, ledger, parse, the value guard) is
 * retired (`.ai/specs/2026-10-10-catalog-single-store.md`), and these two lists are the part of it
 * other modules still read — `product_brand` on supplier/product forms, `product_category` as the
 * 订单描述 code on the company order and the purchase order.
 *
 * Insert-only and idempotent: re-running `yarn mercato seed:defaults --module product_codes` never
 * creates a second dictionary for the same organization and never rewrites an entry an operator edited.
 */
export const setup: ModuleSetupConfig = {
  async seedDefaults(ctx) {
    const em = ctx.em
    const now = new Date()
    await seedDictionary(
      em,
      ctx.tenantId,
      ctx.organizationId,
      now,
      PRODUCT_BRAND_DICTIONARY_KEY,
      'Product brands',
      'Brand abbreviations used on supplier items and product records',
      PRODUCT_BRAND_SEEDS,
    )
    await seedDictionary(
      em,
      ctx.tenantId,
      ctx.organizationId,
      now,
      PRODUCT_CATEGORY_DICTIONARY_KEY,
      'Product categories',
      'Category letters; also the 订单描述 code stored on orders',
      PRODUCT_CATEGORY_SEEDS,
    )
  },
}

async function seedDictionary(
  em: EntityManager,
  tenantId: string,
  organizationId: string,
  now: Date,
  key: string,
  name: string,
  description: string,
  seeds: readonly { value: string; label: string; position: number }[],
): Promise<void> {
  let dictionary = await em.findOne(Dictionary, { tenantId, organizationId, key })
  if (!dictionary) {
    dictionary = em.create(Dictionary, {
      key,
      name,
      description,
      tenantId,
      organizationId,
      isSystem: true,
      isActive: true,
      managerVisibility: 'default',
      createdAt: now,
      updatedAt: now,
    })
    em.persist(dictionary)
  }

  const existing = await em.find(DictionaryEntry, { dictionary, tenantId, organizationId })
  const known = new Set(existing.flatMap((entry) => [entry.value, entry.normalizedValue]))
  for (const seed of seeds) {
    const normalizedValue = normalizeDictionaryValue(seed.value)
    if (known.has(seed.value) || known.has(normalizedValue)) continue
    em.persist(
      em.create(DictionaryEntry, {
        dictionary,
        tenantId,
        organizationId,
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
}

export default setup
