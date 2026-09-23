/**
 * The master's write contract for supplier-sourced fields.
 *
 * Two supplier-side modules map their own records onto the product master — a quotation line
 * (`sourcing`) and a supplier library row (`purchasing`) — and both must obey the same two rules,
 * which is why they live here rather than in either of them:
 *
 * 1. **Only non-empty, changed values are produced.** A supplier sheet that omits a column may
 *    never erase a curated master field, so every value is compared against what the master
 *    already stores before it is sent.
 * 2. **A price is a whole set.** `products.prices.replace` deactivates the rows missing from the
 *    payload, so the caller must submit every row it wants to keep; `mergePriceRows` is what keeps
 *    the `internal` and `export` tiers alive across an import.
 *
 * The source-specific halves (which columns of a quotation line or of a library row feed these
 * values) stay in their own modules: this file only knows the master's field names and the merge
 * semantics, and it imports no entity from any module.
 */

export type ProductFieldValues = {
  name: string | null
  nameEn: string | null
  specSummary: string | null
  hsCode: string | null
  unit: string | null
  netWeight: string | null
  dimensions: Record<string, unknown> | null
  cartonQuantity: number | null
  cartonDimensions: Record<string, unknown> | null
  cartonGrossWeight: string | null
  cartonNetWeight: string | null
}

export type DesiredPriceRow = {
  priceTier: 'purchase'
  currencyCode: string
  minQuantity: number
  unitPrice: string
  startsAt: null
  endsAt: null
  isActive: true
}

/** `products.prices.replace` accepts at most this many rows per product. */
export const MAX_PRICE_ROWS = 100

const SPEC_SUMMARY_LIMIT = 500

/** Long supplier descriptions are a spec sheet, not a paragraph: newlines become ` / `. */
export function toSpecSummary(description: string | null | undefined): string | null {
  if (!description) return null
  const collapsed = description
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' / ')
  if (collapsed.length === 0) return null
  return collapsed.slice(0, SPEC_SUMMARY_LIMIT)
}

/** Drops the blank parts of a `{length,width,height,unit}` record; all-blank collapses to null. */
export function asRecord(value: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!value) return null
  const entries = Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined && entry !== '')
  return entries.length > 0 ? Object.fromEntries(entries) : null
}

/**
 * Values that differ from what the product already stores. Null/undefined supplier values are
 * dropped first, so a sheet that omits a column can never erase the master's value.
 */
export function changedProductFields(
  current: {
    name: string | null
    nameEn: string | null
    specSummary: string | null
    hsCode: string | null
    unit: string | null
    netWeight: string | null
    dimensions: Record<string, unknown> | null
    cartonQuantity: number | null
    cartonDimensions: Record<string, unknown> | null
    cartonGrossWeight: string | null
    cartonNetWeight: string | null
  },
  values: ProductFieldValues,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  if (values.name && values.name !== current.name) payload.name = values.name
  if (values.nameEn && values.nameEn !== current.nameEn) payload.nameEn = values.nameEn
  if (values.specSummary && values.specSummary !== current.specSummary) payload.specSummary = values.specSummary
  if (values.hsCode && values.hsCode !== current.hsCode) payload.hsCode = values.hsCode
  if (values.unit && values.unit !== current.unit) payload.unit = values.unit
  if (values.netWeight && Number(values.netWeight) !== Number(current.netWeight ?? Number.NaN)) payload.netWeight = values.netWeight
  if (values.dimensions && JSON.stringify(values.dimensions) !== JSON.stringify(current.dimensions ?? null)) {
    payload.dimensions = values.dimensions
  }
  if (values.cartonQuantity !== null && values.cartonQuantity !== current.cartonQuantity) payload.cartonQuantity = values.cartonQuantity
  if (values.cartonDimensions && JSON.stringify(values.cartonDimensions) !== JSON.stringify(current.cartonDimensions ?? null)) {
    payload.cartonDimensions = values.cartonDimensions
  }
  if (values.cartonGrossWeight && Number(values.cartonGrossWeight) !== Number(current.cartonGrossWeight ?? Number.NaN)) {
    payload.cartonGrossWeight = values.cartonGrossWeight
  }
  if (values.cartonNetWeight && Number(values.cartonNetWeight) !== Number(current.cartonNetWeight ?? Number.NaN)) {
    payload.cartonNetWeight = values.cartonNetWeight
  }
  return payload
}

export function priceRowKey(row: { priceTier: string; currencyCode: string; minQuantity: number }): string {
  return `${row.priceTier}|${row.currencyCode.toUpperCase()}|${row.minQuantity}`
}

/**
 * Merges the desired row into the product's existing price set.
 *
 * `products.prices.replace` replaces the whole set and deactivates rows missing from the payload,
 * so the caller must submit every row it wants to keep — that is what keeps the `internal` and
 * `export` tiers alive across an import. Rows are returned unchanged when the price already
 * matches, which lets the caller skip the command entirely.
 */
export function mergePriceRows(
  existing: readonly {
    id: string
    priceTier: string
    currencyCode: string
    minQuantity: number
    unitPrice: string
    startsAt: string | null
    endsAt: string | null
    isActive: boolean
  }[],
  desired: DesiredPriceRow,
): { rows: Record<string, unknown>[]; changed: boolean } {
  const key = priceRowKey(desired)
  let changed = !existing.some(
    (row) => priceRowKey(row) === key && Number(row.unitPrice) === Number(desired.unitPrice) && row.isActive,
  )
  const rows: Record<string, unknown>[] = existing.map((row) => {
    if (priceRowKey(row) !== key) {
      return {
        id: row.id,
        priceTier: row.priceTier,
        currencyCode: row.currencyCode,
        minQuantity: row.minQuantity,
        unitPrice: row.unitPrice,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        isActive: row.isActive,
      }
    }
    return {
      id: row.id,
      priceTier: desired.priceTier,
      currencyCode: desired.currencyCode,
      minQuantity: desired.minQuantity,
      unitPrice: desired.unitPrice,
      startsAt: null,
      endsAt: null,
      isActive: true,
    }
  })
  if (!existing.some((row) => priceRowKey(row) === key)) {
    rows.push({ ...desired })
    changed = true
  }
  return { rows, changed }
}
