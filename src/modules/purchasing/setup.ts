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

export default setup
