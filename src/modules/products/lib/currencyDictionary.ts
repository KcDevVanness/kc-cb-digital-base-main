import type { EntityManager } from '@mikro-orm/postgresql'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { normalizeDictionaryValue } from '@open-mercato/core/modules/dictionaries/lib/utils'
import { badRequest } from '@open-mercato/shared/lib/crud/errors'

/**
 * Currency codes on a price row must come from the seeded currency **dictionary** — the same
 * store the platform's currency pickers read — not from the FX master (`currencies` table),
 * which drives exchange rates and reporting. Without this check an API caller could store a code
 * the UI picker can never show, producing a price row that cannot be edited again.
 *
 * Both dictionary keys are accepted because the platform seeds `currency` while the CRM
 * resolves either spelling.
 */
const CURRENCY_DICTIONARY_KEYS = ['currency', 'currencies']

export async function assertCurrencyInDictionary(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  code: string,
): Promise<void> {
  const scopedEm = em.fork()
  const dictionary = await scopedEm.findOne(Dictionary, {
    key: { $in: CURRENCY_DICTIONARY_KEYS },
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  if (!dictionary) {
    throw badRequest('Currency dictionary is not configured yet.')
  }

  const entry = await scopedEm.findOne(DictionaryEntry, {
    dictionary: dictionary.id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    normalizedValue: normalizeDictionaryValue(code),
  })
  if (!entry) {
    throw badRequest(`Unknown currency code: ${code}`)
  }
}
