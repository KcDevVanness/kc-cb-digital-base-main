import type { CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { loadDictionaryEntriesByKey } from '@open-mercato/core/modules/dictionaries/lib/clientEntries'

/**
 * Section banners (分类) of the dictionary this module seeds — the FEEDING / CLEANING / … groups a
 * supplier workbook prints above its lines.
 *
 * Both quotation surfaces offer them as suggestions and stay typable: a workbook brings its own
 * banners, so the dictionary is a shortcut for the ones this business sees most, never a filter on
 * what a parsed quotation may say. A missing or unreadable dictionary yields no suggestions.
 */
export const QUOTE_SECTION_DICTIONARY_KEY = 'quote_section'

export async function loadQuoteSectionOptions(query?: string): Promise<CrudFieldOption[]> {
  const entries = await loadDictionaryEntriesByKey(QUOTE_SECTION_DICTIONARY_KEY)
  const term = query?.trim().toLowerCase() ?? ''
  return entries
    .map((entry) => ({ value: entry.value, label: entry.label }))
    .filter((option) => (term.length ? `${option.value} ${option.label}`.toLowerCase().includes(term) : true))
}
