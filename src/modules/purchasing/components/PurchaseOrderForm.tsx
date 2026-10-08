"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import {
  CrudForm,
  type CrudField,
  type CrudFieldOption,
  type CrudFormGroup,
  type CrudFormGroupComponentProps,
} from '@open-mercato/ui/backend/CrudForm'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import {
  PurchaseOrderStatusBadge,
  purchaseOrderStatusLabel as orderStatusLabel,
} from '@/lib/orders/purchaseOrderStatus'
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
  loadOwnedProductOptions,
  loadOwnerOptions,
  loadProductCategoryOptions,
  loadSupplierProductOptions,
  type SupplierProductOption,
} from './orderFormOptions'
import {
  isSourceSalesOrderKind,
  parseSourceOrderParams,
  salesOrderLinesToPurchaseLines,
  type SourceSalesOrderKind,
} from '../lib/sourceSalesOrder'
import {
  applyLinePickerValue,
  linePickerValue,
  toProductPickerValue,
  toSupplierProductPickerValue,
} from '../lib/orderLinePicker'

export const ORDERS_API_PATH = 'purchasing/purchase-orders'
export const ORDERS_LINES_API_PATH = 'purchasing/purchase-orders/lines'
export const ORDERS_PAYMENTS_API_PATH = 'purchasing/purchase-orders/payments'
export const ORDERS_TRANSITIONS_API_PATH = 'purchasing/purchase-orders/transitions'
export const ORDERS_LIST_HREF = '/backend/purchasing/orders'

const SUPPLIERS_API_PATH = '/api/purchasing/suppliers'
const CURRENCY_DICTIONARY_URL = '/api/currency_policy/currencies'
/** The supplier product library, read for one supplier + product to prefill a copied line's price. */
const SUPPLIER_PRODUCTS_API_PATH = '/api/purchasing/supplier-products'
/** The installed sales module's order lines — what a `?orderId=` prefill copies from. */
const SALES_ORDER_LINES_API_PATH = '/api/sales/order-lines'
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

/** The derived payment vocabulary, shared by the list, the detail page and the finance ledger. */
export const PAYMENT_STATUSES = ['unpaid', 'deposit_paid', 'partially_paid', 'paid'] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]




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
  /** The sales order this purchase order was raised for; null when it stands on its own. */
  sourceSalesOrderId: string | null
  sourceSalesOrderKind: SourceSalesOrderKind | null
  sourceSalesOrderNumber: string | null
  status: OrderStatus
  currencyCode: string
  /** Stored as a fixed-scale decimal string; the form edits it as a number. */
  depositPercent: string | null
  depositAmount: string | null
  notes: string | null
  subtotal: string
  taxTotal: string
  total: string
  /** Derived from the payment rows by the read API; not stored on the order. */
  paidTotal: string
  outstanding: string
  paymentStatus: PaymentStatus
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
    sourceSalesOrderId: readOptionalText(item, 'sourceSalesOrderId', 'source_sales_order_id'),
    sourceSalesOrderKind: (() => {
      const kind = readOptionalText(item, 'sourceSalesOrderKind', 'source_sales_order_kind')
      return isSourceSalesOrderKind(kind) ? kind : null
    })(),
    sourceSalesOrderNumber: readOptionalText(item, 'sourceSalesOrderNumber', 'source_sales_order_number'),
    status: ORDER_STATUSES.includes(item.status as OrderStatus) ? (item.status as OrderStatus) : 'draft',
    currencyCode: readText(item, 'currencyCode', 'currency_code') || 'CNY',
    depositPercent: readOptionalText(item, 'depositPercent', 'deposit_percent'),
    depositAmount: readOptionalText(item, 'depositAmount', 'deposit_amount'),
    notes: readOptionalText(item, 'notes'),
    subtotal: readText(item, 'subtotal') || '0',
    taxTotal: readText(item, 'taxTotal', 'tax_total') || '0',
    total: readText(item, 'total') || '0',
    paidTotal: readText(item, 'paidTotal', 'paid_total') || '0',
    outstanding: readText(item, 'outstanding') || '0',
    paymentStatus: PAYMENT_STATUSES.includes(item.paymentStatus as PaymentStatus)
      ? (item.paymentStatus as PaymentStatus)
      : 'unpaid',
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

/**
 * One editable order line. `key` keeps React (and the picker's resolved label) anchored to a
 * line while lines are added and removed; `productLabel` only ever seeds the picker's display
 * for a product that is not on the first page of options, and is never submitted.
 *
 * A line is picked either from the product master or from the supplier's own library, and the two
 * references are never sent together — but the operator picks from **one** search box: the source
 * travels in the picker's option value (`lib/orderLinePicker.ts`), not in a mode the operator has to
 * understand, and the payload still carries ids only.
 */
export type PurchaseOrderLineValues = {
  key: string
  /** Reference to the app-owned product master (`products_products.id`). */
  productId: string
  /** Legacy reference kept only so an existing draft that carries one can still be saved. */
  catalogProductId: string
  /** Reference to a supplier product library row (`purchasing_supplier_products.id`). */
  supplierProductId: string
  productLabel: string
  quantity: string
  unitPrice: string
  taxRate: string
  priceIncludesTax: boolean
  note: string
}

/**
 * Both lists in one search, the supplier's own library first.
 *
 * A purchase order is placed on one supplier, so "what does this supplier sell us" is the question
 * the picker is usually asked; the master is the fallback for goods that are not in that supplier's
 * list yet (or that we track centrally). The operator never has to decide which library to search —
 * every option names its source first, and the pick's reference follows from it.
 *
 * The source has to be the first thing on the bold line (owner review, 2026-09-24): one physical
 * item appears twice — the supplier's library row and the product created from it — with the same
 * code and name, and a source note underneath was not enough to tell them apart.
 *
 * A library row that has no product record yet says so on the option: it stays pickable (ordering
 * before archiving is a legitimate step) but the buyer is told, at the moment of choosing, that it
 * cannot be shipped or received until it is promoted and catalog-linked.
 */
async function loadLineProductOptions(
  errorMessage: string,
  masterForbiddenMessage: string,
  libraryForbiddenMessage: string,
  librarySourceLabel: string,
  libraryUnlinkedLabel: string,
  masterSourceLabel: string,
  supplierId: string | null,
  query?: string,
  organizationId?: string | null,
): Promise<ComboboxOption[]> {
  const [library, master] = await Promise.all([
    supplierId
      ? loadSupplierProductOptions(errorMessage, libraryForbiddenMessage, supplierId, query, organizationId)
      : Promise.resolve<SupplierProductOption[]>([]),
    loadOwnedProductOptions(errorMessage, masterForbiddenMessage, query, organizationId),
  ])
  return [
    ...library.map((option) => ({
      value: toSupplierProductPickerValue(option.value),
      // The source leads the label rather than trailing in the description: a library row and the
      // product created from it carry the same code and name, so the bold line — what the eye
      // compares — has to differ. The second line then only carries what an unlinked pick costs.
      label: `${librarySourceLabel} · ${option.label}`,
      description: option.linked ? null : libraryUnlinkedLabel,
    })),
    ...master.map((option) => ({
      value: toProductPickerValue(option.value),
      label: `${masterSourceLabel} · ${option.label}`,
      description: null,
    })),
  ]
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
  /**
   * The sales order this purchase order is raised for (`?orderKind=&orderId=`), sent as the id only:
   * the kind and the number are derived and frozen server-side.
   */
  sourceSalesOrderId: string
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
  sourceSalesOrderId: '',
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
    return [{
      key: typeof line.key === 'string' && line.key.length ? line.key : newLineKey(),
      productId: readText(line, 'productId'),
      catalogProductId: readText(line, 'catalogProductId'),
      supplierProductId: readText(line, 'supplierProductId'),
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
    sourceSalesOrderId: toOptionalText(values.sourceSalesOrderId),
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

  /**
   * Fills the supplier's own 供货价 into lines that carry no price yet.
   *
   * Lines copied from a sales order arrive with a product and a quantity but no price on purpose —
   * the sales price is what the customer pays. Once the operator names the supplier, the price that
   * supplier quoted for that product is the number this order actually needs, so it is looked up from
   * the library (one request per distinct product, the discount already applied) and written into the
   * empty cells only. A price the operator typed is never touched, and a product with no library
   * price simply stays empty for them to fill in.
   *
   * The ref keeps a line from being re-filled after the operator clears it deliberately.
   */
  const autoPricedLineKeys = React.useRef<Set<string>>(new Set())

  React.useEffect(() => {
    if (!supplierId) return
    const targets = lines.filter(
      (line) => line.productId.trim().length > 0 && line.unitPrice.trim().length === 0 && !autoPricedLineKeys.current.has(line.key),
    )
    if (targets.length === 0) return
    let cancelled = false
    const productIds = Array.from(new Set(targets.map((line) => line.productId.trim())))
    const load = async () => {
      const prices: Record<string, string> = {}
      await Promise.all(
        productIds.map(async (productId) => {
          const params = new URLSearchParams({ supplierId, productId, page: '1', pageSize: '1' })
          try {
            const payload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
              `${SUPPLIER_PRODUCTS_API_PATH}?${params.toString()}`,
              undefined,
              { fallback: { items: [] }, errorMessage: t('purchasing.orders.form.lines.priceLoadFailed') },
            )
            const cell = payload.items?.[0]?.supplierCostPrice
            if (!cell || typeof cell !== 'object') return
            const record = cell as Record<string, unknown>
            const price = record.netUnitPrice ?? record.unitPrice
            if (typeof price === 'string' && price.length > 0) prices[productId] = price
          } catch {
            // A supplier without a price for this product is normal: leave the cell empty.
          }
        }),
      )
      if (cancelled) return
      let changed = false
      const next = lines.map((line) => {
        const productId = line.productId.trim()
        if (!productId || line.unitPrice.trim().length > 0) return line
        const price = prices[productId]
        if (!price) return line
        autoPricedLineKeys.current.add(line.key)
        changed = true
        return { ...line, unitPrice: price }
      })
      if (changed) setValue('lines', next)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [lines, setValue, supplierId, t])

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
        // The picker searches both sources at once, so a saved line reopens on the reference it was
        // ordered from without the operator having to know which library it lives in.
        const pickerValue = linePickerValue(line)

        return (
          <div key={line.key} className="rounded-md border bg-background p-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <div className="space-y-1.5 md:col-span-5">
                <FieldLabel required>{t('purchasing.orders.form.lines.product')}</FieldLabel>
                <ComboboxInput
                  value={pickerValue}
                  onChange={(next) => updateLine(index, applyLinePickerValue(next))}
                  seedOptions={
                    pickerValue && line.productLabel ? [{ value: pickerValue, label: line.productLabel }] : undefined
                  }
                  loadSuggestions={(query) =>
                    loadLineProductOptions(
                      t('purchasing.orders.form.loadFailed'),
                      t('purchasing.orders.form.lines.masterForbidden'),
                      t('purchasing.orders.form.lines.supplierProductForbidden'),
                      t('purchasing.orders.form.lines.source.supplierLibrary'),
                      t('purchasing.orders.form.lines.source.supplierLibraryUnlinked'),
                      t('purchasing.orders.form.lines.source.master'),
                      supplierId,
                      query,
                      organizationId,
                    )
                  }
                  placeholder={t('purchasing.orders.form.lines.pickerPlaceholder')}
                  allowCustomValues={false}
                  clearable
                />
                {!supplierId ? (
                  <p className="text-xs text-muted-foreground">
                    {t('purchasing.orders.form.lines.supplierRequired')}
                  </p>
                ) : null}
                {/* One line, two sources: the hint says which list is searched first and what each
                    choice costs downstream (a library row needs a sync, a master product needs its
                    catalog link before it can ship). */}
                <p className="text-xs text-muted-foreground">
                  {t('purchasing.orders.form.lines.pickerHint')}
                </p>
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
  const searchParams = useSearchParams()
  const pickerOptionsRef = React.useRef<Record<string, CrudFieldOption[]>>({})
  const fields = useOrderFields(t, pickerOptionsRef)

  /**
   * `?orderKind=&orderId=` — the order hub and the workbench hand the operator here with the sales
   * order already known, so the source anchor and the order's lines arrive filled in.
   *
   * The prefill resolves before the form mounts (`initialValues === null` renders the loading state
   * instead), which is why there is no "overwrite what you typed" confirmation: there is nothing to
   * overwrite yet, and a half-applied prefill would be worse than a short wait. An unusable parameter
   * pair is reported inline and the form opens empty — a mistyped link must not block the page.
   */
  const sourceParam = React.useMemo(() => parseSourceOrderParams(searchParams), [searchParams])
  const [prefillState, setPrefillState] = React.useState<
    { status: 'idle' } | { status: 'loading' } | { status: 'ready'; values: PurchaseOrderFormValues; skipped: number }
  >(sourceParam.status === 'ok' ? { status: 'loading' } : { status: 'idle' })

  React.useEffect(() => {
    if (sourceParam.status !== 'ok') return
    let cancelled = false
    const load = async () => {
      const params = new URLSearchParams({ orderId: sourceParam.id, pageSize: '500' })
      try {
        const payload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
          `${SALES_ORDER_LINES_API_PATH}?${params.toString()}`,
          undefined,
          { fallback: { items: [] }, errorMessage: t('purchasing.orders.form.sourceOrder.loadFailed') },
        )
        if (cancelled) return
        const copy = salesOrderLinesToPurchaseLines(payload.items ?? [])
        setPrefillState({
          status: 'ready',
          skipped: copy.skipped,
          values: {
            ...EMPTY_ORDER_VALUES,
            sourceSalesOrderId: sourceParam.id,
            lines: copy.lines.map((seed) => ({
              ...createEmptyLine(),
              productId: seed.productId ?? '',
              catalogProductId: seed.catalogProductId ?? '',
              quantity: seed.quantity,
            })),
          },
        })
      } catch {
        if (cancelled) return
        // The anchor is still valid even when the lines could not be read: keep it and let the
        // operator add the lines by hand rather than dropping the link they arrived with.
        setPrefillState({
          status: 'ready',
          skipped: 0,
          values: { ...EMPTY_ORDER_VALUES, sourceSalesOrderId: sourceParam.id },
        })
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [sourceParam, t])

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

  if (prefillState.status === 'loading') {
    return <p className="text-sm text-muted-foreground">{t('purchasing.orders.form.sourceOrder.loading')}</p>
  }

  const invalidSourceParam = sourceParam.status === 'invalid'

  return (
    <>
      {invalidSourceParam ? (
        <p className="mb-3 rounded-md border border-status-warning-border bg-status-warning-bg px-3 py-2 text-xs text-status-warning-text" role="alert">
          {t('purchasing.orders.create.sourceOrder.invalid')}
        </p>
      ) : null}
      {prefillState.status === 'ready' && prefillState.skipped > 0 ? (
        <p className="mb-3 text-xs text-muted-foreground">
          {t('purchasing.orders.form.sourceOrder.skipped', { count: prefillState.skipped })}
        </p>
      ) : null}
    <CrudForm<PurchaseOrderFormValues>
      title={t('purchasing.orders.form.createTitle')}
      titleHeadingLevel={1}
      backHref={ORDERS_LIST_HREF}
      fields={fields}
      groups={groups}
      initialValues={prefillState.status === 'ready' ? prefillState.values : EMPTY_ORDER_VALUES}
      submitLabel={t('purchasing.orders.form.save')}
      cancelHref={ORDERS_LIST_HREF}
      onSubmit={handleSubmit}
    />
    </>
  )
}

