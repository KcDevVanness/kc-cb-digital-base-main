/**
 * The fixed rule that turns a quotation line into product-master values.
 *
 * Two properties matter and are pinned by tests: only **non-empty** values are produced (an
 * import must never blank a curated product field), and the price row is built from the line's
 * own currency and MOQ so the ladder lands in `products_prices.min_quantity` where the product
 * module already models it.
 */

import type { SourcingQuoteLine, SourcingSupplierProduct } from '../data/entities'
import { slugifySku } from './valueNormalization'

export type ProductFieldValues = {
  name: string | null
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

const SPEC_SUMMARY_LIMIT = 500

/** Long supplier descriptions are a spec sheet, not a paragraph: newlines become ` / `. */
function toSpecSummary(description: string | null | undefined): string | null {
  if (!description) return null
  const collapsed = description
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' / ')
  if (collapsed.length === 0) return null
  return collapsed.slice(0, SPEC_SUMMARY_LIMIT)
}

function asRecord(value: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!value) return null
  const entries = Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined && entry !== '')
  return entries.length > 0 ? Object.fromEntries(entries) : null
}

/** Non-empty product values a line can contribute; nothing here returns an empty string. */
export function quoteLineToProductFields(line: SourcingQuoteLine): ProductFieldValues {
  const dimensions = asRecord(line.outerPacking ?? null)
  return {
    name: line.productName && line.productName.trim().length > 0 ? line.productName.trim() : null,
    specSummary: toSpecSummary(line.description),
    hsCode: line.hsCode && line.hsCode.trim().length > 0 ? line.hsCode.trim() : null,
    unit: line.unit && line.unit.trim().length > 0 ? line.unit.trim() : null,
    netWeight: line.unitNetWeight ?? null,
    dimensions: asRecord(line.innerPacking ?? null),
    cartonQuantity: line.cartonQuantity ?? null,
    cartonDimensions: dimensions,
    cartonGrossWeight: line.cartonGrossWeight ?? null,
    cartonNetWeight: line.cartonNetWeight ?? null,
  }
}

/**
 * The same rule, sourced from a supplier library row instead of a quotation line.
 *
 * A library row is the curated record the buyer maintains, so "sync to product master" must
 * produce exactly the fields a quotation promotion would. Keeping both mappings in one file is
 * what stops the two paths from drifting apart.
 */
export function supplierProductToProductFields(product: SourcingSupplierProduct): ProductFieldValues {
  return {
    name: product.name && product.name.trim().length > 0 ? product.name.trim() : null,
    specSummary: toSpecSummary(product.description),
    hsCode: product.hsCode && product.hsCode.trim().length > 0 ? product.hsCode.trim() : null,
    unit: product.unit && product.unit.trim().length > 0 ? product.unit.trim() : null,
    netWeight: product.unitNetWeight ?? null,
    dimensions: asRecord(product.innerPacking ?? null),
    cartonQuantity: product.cartonQuantity ?? null,
    cartonDimensions: asRecord(product.outerPacking ?? null),
    cartonGrossWeight: product.cartonGrossWeight ?? null,
    cartonNetWeight: product.cartonNetWeight ?? null,
  }
}

/**
 * Values that differ from what the product already stores. Null/undefined line values are dropped
 * first, so a supplier sheet that omits a column can never erase the master's value.
 */
export function changedProductFields(
  current: {
    name: string | null
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

/** The `purchase` price row a line asks for: the quotation's currency and the line's MOQ. */
export function desiredPriceRow(line: SourcingQuoteLine, quoteCurrency: string): DesiredPriceRow {
  const lineCurrency = line.currencyCode && /^[A-Za-z]{3}$/.test(line.currencyCode) ? line.currencyCode : quoteCurrency
  return {
    priceTier: 'purchase',
    currencyCode: lineCurrency.toUpperCase(),
    minQuantity: line.moqQuantity && line.moqQuantity >= 1 ? Math.round(line.moqQuantity) : 1,
    unitPrice: line.unitCost ?? '0',
    startsAt: null,
    endsAt: null,
    isActive: true,
  }
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

/** Category code for a section banner (`FEEDING` → `feeding`); null when nothing usable is left. */
export function categoryCodeFromSection(label: string | null | undefined): string | null {
  if (!label) return null
  const slug = slugifySku(label).replace(/-/g, '_')
  return /^[a-z0-9_]{1,64}$/.test(slug) ? slug : null
}
