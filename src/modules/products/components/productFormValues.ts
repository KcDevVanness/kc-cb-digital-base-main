import { PRODUCT_PRICE_TIERS, type ProductPriceTier } from '../lib/tiers'

/**
 * The own-product form's values and the payloads they turn into.
 *
 * Kept as pure functions (no React, no fetch) so the form component only composes them: a mapping
 * bug is a data bug, and this is the one place the API's field vocabulary is written down. The
 * field set follows the store contract in `data/validators.ts` — a product **is** the catalog
 * product, so there is no taxonomy (`typeId` / `categoryId`) and no catalog mirror link any more.
 */

export const PRODUCT_STATUSES = ['active', 'inactive'] as const
export type ProductStatus = (typeof PRODUCT_STATUSES)[number]

/** A measurement triple the operator types; blank parts mean "unset" and are dropped on save. */
export type ProductDimensions = {
  length: string
  width: string
  height: string
  unit: string
}

/** Length units a dimension block may be measured in (`dimensions.unit`). */
export const DIMENSION_UNITS = ['cm', 'mm', 'm', 'in', 'ft'] as const
/** A `Select` cannot carry an empty value, so "no unit" travels through a sentinel item. */
export const DIMENSION_UNIT_CLEAR = 'no_unit'

export type ProductVariantRowValues = {
  id?: string
  code: string
  name: string
  barcode: string
  status: ProductStatus
  isDefault: boolean
}

/**
 * One price row in the form. `key` keeps React anchored to a row while rows are added and removed;
 * it is never submitted — the price endpoint upserts on `(tier, currency, min quantity)`.
 */
export type ProductPriceRowValues = {
  key: string
  tier: ProductPriceTier
  currencyCode: string
  minQuantity: string
  unitPrice: string
  startsAt: string
  endsAt: string
  isActive: boolean
}

export type ProductFormValues = {
  id?: string
  sku: string
  name: string
  nameEn: string
  brand: string
  series: string
  manufacturerModel: string
  hsCode: string
  cnCode: string
  countryOfOriginCode: string
  specSummary: string
  unit: string
  status: ProductStatus
  notes: string
  netWeight: string
  grossWeight: string
  volume: string
  dimensions: ProductDimensions | null
  /** CrudForm's number field yields a number once edited, the raw string while untouched. */
  cartonQuantity: number | string
  batteryCapacityMah: number | string
  batteryWh: string
  containsLithiumBattery: boolean
  /** One certification per line in the textarea; blank lines are dropped before submit. */
  certifications: string
  /** Edited by its own group component and submitted to the prices endpoint, not the item one. */
  prices: ProductPriceRowValues[]
  /** Travels **with** the item payload; the submitted set is the new truth. */
  variants: ProductVariantRowValues[]
  /**
   * Carries the optimistic-lock version into `CrudForm`, which auto-derives the expected-version
   * header from `initialValues.updatedAt` for update.
   */
  updatedAt?: string | null
}

/** A product as read back by `/api/products/items`; `id` is always present on a persisted row. */
export type ProductRecord = Omit<ProductFormValues, 'id'> & { id: string }

export const EMPTY_PRODUCT_VALUES: ProductFormValues = {
  sku: '',
  name: '',
  nameEn: '',
  brand: '',
  series: '',
  manufacturerModel: '',
  hsCode: '',
  cnCode: '',
  countryOfOriginCode: '',
  specSummary: '',
  unit: 'PCS',
  status: 'active',
  notes: '',
  netWeight: '',
  grossWeight: '',
  volume: '',
  dimensions: null,
  cartonQuantity: '',
  batteryCapacityMah: '',
  batteryWh: '',
  containsLithiumBattery: false,
  certifications: '',
  prices: [],
  variants: [],
}

/** API rows are objects by contract; anything else is treated as "no data". */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readText(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string') return value
  }
  return ''
}

/** Number columns (`min_quantity`, `carton_quantity`) arrive as numbers and live in text inputs. */
function readNumberText(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    if (typeof value === 'string' && value.trim().length) return value.trim()
  }
  return ''
}

function toOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

/** Integers only, and never negative: the API rejects `-1` and `1.5` on those columns. */
function toOptionalInteger(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 ? value : null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed.length) return null
  const numeric = Number(trimmed)
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : null
}

export function readDimensions(raw: unknown): ProductDimensions | null {
  const source = asRecord(raw)
  if (!source) return null
  const dimensions: ProductDimensions = {
    length: readNumberText(source, 'length'),
    width: readNumberText(source, 'width'),
    height: readNumberText(source, 'height'),
    unit: readText(source, 'unit'),
  }
  const isBlank = !dimensions.length && !dimensions.width && !dimensions.height && !dimensions.unit
  return isBlank ? null : dimensions
}

/**
 * `null` clears the column: the validator drops blank parts and collapses an all-blank object to
 * `null`, so "not set" can never be read as the previous value.
 */
export function buildProductDimensionsPayload(dimensions: ProductDimensions | null): Record<string, unknown> | null {
  if (!dimensions) return null
  const length = dimensions.length.trim()
  const width = dimensions.width.trim()
  const height = dimensions.height.trim()
  const unit = dimensions.unit.trim()
  if (!length && !width && !height && !unit) return null
  return {
    length: length || null,
    width: width || null,
    height: height || null,
    unit: unit || null,
  }
}

function toCertificationsPayload(value: string): string[] | null {
  const entries = value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  return entries.length ? entries : null
}

/**
 * Fills in the ids of variant rows the create-retry learned from the server, so a re-submit (now an
 * update) replaces the rows it created instead of soft-deleting and re-inserting the same codes.
 */
export function attachVariantIds(
  rows: ProductVariantRowValues[],
  idByCode: Record<string, string>,
): ProductVariantRowValues[] {
  return rows.map((row) => {
    if (row.id) return row
    const id = idByCode[row.code.trim()]
    return id ? { ...row, id } : row
  })
}

export function readVariantRows(value: unknown): ProductVariantRowValues[] {
  if (!Array.isArray(value)) return []
  return value.flatMap<ProductVariantRowValues>((entry) => {
    const row = asRecord(entry)
    if (!row) return []
    return [
      {
        ...(typeof row.id === 'string' && row.id.length > 0 ? { id: row.id } : {}),
        // The read side names a variant's key `sku`; the write side calls it `code`.
        code: readText(row, 'code', 'sku'),
        name: readText(row, 'name'),
        barcode: readText(row, 'barcode'),
        status: row.status === 'inactive' || row.isActive === false ? 'inactive' : 'active',
        isDefault: row.isDefault === true,
      },
    ]
  })
}

/**
 * The submitted set.
 *
 * A row the operator opened and left untouched is dropped instead of sent: it has no code and no
 * name, so the API would reject the whole product for a row nobody meant to create. A row with
 * anything in it is submitted as-is — the server's message is what the operator acts on.
 */
export function buildProductVariantsPayload(
  rows: ProductVariantRowValues[],
): Array<Record<string, unknown>> {
  return rows
    .filter((row) => row.code.trim().length > 0 || row.name.trim().length > 0)
    .map((row) => ({
      ...(row.id ? { id: row.id } : {}),
      code: row.code.trim(),
      name: row.name.trim(),
      barcode: row.barcode.trim().length > 0 ? row.barcode.trim() : null,
      status: row.status,
      isDefault: row.isDefault === true,
    }))
}

export function readPriceRows(value: unknown): ProductPriceRowValues[] {
  if (!Array.isArray(value)) return []
  return value.flatMap<ProductPriceRowValues>((entry) => {
    const row = asRecord(entry)
    if (!row) return []
    const rawTier = row.tier ?? row.priceTier
    const tier = isProductPriceTier(rawTier) ? rawTier : 'purchase'
    return [
      {
        key: typeof row.key === 'string' && row.key.length > 0 ? row.key : newPriceRowKey(),
        tier,
        currencyCode: readText(row, 'currencyCode', 'currency_code'),
        minQuantity: readNumberText(row, 'minQuantity', 'min_quantity') || '1',
        unitPrice: readText(row, 'unitPrice', 'unit_price'),
        startsAt: toDateInputValue(readText(row, 'startsAt', 'starts_at')),
        endsAt: toDateInputValue(readText(row, 'endsAt', 'ends_at')),
        isActive: row.isActive !== false,
      },
    ]
  })
}

export function isProductPriceTier(value: unknown): value is ProductPriceTier {
  return typeof value === 'string' && (PRODUCT_PRICE_TIERS as readonly string[]).includes(value)
}

/** An ISO instant or date keeps only its `YYYY-MM-DD` half for the date input. */
export function toDateInputValue(value: string): string {
  if (!value) return ''
  return value.length >= 10 ? value.slice(0, 10) : value
}

let fallbackRowSequence = 0

function newPriceRowKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  fallbackRowSequence += 1
  return `price-${Date.now()}-${fallbackRowSequence}`
}

export function createEmptyPriceRow(): ProductPriceRowValues {
  return {
    key: newPriceRowKey(),
    tier: 'purchase',
    currencyCode: '',
    minQuantity: '1',
    unitPrice: '',
    startsAt: '',
    endsAt: '',
    isActive: true,
  }
}

export function toProductPriceRowValues(item: Record<string, unknown>): ProductPriceRowValues {
  const tier = item.tier ?? item.priceTier
  return {
    key: newPriceRowKey(),
    tier: isProductPriceTier(tier) ? tier : 'purchase',
    currencyCode: readText(item, 'currencyCode', 'currency_code'),
    minQuantity: readNumberText(item, 'minQuantity', 'min_quantity') || '1',
    unitPrice: readText(item, 'unitPrice', 'unit_price'),
    startsAt: toDateInputValue(readText(item, 'startsAt', 'starts_at')),
    endsAt: toDateInputValue(readText(item, 'endsAt', 'ends_at')),
    isActive: item.isActive !== false,
  }
}

/**
 * Submits the complete price set.
 *
 * Rows the operator added but never priced are dropped instead of sent: the API rejects a blank
 * `unitPrice`, and dropping the row costs nothing because it has no key to upsert against. A
 * previously saved row absent from this payload is closed server-side — a removed row is withdrawn,
 * never deleted, so a contract snapshot stays explainable.
 */
export function buildProductPriceRowsPayload(rows: ProductPriceRowValues[]): Array<Record<string, unknown>> {
  return rows
    .filter((row) => row.unitPrice.trim().length > 0)
    .map((row) => ({
      tier: row.tier,
      currencyCode: row.currencyCode.trim().toUpperCase(),
      minQuantity: toOptionalInteger(row.minQuantity) ?? 1,
      unitPrice: row.unitPrice.trim(),
      startsAt: toOptionalText(row.startsAt),
      endsAt: toOptionalText(row.endsAt),
      isActive: row.isActive === true,
    }))
}

/**
 * Maps a record payload into the form's initial values.
 *
 * Exported as a pure function so the optimistic-lock wiring stays testable: `CrudForm` auto-derives
 * the expected-version header from `initialValues.updatedAt`, so dropping `updatedAt` here silently
 * disables optimistic locking for the edit form.
 */
export function toProductFormValues(item: Record<string, unknown>): ProductRecord {
  const updatedAt = item.updatedAt ?? item.updated_at
  return {
    id: readText(item, 'id'),
    sku: readText(item, 'sku'),
    name: readText(item, 'name'),
    nameEn: readText(item, 'nameEn', 'name_en'),
    brand: readText(item, 'brand'),
    series: readText(item, 'series'),
    manufacturerModel: readText(item, 'manufacturerModel', 'manufacturer_model'),
    specSummary: readText(item, 'specSummary', 'spec_summary'),
    hsCode: readText(item, 'hsCode', 'hs_code'),
    cnCode: readText(item, 'cnCode', 'cn_code'),
    countryOfOriginCode: readText(item, 'countryOfOriginCode', 'country_of_origin_code'),
    unit: readText(item, 'unit') || 'PCS',
    status: item.status === 'inactive' ? 'inactive' : 'active',
    notes: readText(item, 'notes'),
    netWeight: readNumberText(item, 'netWeight', 'net_weight'),
    grossWeight: readNumberText(item, 'grossWeight', 'gross_weight'),
    volume: readNumberText(item, 'volume'),
    dimensions: readDimensions(item.dimensions),
    cartonQuantity: readNumberText(item, 'cartonQuantity', 'carton_quantity'),
    batteryCapacityMah: readNumberText(item, 'batteryCapacityMah', 'battery_capacity_mah'),
    batteryWh: readNumberText(item, 'batteryWh', 'battery_wh'),
    containsLithiumBattery: item.containsLithiumBattery === true,
    certifications: Array.isArray(item.certifications)
      ? item.certifications.map((entry) => String(entry)).filter((entry) => entry.length > 0).join('\n')
      : '',
    prices: [],
    variants: readVariantRows(item.variants),
    updatedAt: typeof updatedAt === 'string' ? updatedAt : null,
  }
}

/** Builds the item create/update payload; keys are dropped to the contract field set. */
export function buildProductPayload(values: ProductFormValues): Record<string, unknown> {
  return {
    sku: values.sku.trim(),
    name: values.name.trim(),
    nameEn: toOptionalText(values.nameEn),
    brand: values.brand.trim(),
    series: toOptionalText(values.series),
    manufacturerModel: toOptionalText(values.manufacturerModel),
    specSummary: toOptionalText(values.specSummary),
    unit: values.unit.trim() || 'PCS',
    status: values.status,
    notes: toOptionalText(values.notes),
    hsCode: toOptionalText(values.hsCode),
    cnCode: toOptionalText(values.cnCode),
    countryOfOriginCode: toOptionalText(values.countryOfOriginCode),
    netWeight: toOptionalText(values.netWeight),
    grossWeight: toOptionalText(values.grossWeight),
    volume: toOptionalText(values.volume),
    dimensions: buildProductDimensionsPayload(values.dimensions),
    cartonQuantity: toOptionalInteger(values.cartonQuantity),
    batteryCapacityMah: toOptionalInteger(values.batteryCapacityMah),
    batteryWh: toOptionalText(values.batteryWh),
    containsLithiumBattery: values.containsLithiumBattery === true,
    certifications: toCertificationsPayload(values.certifications),
    variants: buildProductVariantsPayload(values.variants),
  }
}
