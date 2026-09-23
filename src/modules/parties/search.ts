import type {
  SearchBuildContext,
  SearchIndexSource,
  SearchModuleConfig,
  SearchResultPresenter,
} from '@open-mercato/shared/modules/search'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

const ENTITY_ID = 'parties:party' as const

function pickString(...candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const trimmed = candidate.trim()
    if (trimmed.length > 0) return trimmed
  }
  return null
}

/**
 * The presenter shows the plaintext `code`, never `name`.
 *
 * `name`, the contact block and the whole bank block are declared in `encryption.ts`, so the search
 * index holds their ciphertext form — rendering `name` here would print a base64 blob. Reachability
 * is not lost: the query indexer builds `search_tokens` from the DECRYPTED index doc, so a search for
 * the party's name still matches and lands on this result.
 */
function buildPartyPresenter(t: TranslateFn, record: Record<string, unknown>): SearchResultPresenter {
  const code = pickString(record.code) ?? String(record.id ?? '')
  const country = pickString(record.country_code, record.countryCode)
  const status = pickString(record.status)
  const subtitleParts = [country, status].filter((part): part is string => part !== null)
  return {
    title: code,
    subtitle: subtitleParts.length > 0
      ? subtitleParts.join(' · ')
      : t('parties.search.subtitle', 'Trading party'),
    icon: 'building2',
    badge: t('parties.search.badge', 'Party'),
  }
}

function buildPartySource(ctx: SearchBuildContext, presenter: SearchResultPresenter): SearchIndexSource | null {
  const lines: string[] = []
  const code = pickString(ctx.record.code)
  if (code) lines.push(`Code: ${code}`)
  const country = pickString(ctx.record.country_code, ctx.record.countryCode)
  if (country) lines.push(`Country: ${country}`)
  const status = pickString(ctx.record.status)
  if (status) lines.push(`Status: ${status}`)
  if (!lines.length) return null
  return {
    text: lines,
    presenter,
    checksumSource: { record: ctx.record, customFields: ctx.customFields },
  }
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: ENTITY_ID,
      enabled: true,
      priority: 5,
      aclFeatures: ['parties.view'],
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        return buildPartySource(ctx, buildPartyPresenter(t, ctx.record))
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return buildPartyPresenter(t, ctx.record)
      },
      resolveUrl: (ctx) => `/backend/parties/${encodeURIComponent(String(ctx.record.id))}/edit`,
      fieldPolicy: {
        // `searchable` is a whitelist of fields safe to hand to an external provider as plaintext.
        searchable: ['code', 'country_code', 'status'],
        // Every encrypted column stays out of the provider payload; token search still reaches them
        // through `search_tokens`, which is built from the decrypted index doc.
        excluded: [
          'name',
          'contact_name',
          'contact_phone',
          'email',
          'address_line1',
          'address_line2',
          'city',
        ],
      },
    },
  ],
}

export default searchConfig
export const config = searchConfig
