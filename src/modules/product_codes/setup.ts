import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { normalizeDictionaryValue } from '@open-mercato/core/modules/dictionaries/lib/utils'
import { ProductCodeRule } from './data/entities'
import { PRODUCT_BRAND_DICTIONARY_KEY, PRODUCT_CATEGORY_DICTIONARY_KEY } from './lib/dictionaryValues'

/**
 * The brand code list — the prefix of every generated code.
 *
 * A brand is a proper noun, so the label is the name itself and carries one language. `PK` is PetKit:
 * goods bought from PetKit are sold under that brand, which is why the prefix names the brand and not
 * the supplier — the same item sourced from a second factory keeps its code.
 */
export const PRODUCT_BRAND_SEEDS = [
  { value: 'SP', label: 'Super pawers', position: 10 },
  { value: 'DK', label: 'DoKi', position: 20 },
  { value: 'PK', label: 'PetKit', position: 30 },
] as const

/**
 * The category letters, taken from the codes the business already uses on its product sheets
 * (`SP-CL001` 猫砂, `SP-TP002` 尿片, `SP-LB006` 猫砂盆, `SP-LS011` 猫砂铲, `SP-CB012` 餐具).
 *
 * The letters are the stable part and are stored on the code; the label is what an operator reads.
 * A category the list does not carry can be added on the 字典库 page — this is a starting set, not a
 * closed one.
 */
export const PRODUCT_CATEGORY_SEEDS = [
  { value: 'CL', label: '猫砂', position: 10 },
  { value: 'TP', label: '尿片', position: 20 },
  { value: 'LB', label: '猫砂盆', position: 30 },
  { value: 'LS', label: '猫砂铲', position: 40 },
  { value: 'CB', label: '餐具', position: 50 },
] as const

/** The name of the seeded rule; also its uniqueness key per organization. */
export const DEFAULT_SKU_RULE_NAME = 'SKU 型号'

/**
 * ACL defaults for newly created tenants.
 *
 * `superadmin`/`admin` receive the module so the first operator can work without a bootstrap
 * deadlock; `employee` is deliberately left ungranted, exactly as `purchasing` does it — which
 * purchasing capabilities a role needs is an operational decision, not a default this module makes.
 * Generation is its own feature so a buyer can issue a code without being able to edit rules.
 */
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['product_codes.*'],
    admin: ['product_codes.*'],
  },
  /**
   * Insert-only and idempotent: re-running `yarn mercato seed:defaults --module product_codes` never
   * creates a second dictionary for the same organization and never rewrites an entry or a rule an
   * operator has edited. Seeding the rule matters more than it looks — without it the form's 生成
   * button has nothing to resolve, so a fresh tenant would ship with the feature dead.
   */
  async seedDefaults(ctx) {
    const em = ctx.em
    const now = new Date()
    await seedDictionary(em, ctx.tenantId, ctx.organizationId, now, PRODUCT_BRAND_DICTIONARY_KEY, 'Product brands', 'Brand abbreviations used as code prefixes', PRODUCT_BRAND_SEEDS)
    await seedDictionary(em, ctx.tenantId, ctx.organizationId, now, PRODUCT_CATEGORY_DICTIONARY_KEY, 'Product categories', 'Category letters used in product codes', PRODUCT_CATEGORY_SEEDS)
    await seedDefaultRule(em, ctx.tenantId, ctx.organizationId)
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

/**
 * The one rule a new organization starts with: brand + category + a three-digit serial, joined by a
 * dash — the `PK-CL001` shape the business already writes by hand. The serial scope is
 * `brand_category` because the workbook's own counters run per product family, and `enforce` stays
 * `warn`: an operator typing a legacy-style code must not be blocked by a rule that arrived after it.
 */
async function seedDefaultRule(em: EntityManager, tenantId: string, organizationId: string): Promise<void> {
  const existing = await em.findOne(ProductCodeRule, {
    tenantId,
    organizationId,
    name: DEFAULT_SKU_RULE_NAME,
    deletedAt: null,
  })
  if (existing) return
  em.persist(
    em.create(ProductCodeRule, {
      tenantId,
      organizationId,
      name: DEFAULT_SKU_RULE_NAME,
      mode: 'generate',
      segments: [
        { kind: 'dictionary', key: 'brand', dictionaryKey: PRODUCT_BRAND_DICTIONARY_KEY, length: 2, upper: true, join: false },
        { kind: 'dictionary', key: 'category', dictionaryKey: PRODUCT_CATEGORY_DICTIONARY_KEY, length: 2, upper: true, join: false },
        // `join` reproduces the codes the business already writes: `SP-CL001`, never `SP-CL-001`.
        { kind: 'serial', key: 'serial', length: 3, join: true },
      ],
      separator: '-',
      serialLength: 3,
      serialScope: 'brand_category',
      enforce: 'warn',
      isActive: true,
    }),
  )
  await em.flush()
}

export default setup
