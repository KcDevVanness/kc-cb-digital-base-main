import type { EntityManager } from '@mikro-orm/postgresql'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { normalizeDictionaryValue } from '@open-mercato/core/modules/dictionaries/lib/utils'
import { badRequest } from '@open-mercato/shared/lib/crud/errors'

/**
 * The two code lists the business maintains in the installed `dictionaries` module.
 *
 * They outlived the code-issuance retirement (`.ai/specs/2026-10-10-catalog-single-store.md`):
 * `product_brand` labels the brand a supplier item is sold under, and `product_category` doubles as
 * the 订单描述 code the company order and the purchase order store. SKUs are typed by hand now, so
 * nothing here generates a code — the module only *reads* these lists, and the write guard that used
 * to freeze an issued value is gone with the ledger it protected.
 */
export const PRODUCT_BRAND_DICTIONARY_KEY = 'product_brand'
export const PRODUCT_CATEGORY_DICTIONARY_KEY = 'product_category'

export type DictionaryValue = { value: string; label: string }

/**
 * Refuses a value the dictionary does not list, so a supplier's brand can never be a typo.
 *
 * The check reads the dictionary rather than trusting the caller: the value arrives from a form, and a
 * value the picker cannot show again would render as a bare code everywhere it is displayed.
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
