import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { normalizeDictionaryValue } from '@open-mercato/core/modules/dictionaries/lib/utils'

/** Dictionary the order form reads to fill the 订单描述 picker. */
export const PURCHASE_ORDER_PRODUCT_CATEGORY_DICTIONARY_KEY = 'order_product_category'

/**
 * Product categories the purchase flow always has. `value` is the stable code stored on the order,
 * `label` is what the operator sees; the dictionary entry's normalized value derives from the label
 * so duplicate detection matches the installed dictionaries module.
 */
export const PURCHASE_ORDER_PRODUCT_CATEGORY_SEEDS = [
  { value: 'litter_box', label: '智能全自动猫厕所', position: 10 },
  { value: 'pet_supplies', label: '宠物用品', position: 20 },
  { value: 'cat_litter', label: '猫砂', position: 30 },
] as const

/**
 * The units of measure the supplier product library offers in its 单位 dropdown.
 *
 * `value` is the code stored on the row — the code is what a customs declaration, a quotation and
 * the product master all print, so it is the stable part. `label` is what the operator reads, and
 * carries the Chinese name next to the code so a buyer who has never seen the supplier's workbook
 * still knows what will be printed.
 *
 * The product form and the trade-document lines read the same dictionary through
 * `products/lib/unitOptions.ts`; this module seeds it because it owns the library that needs it.
 */
export const SUPPLIER_PRODUCT_UNIT_DICTIONARY_KEY = 'supplier_product_unit'

export const SUPPLIER_PRODUCT_UNIT_SEEDS = [
  { value: 'PCS', label: '件 (PCS)', position: 10 },
  { value: 'SET', label: '套 (SET)', position: 20 },
  { value: 'PAIR', label: '对 (PAIR)', position: 30 },
  { value: 'BOX', label: '盒 (BOX)', position: 40 },
  { value: 'CTN', label: '箱 (CTN)', position: 50 },
  { value: 'BAG', label: '袋 (BAG)', position: 60 },
  { value: 'ROLL', label: '卷 (ROLL)', position: 70 },
  { value: 'KG', label: '千克 (KG)', position: 80 },
  { value: 'G', label: '克 (G)', position: 90 },
  { value: 'M', label: '米 (M)', position: 100 },
  { value: 'L', label: '升 (L)', position: 110 },
] as const

/**
 * ACL defaults for newly created tenants.
 *
 * The module ships no demo rows: the supplier master starts empty. `superadmin`/`admin` receive the
 * module's features so the first operator can work without a bootstrap deadlock; `employee` is
 * deliberately left ungranted, because which purchasing capabilities a role needs is an operational
 * decision, not a default this module may make for the app.
 */
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['purchasing.*'],
    admin: ['purchasing.*'],
  },
  /**
   * Seed is insert-only and idempotent: re-running `yarn mercato seed:defaults --module purchasing`
   * never creates a second dictionary for the same organization and never rewrites an entry an
   * operator has edited (label, value, position, color stay theirs). A category added by hand is
   * left alone too — only the seeded codes below are inserted when missing.
   */
  async seedDefaults(ctx) {
    const em = ctx.em
    const now = new Date()

    await seedUnitDictionary(em, ctx.tenantId, ctx.organizationId, now)

    let dictionary = await em.findOne(Dictionary, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      key: PURCHASE_ORDER_PRODUCT_CATEGORY_DICTIONARY_KEY,
    })
    if (!dictionary) {
      dictionary = em.create(Dictionary, {
        key: PURCHASE_ORDER_PRODUCT_CATEGORY_DICTIONARY_KEY,
        name: 'Order product categories',
        description: 'Product categories offered on purchase orders (订单描述)',
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
    for (const seed of PURCHASE_ORDER_PRODUCT_CATEGORY_SEEDS) {
      const normalizedValue = normalizeDictionaryValue(seed.label)
      if (known.has(seed.value) || known.has(normalizedValue)) continue
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

/**
 * The library's unit dictionary, seeded with the same insert-only rules as the category dictionary:
 * a second run never duplicates it and never rewrites an entry an operator edited. A unit added by
 * hand is left alone too — the API accepts any code, so a dictionary gap is never a write failure.
 */
async function seedUnitDictionary(
  em: EntityManager,
  tenantId: string,
  organizationId: string,
  now: Date,
): Promise<void> {
  let dictionary = await em.findOne(Dictionary, {
    tenantId,
    organizationId,
    key: SUPPLIER_PRODUCT_UNIT_DICTIONARY_KEY,
  })
  if (!dictionary) {
    dictionary = em.create(Dictionary, {
      key: SUPPLIER_PRODUCT_UNIT_DICTIONARY_KEY,
      name: 'Supplier product units',
      description: 'Units of measure offered on supplier product library rows (单位)',
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
  for (const seed of SUPPLIER_PRODUCT_UNIT_SEEDS) {
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
        isDefault: seed.value === 'PCS',
        createdAt: now,
        updatedAt: now,
      }),
    )
  }
}

export default setup
