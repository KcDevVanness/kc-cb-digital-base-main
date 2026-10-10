import type { EntityManager } from '@mikro-orm/postgresql'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { canonicalizeUnitCode } from '@open-mercato/core/modules/catalog/lib/unitCodes'
import { normalizeDictionaryValue } from '@open-mercato/core/modules/dictionaries/lib/utils'

/**
 * The app's unit-of-measure vocabulary — one list, two dictionaries.
 *
 * A product's unit is a **catalog** `default_unit` since the single-store cutover, and the installed
 * `catalog` module refuses a unit its own `unit` dictionary does not list
 * (`resolveCanonicalUnitCode`, `400 uom.unit_not_found`). The pickers therefore cannot offer a code
 * the write path would reject, and they cannot invent a spelling either: catalog resolves the code
 * through the dictionary and stores **the entry's own `value`**, so the entry's spelling is what
 * lands on the product and on every printed document.
 *
 * Hence the two rules this list encodes:
 * - every code here is (or is made, by `ensureCatalogUnitEntries`) a valid catalog unit;
 * - the code here is spelled the way the dictionary stores it, so what an operator picks is what the
 *   record keeps. Catalog already ships eight of them (`set`/`pair`/`box`/`roll`/`kg`/`g`/`m`/`l`,
 *   lowercase engineering spellings) — re-spelling those as `SET`/`KG`/… would mean either renaming
 *   a peer-seeded entry of a dictionary that already stores products (breaking their next update) or
 *   creating a second entry whose normalized key collides with the first (the resolution then picks
 *   whichever row the database returns first). Both are worse than accepting the spelling catalog
 *   owns; the app's three own codes (`PCS`/`CTN`/`BAG`) keep the trade spelling, because we insert
 *   those entries ourselves and the spellings a customs declaration prints are theirs.
 *
 * `label` is the operator's display name **alone** — one language, no code glued to it; the picker
 * renders `CODE — name` (see `docs/dev/i18n.md` and this module's `lib/unitOptions.ts`).
 */
export const UNIT_DICTIONARY_KEY = 'supplier_product_unit'

/** Catalog's own UOM key; `catalog/lib/unitResolution.ts` also accepts `units`/`measurement_units`. */
export const CATALOG_UNIT_DICTIONARY_KEY = 'unit'

export type UnitVocabularyEntry = { code: string; label: string; position: number }

export const UNIT_VOCABULARY: readonly UnitVocabularyEntry[] = [
  { code: 'PCS', label: '件', position: 10 },
  { code: 'set', label: '套', position: 20 },
  { code: 'pair', label: '对', position: 30 },
  { code: 'box', label: '盒', position: 40 },
  { code: 'CTN', label: '箱', position: 50 },
  { code: 'BAG', label: '袋', position: 60 },
  { code: 'roll', label: '卷', position: 70 },
  { code: 'kg', label: '千克', position: 80 },
  { code: 'g', label: '克', position: 90 },
  { code: 'm', label: '米', position: 100 },
  { code: 'l', label: '升', position: 110 },
] as const

/**
 * Seeds catalog's `unit` dictionary with the vocabulary codes it does not ship (insert-only, and
 * skipped when the canonical key is already taken by an entry of any spelling).
 *
 * A dictionary that is missing entirely is created here as well: `resolveCanonicalUnitCode` falls
 * back to the raw canonicalized code when no dictionary exists, which would store `PCS` as `pcs` in
 * one organization and as the entry's `value` in another — the same product field meaning two
 * different strings depending on whether catalog's setup had run.
 */
export async function ensureCatalogUnitEntries(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  now: Date = new Date(),
): Promise<void> {
  let dictionary = await em.findOne(Dictionary, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    key: CATALOG_UNIT_DICTIONARY_KEY,
    deletedAt: null,
  })
  if (!dictionary) {
    dictionary = em.create(Dictionary, {
      key: CATALOG_UNIT_DICTIONARY_KEY,
      name: 'Units of measure',
      description: 'Reusable units for catalog products and pricing.',
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      isSystem: true,
      isActive: true,
      managerVisibility: 'default',
      createdAt: now,
      updatedAt: now,
    })
    em.persist(dictionary)
    await em.flush()
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
    known.add(unit.code)
    known.add(normalizedValue)
  }
  await em.flush()
}

/** True when the code the app stores is one catalog's resolution accepts as-is (case aside). */
export function isKnownUnitCode(code: string): boolean {
  const normalized = canonicalizeUnitCode(code)
  return normalized !== null && UNIT_VOCABULARY.some((unit) => canonicalizeUnitCode(unit.code) === normalized)
}
