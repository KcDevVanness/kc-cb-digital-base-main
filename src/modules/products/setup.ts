import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { normalizeDictionaryValue } from '@open-mercato/core/modules/dictionaries/lib/utils'
import {
  UNIT_DICTIONARY_KEY,
  UNIT_VOCABULARY,
  ensureCatalogUnitEntries,
} from './lib/unitVocabulary'

/**
 * ACL defaults for newly created tenants.
 *
 * `superadmin`/`admin` receive the module's features so the first operator can work
 * without a bootstrap deadlock, because which product capabilities a role needs is an
 * operational decision, not a default this module may make for the app.
 *
 * The five product-line seeds are gone with the app-owned taxonomy: the product families were rows
 * of a table this module no longer owns, and a category is now a catalog category created by hand
 * when the business wants one.
 */
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['products.*'],
    admin: ['products.*'],
  },
  /**
   * Seeds the unit vocabulary of a new organization — the list this module's form, the purchase
   * lines and the trade documents all read (`lib/unitOptions.ts`), plus the entries the write path
   * needs in catalog's own dictionary (`lib/unitVocabulary.ts` explains the split).
   *
   * Insert-only and idempotent: re-running `yarn mercato seed:defaults --module products` never
   * duplicates a dictionary and never rewrites an entry an operator edited (label, value, position,
   * colour stay theirs). A unit added by hand is left alone too — only the seeded codes are inserted
   * when missing. The vocabulary moved here from `purchasing` on 2026-10-10: the unit is a product
   * field now (`catalog.default_unit`), so the module that writes it owns the list.
   */
  async seedDefaults(ctx) {
    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    const now = new Date()
    await seedUnitDictionary(ctx.em, scope, now)
    await ensureCatalogUnitEntries(ctx.em, scope, now)
  },
}

/**
 * The app's display vocabulary, seeded insert-only: a second run never duplicates it and never
 * rewrites an entry an operator edited.
 */
async function seedUnitDictionary(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  now: Date,
): Promise<void> {
  let dictionary = await em.findOne(Dictionary, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    key: UNIT_DICTIONARY_KEY,
  })
  if (!dictionary) {
    dictionary = em.create(Dictionary, {
      key: UNIT_DICTIONARY_KEY,
      name: 'Supplier product units',
      description: 'Units of measure offered on supplier product library rows and product forms',
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
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
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  const known = new Set(existing.flatMap((entry) => [entry.value, entry.normalizedValue]))
  for (const unit of UNIT_VOCABULARY) {
    const normalizedValue = normalizeDictionaryValue(unit.code)
    if (known.has(unit.code) || known.has(normalizedValue)) continue
    em.persist(
      em.create(DictionaryEntry, {
        dictionary,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        value: unit.code,
        normalizedValue,
        label: unit.label,
        color: null,
        icon: null,
        position: unit.position,
        isDefault: unit.code === 'PCS',
        createdAt: now,
        updatedAt: now,
      }),
    )
  }
}

export default setup
