"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import {
  CrudForm,
  type CrudField,
  type CrudFieldOption,
  type CrudFormGroup,
  type CrudFormGroupComponentProps,
} from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { pushWithFlash } from '@open-mercato/ui/backend/utils/flash'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { ComboboxInput } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { FieldLabel } from '@open-mercato/ui/primitives/label'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import {
  PRODUCT_FORM_STEPS,
  PRODUCT_FORM_STEP_TITLE_KEYS,
  firstInvalidField,
  firstValidationMessage,
  groupsForStep,
  resolveStepForField,
  type ProductFormStep,
} from '../lib/formLayout'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { PRODUCT_PRICE_TIERS, type ProductPriceTier } from '../lib/tiers'
import {
  VariantsEditor,
  buildProductVariantsPayload,
  readVariantRows,
  type ProductVariantRowValues,
} from './VariantsEditor'

/**
 * This file owns the product contract shared with the list surface: the record shape, its
 * payload mapper, the lookup loaders and the price-row vocabulary. Keeping them here means the
 * table cell and the form field cannot drift apart — the same reason `SupplierForm` owns
 * `toSupplierFormValues`.
 *
 * Prices are deliberately *not* part of the product payload: `/api/products/items` stores the
 * header, while `/api/products/prices` owns a product's whole price set (a row absent from the
 * submission is deactivated, never deleted, so a contract snapshot can still explain itself).
 *
 * Variants are the opposite case and go **with** the item payload: a SKU has no meaning without its
 * product, so the item command writes both in one transaction and one lock, and a row missing from
 * the submission is soft-deleted (its code stays reserved).
 */

export const PRODUCTS_API_PATH = 'products/items'
export const PRODUCTS_PRICES_API_PATH = 'products/prices'
export const PRODUCTS_TYPES_API_PATH = 'products/types'
export const PRODUCTS_CATEGORIES_API_PATH = 'products/categories'
export const PRODUCTS_LIST_HREF = '/backend/products/items'

const CURRENCY_DICTIONARY_URL = '/api/currency_policy/currencies'
/** Pickers only need the selectable rows, not a page of them; 200 is the API's page cap. */
export const OPTION_PAGE_SIZE = 200

/** The installed catalog's own list bound; a larger `pageSize` is answered with a 400. */
const CATALOG_OPTION_PAGE_SIZE = 50

export const PRODUCT_STATUSES = ['active', 'inactive'] as const
export type ProductStatus = (typeof PRODUCT_STATUSES)[number]

const PRICE_TIER_LABEL_KEYS: Record<ProductPriceTier, string> = {
  purchase: 'products.priceTier.purchase',
  internal: 'products.priceTier.internal',
  export: 'products.priceTier.export',
}

export function productPriceTierLabel(t: TranslateFn, tier: ProductPriceTier): string {
  return t(PRICE_TIER_LABEL_KEYS[tier])
}

function isPriceTier(value: unknown): value is ProductPriceTier {
  return typeof value === 'string' && (PRODUCT_PRICE_TIERS as readonly string[]).includes(value)
}

/** A measurement triple the operator types; blank parts mean "unset" and are dropped on save. */
export type ProductDimensions = {
  length: string
  width: string
  height: string
  unit: string
}

/**
 * One price row in the form. `key` keeps React anchored to a row while rows are added and
 * removed; it is never submitted — the price endpoint upserts on the natural key
 * `(tier, currency, min quantity)`.
 */
export type ProductPriceRowValues = {
  key: string
  priceTier: ProductPriceTier
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
  typeId: string
  categoryId: string
  specSummary: string
  barcode: string
  unit: string
  status: ProductStatus
  notes: string
  hsCode: string
  cnCode: string
  countryOfOriginCode: string
  netWeight: string
  grossWeight: string
  dimensions: ProductDimensions | null
  /** CrudForm's number field yields a number once edited, the raw string while untouched. */
  cartonQuantity: number | string
  cartonDimensions: ProductDimensions | null
  cartonGrossWeight: string
  cartonNetWeight: string
  containsLithiumBattery: boolean
  batteryCapacityMah: number | string
  batteryWh: string
  /** One certification per line in the textarea; blank lines are dropped before submit. */
  certifications: string
  /**
   * Optional link to the installed catalog product.
   *
   * Not decoration: the shipment receive path books stock at *variant* level and resolves that
   * variant through the catalog, so a product without this link can be ordered but not shipped or
   * received (the allocation command says so). Editable from step 2.
   */
  catalogProductId: string
  /** Edited by its own group component and submitted to the prices endpoint, not the item one. */
  prices: ProductPriceRowValues[]
  /**
   * The product's SKUs. Unlike the price rows these travel **with** the item payload: a variant has no
   * meaning outside its product, so the item command writes both in one transaction, one lock and one
   * audit entry. The submitted set is the new truth — a row the operator removed is soft-deleted.
   */
  variants: ProductVariantRowValues[]
  /**
   * Carries the optimistic-lock version into `CrudForm`, which auto-derives the
   * expected-version header from `initialValues.updatedAt` for update.
   */
  updatedAt?: string | null
}

/** Product as returned by `/api/products/items`; `id` is always present on a persisted row. */
export type ProductRecord = Omit<ProductFormValues, 'id'> & { id: string }

export type ProductLookupOption = { id: string; label: string }

const EMPTY_PRODUCT_VALUES: ProductFormValues = {
  sku: '',
  name: '',
  nameEn: '',
  brand: 'Petkit',
  series: '',
  manufacturerModel: '',
  typeId: '',
  categoryId: '',
  specSummary: '',
  barcode: '',
  unit: 'PCS',
  status: 'active',
  notes: '',
  hsCode: '',
  cnCode: '',
  countryOfOriginCode: '',
  netWeight: '',
  grossWeight: '',
  dimensions: null,
  cartonQuantity: '',
  cartonDimensions: null,
  cartonGrossWeight: '',
  cartonNetWeight: '',
  containsLithiumBattery: false,
  batteryCapacityMah: '',
  batteryWh: '',
  certifications: '',
  catalogProductId: '',
  prices: [],
  variants: [],
}

/**
 * API rows are objects by contract; anything else is treated as "no data" instead of being read
 * blindly. The cast only re-types a value whose shape was just checked — it is not a shortcut
 * around a missing check.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/** HTTP status of a failed API call, when the thrown error carries one. */
function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('status' in error)) return null
  const status = error.status
  return typeof status === 'number' ? status : null
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

function readDimensions(raw: unknown): ProductDimensions | null {
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
 * `null` clears the column: the validator drops blank parts and collapses an all-blank object
 * to `null`, so "not set" can never be read as the previous value.
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

function readPriceRows(value: unknown): ProductPriceRowValues[] {
  if (!Array.isArray(value)) return []
  return value.flatMap<ProductPriceRowValues>((entry) => {
    const row = asRecord(entry)
    if (!row) return []
    return [{
      key: typeof row.key === 'string' && row.key.length ? row.key : newPriceRowKey(),
      priceTier: isPriceTier(row.priceTier) ? row.priceTier : 'purchase',
      currencyCode: readText(row, 'currencyCode', 'currency_code'),
      minQuantity: readNumberText(row, 'minQuantity', 'min_quantity') || '1',
      unitPrice: readText(row, 'unitPrice', 'unit_price'),
      startsAt: readText(row, 'startsAt', 'starts_at'),
      endsAt: readText(row, 'endsAt', 'ends_at'),
      isActive: row.isActive !== false,
    }]
  })
}

/**
 * Maps a list/record payload into the form's initial values.
 *
 * Exported as a pure function so the optimistic-lock wiring stays testable: `CrudForm`
 * auto-derives the expected-version header from `initialValues.updatedAt`, so dropping
 * `updatedAt` here silently disables optimistic locking for the edit form.
 */
export function toProductFormValues(item: Record<string, unknown>): ProductRecord {
  const updatedAt = item.updatedAt ?? item.updated_at
  const status = item.status
  return {
    id: readText(item, 'id'),
    sku: readText(item, 'sku'),
    name: readText(item, 'name'),
    nameEn: readText(item, 'nameEn', 'name_en'),
    brand: readText(item, 'brand') || 'Petkit',
    series: readText(item, 'series'),
    manufacturerModel: readText(item, 'manufacturerModel', 'manufacturer_model'),
    typeId: readText(item, 'typeId', 'type_id'),
    categoryId: readText(item, 'categoryId', 'category_id'),
    specSummary: readText(item, 'specSummary', 'spec_summary'),
    catalogProductId: readText(item, 'catalogProductId', 'catalog_product_id'),
    barcode: readText(item, 'barcode'),
    unit: readText(item, 'unit') || 'PCS',
    status: status === 'inactive' ? 'inactive' : 'active',
    notes: readText(item, 'notes'),
    hsCode: readText(item, 'hsCode', 'hs_code'),
    cnCode: readText(item, 'cnCode', 'cn_code'),
    countryOfOriginCode: readText(item, 'countryOfOriginCode', 'country_of_origin_code'),
    netWeight: readNumberText(item, 'netWeight', 'net_weight'),
    grossWeight: readNumberText(item, 'grossWeight', 'gross_weight'),
    dimensions: readDimensions(item.dimensions),
    cartonQuantity: readNumberText(item, 'cartonQuantity', 'carton_quantity'),
    cartonDimensions: readDimensions(item.cartonDimensions ?? item.carton_dimensions),
    cartonGrossWeight: readNumberText(item, 'cartonGrossWeight', 'carton_gross_weight'),
    cartonNetWeight: readNumberText(item, 'cartonNetWeight', 'carton_net_weight'),
    batteryCapacityMah: readNumberText(item, 'batteryCapacityMah', 'battery_capacity_mah'),
    batteryWh: readNumberText(item, 'batteryWh', 'battery_wh'),
    containsLithiumBattery: item.containsLithiumBattery === true,
    certifications: Array.isArray(item.certifications)
      ? item.certifications.map((entry) => String(entry)).filter((entry) => entry.length > 0).join('\n')
      : '',
    prices: [],
    // The detail read is the only source of variants: the list projection stays a single-table page,
    // so a product's SKUs are read where the form can show them.
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
    brand: values.brand.trim() || 'Petkit',
    series: toOptionalText(values.series),
    manufacturerModel: toOptionalText(values.manufacturerModel),
    typeId: toOptionalText(values.typeId),
    categoryId: toOptionalText(values.categoryId),
    specSummary: toOptionalText(values.specSummary),
    barcode: toOptionalText(values.barcode),
    unit: values.unit.trim() || 'PCS',
    status: values.status,
    notes: toOptionalText(values.notes),
    hsCode: toOptionalText(values.hsCode),
    cnCode: toOptionalText(values.cnCode),
    countryOfOriginCode: toOptionalText(values.countryOfOriginCode),
    netWeight: toOptionalText(values.netWeight),
    grossWeight: toOptionalText(values.grossWeight),
    dimensions: buildProductDimensionsPayload(values.dimensions),
    cartonQuantity: toOptionalInteger(values.cartonQuantity),
    cartonDimensions: buildProductDimensionsPayload(values.cartonDimensions),
    cartonGrossWeight: toOptionalText(values.cartonGrossWeight),
    cartonNetWeight: toOptionalText(values.cartonNetWeight),
    batteryCapacityMah: toOptionalInteger(values.batteryCapacityMah),
    batteryWh: toOptionalText(values.batteryWh),
    containsLithiumBattery: values.containsLithiumBattery === true,
    certifications: toCertificationsPayload(values.certifications),
    variants: buildProductVariantsPayload(values.variants),
    // Sent as null when cleared: the link is optional, and clearing it must remove the reference
    // instead of leaving the previous one in place.
    catalogProductId: toOptionalText(values.catalogProductId),
  }
}

let fallbackRowSequence = 0

function newPriceRowKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  fallbackRowSequence += 1
  return `price-${Date.now()}-${fallbackRowSequence}`
}

function createEmptyPriceRow(): ProductPriceRowValues {
  return {
    key: newPriceRowKey(),
    priceTier: 'purchase',
    currencyCode: '',
    minQuantity: '1',
    unitPrice: '',
    startsAt: '',
    endsAt: '',
    isActive: true,
  }
}

export function toProductPriceRowValues(item: Record<string, unknown>): ProductPriceRowValues {
  return {
    key: newPriceRowKey(),
    priceTier: isPriceTier(item.priceTier) ? item.priceTier : 'purchase',
    currencyCode: readText(item, 'currencyCode', 'currency_code'),
    minQuantity: readNumberText(item, 'minQuantity', 'min_quantity') || '1',
    unitPrice: readText(item, 'unitPrice', 'unit_price'),
    startsAt: readText(item, 'startsAt', 'starts_at'),
    endsAt: readText(item, 'endsAt', 'ends_at'),
    isActive: item.isActive !== false,
  }
}

/**
 * Submits the complete price set.
 *
 * Rows the operator added but never priced are dropped instead of sent: the API rejects a blank
 * `unitPrice`, and dropping the row costs nothing because it has no key to upsert against. A
 * previously saved row that is absent from this payload is deactivated server-side, which is the
 * intended meaning of "removed from the price list" (a deleted row would orphan contract history).
 */
export function buildProductPriceRowsPayload(rows: ProductPriceRowValues[]): Array<Record<string, unknown>> {
  return rows
    .filter((row) => row.unitPrice.trim().length > 0)
    .map((row) => ({
      priceTier: row.priceTier,
      currencyCode: row.currencyCode.trim().toUpperCase(),
      minQuantity: toOptionalInteger(row.minQuantity) ?? 1,
      unitPrice: row.unitPrice.trim(),
      startsAt: toOptionalText(row.startsAt),
      endsAt: toOptionalText(row.endsAt),
      isActive: row.isActive === true,
    }))
}

/** Type rows the product form may reference: `CODE — name`, or whatever part exists. */
export function productTypeOption(item: Record<string, unknown>): ProductLookupOption | null {
  const id = readText(item, 'id')
  if (!id) return null
  const code = readText(item, 'code')
  const name = readText(item, 'name')
  const label = code && name ? `${code} — ${name}` : code || name
  return { id, label: label || id }
}

export function buildProductTypeOptions(items: Array<Record<string, unknown>>): ProductLookupOption[] {
  return items
    .map(productTypeOption)
    .filter((option): option is ProductLookupOption => option !== null)
}

/**
 * Display path per category id, assembled from the sibling rows the caller already holds.
 *
 * `/api/products/categories` sends `treePath` as ancestor **ids** and the names as separate rows,
 * so the label is a join over this map: a category row alone cannot spell its own path.
 */
export function buildProductCategoryLabels(items: Array<Record<string, unknown>>): Map<string, string> {
  const names = new Map<string, string>()
  for (const item of items) {
    const id = readText(item, 'id')
    if (!id) continue
    names.set(id, readText(item, 'name') || readText(item, 'nameEn', 'name_en') || readText(item, 'code') || id)
  }
  const labels = new Map<string, string>()
  for (const item of items) {
    const id = readText(item, 'id')
    if (!id) continue
    const rawAncestors = item.ancestorIds ?? item.ancestor_ids
    const ancestors = Array.isArray(rawAncestors)
      ? rawAncestors
          .map((entry) => names.get(String(entry)))
          .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      : []
    labels.set(id, [...ancestors, names.get(id) ?? id].join(' / '))
  }
  return labels
}

export function buildProductCategoryOptions(items: Array<Record<string, unknown>>): ProductLookupOption[] {
  const labels = buildProductCategoryLabels(items)
  return items.flatMap<ProductLookupOption>((item) => {
    const id = readText(item, 'id')
    if (!id) return []
    return [{ id, label: labels.get(id) ?? id }]
  })
}

/**
 * Only active types are offered: a retired type must not be assignable to a new product, which is
 * exactly what "停用后不再出现在产品表单的选择器中" promises.
 */
async function loadProductTypeOptions(errorMessage: string, organizationId?: string | null): Promise<CrudFieldOption[]> {
  const scope = organizationId ? `&organizationId=${encodeURIComponent(organizationId)}` : ''
  const payload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
    `/api/${PRODUCTS_TYPES_API_PATH}?pageSize=${OPTION_PAGE_SIZE}&isActive=true${scope}`,
    undefined,
    { fallback: { items: [] }, errorMessage },
  )
  return buildProductTypeOptions(payload.items ?? []).map((option) => ({ value: option.id, label: option.label }))
}

/**
 * Categories are left unfiltered so a product bound to a retired category still shows its path.
 *
 * The list is narrowed to the selected organization, though: a product may only reference its own
 * organization's category (the write command rejects another organization's row even when the
 * caller can see it), so offering a subsidiary's category here would only produce a 400 later.
 */
async function loadProductCategoryOptions(errorMessage: string, organizationId?: string | null): Promise<CrudFieldOption[]> {
  const scope = organizationId ? `&organizationId=${encodeURIComponent(organizationId)}` : ''
  const payload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
    `/api/${PRODUCTS_CATEGORIES_API_PATH}?pageSize=${OPTION_PAGE_SIZE}${scope}`,
    undefined,
    { fallback: { items: [] }, errorMessage },
  )
  return buildProductCategoryOptions(payload.items ?? []).map((option) => ({ value: option.id, label: option.label }))
}

/**
 * Options for the optional link to the installed catalog product.
 *
 * Read-only and deliberately narrow: the products module owns its master, and this is only the
 * bridge the shipment receive path needs to resolve a variant. The installed pages are hidden from
 * the admin, its list API stays available for exactly this picker.
 */
async function loadCatalogLinkOptions(errorMessage: string, query?: string): Promise<CrudFieldOption[]> {
  // The installed catalog's list caps `pageSize` at 100 and rejects anything larger with a 400, so
  // this picker uses its own bound instead of the module's wider option page size.
  const params = new URLSearchParams({ page: '1', pageSize: String(CATALOG_OPTION_PAGE_SIZE) })
  const search = typeof query === 'string' ? query.trim() : ''
  if (search.length > 0) params.set('search', search)
  const payload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
    `/api/catalog/products?${params.toString()}`,
    undefined,
    { fallback: { items: [] }, errorMessage },
  )
  return (payload.items ?? []).flatMap((item) => {
    const value = readText(item, 'id')
    if (!value) return []
    const title = readText(item, 'title', 'name')
    const sku = readText(item, 'sku')
    return [{ value, label: sku && title ? `${sku} — ${title}` : sku || title || value }]
  })
}

/** Searchable picker for the catalog link, with the consequence of leaving it empty spelled out. */
function CatalogLinkField({ value, onChange, t }: { value: string; onChange: (next: string) => void; t: TranslateFn }) {
  return (
    <div className="space-y-1.5">
      <FieldLabel htmlFor="product-catalog-link">{t('products.items.form.field.catalogProductId')}</FieldLabel>
      <ComboboxInput
        value={value}
        onChange={onChange}
        placeholder={t('products.items.form.field.catalogProductIdPlaceholder')}
        loadSuggestions={(query) =>
          loadCatalogLinkOptions(t('products.items.form.catalogLinkLoadFailed'), query)
        }
        allowCustomValues={false}
        clearable
        clearLabel={t('products.items.form.field.catalogProductIdClear')}
      />
      <p className="text-xs text-muted-foreground">{t('products.items.form.field.catalogProductIdHelp')}</p>
    </div>
  )
}

/**
 * Currency options come from the seeded dictionary — the same store every platform currency
 * picker reads — so a price row can only be quoted in a code the command layer accepts.
 */
async function loadCurrencyOptions(errorMessage: string): Promise<CrudFieldOption[]> {
  const payload = await readApiResultOrThrow<{ entries?: Array<{ value?: string; label?: string }> }>(
    CURRENCY_DICTIONARY_URL,
    undefined,
    { errorMessage },
  )
  return (payload.entries ?? [])
    .map((entry) => {
      const value = typeof entry.value === 'string' ? entry.value.trim().toUpperCase() : ''
      if (!value) return null
      const label = typeof entry.label === 'string' && entry.label.trim().length ? entry.label.trim() : value
      return { value, label: `${value} — ${label}` }
    })
    .filter((option): option is CrudFieldOption => option !== null)
    .sort((left, right) => left.value.localeCompare(right.value))
}

/**
 * Four inputs writing one `{length,width,height,unit}` object.
 *
 * It is a bare group (no group chrome) so the measurement editor sits *between* the scalar
 * packaging fields instead of after them — `CrudForm` renders a group's own component before its
 * fields, so an inline custom field could not hold that position.
 */
function ProductDimensionsEditor({
  fieldId,
  label,
  values,
  setValue,
  t,
}: CrudFormGroupComponentProps & { fieldId: string; label: string; t: TranslateFn }) {
  const current: ProductDimensions = React.useMemo(
    () => readDimensions(values[fieldId]) ?? { length: '', width: '', height: '', unit: '' },
    [fieldId, values],
  )

  const updatePart = React.useCallback(
    (part: keyof ProductDimensions, value: string) => {
      const next: ProductDimensions = { ...current }
      next[part] = value
      return next
    },
    [current],
  )

  const inputId = (part: string) => `product-${fieldId}-${part}`
  const fields: Array<{ part: keyof ProductDimensions; label: string; maxLength?: number }> = [
    { part: 'length', label: t('products.items.form.field.length') },
    { part: 'width', label: t('products.items.form.field.width') },
    { part: 'height', label: t('products.items.form.field.height') },
    { part: 'unit', label: t('products.items.form.field.dimensionUnit'), maxLength: 16 },
  ]

  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-sm font-medium">{label}</p>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        {fields.map((field) => (
          <div key={field.part} className="space-y-1.5">
            <FieldLabel htmlFor={inputId(field.part)}>{field.label}</FieldLabel>
            <Input
              id={inputId(field.part)}
              value={current[field.part]}
              maxLength={field.maxLength}
              inputMode={field.maxLength ? undefined : 'decimal'}
              onChange={(event) => setValue(fieldId, updatePart(field.part, event.target.value))}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function useCurrencyOptions(t: TranslateFn): CrudFieldOption[] {
  const [options, setOptions] = React.useState<CrudFieldOption[]>([])
  React.useEffect(() => {
    let cancelled = false
    loadCurrencyOptions(t('products.items.form.priceLoadFailed'))
      .then((next) => {
        if (!cancelled) setOptions(next)
      })
      .catch(() => {
        if (!cancelled) flash(t('products.items.form.priceLoadFailed'), 'error')
      })
    return () => {
      cancelled = true
    }
  }, [t])
  return options
}

/**
 * The server reports price problems against a nested path (`rows.0.unitPrice`), so the section
 * surfaces the first error it owns instead of only an exact `prices` key.
 */
function firstPriceRowError(errors: Record<string, string>): string | null {
  const key = Object.keys(errors).find(
    (candidate) =>
      candidate === 'prices' ||
      candidate === 'rows' ||
      candidate.startsWith('prices.') ||
      candidate.startsWith('rows.'),
  )
  return key ? errors[key] ?? null : null
}

/**
 * The product's whole price list: three tiers (purchase / internal / export) quoted per currency
 * and minimum quantity.
 *
 * Rows are the form's `prices` value, so a save failure keeps whatever the operator typed and a
 * retry only has to press save again.
 */
function ProductPriceRowsEditor({ values, setValue, errors, t }: CrudFormGroupComponentProps & { t: TranslateFn }) {
  const rows = readPriceRows(values.prices)
  const dictionaryOptions = useCurrencyOptions(t)
  const error = firstPriceRowError(errors)

  // A currency already on a row survives even when the dictionary does not offer it (an old quote
  // in a retired code), so opening a record can never silently blank its currency.
  const currencyOptions = React.useMemo<CrudFieldOption[]>(() => {
    const merged = new Map<string, CrudFieldOption>(
      dictionaryOptions.map((option): [string, CrudFieldOption] => [option.value, option]),
    )
    for (const row of rows) {
      const code = row.currencyCode.trim().toUpperCase()
      if (code && !merged.has(code)) merged.set(code, { value: code, label: code })
    }
    return [...merged.values()].sort((left, right) => left.value.localeCompare(right.value))
  }, [dictionaryOptions, rows])

  const tierOptions = React.useMemo<CrudFieldOption[]>(
    () => PRODUCT_PRICE_TIERS.map((tier) => ({ value: tier, label: productPriceTierLabel(t, tier) })),
    [t],
  )

  const updateRow = React.useCallback(
    (index: number, patch: Partial<ProductPriceRowValues>) => {
      setValue('prices', rows.map((row, position) => (position === index ? { ...row, ...patch } : row)))
    },
    [rows, setValue],
  )

  const removeRow = React.useCallback(
    (index: number) => {
      setValue('prices', rows.filter((_, position) => position !== index))
    },
    [rows, setValue],
  )

  const addRow = React.useCallback(() => {
    setValue('prices', [...rows, createEmptyPriceRow()])
  }, [rows, setValue])

  return (
    <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-sm font-medium">{t('products.items.form.group.prices')}</h3>
        <Button type="button" variant="outline" onClick={addRow}>
          <Plus className="size-4" aria-hidden="true" />
          {t('products.items.form.priceAdd')}
        </Button>
      </div>

      {error ? <p className="text-xs text-status-error-text" role="alert">{error}</p> : null}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('products.items.form.priceEmpty')}</p>
      ) : null}

      {rows.map((row, index) => {
        const fieldId = (suffix: string) => `product-price-${row.key}-${suffix}`
        const tierId = fieldId('tier')
        const currencyId = fieldId('currency')
        const minQuantityId = fieldId('minQuantity')
        const unitPriceId = fieldId('unitPrice')
        const startsAtId = fieldId('startsAt')
        const endsAtId = fieldId('endsAt')

        return (
          <div key={row.key} className="rounded-md border bg-background p-3">
            <div className="mb-2 flex items-center justify-between gap-4">
              <p className="text-xs font-medium text-muted-foreground">
                {`${t('products.items.form.priceTitle')} ${index + 1}`}
              </p>
              <IconButton
                type="button"
                variant="ghost"
                size="lg"
                aria-label={t('products.items.form.priceRemove')}
                onClick={() => removeRow(index)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <div className="space-y-1.5 md:col-span-3">
                <FieldLabel htmlFor={tierId} required>
                  {t('products.items.form.priceTier')}
                </FieldLabel>
                <Select
                  value={row.priceTier}
                  onValueChange={(next) => updateRow(index, { priceTier: isPriceTier(next) ? next : 'purchase' })}
                >
                  <SelectTrigger id={tierId} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {tierOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 md:col-span-3">
                <FieldLabel htmlFor={currencyId} required>
                  {t('products.items.form.priceCurrency')}
                </FieldLabel>
                <Select
                  value={row.currencyCode.trim().toUpperCase() || undefined}
                  onValueChange={(next) => updateRow(index, { currencyCode: next })}
                >
                  <SelectTrigger id={currencyId} className="w-full">
                    <SelectValue placeholder={t('products.items.form.priceCurrency')} />
                  </SelectTrigger>
                  <SelectContent>
                    {currencyOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <FieldLabel htmlFor={minQuantityId}>{t('products.items.form.priceMinQuantity')}</FieldLabel>
                <Input
                  id={minQuantityId}
                  type="number"
                  min="1"
                  step="1"
                  value={row.minQuantity}
                  onChange={(event) => updateRow(index, { minQuantity: event.target.value })}
                />
              </div>
              <div className="space-y-1.5 md:col-span-4">
                <FieldLabel htmlFor={unitPriceId} required>
                  {t('products.items.form.priceUnitPrice')}
                </FieldLabel>
                <Input
                  id={unitPriceId}
                  inputMode="decimal"
                  value={row.unitPrice}
                  onChange={(event) => updateRow(index, { unitPrice: event.target.value })}
                />
              </div>
              <div className="space-y-1.5 md:col-span-4">
                <FieldLabel htmlFor={startsAtId}>{t('products.items.form.priceStartsAt')}</FieldLabel>
                <Input
                  id={startsAtId}
                  type="date"
                  value={row.startsAt}
                  onChange={(event) => updateRow(index, { startsAt: event.target.value })}
                />
              </div>
              <div className="space-y-1.5 md:col-span-4">
                <FieldLabel htmlFor={endsAtId}>{t('products.items.form.priceEndsAt')}</FieldLabel>
                <Input
                  id={endsAtId}
                  type="date"
                  value={row.endsAt}
                  onChange={(event) => updateRow(index, { endsAt: event.target.value })}
                />
              </div>
              <div className="flex items-end md:col-span-4">
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={row.isActive}
                    onCheckedChange={(next) => updateRow(index, { isActive: next === true })}
                  />
                  {t('products.items.form.priceIsActive')}
                </label>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Group titles are passed as i18n keys: `CrudForm` renders them through `t(title, title)`, which
 * resolves a key or keeps the literal text.
 */
function useProductGroups(t: TranslateFn): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'details',
      column: 1,
      title: 'products.items.form.group.details',
      fields: [
        'sku',
        'name',
        'nameEn',
        'brand',
        'series',
        'manufacturerModel',
        'typeId',
        'categoryId',
        'specSummary',
        'barcode',
        'unit',
        'status',
        'notes',
      ],
    },
    {
      id: 'packaging',
      column: 2,
      title: 'products.items.form.group.packaging',
      fields: ['hsCode', 'cnCode', 'countryOfOriginCode', 'netWeight', 'grossWeight'],
    },
    {
      id: 'dimensions',
      column: 2,
      bare: true,
      component: (context) => (
        <ProductDimensionsEditor
          {...context}
          fieldId="dimensions"
          label={t('products.items.form.field.dimensions')}
          t={t}
        />
      ),
    },
    {
      id: 'packagingCarton',
      column: 2,
      fields: ['cartonQuantity'],
    },
    {
      id: 'cartonDimensions',
      column: 2,
      bare: true,
      component: (context) => (
        <ProductDimensionsEditor
          {...context}
          fieldId="cartonDimensions"
          label={t('products.items.form.field.cartonDimensions')}
          t={t}
        />
      ),
    },
    {
      id: 'packagingCartonTail',
      column: 2,
      fields: ['cartonGrossWeight', 'cartonNetWeight'],
    },
    {
      id: 'catalogLink',
      column: 2,
      bare: true,
      component: (context) => (
        <CatalogLinkField
          value={typeof context.values.catalogProductId === 'string' ? context.values.catalogProductId : ''}
          onChange={(next) => context.setValue('catalogProductId', next)}
          t={t}
        />
      ),
    },
    {
      id: 'battery',
      column: 2,
      title: 'products.items.form.group.battery',
      fields: ['containsLithiumBattery', 'batteryCapacityMah', 'batteryWh', 'certifications'],
    },
    {
      id: 'prices',
      column: 1,
      bare: true,
      component: (context) => <ProductPriceRowsEditor {...context} t={t} />,
    },
    {
      id: 'variants',
      column: 1,
      fields: ['variants'],
    },
  ], [t])
}

/**
 * Step switcher for the product form.
 *
 * Plain buttons rather than a platform stepper: `CrudForm` owns one submit for the whole record, so
 * the steps only decide which groups are rendered — nothing is saved step by step, and switching
 * back and forth never loses input.
 */
function ProductFormSteps({
  step,
  onStepChange,
  t,
}: {
  step: ProductFormStep
  onStepChange: (next: ProductFormStep) => void
  t: TranslateFn
}) {
  const index = PRODUCT_FORM_STEPS.indexOf(step)
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label={t('products.items.form.step.label')}>
      {PRODUCT_FORM_STEPS.map((candidate, position) => (
        <Button
          key={candidate}
          type="button"
          variant={candidate === step ? 'default' : 'outline'}
          aria-current={candidate === step ? 'step' : undefined}
          onClick={() => onStepChange(candidate)}
        >
          {t(PRODUCT_FORM_STEP_TITLE_KEYS[candidate])}
        </Button>
      ))}
      <span className="text-xs text-muted-foreground">
        {`${index + 1}/${PRODUCT_FORM_STEPS.length}`} {t('products.items.form.step.hint')}
      </span>
    </div>
  )
}

/**
 * Reveals the step that owns a server-side validation failure and returns the message to flash.
 *
 * Without this the operator would submit from step 1 and get "保存失败" while the offending field sits
 * on a step they cannot see.
 */
function revealInvalidStep(
  error: unknown,
  setStep: (next: ProductFormStep) => void,
  t: TranslateFn,
): string {
  const field = firstInvalidField(error)
  const step = field ? resolveStepForField(field) : null
  if (step) setStep(step)
  return firstValidationMessage(error) ?? t('products.items.form.saveFailed')
}

function useProductsFields(t: TranslateFn): CrudField[] {
  // Pickers are narrowed to the organization the operator is working in; the list page keeps the
  // wider (descendant-inclusive) visibility because reading a subsidiary's product is allowed.
  const { organizationId } = useOrganizationScopeDetail()
  return React.useMemo<CrudField[]>(() => [
    {
      id: 'sku',
      label: t('products.items.form.field.sku'),
      type: 'text',
      required: true,
      layout: 'half',
    },
    {
      id: 'name',
      label: t('products.items.form.field.name'),
      type: 'text',
      required: true,
    },
    {
      id: 'nameEn',
      label: t('products.items.form.field.nameEn'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'brand',
      label: t('products.items.form.field.brand'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'series',
      label: t('products.items.form.field.series'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'manufacturerModel',
      label: t('products.items.form.field.manufacturerModel'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'typeId',
      label: t('products.items.form.field.type'),
      type: 'select',
      placeholder: t('products.items.form.selectType'),
      loadOptions: () => loadProductTypeOptions(t('products.items.form.typeLoadFailed'), organizationId),
    },
    {
      id: 'categoryId',
      label: t('products.items.form.field.category'),
      type: 'select',
      placeholder: t('products.items.form.selectCategory'),
      loadOptions: () => loadProductCategoryOptions(t('products.items.form.categoryLoadFailed'), organizationId),
    },
    {
      id: 'specSummary',
      label: t('products.items.form.field.specSummary'),
      type: 'text',
      description: t('products.items.form.field.specSummaryHelp'),
    },
    {
      id: 'barcode',
      label: t('products.items.form.field.barcode'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'unit',
      label: t('products.items.form.field.unit'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'status',
      label: t('products.items.form.field.status'),
      type: 'select',
      required: true,
      layout: 'half',
      options: [
        { value: 'active', label: t('products.items.list.status.active') },
        { value: 'inactive', label: t('products.items.list.status.inactive') },
      ],
    },
    {
      id: 'notes',
      label: t('products.items.form.field.notes'),
      type: 'textarea',
    },
    {
      id: 'hsCode',
      label: t('products.items.form.field.hsCode'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'cnCode',
      label: t('products.items.form.field.cnCode'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'countryOfOriginCode',
      label: t('products.items.form.field.countryOfOriginCode'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'netWeight',
      label: t('products.items.form.field.netWeight'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'grossWeight',
      label: t('products.items.form.field.grossWeight'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'cartonQuantity',
      label: t('products.items.form.field.cartonQuantity'),
      type: 'number',
      layout: 'half',
    },
    {
      id: 'cartonGrossWeight',
      label: t('products.items.form.field.cartonGrossWeight'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'cartonNetWeight',
      label: t('products.items.form.field.cartonNetWeight'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'containsLithiumBattery',
      label: t('products.items.form.field.containsLithiumBattery'),
      type: 'checkbox',
    },
    {
      id: 'batteryCapacityMah',
      label: t('products.items.form.field.batteryCapacityMah'),
      type: 'number',
      layout: 'half',
    },
    {
      id: 'batteryWh',
      label: t('products.items.form.field.batteryWh'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'certifications',
      label: t('products.items.form.field.certifications'),
      type: 'textarea',
      description: t('products.items.form.field.certificationsHelp'),
    },
    // A child grid, not a flat field: the step edits the product's whole SKU set at once, and the
    // command reads the submitted rows as the new truth.
    {
      id: 'variants',
      label: t('products.variants.title'),
      type: 'custom',
      component: VariantsEditor,
      description: t('products.variants.description'),
    },
  ], [t, organizationId])
}

/**
 * Writes a product's whole price set after the item itself was saved.
 *
 * The item is already persisted at this point, so a price failure is reported on its own key and
 * rethrown: the form keeps the operator's rows (nothing is cleared) and re-submitting retries both
 * writes — the item update is idempotent, the price submission is a full replacement.
 */
async function saveProductPrices(
  productId: string,
  rows: ProductPriceRowValues[],
  t: TranslateFn,
): Promise<void> {
  try {
    await updateCrud(PRODUCTS_PRICES_API_PATH, {
      productId,
      rows: buildProductPriceRowsPayload(rows),
    })
  } catch (priceError) {
    flash(t('products.items.form.priceSaveFailed'), 'error')
    throw priceError
  }
}

function ProductCreateForm() {
  const t = useT()
  const router = useRouter()
  const fields = useProductsFields(t)
  const allGroups = useProductGroups(t)
  const [step, setStep] = React.useState<ProductFormStep>('basics')
  const groups = React.useMemo(() => groupsForStep(allGroups, step), [allGroups, step])

  const handleSubmit = React.useCallback(async (values: ProductFormValues) => {
    let createdId: string | null = null
    try {
      const created = await createCrud<{ id?: string }>(PRODUCTS_API_PATH, buildProductPayload(values))
      createdId = typeof created.result?.id === 'string' ? created.result.id : null
    } catch (saveError) {
      flash(revealInvalidStep(saveError, setStep, t), 'error')
      throw saveError
    }
    if (!createdId) {
      // Without an id there is nothing to hang the price rows on, and reporting "saved" would be a
      // lie the operator cannot see through. The record is in the list; the message says as much.
      flash(t('products.items.form.saveFailed'), 'error')
      throw new Error(t('products.items.form.saveFailed'))
    }
    await saveProductPrices(createdId, values.prices, t)
    pushWithFlash(router, PRODUCTS_LIST_HREF, t('products.items.form.saved'), 'success')
  }, [router, t])

  return (
    <div>
      <ProductFormSteps step={step} onStepChange={setStep} t={t} />
      <CrudForm<ProductFormValues>
      title={t('products.items.form.createTitle')}
      titleHeadingLevel={1}
      backHref={PRODUCTS_LIST_HREF}
      fields={fields}
      groups={groups}
      initialValues={EMPTY_PRODUCT_VALUES}
      submitLabel={t('products.items.form.save')}
      cancelHref={PRODUCTS_LIST_HREF}
      onSubmit={handleSubmit}
      />
    </div>
  )
}

function ProductEditForm({ productId }: { productId: string }) {
  const t = useT()
  const router = useRouter()
  const fields = useProductsFields(t)
  const allGroups = useProductGroups(t)
  const [step, setStep] = React.useState<ProductFormStep>('basics')
  const groups = React.useMemo(() => groupsForStep(allGroups, step), [allGroups, step])
  const [initial, setInitial] = React.useState<ProductRecord | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setIsNotFound(false)
      try {
        // The detail read carries the product's SKUs; the list projection is a single-table page and
        // deliberately does not. Losing the variants hides the product's SKUs but not the product, so
        // the shape is the same as the price list below: one read per concern.
        const payload = await readApiResultOrThrow<{ item?: Record<string, unknown> }>(
          `/api/${PRODUCTS_API_PATH}/${encodeURIComponent(productId)}`,
          undefined,
          { errorMessage: t('products.items.form.loadFailed') },
        )
        const item = payload.item
        if (!item) {
          if (!cancelled) setIsNotFound(true)
          return
        }
        const values = toProductFormValues(item)
        // The price list is a separate read: losing it must not hide the product itself, so a
        // failure degrades to "no rows loaded" plus a message the operator can act on.
        let prices: ProductPriceRowValues[] = []
        try {
          const pricePayload = await fetchCrudList<Record<string, unknown>>(
            PRODUCTS_PRICES_API_PATH,
            { productId, pageSize: OPTION_PAGE_SIZE },
          )
          prices = (pricePayload.items ?? []).map(toProductPriceRowValues)
        } catch {
          if (!cancelled) flash(t('products.items.form.priceLoadFailed'), 'error')
        }
        if (!cancelled) setInitial({ ...values, prices })
      } catch (loadError: unknown) {
        if (!cancelled) {
          const status = errorStatus(loadError)
          if (status === 404) setIsNotFound(true)
          else if (status === 403) setError(t('products.common.notAuthorized'))
          else setError(t('products.items.form.loadFailed'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [productId, t])

  const fallbackInitialValues = React.useMemo<ProductFormValues>(
    () => ({ ...EMPTY_PRODUCT_VALUES, id: productId, updatedAt: null }),
    [productId],
  )

  const handleSubmit = React.useCallback(async (values: ProductFormValues) => {
    const id = initial?.id || productId
    try {
      await updateCrud(PRODUCTS_API_PATH, {
        id,
        ...buildProductPayload(values),
        updatedAt: initial?.updatedAt ?? null,
      })
    } catch (updateError) {
      flash(revealInvalidStep(updateError, setStep, t), 'error')
      throw updateError
    }
    try {
      await saveProductPrices(id, values.prices, t)
    } catch (priceError) {
      // The price grid is the last step; keep the operator there instead of dropping them back on
      // basics after a rejected row.
      setStep('prices')
      throw priceError
    }
    pushWithFlash(router, PRODUCTS_LIST_HREF, t('products.items.form.saved'), 'success')
  }, [initial, productId, router, t])

  if (isNotFound) {
    return (
      <RecordNotFoundState
        label={t('products.items.form.notFound')}
        backHref={PRODUCTS_LIST_HREF}
      />
    )
  }

  if (error) return <ErrorMessage label={error} />

  return (
    <div>
      <ProductFormSteps step={step} onStepChange={setStep} t={t} />
      <CrudForm<ProductFormValues>
      title={t('products.items.form.editTitle')}
      titleHeadingLevel={1}
      backHref={PRODUCTS_LIST_HREF}
      fields={fields}
      groups={groups}
      initialValues={initial ?? fallbackInitialValues}
      submitLabel={t('products.items.form.save')}
      cancelHref={PRODUCTS_LIST_HREF}
      isLoading={loading}
      onSubmit={handleSubmit}
      />
    </div>
  )
}

export default function ProductForm({ mode, productId }: { mode: 'create' | 'edit'; productId?: string }) {
  if (mode === 'edit') {
    if (!productId) return null
    return <ProductEditForm productId={productId} />
  }
  return <ProductCreateForm />
}
