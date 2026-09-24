import { pickBasePriceRow, type SupplierProductPriceKind } from './priceKinds'

/**
 * The supplier library form's values and payload builders.
 *
 * Pure functions in `lib/` rather than inside the client component: they are the layer a save
 * round trip is proven on (a numeric field arrives as a number once it has been edited, an
 * untouched one as the raw string), and a Node-env test can import this file without pulling
 * `next/image` or `CrudForm` in.
 */

/** Packing sizes are centimetres everywhere in this library, so only the three numbers vary. */
export type PackingValues = { length: string; width: string; height: string }

/**
 * One price row of the item's stored set, as the form carries it. `key` keeps React anchored to a
 * row while the set is rewritten; it is never submitted, because the endpoint upserts on
 * `(kind, currency, min quantity)`.
 *
 * The form **edits** one of these — the base `supplier_cost` row the single 供货价 field shows — and
 * submits the rest back untouched (`splitSupplierProductPriceRows` below).
 */
export type SupplierProductPriceRowValues = {
  key: string
  priceKind: SupplierProductPriceKind
  currencyCode: string
  minQuantity: string
  unitPrice: string
  isActive: boolean
}

/** The stored set, split into the row the form edits and the rows it only shows. */
export type SupplierProductPriceRowSplit = {
  /**
   * The active `supplier_cost` base row — the one `lib/supplierProductPrices.ts` resolves for the
   * list column and the promotion, so the number the operator edits is the number the list shows.
   * `null` when the item has no live supply price (a withdrawn row is never the primary: putting it
   * back in the field would revive it on the next save without the operator asking).
   */
  primary: SupplierProductPriceRowValues | null
  /** Every other stored row: another currency or ladder step, a withdrawn price, a legacy offer. */
  extras: SupplierProductPriceRowValues[]
}

export type SupplierProductFormValues = {
  id?: string
  supplierId: string
  supplierName: string
  supplierSku: string
  itemNo: string
  brandValue: string
  name: string
  nameZh: string
  nameEn: string
  description: string
  declarationElements: string
  unit: string
  hsCode: string
  /**
   * CrudForm's number field yields a **number** once edited and the raw string while untouched, so
   * every numeric value is read through the tolerant helpers below (calling `.trim()` on a number
   * is what broke the first save of a row whose Qty/Box had been typed in).
   */
  moqQuantity: number | string
  cartonQuantity: number | string
  unitNetWeight: number | string
  unitGrossWeight: number | string
  unitVolume: number | string
  /**
   * The supplier's discount off the supply price, in percent — a product-level term (REQ-SPL-022).
   * Blank means no discount; the 折后价 is derived for display and for the promotion, never stored.
   */
  discountPercent: number | string
  innerPacking: PackingValues
  /** Ordered attachment ids of the product photos (REQ-SPL-014). */
  imageAttachmentIds: string[]
  /** The item's whole price list, submitted separately after the row itself (REQ-SPL-013). */
  prices: SupplierProductPriceRowValues[]
  status: string
  notes: string
  /**
   * Carries the optimistic-lock version into `CrudForm`, which auto-derives the
   * expected-version header from `initialValues.updatedAt` for update and delete.
   */
  updatedAt?: string | null
}

export const EMPTY_PACKING: PackingValues = { length: '', width: '', height: '' }

export const EMPTY_VALUES: SupplierProductFormValues = {
  supplierId: '',
  supplierName: '',
  supplierSku: '',
  itemNo: '',
  brandValue: '',
  name: '',
  nameZh: '',
  nameEn: '',
  description: '',
  declarationElements: '',
  unit: 'PCS',
  hsCode: '',
  moqQuantity: '',
  cartonQuantity: '',
  unitNetWeight: '',
  unitGrossWeight: '',
  unitVolume: '',
  discountPercent: '',
  innerPacking: EMPTY_PACKING,
  imageAttachmentIds: [],
  prices: [],
  status: 'active',
  notes: '',
}

let priceRowSequence = 0

/**
 * The row an item without a stored supply price starts from: 供货价 in CNY at the lowest ladder step.
 * Only the currency is ever picked before the amount is typed, and the amount decides whether the
 * row is submitted at all (`buildSupplierProductPriceRowsPayload`).
 */
export function createEmptyPriceRow(): SupplierProductPriceRowValues {
  priceRowSequence += 1
  return {
    key: `price-${priceRowSequence}`,
    priceKind: 'supplier_cost',
    currencyCode: 'CNY',
    minQuantity: '1',
    unitPrice: '',
    isActive: true,
  }
}

/**
 * Splits the stored set into the row the form's single 供货价 field edits and the rows it keeps for
 * traceability — the comparison is `lib/priceKinds.ts` `pickBasePriceRow`, the same rule the list
 * column and the promotion resolve the base row with.
 *
 * An unparseable or blank ladder step reads as 1, the API's own default, so a malformed legacy value
 * can never make the row uneditable.
 */
export function splitSupplierProductPriceRows(rows: SupplierProductPriceRowValues[]): SupplierProductPriceRowSplit {
  const candidates = rows
    .filter((row) => row.priceKind === 'supplier_cost' && row.isActive)
    .map((row) => ({
      row,
      minQuantity: Number.parseInt(row.minQuantity.trim() || '1', 10) || 1,
      currencyCode: row.currencyCode.trim().toUpperCase(),
    }))
  const base = pickBasePriceRow(candidates)
  const primary = base ? base.row : null
  return { primary, extras: primary ? rows.filter((row) => row !== primary) : [...rows] }
}

export function readText(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string') return value
  }
  return ''
}

export function readNumberText(source: Record<string, unknown>, key: string): string {
  const value = source[key]
  if (value === null || value === undefined) return ''
  return typeof value === 'number' || typeof value === 'string' ? String(value) : ''
}

export function readPacking(raw: unknown): PackingValues {
  if (!raw || typeof raw !== 'object') return EMPTY_PACKING
  const source = raw as Record<string, unknown>
  return {
    length: readNumberText(source, 'length'),
    width: readNumberText(source, 'width'),
    height: readNumberText(source, 'height'),
  }
}

/** Anything that is not a string array reads as "no photos" instead of breaking the form. */
export function readImageIds(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === 'string') : []
}

function isPriceKind(value: unknown): value is SupplierProductPriceKind {
  return value === 'supplier_cost' || value === 'company_offer'
}

/**
 * One API price row as the form edits it. A deactivated row is still loaded: the operator has to
 * see the price they withdrew, and a row left untouched is submitted back unchanged (which keeps
 * it deactivated instead of silently reviving it).
 */
export function toProductPriceRowValues(item: Record<string, unknown>): SupplierProductPriceRowValues {
  priceRowSequence += 1
  return {
    key: `price-${priceRowSequence}`,
    priceKind: isPriceKind(item.priceKind) ? item.priceKind : 'supplier_cost',
    currencyCode: readText(item, 'currencyCode', 'currency_code').toUpperCase() || 'CNY',
    minQuantity: readNumberText(item, 'minQuantity') || readNumberText(item, 'min_quantity') || '1',
    unitPrice: readNumberText(item, 'unitPrice') || readNumberText(item, 'unit_price'),
    isActive: item.isActive === undefined ? item.is_active !== false : item.isActive !== false,
  }
}

/**
 * The price payload: the whole stored set, with each row's own kind, currency and ladder step as
 * its identity.
 *
 * A row without an amount is **dropped**, never submitted as `0`: an empty row is either the single
 * price field left blank or a price the operator cleared — and a stored `0` would read as "free" in
 * every later negotiation. Dropping the base row is how a price is withdrawn: the row keeps its
 * amount and comes back `isActive: false`, which is what makes the set explainable afterwards.
 * Rows the form only shows (other currencies/steps, withdrawn ones) are submitted back unchanged,
 * so a save never rewrites history.
 */
export function buildSupplierProductPriceRowsPayload(rows: SupplierProductPriceRowValues[]): Array<Record<string, unknown>> {
  return rows
    .filter((row) => row.unitPrice.trim().length > 0)
    .map((row) => ({
      priceKind: row.priceKind,
      currencyCode: row.currencyCode.trim().toUpperCase(),
      minQuantity: Number(row.minQuantity.trim() || '1'),
      unitPrice: row.unitPrice.trim(),
      isActive: row.isActive,
    }))
}

/**
 * Maps a record onto the form's initial values.
 *
 * Exported as a pure function because dropping `updatedAt` here silently disables optimistic
 * locking for the edit form.
 */
export function toSupplierProductFormValues(item: Record<string, unknown>): SupplierProductFormValues {
  const updatedAt = item.updatedAt ?? item.updated_at
  return {
    id: readText(item, 'id'),
    supplierId: readText(item, 'supplierId', 'supplier_id'),
    supplierName: readText(item, 'supplierName', 'supplier_name_snapshot'),
    supplierSku: readText(item, 'supplierSku', 'supplier_sku'),
    itemNo: readText(item, 'itemNo', 'item_no'),
    brandValue: readText(item, 'brandValue', 'brand_value'),
    name: readText(item, 'name'),
    nameZh: readText(item, 'nameZh', 'name_zh'),
    nameEn: readText(item, 'nameEn', 'name_en'),
    description: readText(item, 'description'),
    declarationElements: readText(item, 'declarationElements', 'declaration_elements'),
    unit: readText(item, 'unit') || 'PCS',
    hsCode: readText(item, 'hsCode', 'hs_code'),
    moqQuantity: readNumberText(item, 'moqQuantity') || readNumberText(item, 'moq_quantity'),
    cartonQuantity: readNumberText(item, 'cartonQuantity') || readNumberText(item, 'carton_quantity'),
    unitNetWeight: readNumberText(item, 'unitNetWeight') || readNumberText(item, 'unit_net_weight'),
    unitGrossWeight: readNumberText(item, 'unitGrossWeight') || readNumberText(item, 'unit_gross_weight'),
    unitVolume: readNumberText(item, 'unitVolume') || readNumberText(item, 'unit_volume'),
    discountPercent: readNumberText(item, 'discountPercent') || readNumberText(item, 'discount_percent'),
    innerPacking: readPacking(item.innerPacking ?? item.inner_packing),
    imageAttachmentIds: readImageIds(item.imageAttachmentIds ?? item.image_attachment_ids),
    prices: Array.isArray(item.prices)
      ? item.prices.map((row) => toProductPriceRowValues(row as Record<string, unknown>))
      : [],
    status: readText(item, 'status') || 'active',
    notes: readText(item, 'notes'),
    updatedAt: typeof updatedAt === 'string' ? updatedAt : null,
  }
}

/** A numeric field's value as a number, or `null` for blank/not-a-number. */
export function nullableNumberText(value: number | string): number | null {
  const trimmed = typeof value === 'number' ? String(value) : value.trim()
  if (trimmed.length === 0) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

/** A decimal field's value as the fixed-scale string the API validates. */
export function nullableDecimalText(value: number | string): string | null {
  const trimmed = typeof value === 'number' ? String(value) : value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function packingPayload(packing: PackingValues): Record<string, unknown> | null {
  const length = nullableNumberText(packing.length)
  const width = nullableNumberText(packing.width)
  const height = nullableNumberText(packing.height)
  if (length === null && width === null && height === null) return null
  return { length, width, height, unit: 'cm' }
}

/**
 * Builds the create/update payload.
 *
 * `supplierId` is dropped on update: a code is only unique *per supplier*, so the owning supplier
 * is part of the row's identity and the server refuses to move it.
 */
export function buildSupplierProductPayload(values: SupplierProductFormValues): Record<string, unknown> {
  return {
    supplierSku: values.supplierSku.trim(),
    itemNo: values.itemNo.trim() || null,
    brandValue: values.brandValue.trim() || null,
    name: values.name.trim(),
    nameZh: values.nameZh.trim() || null,
    nameEn: values.nameEn.trim() || null,
    description: values.description.trim() || null,
    declarationElements: values.declarationElements.trim() || null,
    unit: values.unit.trim() || 'PCS',
    hsCode: values.hsCode.trim() || null,
    moqQuantity: nullableNumberText(values.moqQuantity),
    cartonQuantity: nullableNumberText(values.cartonQuantity),
    unitNetWeight: nullableDecimalText(values.unitNetWeight),
    unitGrossWeight: nullableDecimalText(values.unitGrossWeight),
    unitVolume: nullableDecimalText(values.unitVolume),
    discountPercent: nullableDecimalText(values.discountPercent),
    innerPacking: packingPayload(values.innerPacking),
    // Replace-set: the submitted list is the new photo list, so removing a thumbnail here removes
    // the binding on save (the uploaded file itself stays in the attachments module).
    imageAttachmentIds: values.imageAttachmentIds,
    status: values.status === 'inactive' ? 'inactive' : 'active',
    notes: values.notes.trim() || null,
  }
}

