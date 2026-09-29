/**
 * The label and by-id read for the products module's optional link to an installed catalog product.
 *
 * The link is a bare uuid on the product record, so the picker that renders it needs a human label
 * both when it lists options and when it shows a value that is already set. Keeping the shaping here
 * means the option list and the pre-selected value cannot render two different labels for one
 * product.
 */

import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

/** `SKU — title` when both are known, else whichever of the two exists, else the id. */
export function catalogLinkLabel(item: Record<string, unknown>): string {
  const title = readNonEmpty(item, 'title', 'name')
  const sku = readNonEmpty(item, 'sku')
  return sku && title ? `${sku} — ${title}` : sku || title || readNonEmpty(item, 'id')
}

/** First non-blank string among `keys`; a label half must not be an empty string. */
function readNonEmpty(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return ''
}

/**
 * Resolve a pre-selected catalog link to its label by id.
 *
 * The field's value is already set when an edited product loads, and `ComboboxInput`'s eager
 * fallback does not survive React StrictMode's double-invoked effects (its fetch is cancelled and
 * its ref guard then blocks the retry), which painted the raw uuid into the field. `resolveLabel` is
 * the component's documented path for a pre-selected value.
 */
export async function resolveCatalogLinkLabel(value: string): Promise<string> {
  const payload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
    `/api/catalog/products?id=${encodeURIComponent(value)}&pageSize=1`,
    undefined,
    { fallback: { items: [] }, errorMessage: '' },
  )
  const item = payload.items?.[0]
  return item ? catalogLinkLabel(item) : ''
}
