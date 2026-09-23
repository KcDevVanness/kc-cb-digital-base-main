import type { EntityManager } from '@mikro-orm/postgresql'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { normalizeDictionaryValue } from '@open-mercato/core/modules/dictionaries/lib/utils'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

/**
 * Currency codes on a quotation must exist in the seeded currency **dictionary** — the store the
 * platform's currency pickers read — not in the FX master, which drives rates and reporting.
 * Without the check an import could accept a code the UI can never show, and the promoted price
 * row would then be un-editable.
 *
 * Mirrors the check the products and purchasing modules run on their own price rows; each app
 * module owns its copy rather than importing another module's internals.
 */
const CURRENCY_DICTIONARY_KEYS = ['currency', 'currencies']

export async function assertCurrencyKnown(
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
    throw new CrudHttpError(422, {
      error: 'Currency dictionary is not configured yet.',
      code: 'currency_not_in_dictionary',
    })
  }
  const entry = await scopedEm.findOne(DictionaryEntry, {
    dictionary: dictionary.id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    normalizedValue: normalizeDictionaryValue(code),
  })
  if (!entry) {
    throw new CrudHttpError(422, {
      error: `Unknown currency code: ${code}`,
      code: 'currency_not_in_dictionary',
    })
  }
}
