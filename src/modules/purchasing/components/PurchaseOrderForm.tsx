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
import { ComboboxInput } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { pushWithFlash } from '@open-mercato/ui/backend/utils/flash'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { FieldLabel } from '@open-mercato/ui/primitives/label'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { formatDisplayDate, toUtcDateInputValue } from '@open-mercato/ui/primitives/date-format'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import {
  findOptionSnapshot,
  loadCustomerOptions,
  loadOwnerOptions,
  loadProductCategoryOptions,
  loadSupplierProductOptions,
} from './orderFormOptions'

export const ORDERS_API_PATH = 'purchasing/purchase-orders'
export const ORDERS_LINES_API_PATH = 'purchasing/purchase-orders/lines'
export const ORDERS_PAYMENTS_API_PATH = 'purchasing/purchase-orders/payments'
export const ORDERS_TRANSITIONS_API_PATH = 'purchasing/purchase-orders/transitions'
export const ORDERS_LIST_HREF = '/backend/purchasing/orders'

const SUPPLIERS_API_PATH = '/api/purchasing/suppliers'
const PRODUCTS_API_PATH = '/api/products/items'
const CURRENCY_DICTIONARY_URL = '/api/currency_policy/currencies'
const OPTION_PAGE_SIZE = 50

/**
 * This file owns the purchase-order contract shared with the list and detail surfaces:
 * the record shape and its payload mapper, the status vocabulary, the option loaders,
 * and the money/date renderers. Keeping them here (rather than in the two views) means
 * the table cell shown in the list and the value rendered on the detail page cannot
 * drift apart — the same reason `SupplierForm` owns `toSupplierFormValues`.
 * The header's three reference pickers load through `./orderFormOptions`.
 */

export const ORDER_STATUSES = ['draft', 'placed', 'shipped', 'received', 'closed', 'cancelled'] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

const ORDER_STATUS_MAP: StatusMap<OrderStatus> = {
  draft: 'neutral',
  placed: 'info',
  shipped: 'info',
  received: 'success',
  closed: 'success',
  cancelled: 'error',
}

const ORDER_STATUS_LABEL_KEYS: Record<OrderStatus, string> = {
  draft: 'purchasing.orders.status.draft',
  placed: 'purchasing.orders.status.placed',
  shipped: 'purchasing.orders.status.shipped',
  received: 'purchasing.orders.status.received',
  closed: 'purchasing.orders.status.closed',
  cancelled: 'purchasing.orders.status.cancelled',
}

export function orderStatusLabel(t: TranslateFn, status: OrderStatus): string {
  return t(ORDER_STATUS_LABEL_KEYS[status])
}

/** A purchase order as `/api/purchasing/purchase-orders` projects it. */
export type PurchaseOrderRecord = {
  id: string
  number: string | null
  /** The business's own order number (year-month-sequence); `number` stays the system one. */
  businessNumber: string | null
  supplierId: string
  supplierName: string | null
  /** Dictionary code of `order_product_category`. */
  productCategory: string | null
  ownerUserId: string | null
  ownerSnapshot: Record<string, unknown> | null
  /** Display name the list projection resolves from the snapshot; what the pages render. */
  ownerName: string | null
  customerId: string | null
  customerSnapshot: Record<string, unknown> | null
  customerName: string | null
  status: OrderStatus
  currencyCode: string
  /** Stored as a fixed-scale decimal string; the form edits it as a number. */
  depositPercent: string | null
  depositAmount: string | null
  notes: string | null
  subtotal: string
  taxTotal: string
  total: string
  expectedShipAt: string | null
  placedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

function readText(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string') return value
  }
  return ''
}

function readOptionalText(source: Record<string, unknown>, ...keys: string[]): string | null {
  const value = readText(source, ...keys).trim()
  return value.length ? value : null
}

/**
 * The owner/customer display snapshots are jsonb columns, so their shape is whatever the client
 * froze onto the order — anything that is not an object (a stale row, a hand-written `null`) is
 * read as "no snapshot" rather than handed to a template that expects fields.
 */
function readOptionalRecord(source: Record<string, unknown>, ...keys: string[]): Record<string, unknown> | null {
  for (const key of keys) {
    const value = source[key]
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  }
  return null
}

export function toPurchaseOrderRecord(item: Record<string, unknown>): PurchaseOrderRecord {
  return {
    id: readText(item, 'id'),
    number: readOptionalText(item, 'number'),
    businessNumber: readOptionalText(item, 'businessNumber', 'business_number'),
    supplierId: readText(item, 'supplierId', 'supplier_id'),
    supplierName: readOptionalText(item, 'supplierName', 'supplier_name'),
    productCategory: readOptionalText(item, 'productCategory', 'product_category'),
    ownerUserId: readOptionalText(item, 'ownerUserId', 'owner_user_id'),
    ownerSnapshot: readOptionalRecord(item, 'ownerSnapshot', 'owner_snapshot'),
    ownerName: readOptionalText(item, 'ownerName', 'owner_name'),
    customerId: readOptionalText(item, 'customerId', 'customer_id'),
    customerSnapshot: readOptionalRecord(item, 'customerSnapshot', 'customer_snapshot'),
    customerName: readOptionalText(item, 'customerName', 'customer_name'),
    status: ORDER_STATUSES.includes(item.status as OrderStatus) ? (item.status as OrderStatus) : 'draft',
    currencyCode: readText(item, 'currencyCode', 'currency_code') || 'CNY',
    depositPercent: readOptionalText(item, 'depositPercent', 'deposit_percent'),
    depositAmount: readOptionalText(item, 'depositAmount', 'deposit_amount'),
    notes: readOptionalText(item, 'notes'),
    subtotal: readText(item, 'subtotal') || '0',
    taxTotal: readText(item, 'taxTotal', 'tax_total') || '0',
    total: readText(item, 'total') || '0',
    expectedShipAt: readOptionalText(item, 'expectedShipAt', 'expected_ship_at'),
    placedAt: readOptionalText(item, 'placedAt', 'placed_at'),
    createdAt: readOptionalText(item, 'createdAt', 'created_at'),
    updatedAt: readOptionalText(item, 'updatedAt', 'updated_at'),
  }
}

/**
 * Drops the trailing zeros a fixed-scale decimal column adds (`10.0000` → `10`) without
 * re-reading the digits through a float, so a unit price of `12.3456` keeps all four.
 */
export function trimDecimalZeros(value: string): string {
  const trimmedText = value.trim()
  if (!trimmedText.includes('.')) return trimmedText
  const stripped = trimmedText.replace(/0+$/, '').replace(/\.$/, '')
  if (!stripped.length || stripped === '-0') return '0'
  return stripped
}

/** Renders a stored decimal (or a value derived from stored decimals) as a currency amount. */
export function formatMoney(value: string | number, currencyCode: string, locale?: string): string {
  const numeric = typeof value === 'number' ? value : Number(value)
  const code = currencyCode.trim().toUpperCase()
  if (!Number.isFinite(numeric)) return String(value)
  if (code.length !== 3) return numeric.toFixed(2)
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(numeric)
  } catch {
    return `${code} ${numeric.toFixed(2)}`
  }
}

/**
 * Date-only columns (`expected_ship_at`, `paid_at`) are written from a date input and stored as
 * UTC midnight, so their day must be read back in the frame it was written in — reading the
 * instant locally names the previous day west of UTC.
 */
export function formatOrderDate(value: string | null | undefined, locale?: string): string | null {
  const day = toUtcDateInputValue(value)
  return day ? formatDisplayDate(day, locale) : null
}

function optionFromSupplier(item: Record<string, unknown>): CrudFieldOption | null {
  const value = readText(item, 'id')
  if (!value) return null
  const name = readText(item, 'name')
  const code = readText(item, 'code')
  return { value, label: code && name ? `${code} — ${name}` : code || name || value }
}

/** Active suppliers, newest naming first; the label is `CODE — name`. */
export async function loadSupplierOptions(errorMessage: string, query?: string): Promise<CrudFieldOption[]> {
  const params = new URLSearchParams({
    page: '1',
    pageSize: String(OPTION_PAGE_SIZE),
    isActive: 'true',
  })
  const term = query?.trim()
  if (term) params.set('search', term)
  const payload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
    `${SUPPLIERS_API_PATH}?${params.toString()}`,
    undefined,
    { fallback: { items: [] }, errorMessage },
  )
  return (payload.items ?? [])
    .map(optionFromSupplier)
    .filter((option): option is CrudFieldOption => option !== null)
}

/**
 * Currency options come from the seeded dictionary — the same store every platform currency
 * picker reads — so the select can only offer codes the command layer accepts.
 */
export async function loadCurrencyOptions(errorMessage: string): Promise<CrudFieldOption[]> {
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

function optionFromOwnedProduct(item: Record<string, unknown>): CrudFieldOption | null {
  const value = readText(item, 'id')
  if (!value) return null
  const title = readText(item, 'name', 'title')
  const sku = readText(item, 'sku')
  const label = sku && title ? `${sku} — ${title}` : sku || title
  return { value, label: label || value }
}

/**
 * Products the current organization can buy, from the app-owned master.
 *
 * The order line references `products_products.id` (see
 * .ai/specs/2026-09-22-products-and-trade-docs.md); the installed catalog is no longer consulted
 * for new lines. `organizationId` narrows the list to the selected organization because the write
 * command resolves the product in that scope.
 */
export async function loadOwnedProductOptions(
  errorMessage: string,
  query?: string,
  organizationId?: string | null,
): Promise<CrudFieldOption[]> {
  const params = new URLSearchParams({ page: '1', pageSize: String(OPTION_PAGE_SIZE), status: 'active' })
  if (organizationId) params.set('organizationId', organizationId)
  const term = query?.trim()
  if (term) params.set('search', term)
  const payload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
    `${PRODUCTS_API_PATH}?${params.toString()}`,
    undefined,
    { fallback: { items: [] }, errorMessage },
  )
  return (payload.items ?? [])
    .map(optionFromOwnedProduct)
    .filter((option): option is CrudFieldOption => option !== null)
}

/**
 * One editable order line. `key` keeps React (and the picker's resolved label) anchored to a
 * line while lines are added and removed; `productLabel` only ever seeds the picker's display
 * for a product that is not on the first page of options, and is never submitted.
 *
 * A line is picked either from the product master or from the supplier's own library, and the two
 * references are never sent together. `supplierProductMode` remembers which picker the operator is
 * working in while nothing is chosen yet — an empty library reference is indistinguishable from an
 * empty master one — and is form-only: the payload carries ids, never the editing mode.
 */
export type PurchaseOrderLineValues = {
  key: string
  /** Reference to the app-owned product master (`products_products.id`). */
  productId: string
  /** Legacy reference kept only so an existing draft that carries one can still be saved. */
  catalogProductId: string
  /** Reference to a supplier product library row (`sourcing_supplier_products.id`). */
  supplierProductId: string
  /** True while this line is being picked from the supplier library instead of the master. */
  supplierProductMode: boolean
  productLabel: string
  quantity: string
  unitPrice: string
  taxRate: string
  priceIncludesTax: boolean
  note: string
}

export type PurchaseOrderFormValues = {
  /** The business's own order number; the system `number` is assigned when the order is placed. */
  businessNumber: string
  /** Dictionary code of `order_product_category`. */
  productCategory: string
  ownerUserId: string
  /** Frozen display snapshot of the picked purchaser, sent by the client (see handleSubmit). */
  ownerSnapshot: Record<string, unknown> | null
  customerId: string
  /** Frozen display snapshot of the picked customer, sent by the client (see handleSubmit). */
  customerSnapshot: Record<string, unknown> | null
  supplierId: string
  currencyCode: string
  /** CrudForm's number field yields a number once edited, the raw string while untouched. */
  depositPercent: number | string
  depositAmount: number | string
  expectedShipAt: string
  notes: string
  lines: PurchaseOrderLineValues[]
}

export const EMPTY_ORDER_VALUES: PurchaseOrderFormValues = {
  businessNumber: '',
  productCategory: '',
  ownerUserId: '',
  ownerSnapshot: null,
  customerId: '',
  customerSnapshot: null,
  supplierId: '',
  currencyCode: '',
  depositPercent: '',
  depositAmount: '',
  expectedShipAt: '',
  notes: '',
  lines: [],
}

function newLineKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `line-${Date.now()}-${Math.round(performance.now())}`
}

function createEmptyLine(): PurchaseOrderLineValues {
  return {
    key: newLineKey(),
    productId: '',
    catalogProductId: '',
    supplierProductId: '',
    supplierProductMode: false,
    productLabel: '',
    quantity: '',
    unitPrice: '',
    taxRate: '',
    priceIncludesTax: true,
    note: '',
  }
}

function readLines(value: unknown): PurchaseOrderLineValues[] {
  if (!Array.isArray(value)) return []
  return value.flatMap<PurchaseOrderLineValues>((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const line = entry as Record<string, unknown>
    const supplierProductId = readText(line, 'supplierProductId')
    return [{
      key: typeof line.key === 'string' && line.key.length ? line.key : newLineKey(),
      productId: readText(line, 'productId'),
      catalogProductId: readText(line, 'catalogProductId'),
      supplierProductId,
      // A line reopened from a saved order keeps library mode through its reference, so the flag
      // only has to survive the editing session itself.
      supplierProductMode: line.supplierProductMode === true || supplierProductId.length > 0,
      productLabel: readText(line, 'productLabel'),
      quantity: readText(line, 'quantity'),
      unitPrice: readText(line, 'unitPrice'),
      taxRate: readText(line, 'taxRate'),
      priceIncludesTax: line.priceIncludesTax !== false,
      note: readText(line, 'note'),
    }]
  })
}

/**
 * CrudForm's number fields hand back a number once edited and the raw string while untouched,
 * and a cleared field hands back `undefined`; every decimal the form produces goes through here.
 */
export function toOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed.length) return null
  const numeric = Number(trimmed)
  return Number.isFinite(numeric) ? numeric : null
}

function toOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

/**
 * Builds the create payload: only the contract's keys, decimals as numbers (the command
 * coerces them onto their fixed-scale columns) and blank optional fields as `null` so
 * "not set" cannot be read as the previous value.
 *
 * A snapshot without its id is dropped: clearing the purchaser must clear what the order was
 * filed under, otherwise the detail page would keep showing a name the order no longer owns.
 */
export function buildPurchaseOrderPayload(values: PurchaseOrderFormValues): Record<string, unknown> {
  const ownerUserId = toOptionalText(values.ownerUserId)
  const customerId = toOptionalText(values.customerId)
  return {
    businessNumber: toOptionalText(values.businessNumber),
    productCategory: toOptionalText(values.productCategory),
    ownerUserId,
    ownerSnapshot: ownerUserId ? values.ownerSnapshot ?? null : null,
    customerId,
    customerSnapshot: customerId ? values.customerSnapshot ?? null : null,
    supplierId: toOptionalText(values.supplierId) ?? '',
    currencyCode: (toOptionalText(values.currencyCode) ?? '').toUpperCase(),
    depositPercent: toOptionalNumber(values.depositPercent),
    depositAmount: toOptionalNumber(values.depositAmount),
    expectedShipAt: toOptionalText(values.expectedShipAt),
    notes: toOptionalText(values.notes),
    lines: values.lines.map((line) => {
      // A library line carries exactly one reference and the command rejects a mix, so both master
      // references are dropped the moment the operator picks from the library.
      const supplierProductId = line.supplierProductId.trim()
      const ownedProductId = line.productId.trim()
      return {
        productId: supplierProductId ? undefined : ownedProductId,
        // Sent only when the line has no other reference, so the API's "at least one reference"
        // rule is satisfied for a new line, a library line and a legacy draft line alike.
        catalogProductId:
          (supplierProductId || ownedProductId) ? undefined : line.catalogProductId.trim() || undefined,
        supplierProductId: supplierProductId || undefined,
        quantity: toOptionalNumber(line.quantity) ?? 0,
        unitPrice: toOptionalNumber(line.unitPrice) ?? 0,
        taxRate: toOptionalNumber(line.taxRate) ?? 0,
        priceIncludesTax: line.priceIncludesTax === true,
        note: toOptionalText(line.note),
      }
    }),
  }
}

/**
 * The server reports line problems against a nested path (`lines.0.quantity`), so the section
 * surfaces the first error it owns instead of only the exact `lines` key.
 */
function firstLineError(errors: Record<string, string>): string | null {
  const key = Object.keys(errors).find((candidate) => candidate === 'lines' || candidate.startsWith('lines.'))
  return key ? errors[key] ?? null : null
}

/**
 * The write command answers a line whose library row belongs to another supplier with a 422 and a
 * stable code, and the message it carries is written for a developer rather than for this locale.
 * The picked reference stays on the line either way: only the operator can say whether the supplier
 * or the picked item is the wrong one, so the error is reported and nothing is cleared.
 */
export function isSupplierProductMismatch(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false
  return error.code === 'supplier_product_supplier_mismatch'
}

export function PurchaseOrderLinesEditor({
  t,
  values,
  setValue,
  errors,
}: CrudFormGroupComponentProps & { t: TranslateFn }) {
  // Same narrowing as the product form: the order write resolves its products in the selected
  // organization, so the picker must not offer a sibling organization's product.
  const { organizationId } = useOrganizationScopeDetail()
  // A library row belongs to exactly one supplier, so the picker is only meaningful once the header
  // names one — the server rejects a foreign row anyway, this just stops the pick before it happens.
  const supplierId = readText(values, 'supplierId')
  const lines = readLines(values.lines)
  const error = firstLineError(errors)

  const updateLine = React.useCallback(
    (index: number, patch: Partial<PurchaseOrderLineValues>) => {
      setValue('lines', lines.map((line, position) => (position === index ? { ...line, ...patch } : line)))
    },
    [lines, setValue],
  )

  const removeLine = React.useCallback(
    (index: number) => {
      setValue('lines', lines.filter((_, position) => position !== index))
    },
    [lines, setValue],
  )

  const addLine = React.useCallback(() => {
    setValue('lines', [...lines, createEmptyLine()])
  }, [lines, setValue])

  return (
    <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-sm font-medium">{t('purchasing.orders.form.lines.title')}</h3>
        <Button type="button" variant="outline" onClick={addLine}>
          <Plus className="size-4" aria-hidden="true" />
          {t('purchasing.orders.form.lines.add')}
        </Button>
      </div>

      {error ? <p className="text-xs text-status-error-text" role="alert">{error}</p> : null}

      {lines.map((line, index) => {
        const fieldId = (suffix: string) => `purchase-order-line-${line.key}-${suffix}`
        const quantityId = fieldId('quantity')
        const unitPriceId = fieldId('unitPrice')
        const taxRateId = fieldId('taxRate')
        const noteId = fieldId('note')
        // The reference decides the picker, so a saved line reopens on the library it was ordered
        // from and the mode flag is only needed while the operator is still choosing.
        const supplierMode = line.supplierProductMode || line.supplierProductId.length > 0
        // Switching pickers clears the other side: the command accepts one reference per line, and
        // a label seeded for the other picker would show a product the line no longer references.
        const switchPicker = () => {
          if (supplierMode) {
            updateLine(index, { supplierProductMode: false, supplierProductId: '', productLabel: '' })
            return
          }
          updateLine(index, { supplierProductMode: true, productId: '', catalogProductId: '', productLabel: '' })
        }

        return (
          <div key={line.key} className="rounded-md border bg-background p-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <div className="space-y-1.5 md:col-span-5">
                <FieldLabel required>
                  {t(
                    supplierMode
                      ? 'purchasing.orders.form.lines.supplierProduct'
                      : 'purchasing.orders.form.lines.product',
                  )}
                </FieldLabel>
                {supplierMode ? (
                  <ComboboxInput
                    value={line.supplierProductId}
                    onChange={(next) => updateLine(index, { supplierProductId: next })}
                    seedOptions={
                      line.supplierProductId && line.productLabel
                        ? [{ value: line.supplierProductId, label: line.productLabel }]
                        : undefined
                    }
                    loadSuggestions={(query) =>
                      loadSupplierProductOptions(
                        t('purchasing.orders.form.loadFailed'),
                        supplierId,
                        query,
                        organizationId,
                      )
                    }
                    allowCustomValues={false}
                    clearable
                    disabled={!supplierId}
                  />
                ) : (
                  <ComboboxInput
                    value={line.productId || line.catalogProductId}
                    onChange={(next) => updateLine(index, { productId: next, catalogProductId: '' })}
                    seedOptions={
                      line.productLabel
                        ? [{ value: line.productId || line.catalogProductId, label: line.productLabel }]
                        : undefined
                    }
                    loadSuggestions={(query) =>
                      loadOwnedProductOptions(t('purchasing.orders.form.loadFailed'), query, organizationId)
                    }
                    allowCustomValues={false}
                    clearable
                  />
                )}
                {supplierMode && !supplierId ? (
                  <p className="text-xs text-muted-foreground">
                    {t('purchasing.orders.form.lines.supplierRequired')}
                  </p>
                ) : null}
                <Button type="button" variant="link" size="2xs" className="h-auto px-0" onClick={switchPicker}>
                  {t(
                    supplierMode
                      ? 'purchasing.orders.form.lines.switchToMaster'
                      : 'purchasing.orders.form.lines.switchToSupplierProduct',
                  )}
                </Button>
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <FieldLabel htmlFor={quantityId} required>
                  {t('purchasing.orders.form.lines.quantity')}
                </FieldLabel>
                <Input
                  id={quantityId}
                  type="number"
                  min="0"
                  step="any"
                  value={line.quantity}
                  onChange={(event) => updateLine(index, { quantity: event.target.value })}
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <FieldLabel htmlFor={unitPriceId} required>
                  {t('purchasing.orders.form.lines.unitPrice')}
                </FieldLabel>
                <Input
                  id={unitPriceId}
                  type="number"
                  min="0"
                  step="any"
                  value={line.unitPrice}
                  onChange={(event) => updateLine(index, { unitPrice: event.target.value })}
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <FieldLabel htmlFor={taxRateId}>{t('purchasing.orders.form.lines.taxRate')}</FieldLabel>
                <Input
                  id={taxRateId}
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  value={line.taxRate}
                  onChange={(event) => updateLine(index, { taxRate: event.target.value })}
                />
              </div>
              <div className="flex items-end justify-end md:col-span-1">
                <IconButton
                  type="button"
                  variant="ghost"
                  size="lg"
                  aria-label={t('purchasing.orders.form.lines.remove')}
                  onClick={() => removeLine(index)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </IconButton>
              </div>
              <div className="flex items-end md:col-span-3">
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={line.priceIncludesTax}
                    onCheckedChange={(next) => updateLine(index, { priceIncludesTax: next === true })}
                  />
                  {t('purchasing.orders.form.lines.priceIncludesTax')}
                </label>
              </div>
              <div className="space-y-1.5 md:col-span-9">
                <FieldLabel htmlFor={noteId}>{t('purchasing.orders.form.lines.note')}</FieldLabel>
                <Input
                  id={noteId}
                  value={line.note}
                  onChange={(event) => updateLine(index, { note: event.target.value })}
                />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * CrudForm keeps the options a `loadOptions` call returned to itself, and the submit handler
 * needs the picked option's label to freeze onto the payload, so each relying picker records
 * what its loader returned here.
 */
async function rememberPickerOptions(
  store: React.RefObject<Record<string, CrudFieldOption[]>>,
  fieldId: string,
  load: () => Promise<CrudFieldOption[]>,
): Promise<CrudFieldOption[]> {
  const options = await load()
  store.current[fieldId] = options
  return options
}

function resolvePickerSnapshot(
  store: React.RefObject<Record<string, CrudFieldOption[]>>,
  fieldId: string,
  selectedId: string,
): Record<string, unknown> | null {
  const id = selectedId.trim()
  if (!id) return null
  return findOptionSnapshot(store.current[fieldId] ?? [], id)
}

function useOrderFields(
  t: TranslateFn,
  pickerOptions: React.RefObject<Record<string, CrudFieldOption[]>>,
): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    {
      id: 'businessNumber',
      label: t('purchasing.orders.form.field.businessNumber'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'productCategory',
      label: t('purchasing.orders.form.field.productCategory'),
      type: 'select',
      layout: 'half',
      loadOptions: () =>
        rememberPickerOptions(pickerOptions, 'productCategory', () =>
          loadProductCategoryOptions(t('purchasing.orders.form.optionsLoadFailed')),
        ),
    },
    {
      id: 'supplierId',
      label: t('purchasing.orders.form.field.supplier'),
      type: 'select',
      required: true,
      layout: 'half',
      loadOptions: (query) => loadSupplierOptions(t('purchasing.orders.form.loadFailed'), query),
    },
    {
      id: 'ownerUserId',
      label: t('purchasing.orders.form.field.owner'),
      type: 'select',
      layout: 'half',
      loadOptions: (query) =>
        rememberPickerOptions(pickerOptions, 'ownerUserId', () =>
          loadOwnerOptions(t('purchasing.orders.form.optionsLoadFailed'), query),
        ),
    },
    {
      id: 'customerId',
      label: t('purchasing.orders.form.field.customer'),
      type: 'select',
      layout: 'half',
      loadOptions: () =>
        rememberPickerOptions(pickerOptions, 'customerId', () =>
          loadCustomerOptions(t('purchasing.orders.form.optionsLoadFailed')),
        ),
    },
    {
      id: 'currencyCode',
      label: t('purchasing.orders.form.field.currency'),
      type: 'select',
      required: true,
      layout: 'half',
      loadOptions: () => loadCurrencyOptions(t('purchasing.orders.form.loadFailed')),
    },
    {
      id: 'expectedShipAt',
      label: t('purchasing.orders.form.field.expectedShipAt'),
      type: 'date',
      layout: 'half',
    },
    {
      id: 'depositPercent',
      label: t('purchasing.orders.form.field.depositPercent'),
      type: 'number',
      layout: 'half',
    },
    {
      id: 'depositAmount',
      label: t('purchasing.orders.form.field.depositAmount'),
      type: 'number',
      layout: 'half',
    },
    {
      id: 'notes',
      label: t('purchasing.orders.form.field.notes'),
      type: 'textarea',
      layout: 'half',
    },
  ], [t, pickerOptions])
}

export default function PurchaseOrderForm() {
  const t = useT()
  const router = useRouter()
  const pickerOptionsRef = React.useRef<Record<string, CrudFieldOption[]>>({})
  const fields = useOrderFields(t, pickerOptionsRef)

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'header',
      column: 1,
      fields: [
        'businessNumber',
        'productCategory',
        'supplierId',
        'ownerUserId',
        'customerId',
        'currencyCode',
        'expectedShipAt',
        'depositPercent',
        'depositAmount',
        'notes',
      ],
    },
    {
      id: 'lines',
      column: 1,
      bare: true,
      component: (context) => <PurchaseOrderLinesEditor {...context} t={t} />,
    },
  ], [t])

  const handleSubmit = React.useCallback(async (values: PurchaseOrderFormValues) => {
    // The write command must not read another module's tables to resolve a display name, so the
    // purchaser and customer snapshots are frozen here, from the option the operator picked:
    // the label a renamed or departed user would otherwise rewrite on an order already filed.
    // A picked id that is not on the loaded page (a user beyond the first page) sends `null`.
    const payload = buildPurchaseOrderPayload({
      ...values,
      ownerSnapshot: resolvePickerSnapshot(pickerOptionsRef, 'ownerUserId', values.ownerUserId),
      customerSnapshot: resolvePickerSnapshot(pickerOptionsRef, 'customerId', values.customerId),
    })
    try {
      const result = await createCrud<{ id?: string }>(ORDERS_API_PATH, payload)
      const createdId = typeof result.result?.id === 'string' ? result.result.id : null
      if (createdId) {
        // The detail page is the only surface that shows the lines, totals and payments a
        // freshly placed order needs, so the create flow hands the user straight to it.
        pushWithFlash(
          router,
          `${ORDERS_LIST_HREF}/${encodeURIComponent(createdId)}`,
          t('purchasing.orders.form.saved'),
          'success',
        )
        return
      }
      pushWithFlash(router, ORDERS_LIST_HREF, t('purchasing.orders.form.saved'), 'success')
    } catch (error) {
      flash(
        isSupplierProductMismatch(error)
          ? t('purchasing.errors.supplierProductMismatch')
          : t('purchasing.orders.form.saveFailed'),
        'error',
      )
      throw error
    }
  }, [router, t])

  return (
    <CrudForm<PurchaseOrderFormValues>
      title={t('purchasing.orders.form.createTitle')}
      titleHeadingLevel={1}
      backHref={ORDERS_LIST_HREF}
      fields={fields}
      groups={groups}
      initialValues={EMPTY_ORDER_VALUES}
      submitLabel={t('purchasing.orders.form.save')}
      cancelHref={ORDERS_LIST_HREF}
      onSubmit={handleSubmit}
    />
  )
}

/** Status pill used by the list and the detail header, so both read the same vocabulary. */
export function PurchaseOrderStatusBadge({ status }: { status: OrderStatus }) {
  const t = useT()
  return (
    <StatusBadge variant={ORDER_STATUS_MAP[status]} dot>
      {orderStatusLabel(t, status)}
    </StatusBadge>
  )
}
