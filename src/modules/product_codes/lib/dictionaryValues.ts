import type { EntityManager } from '@mikro-orm/postgresql'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { normalizeDictionaryValue } from '@open-mercato/core/modules/dictionaries/lib/utils'
import { badRequest } from '@open-mercato/shared/lib/crud/errors'

/**
 * The two code lists a rule reads, kept in the installed `dictionaries` module.
 *
 * They live there rather than in this module's own tables because this deployment already keeps every
 * shared vocabulary in one place (`supplier_product_unit`, `container_type`, `payment_terms`, …) and
 * maintains it on the 字典库 page — business staff add a brand without a deployment, and one page
 * answers "where do I change a code list". This module only ever *reads* them; the write guard that
 * protects an issued value is a command interceptor (`commands/interceptors.ts`).
 */
export const PRODUCT_BRAND_DICTIONARY_KEY = 'product_brand'
export const PRODUCT_CATEGORY_DICTIONARY_KEY = 'product_category'

export type DictionaryValue = { value: string; label: string }

/** Every dictionary key a rule may reference; anything else is a configuration mistake. */
export const CODE_DICTIONARY_KEYS: readonly string[] = [PRODUCT_BRAND_DICTIONARY_KEY, PRODUCT_CATEGORY_DICTIONARY_KEY]

async function loadEntries(em: EntityManager, scope: { tenantId: string; organizationId: string }, key: string): Promise<DictionaryValue[]> {
  const scopedEm = em.fork()
  const dictionary = await scopedEm.findOne(Dictionary, {
    key,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  if (!dictionary) return []
  const entries = await scopedEm.find(
    DictionaryEntry,
    { dictionary: dictionary.id, tenantId: scope.tenantId, organizationId: scope.organizationId },
    { orderBy: { position: 'asc', createdAt: 'asc' } },
  )
  return entries.map((entry) => ({ value: entry.value, label: entry.label ?? entry.value }))
}

/**
 * Every value and label the rules need, in the two shapes they are consumed in: a list of raw values
 * for worst-case rule validation, and a value → label map for the breakdown.
 */
export async function loadCodeDictionaries(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<{ values: Record<string, string[]>; labels: Record<string, Record<string, string>> }> {
  const values: Record<string, string[]> = {}
  const labels: Record<string, Record<string, string>> = {}
  for (const key of CODE_DICTIONARY_KEYS) {
    const entries = await loadEntries(em, scope, key)
    values[key] = entries.map((entry) => entry.value)
    labels[key] = Object.fromEntries(entries.map((entry) => [entry.value, entry.label]))
  }
  return { values, labels }
}

/** The dictionary entries themselves, for the rule editor's pickers. */
export async function loadDictionaryValues(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  key: string,
): Promise<DictionaryValue[]> {
  return loadEntries(em, scope, key)
}

/**
 * Refuses a value the dictionary does not list, so a code can never be built from a typo.
 *
 * The check reads the dictionary rather than trusting the caller: the value arrives from a form, and a
 * value the picker cannot show again would produce a code whose breakdown is permanently "未登记".
 */
export async function assertDictionaryValue(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  key: string,
  value: string,
): Promise<void> {
  const scopedEm = em.fork()
  const dictionary = await scopedEm.findOne(Dictionary, {
    key,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  if (!dictionary) throw badRequest(`Dictionary ${key} is not configured for this organization yet`)
  const entry = await scopedEm.findOne(DictionaryEntry, {
    dictionary: dictionary.id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    normalizedValue: normalizeDictionaryValue(value),
  })
  if (!entry) throw badRequest(`Unknown ${key} value: ${value}`)
}
