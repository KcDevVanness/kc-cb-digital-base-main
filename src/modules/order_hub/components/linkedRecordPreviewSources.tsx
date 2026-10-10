'use client'

import * as React from 'react'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { MoneyAmount } from '@/lib/money/MoneyAmount'
import { isPurchaseOrderStatus, purchaseOrderStatusLabel } from '@/lib/orders/purchaseOrderStatus'
import { contractStatusLabel, invoiceStatusLabel } from '../../trade_docs/components/contractLabels'

/**
 * The order hub's read-only preview drawer is written once; what differs per linked record kind is
 * only this file: where the head is read from, what the drawer shows and where 「编辑」 goes.
 *
 * Every read goes through the module's own list route with a single-record filter (`{ id, pageSize:
 * 1 }`), the same routes and the same `fetchCrudList` helper the hub's own sections use, so a
 * preview can never show more than the owning module would. The two 档案 routes
 * (`export_finance/collections`, `export_finance/refunds`) answer `{ item }` instead of a page, so
 * they are read through a different narrowing helper.
 */

export type LinkedRecordPreviewKind =
  | 'purchase_order' | 'internal_sales_order' | 'external_sales_order'
  | 'contract' | 'document' | 'tax_invoice' | 'shipment' | 'packing_list'
  | 'collection' | 'refund'

export type LinkedRecordPreviewTarget = {
  kind: LinkedRecordPreviewKind
  /** The record's own id, or the id its owner archive is keyed by (collection → purchase order id, refund → shipment id). */
  refId: string
  /** The row's frozen number, used for the drawer subtitle before a read completes. */
  label?: string | null
  /**
   * The row's own sub-kind when the owning module keys its pages by it — a document row passes
   * `'proforma'` or `'commercial'`, so 「编辑」 can pick the right invoice page without a read.
   */
  variant?: string
}

export type LinkedRecordPreviewField = { label: string; value: React.ReactNode }

export type LinkedRecordPreviewSource = {
  /** Live read of one record's head, scoped exactly like the hub's own reads through the module's API. */
  read: (target: LinkedRecordPreviewTarget) => Promise<Record<string, unknown>>
  /** Drawer heading, e.g. the document number (`target.label` as fallback). */
  title: (record: Record<string, unknown>, target: LinkedRecordPreviewTarget, t: TranslateFn) => string
  /** Secondary line under the title (kind in words, counterparty); null when it has none. */
  subtitle?: (record: Record<string, unknown>, target: LinkedRecordPreviewTarget, t: TranslateFn) => string | null
  /** Curated read-only fields; a missing value is `null` and the drawer renders the shared 「—」 fallback. */
  fields: (record: Record<string, unknown>, t: TranslateFn) => LinkedRecordPreviewField[]
  /** Where the row's 「编辑」 goes, WITHOUT any returnTo parameter. */
  openHref: (target: LinkedRecordPreviewTarget) => string
}

const PURCHASE_ORDERS_PATH = 'purchasing/purchase-orders'
const SALES_ORDERS_PATH = 'sales/orders'
const CONTRACTS_PATH = 'trade_docs/contracts'
const DOCUMENTS_PATH = 'trade_docs/documents'
const INVOICES_PATH = 'trade_docs/invoices'
const SHIPMENTS_PATH = 'cross_border/shipments'
const SHIPMENT_DOCUMENTS_PATH = 'cross_border/shipments/documents'
const COLLECTIONS_PATH = 'export_finance/collections'
const REFUNDS_PATH = 'export_finance/refunds'

/** The drawer's own heading words; the kind in words is the subtitle's first half. */
const KIND_LABEL_KEYS: Record<LinkedRecordPreviewKind, string> = {
  purchase_order: 'order_hub.preview.kind.purchase_order',
  internal_sales_order: 'order_hub.preview.kind.internal_sales_order',
  external_sales_order: 'order_hub.preview.kind.external_sales_order',
  contract: 'order_hub.preview.kind.contract',
  document: 'order_hub.preview.kind.document',
  tax_invoice: 'order_hub.preview.kind.tax_invoice',
  shipment: 'order_hub.preview.kind.shipment',
  packing_list: 'order_hub.preview.kind.packing_list',
  collection: 'order_hub.preview.kind.collection',
  refund: 'order_hub.preview.kind.refund',
}

/** Field labels. One key per meaning, so 单号 stays 单号 wherever it appears. */
const FIELD = {
  number: 'order_hub.preview.field.number',
  businessNumber: 'order_hub.preview.field.businessNumber',
  supplier: 'order_hub.preview.field.supplier',
  owner: 'order_hub.preview.field.owner',
  customer: 'order_hub.preview.field.customer',
  orderDescription: 'order_hub.preview.field.orderDescription',
  status: 'order_hub.preview.field.status',
  placedAt: 'order_hub.preview.field.placedAt',
  expectedDelivery: 'order_hub.preview.field.expectedDelivery',
  currency: 'order_hub.preview.field.currency',
  orderAmount: 'order_hub.preview.field.orderAmount',
  deposit: 'order_hub.preview.field.deposit',
  paid: 'order_hub.preview.field.paid',
  outstanding: 'order_hub.preview.field.outstanding',
  notes: 'order_hub.preview.field.notes',
  buyer: 'order_hub.preview.field.buyer',
  total: 'order_hub.preview.field.total',
  counterpartyKind: 'order_hub.preview.field.counterpartyKind',
  counterparty: 'order_hub.preview.field.counterparty',
  date: 'order_hub.preview.field.date',
  kind: 'order_hub.preview.field.kind',
  amount: 'order_hub.preview.field.amount',
  invoicedAt: 'order_hub.preview.field.invoicedAt',
  containerNumber: 'order_hub.preview.field.containerNumber',
  sealNumber: 'order_hub.preview.field.sealNumber',
  bookingNumber: 'order_hub.preview.field.bookingNumber',
  carrier: 'order_hub.preview.field.carrier',
  etd: 'order_hub.preview.field.etd',
  eta: 'order_hub.preview.field.eta',
  shipment: 'order_hub.preview.field.shipment',
  issuedAt: 'order_hub.preview.field.issuedAt',
  purchaseOrderNumber: 'order_hub.preview.field.purchaseOrderNumber',
  shipmentNumber: 'order_hub.preview.field.shipmentNumber',
  foreignIncomeCertificate: 'order_hub.preview.field.foreignIncomeCertificate',
  time: 'order_hub.preview.field.time',
  taxRefundAmount: 'order_hub.preview.field.taxRefundAmount',
} as const

/** Values the drawer prints for a yes/no fact: 涉外收入证明 filed or not (是 / 否). */
const VALUE_KEYS = {
  yes: 'order_hub.preview.value.yes',
  no: 'order_hub.preview.value.no',
} as const

/** The first non-empty string (or finite number) among `keys`, else null — the shape of "missing". */
function scalar(source: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim().length > 0) return value
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return null
}

/** The first object among `keys` — the frozen jsonb snapshots carry the printed names. */
function readRecord(source: Record<string, unknown>, ...keys: string[]): Record<string, unknown> | null {
  for (const key of keys) {
    const value = source[key]
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  }
  return null
}

/** The `name` a snapshot froze, or null when it has none. */
function snapshotName(snapshot: Record<string, unknown> | null): string | null {
  if (!snapshot) return null
  const name = snapshot.name
  return typeof name === 'string' && name.trim().length > 0 ? name : null
}

/** A date column (`YYYY-MM-DD`) or a timestamp, trimmed to the day the drawer prints. */
function readDate(source: Record<string, unknown>, ...keys: string[]): string | null {
  const value = scalar(source, ...keys)
  if (!value) return null
  // `2026-09-29T07:59:37.922Z` (the list projections) and `2026-09-29 07:59:37.922+00` (a stored
  // `timestamptz` read straight) are the same day; both print as the date-only column the block uses.
  return /^\d{4}-\d{2}-\d{2}[T ]/.test(value) ? value.slice(0, 10) : value
}

/** An amount as a money value: `MoneyAmount` when the row names its currency, the stored figure otherwise. */
function money(amount: unknown, currency: string | null): React.ReactNode {
  const value = typeof amount === 'string' && amount.trim().length > 0
    ? amount
    : typeof amount === 'number' && Number.isFinite(amount)
      ? String(amount)
      : null
  if (value === null) return null
  return currency ? <MoneyAmount currencyCode={currency} amount={value} /> : value
}

/** The subtitle: the kind in the drawer's own words, with the counterparty's name beside it. */
function subtitleWithCounterparty(t: TranslateFn, kindKey: string, counterparty: string | null): string {
  const kind = t(kindKey)
  return counterparty ? `${kind} · ${counterparty}` : kind
}

/** A status the owning module already has words for; an unknown value stays as it is. */
function moduleStatus(t: TranslateFn, keyPrefix: string, status: string | null): string | null {
  return status ? t(`${keyPrefix}.${status}`, status) : null
}

/** One record's head from a paged list route, or `{}` when the filter matched nothing. */
async function readListHead(path: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const payload = await fetchCrudList<Record<string, unknown>>(path, { ...params, pageSize: 1 })
  return payload.items?.[0] ?? {}
}

/** One 档案 from a route that answers `{ item }` (collections, refunds) rather than a page. */
async function readArchiveItem(path: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const payload = await fetchCrudList<Record<string, unknown>>(path, { ...params, pageSize: 1 })
  if (!('item' in payload)) return {}
  const item: unknown = payload.item
  if (!item || typeof item !== 'object' || Array.isArray(item)) return {}
  // `typeof item === 'object'` is all the runtime check the wire gives; the item is a JSON record.
  return item as Record<string, unknown>
}

const purchaseOrderSource: LinkedRecordPreviewSource = {
  read: (target) => readListHead(PURCHASE_ORDERS_PATH, { id: target.refId }),
  title: (record, target) => scalar(record, 'number') ?? target.label ?? '',
  subtitle: (record, target, t) => subtitleWithCounterparty(
    t,
    KIND_LABEL_KEYS.purchase_order,
    scalar(record, 'supplierName', 'supplier_name') ?? snapshotName(readRecord(record, 'supplierSnapshot', 'supplier_snapshot')),
  ),
  fields: (record, t) => {
    const currency = scalar(record, 'currencyCode', 'currency_code')
    const status = scalar(record, 'status')
    return [
      { label: t(FIELD.number), value: scalar(record, 'number') },
      { label: t(FIELD.businessNumber), value: scalar(record, 'businessNumber', 'business_number') },
      {
        label: t(FIELD.supplier),
        value: scalar(record, 'supplierName', 'supplier_name') ?? snapshotName(readRecord(record, 'supplierSnapshot', 'supplier_snapshot')),
      },
      {
        label: t(FIELD.owner),
        value: scalar(record, 'ownerName', 'owner_name') ?? snapshotName(readRecord(record, 'ownerSnapshot', 'owner_snapshot')),
      },
      {
        label: t(FIELD.customer),
        value: scalar(record, 'customerName', 'customer_name') ?? snapshotName(readRecord(record, 'customerSnapshot', 'customer_snapshot')),
      },
      { label: t(FIELD.orderDescription), value: scalar(record, 'productCategory', 'product_category') },
      {
        label: t(FIELD.status),
        value: status ? (isPurchaseOrderStatus(status) ? purchaseOrderStatusLabel(t, status) : status) : null,
      },
      { label: t(FIELD.placedAt), value: readDate(record, 'placedAt', 'placed_at', 'createdAt', 'created_at') },
      { label: t(FIELD.expectedDelivery), value: readDate(record, 'expectedShipAt', 'expected_ship_at') },
      { label: t(FIELD.currency), value: currency },
      { label: t(FIELD.orderAmount), value: money(record.total, currency) },
      { label: t(FIELD.deposit), value: money(record.depositAmount ?? record.deposit_amount, currency) },
      { label: t(FIELD.paid), value: money(record.paidTotal ?? record.paid_total, currency) },
      { label: t(FIELD.outstanding), value: money(record.outstanding, currency) },
      { label: t(FIELD.notes), value: scalar(record, 'notes') },
    ]
  },
  openHref: (target) => `/backend/purchasing/orders/${encodeURIComponent(target.refId)}/edit`,
}

/** The two sales kinds share one route and one shape; only the ledger their 「编辑」 opens differs. */
function salesOrderSource(kind: 'internal_sales_order' | 'external_sales_order'): LinkedRecordPreviewSource {
  const ledger = kind === 'external_sales_order' ? '/backend/external-sales' : '/backend/internal-sales'
  return {
    read: (target) => readListHead(SALES_ORDERS_PATH, { id: target.refId }),
    title: (record, target) => scalar(record, 'orderNumber', 'order_number', 'number') ?? target.label ?? '',
    subtitle: (record, target, t) => subtitleWithCounterparty(
      t,
      KIND_LABEL_KEYS[kind],
      snapshotName(readRecord(record, 'customerSnapshot', 'customer_snapshot')),
    ),
    fields: (record, t) => {
      const currency = scalar(record, 'currencyCode', 'currency_code')
      return [
        { label: t(FIELD.number), value: scalar(record, 'orderNumber', 'order_number', 'number') },
        { label: t(FIELD.buyer), value: snapshotName(readRecord(record, 'customerSnapshot', 'customer_snapshot')) },
        { label: t(FIELD.status), value: scalar(record, 'status') },
        { label: t(FIELD.currency), value: currency },
        {
          label: t(FIELD.total),
          value: money(
            record.grandTotalNetAmount
              ?? record.grand_total_net_amount
              ?? record.grandTotalGrossAmount
              ?? record.grand_total_gross_amount
              ?? record.total,
            currency,
          ),
        },
        { label: t(FIELD.placedAt), value: readDate(record, 'placedAt', 'placed_at', 'createdAt', 'created_at') },
        { label: t(FIELD.notes), value: scalar(record, 'comment', 'comments') },
      ]
    },
    openHref: (target) => `${ledger}/orders/${encodeURIComponent(target.refId)}/edit`,
  }
}

const contractSource: LinkedRecordPreviewSource = {
  read: (target) => readListHead(CONTRACTS_PATH, { id: target.refId }),
  title: (record, target) => scalar(record, 'number') ?? target.label ?? '',
  subtitle: (record, target, t) => subtitleWithCounterparty(
    t,
    KIND_LABEL_KEYS.contract,
    scalar(record, 'counterpartyName', 'counterparty_name')
      ?? snapshotName(readRecord(record, 'counterpartySnapshot', 'counterparty_snapshot')),
  ),
  fields: (record, t) => {
    const currency = scalar(record, 'currencyCode', 'currency_code')
    const counterpartyKind = scalar(record, 'counterpartyKind', 'counterparty_kind')
    const status = scalar(record, 'status')
    return [
      { label: t(FIELD.number), value: scalar(record, 'number') },
      {
        label: t(FIELD.counterpartyKind),
        value: counterpartyKind ? t(`trade_docs.contracts.form.counterpartyKind.${counterpartyKind}`, counterpartyKind) : null,
      },
      {
        label: t(FIELD.counterparty),
        value: scalar(record, 'counterpartyName', 'counterparty_name')
          ?? snapshotName(readRecord(record, 'counterpartySnapshot', 'counterparty_snapshot')),
      },
      { label: t(FIELD.status), value: status ? contractStatusLabel(t, status) : null },
      { label: t(FIELD.currency), value: currency },
      { label: t(FIELD.total), value: money(record.contractTotal ?? record.contract_total ?? record.financeTotal, currency) },
      { label: t(FIELD.date), value: readDate(record, 'signedAt', 'signed_at') },
      { label: t(FIELD.notes), value: scalar(record, 'notes') },
    ]
  },
  openHref: (target) => `/backend/trade-docs/contracts/${encodeURIComponent(target.refId)}`,
}

const documentSource: LinkedRecordPreviewSource = {
  read: (target) => readListHead(DOCUMENTS_PATH, { id: target.refId }),
  title: (record, target) => scalar(record, 'number') ?? target.label ?? '',
  subtitle: (record, target, t) => subtitleWithCounterparty(
    t,
    KIND_LABEL_KEYS.document,
    scalar(record, 'counterpartyName', 'counterparty_name')
      ?? snapshotName(readRecord(record, 'counterpartySnapshot', 'counterparty_snapshot')),
  ),
  fields: (record, t) => {
    const currency = scalar(record, 'currencyCode', 'currency_code')
    const kind = scalar(record, 'kind')
    return [
      {
        label: t(FIELD.kind),
        value: kind === 'commercial' || kind === 'proforma' ? t(`trade_docs.documents.kind.${kind}`) : kind,
      },
      { label: t(FIELD.number), value: scalar(record, 'number') },
      { label: t(FIELD.status), value: moduleStatus(t, 'trade_docs.documents.status', scalar(record, 'status')) },
      { label: t(FIELD.currency), value: currency },
      { label: t(FIELD.total), value: money(record.total, currency) },
      { label: t(FIELD.date), value: readDate(record, 'issuedAt', 'issued_at', 'createdAt', 'created_at') },
      { label: t(FIELD.notes), value: scalar(record, 'notes') },
    ]
  },
  openHref: (target) => {
    // The row's own trade type travels on the target, so a CI opens the CI editor and a PI the PI one.
    const ledger = target.variant === 'commercial'
      ? '/backend/trade-docs/commercial-invoices'
      : '/backend/trade-docs/proformas'
    return `${ledger}/${encodeURIComponent(target.refId)}/edit`
  },
}

const taxInvoiceSource: LinkedRecordPreviewSource = {
  read: (target) => readListHead(INVOICES_PATH, { id: target.refId }),
  title: (record, target) => scalar(record, 'number', 'ourNumber', 'our_number') ?? target.label ?? '',
  subtitle: (record, target, t) => subtitleWithCounterparty(
    t,
    KIND_LABEL_KEYS.tax_invoice,
    scalar(record, 'counterpartyName', 'counterparty_name'),
  ),
  fields: (record, t) => {
    const currency = scalar(record, 'currencyCode', 'currency_code')
    const status = scalar(record, 'status')
    return [
      { label: t(FIELD.number), value: scalar(record, 'number', 'ourNumber', 'our_number') },
      { label: t(FIELD.status), value: status ? invoiceStatusLabel(t, status) : null },
      { label: t(FIELD.currency), value: currency },
      { label: t(FIELD.amount), value: money(record.total, currency) },
      { label: t(FIELD.invoicedAt), value: readDate(record, 'issuedAt', 'issued_at') },
    ]
  },
  openHref: (target) => `/backend/trade-docs/invoices/${encodeURIComponent(target.refId)}/edit`,
}

const shipmentSource: LinkedRecordPreviewSource = {
  read: (target) => readListHead(SHIPMENTS_PATH, { id: target.refId }),
  title: (record, target) => scalar(record, 'number') ?? target.label ?? '',
  subtitle: (record, target, t) => subtitleWithCounterparty(
    t,
    KIND_LABEL_KEYS.shipment,
    scalar(record, 'carrierName', 'carrier_name'),
  ),
  fields: (record, t) => [
    { label: t(FIELD.number), value: scalar(record, 'number') },
    { label: t(FIELD.status), value: moduleStatus(t, 'cross_border.shipments.status', scalar(record, 'status')) },
    { label: t(FIELD.containerNumber), value: scalar(record, 'containerNumber', 'container_number') },
    { label: t(FIELD.sealNumber), value: scalar(record, 'sealNumber', 'seal_number') },
    { label: t(FIELD.bookingNumber), value: scalar(record, 'bookingNumber', 'booking_number') },
    { label: t(FIELD.carrier), value: scalar(record, 'carrierName', 'carrier_name') },
    { label: t(FIELD.etd), value: readDate(record, 'etd') },
    { label: t(FIELD.eta), value: readDate(record, 'eta') },
  ],
  openHref: (target) => `/backend/cross_border/shipments/${encodeURIComponent(target.refId)}`,
}

const packingListSource: LinkedRecordPreviewSource = {
  // The route accepts an `id` filter, so the row answers in one read; it names its shipment by id.
  read: (target) => readListHead(SHIPMENT_DOCUMENTS_PATH, { id: target.refId }),
  title: (record, target) => scalar(record, 'documentNumber', 'document_number') ?? target.label ?? '',
  subtitle: (record, target, t) => subtitleWithCounterparty(
    t,
    KIND_LABEL_KEYS.packing_list,
    scalar(record, 'shipmentNumber') ?? scalar(record, 'shipmentId', 'shipment_id'),
  ),
  fields: (record, t) => [
    { label: t(FIELD.number), value: scalar(record, 'documentNumber', 'document_number') },
    {
      label: t(FIELD.shipment),
      value: scalar(record, 'shipmentNumber') ?? scalar(record, 'shipmentId', 'shipment_id'),
    },
    { label: t(FIELD.issuedAt), value: readDate(record, 'issuedAt', 'issued_at') },
  ],
  openHref: (target) => `/backend/cross_border/packing-lists/${encodeURIComponent(target.refId)}`,
}

const collectionSource: LinkedRecordPreviewSource = {
  read: (target) => readArchiveItem(COLLECTIONS_PATH, { purchaseOrderId: target.refId }),
  title: (record, target) => scalar(record, 'purchaseOrderNumber', 'purchase_order_number') ?? target.label ?? '',
  subtitle: (_record, _target, t) => t(KIND_LABEL_KEYS.collection),
  fields: (record, t) => {
    const currency = scalar(record, 'currencyCode', 'currency_code')
    const filed = record.foreignIncomeCertificate
    return [
      { label: t(FIELD.purchaseOrderNumber), value: scalar(record, 'purchaseOrderNumber', 'purchase_order_number') },
      { label: t(FIELD.status), value: moduleStatus(t, 'export_finance.collection.status', scalar(record, 'collectionStatus')) },
      { label: t(FIELD.amount), value: money(record.amount, currency) },
      { label: t(FIELD.currency), value: currency },
      {
        // 涉外收入证明 is a separate order-file fact the 收汇 archive does not carry, and the preview's
        // one read is the archive: the field stays 「—」 until a row that carries the boolean arrives.
        label: t(FIELD.foreignIncomeCertificate),
        value: typeof filed === 'boolean' ? t(filed ? VALUE_KEYS.yes : VALUE_KEYS.no) : null,
      },
      { label: t(FIELD.time), value: readDate(record, 'receivedAt', 'received_at', 'updatedAt', 'updated_at') },
    ]
  },
  openHref: (target) => `/backend/export-finance/orders/${encodeURIComponent(target.refId)}`,
}

const refundSource: LinkedRecordPreviewSource = {
  read: (target) => readArchiveItem(REFUNDS_PATH, { shipmentId: target.refId }),
  title: (record, target) => scalar(record, 'shipmentNumber', 'shipment_number') ?? target.label ?? '',
  subtitle: (_record, _target, t) => t(KIND_LABEL_KEYS.refund),
  fields: (record, t) => {
    const currency = scalar(record, 'currencyCode', 'currency_code')
    return [
      { label: t(FIELD.shipmentNumber), value: scalar(record, 'shipmentNumber', 'shipment_number') },
      { label: t(FIELD.status), value: moduleStatus(t, 'export_finance.refund.status', scalar(record, 'taxRefundStatus')) },
      { label: t(FIELD.taxRefundAmount), value: money(record.taxRefundAmount ?? record.tax_refund_amount, currency) },
      { label: t(FIELD.currency), value: currency },
    ]
  },
  openHref: (target) => `/backend/export-finance/containers/${encodeURIComponent(target.refId)}`,
}

/**
 * What an unrecognized kind falls back to: the row's frozen label with no fields and the order hub
 * list as its destination. The kind is a closed union, so this branch is only reachable from data a
 * migration or a stale cached row could still carry; it renders rather than throws.
 */
const UNKNOWN_SOURCE: LinkedRecordPreviewSource = {
  read: async () => ({}),
  title: (_record, target) => target.label ?? '',
  subtitle: () => null,
  fields: () => [],
  openHref: () => '/backend/orders',
}

const SOURCES: Record<LinkedRecordPreviewKind, LinkedRecordPreviewSource> = {
  purchase_order: purchaseOrderSource,
  internal_sales_order: salesOrderSource('internal_sales_order'),
  external_sales_order: salesOrderSource('external_sales_order'),
  contract: contractSource,
  document: documentSource,
  tax_invoice: taxInvoiceSource,
  shipment: shipmentSource,
  packing_list: packingListSource,
  collection: collectionSource,
  refund: refundSource,
}

/** The preview source of one linked-record kind; an unknown kind answers the empty source. */
export function linkedRecordPreviewSource(kind: LinkedRecordPreviewKind): LinkedRecordPreviewSource {
  return SOURCES[kind] ?? UNKNOWN_SOURCE
}
