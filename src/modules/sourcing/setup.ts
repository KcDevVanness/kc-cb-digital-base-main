import type { InitSetupContext, ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { normalizeDictionaryValue } from '@open-mercato/core/modules/dictionaries/lib/utils'

/**
 * Section banners the supplier workbooks group their lines by (分类). `value` is the banner as the
 * workbooks print it — the operator edits a line into this spelling instead of inventing a code —
 * and `label` is the Chinese name alone: the picker renders the stored code beside it
 * (`FEEDING — 喂食`), so the label itself stays one language.
 */
export const QUOTE_SECTION_DICTIONARY_KEY = 'quote_section'

export const QUOTE_SECTION_SEEDS = [
  { value: 'FEEDING', label: '喂食', position: 10 },
  { value: 'CLEANING', label: '清洁', position: 20 },
  { value: 'GROOMING', label: '美容', position: 30 },
  { value: 'FUN', label: '玩具', position: 40 },
  { value: 'SPORT', label: '运动', position: 50 },
  { value: 'ACCESSORY', label: '配件', position: 60 },
] as const

/**
 * The section dictionary, seeded insert-only and idempotently like the unit one: an entry the
 * operator renamed, reordered or added is left alone, and a section the dictionary does not carry
 * can still be typed on a line — the workbook stays the source of what a quotation says.
 */
async function seedQuoteSections(ctx: InitSetupContext) {
  const em = ctx.em
  const now = new Date()
  let dictionary = await em.findOne(Dictionary, {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    key: QUOTE_SECTION_DICTIONARY_KEY,
  })
  if (!dictionary) {
    dictionary = em.create(Dictionary, {
      key: QUOTE_SECTION_DICTIONARY_KEY,
      name: 'Quotation sections',
      description: 'Section banners offered on quotation lines',
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
  for (const seed of QUOTE_SECTION_SEEDS) {
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
}

/**
 * ACL defaults for newly created tenants. `employee` is deliberately left ungranted:
 * whether an operator may import supplier prices is an operational decision, not a default.
 */
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['sourcing.*', 'products.items.manage', 'products.prices.manage'],
    admin: ['sourcing.*', 'products.items.manage', 'products.prices.manage'],
  },
  /**
   * The quotation-section dictionary is seeded insert-only and idempotently: re-running
   * `yarn mercato seed:defaults --module sourcing` never creates a second dictionary for the same
   * organization and never rewrites an entry an operator has edited. A section the dictionary does
   * not carry can still be typed on a line.
   *
   * The supplier product library's unit dictionary (`supplier_product_unit`) is seeded by
   * `purchasing/setup.ts`, the module that owns the library since 2026-09-23; the product form and
   * the trade-document lines read it through `products/lib/unitOptions.ts`.
   */
  async seedDefaults(ctx) {
    await seedQuoteSections(ctx)
  },
}

export default setup
