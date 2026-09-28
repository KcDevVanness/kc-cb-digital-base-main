import type { EntityManager } from '@mikro-orm/postgresql'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { normalizeDictionaryValue } from '@open-mercato/core/modules/dictionaries/lib/utils'
import { badRequest } from '@open-mercato/shared/lib/crud/errors'

/**
 * The code lists this module reads, kept in the installed `dictionaries` module like every other
 * shared vocabulary in this deployment (`container_type`, `supplier_product_unit`, …): business
 * staff extend a cost type on the 字典库 page without a deployment.
 *
 * This module only ever *reads* them; the seeded entries live in `setup.ts`.
 */
export const SHIPMENT_COST_TYPE_DICTIONARY_KEY = 'shipment_cost_type'
export const FINANCE_EXPENSE_TYPE_DICTIONARY_KEY = 'finance_expense_type'

export type DictionaryValue = { value: string; label: string }

/** Every dictionary key this module validates against; anything else is a configuration mistake. */
export const FINANCE_DICTIONARY_KEYS: readonly string[] = [
  SHIPMENT_COST_TYPE_DICTIONARY_KEY,
  FINANCE_EXPENSE_TYPE_DICTIONARY_KEY,
]

export async function loadDictionaryValues(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  key: string,
): Promise<DictionaryValue[]> {
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
 * Refuses a value the dictionary does not list, so a stored cost type always has a label the picker
 * can render again. The check reads the dictionary rather than trusting the caller.
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
