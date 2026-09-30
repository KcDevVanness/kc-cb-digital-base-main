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
import { ComboboxInput } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { pushWithFlash } from '@open-mercato/ui/backend/utils/flash'
import { Button } from '@open-mercato/ui/primitives/button'
import { FieldLabel } from '@open-mercato/ui/primitives/label'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import {
  formatDisplayDate,
  toUtcDateInputValue,
} from '@open-mercato/ui/primitives/date-format'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { loadProductOption, loadProductOptions, type ProductOption } from '../../products/components/formOptions'
import {
  loadCarrierOptions,
  loadContainerTypeOptions,
  loadContractLines,
  loadContractOptions,
  loadPortOptions,
  loadSalesOrderLineOptions,
  loadSalesOrderLabel,
  loadSalesOrderOptions,
  type ContractLineOption,
  type SalesOrderLineOption,
} from './shipmentFormOptions'

/**
 * This file owns the shipment contract shared with the list and detail surfaces: the record
 * shape and its payload mapper, the status/milestone vocabularies, the date renderers, the
 * option loaders for the fields that reference other modules, and the two allocation-sized
 * editors (destination picker, allocation rows). Keeping them here means the value the list
 * renders, the value the form submits, and the value the detail page shows cannot drift apart.
 */

export const SHIPMENTS_API_PATH = 'cross_border/shipments'
export const SHIPMENT_CONTRACTS_API_PATH = 'cross_border/shipments/contracts'
export const SHIPMENT_ALLOCATIONS_API_PATH = 'cross_border/shipments/allocations'
export const SHIPMENT_SALES_ALLOCATIONS_API_PATH = 'cross_border/shipments/sales-allocations'
export const SHIPMENT_MILESTONES_API_PATH = 'cross_border/shipments/milestones'
export const SHIPMENT_DOCUMENTS_API_PATH = 'cross_border/shipments/documents'
export const SHIPMENT_DEPART_API_PATH = 'cross_border/shipments/depart'
export const SHIPMENT_RECEIVE_API_PATH = 'cross_border/shipments/receive'
export const SHIPMENT_CANCEL_API_PATH = 'cross_border/shipments/cancel'
export const SHIPMENT_CLOSE_API_PATH = 'cross_border/shipments/close'
export const SHIPMENTS_LIST_HREF = '/backend/cross_border/shipments'

const PURCHASE_ORDERS_API_URL = '/api/purchasing/purchase-orders'
const PURCHASE_ORDER_LINES_API_URL = '/api/purchasing/purchase-orders/lines'
const WAREHOUSES_API_URL = '/api/wms/warehouses'
const LOCATIONS_API_URL = '/api/wms/locations'
const OPTION_PAGE_SIZE = 50
const OPTION_ID_PAGE_SIZE = 1

/** Statuses the list filter offers, in the order the state machine walks them. */
export const SHIPMENT_STATUSES = ['draft', 'in_transit', 'received', 'closed', 'cancelled'] as const
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number]

const SHIPMENT_STATUS_MAP: StatusMap<ShipmentStatus> = {
  draft: 'neutral',
  in_transit: 'info',
  received: 'success',
  // Archival: done and filed, not a new achievement — neutral reads correctly next to `received`.
  closed: 'neutral',
  cancelled: 'error',
}

const SHIPMENT_STATUS_LABEL_KEYS: Record<ShipmentStatus, string> = {
  draft: 'cross_border.shipments.status.draft',
  in_transit: 'cross_border.shipments.status.in_transit',
  received: 'cross_border.shipments.status.received',
  closed: 'cross_border.shipments.status.closed',
  cancelled: 'cross_border.shipments.status.cancelled',
}

export function shipmentStatusLabel(t: TranslateFn, status: ShipmentStatus): string {
  return t(SHIPMENT_STATUS_LABEL_KEYS[status])
}

/**
 * The physical stages in the order they happen. The command layer rejects a stage that walks
 * backwards, so this order is also the order the form must offer them in.
 */
export const SHIPMENT_MILESTONES = [
  'picked_up',
  'export_customs',
  'in_transit',
  'arrived',
  'cleared',
  'warehoused',
] as const
export type ShipmentMilestone = (typeof SHIPMENT_MILESTONES)[number]

const SHIPMENT_MILESTONE_LABEL_KEYS: Record<ShipmentMilestone, string> = {
  picked_up: 'cross_border.shipments.milestones.picked_up',
  export_customs: 'cross_border.shipments.milestones.export_customs',
  in_transit: 'cross_border.shipments.milestones.in_transit',
  arrived: 'cross_border.shipments.milestones.arrived',
  cleared: 'cross_border.shipments.milestones.cleared',
  warehoused: 'cross_border.shipments.milestones.warehoused',
}

export function shipmentMilestoneLabel(t: TranslateFn, milestone: ShipmentMilestone): string {
  return t(SHIPMENT_MILESTONE_LABEL_KEYS[milestone])
}

/** Export document types the module accepts — the same types the command's enum offers. */
export const SHIPMENT_DOCUMENT_TYPES = [
  'customs_declaration',
  'packing_list',
  'commercial_invoice',
  'bill_of_lading',
  'so',
  'telex_release',
  'domestic_freight_receipt',
  'booking_charges_receipt',
  'other',
] as const
export type ShipmentDocumentType = (typeof SHIPMENT_DOCUMENT_TYPES)[number]

const SHIPMENT_DOCUMENT_TYPE_LABEL_KEYS: Record<ShipmentDocumentType, string> = {
  customs_declaration: 'cross_border.shipments.documents.docType.customs_declaration',
  packing_list: 'cross_border.shipments.documents.docType.packing_list',
  commercial_invoice: 'cross_border.shipments.documents.docType.commercial_invoice',
  bill_of_lading: 'cross_border.shipments.documents.docType.bill_of_lading',
  so: 'cross_border.shipments.documents.docType.so',
  telex_release: 'cross_border.shipments.documents.docType.telex_release',
  domestic_freight_receipt: 'cross_border.shipments.documents.docType.domestic_freight_receipt',
  booking_charges_receipt: 'cross_border.shipments.documents.docType.booking_charges_receipt',
  other: 'cross_border.shipments.documents.docType.other',
}

export function shipmentDocumentTypeLabel(t: TranslateFn, docType: ShipmentDocumentType): string {
  return t(SHIPMENT_DOCUMENT_TYPE_LABEL_KEYS[docType])
}

/**
 * The types a *new* document row may be created with. `commercial_invoice` stays in the type list
 * above so historical rows keep rendering, but it is no longer offered: the commercial invoice now
 * lives in its own `trade_docs` document (`SHIPMENT_COMMERCIAL_INVOICE_HREF`), and the system must
 * not carry two truths for one document.
 */
export const SHIPMENT_SELECTABLE_DOCUMENT_TYPES = SHIPMENT_DOCUMENT_TYPES.filter(
  (docType) => docType !== 'commercial_invoice',
)

/** Where the structured commercial invoice lives now (the `trade_docs` CI list). */
export const SHIPMENT_COMMERCIAL_INVOICE_HREF = '/backend/trade-docs/commercial-invoices'

/**
 * The packing-list ledger (`/backend/packing-lists`) — the PL its own menu entry in the 出口业务
 * group, next to the PI/CI pages. The rows are the shipment's `packing_list` documents; the write
 * path stays the shipment document command, which is why the dialog picks a shipment first.
 */
export const PACKING_LISTS_LIST_HREF = '/backend/cross_border/packing-lists'

/**
 * Attachments are uploaded before the document row exists (the row stores the returned id), so
 * the file is filed against the shipment it belongs to rather than against a missing document.
 */
export const SHIPMENT_ATTACHMENT_ENTITY_ID = 'cross_border:shipment'

/** A shipment as `/api/cross_border/shipments` projects it. */
export type ShipmentRecord = {
  id: string
  number: string | null
  status: ShipmentStatus
  carrierName: string | null
  departurePort: string | null
  /** `container_type` dictionary code; the form's picker owns the label. */
  containerType: string | null
  containerNumber: string | null
  sealNumber: string | null
  /** Booking/waybill number, on the shipment so an SO document row never repeats it. */
  bookingNumber: string | null
  currentMilestone: ShipmentMilestone | null
  /** Only projected by the detail read; the receive dialog defaults from it when present. */
  destinationWarehouseId: string | null
  destinationLocationId: string | null
  etd: string | null
  eta: string | null
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

function toOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

/**
 * Drops the trailing zeros a fixed-scale decimal column adds (`10.0000` → `10`) without
 * re-reading the digits through a float, so a quantity of `12.3456` keeps all four.
 */
export function trimShipmentQuantity(value: string): string {
  const trimmed = value.trim()
  if (!trimmed.includes('.')) return trimmed
  const stripped = trimmed.replace(/0+$/, '').replace(/\.$/, '')
  return stripped.length ? stripped : '0'
}

export function shipmentErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length) return error.message
  return fallback
}

/**
 * How a shipment is named wherever another screen has to point at it: its business number once it
 * has one, and otherwise the status plus whatever identifies the row meanwhile (a draft has no
 * number until it departs) — container number, then carrier, then the id's first eight characters.
 */
export function shipmentDisplayLabel(t: TranslateFn, shipment: ShipmentRecord): string {
  const parts = [shipment.number ?? shipmentStatusLabel(t, shipment.status)]
  const secondary = shipment.containerNumber ?? shipment.carrierName
  if (secondary) parts.push(secondary)
  else if (!shipment.number) parts.push(shipment.id.slice(0, 8))
  return parts.join(' · ')
}

export function toShipmentRecord(item: Record<string, unknown>): ShipmentRecord {
  const status = item.status
  const milestone = item.currentMilestone ?? item.current_milestone
  return {
    id: readText(item, 'id'),
    number: readOptionalText(item, 'number'),
    status: SHIPMENT_STATUSES.includes(status as ShipmentStatus) ? (status as ShipmentStatus) : 'draft',
    carrierName: readOptionalText(item, 'carrierName', 'carrier_name'),
    departurePort: readOptionalText(item, 'departurePort', 'departure_port'),
    containerType: readOptionalText(item, 'containerType', 'container_type'),
    containerNumber: readOptionalText(item, 'containerNumber', 'container_number'),
    sealNumber: readOptionalText(item, 'sealNumber', 'seal_number'),
    bookingNumber: readOptionalText(item, 'bookingNumber', 'booking_number'),
    currentMilestone: SHIPMENT_MILESTONES.includes(milestone as ShipmentMilestone)
      ? (milestone as ShipmentMilestone)
      : null,
    destinationWarehouseId: readOptionalText(item, 'destinationWarehouseId', 'destination_warehouse_id'),
    destinationLocationId: readOptionalText(item, 'destinationLocationId', 'destination_location_id'),
    etd: readOptionalText(item, 'etd'),
    eta: readOptionalText(item, 'eta'),
    createdAt: readOptionalText(item, 'createdAt', 'created_at'),
    updatedAt: readOptionalText(item, 'updatedAt', 'updated_at'),
  }
}

/**
 * Date-only columns (`etd`, `eta`, `issued_at`) are written from a date input and stored as UTC
 * midnight, so their day must be read back in the frame it was written in — reading the instant
 * locally names the previous day west of UTC.
 */
export function formatShipmentDate(value: string | null | undefined, locale?: string): string | null {
  const day = toUtcDateInputValue(value)
  return day ? formatDisplayDate(day, locale) : null
}

/** `datetime-local` inputs read and write the wall-clock time the operator is standing in. */
export function toLocalDateTimeInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function ShipmentStatusBadge({ status }: { status: ShipmentStatus }) {
  const t = useT()
  return (
    <StatusBadge variant={SHIPMENT_STATUS_MAP[status]} dot>
      {shipmentStatusLabel(t, status)}
    </StatusBadge>
  )
}

type PagedItems = { items?: Array<Record<string, unknown>> }

function optionFromWarehouse(item: Record<string, unknown>): CrudFieldOption | null {
  const value = readText(item, 'id')
  if (!value) return null
  const name = readText(item, 'name')
  const code = readText(item, 'code')
  return { value, label: code && name ? `${code} — ${name}` : code || name || value }
}

function optionFromLocation(item: Record<string, unknown>): CrudFieldOption | null {
  const value = readText(item, 'id')
  if (!value) return null
  const code = readText(item, 'code')
  const type = readText(item, 'type')
  const label = code && type ? `${code} — ${type}` : code || type || value
  return { value, label }
}

/** Active warehouses; the label is `code — name`, the same vocabulary wms itself renders. */
export async function loadWarehouseOptions(errorMessage: string, query?: string): Promise<CrudFieldOption[]> {
  const params = new URLSearchParams({
    page: '1',
    pageSize: String(OPTION_PAGE_SIZE),
    isActive: 'true',
  })
  const term = query?.trim()
  if (term) params.set('search', term)
  const payload = await readApiResultOrThrow<PagedItems>(
    `${WAREHOUSES_API_URL}?${params.toString()}`,
    undefined,
    { fallback: { items: [] }, errorMessage },
  )
  return (payload.items ?? [])
    .map(optionFromWarehouse)
    .filter((option): option is CrudFieldOption => option !== null)
}

/**
 * Locations of one warehouse. Wms owns the hierarchy, so the picker can only ever offer a
 * location that belongs to the warehouse the operator already chose.
 */
export async function loadLocationOptions(
  errorMessage: string,
  warehouseId: string,
  query?: string,
): Promise<CrudFieldOption[]> {
  const scopedWarehouseId = warehouseId.trim()
  if (!scopedWarehouseId) return []
  const params = new URLSearchParams({
    page: '1',
    pageSize: String(OPTION_PAGE_SIZE),
    warehouseId: scopedWarehouseId,
    isActive: 'true',
  })
  const term = query?.trim()
  if (term) params.set('search', term)
  const payload = await readApiResultOrThrow<PagedItems>(
    `${LOCATIONS_API_URL}?${params.toString()}`,
    undefined,
    { fallback: { items: [] }, errorMessage },
  )
  return (payload.items ?? [])
    .map(optionFromLocation)
    .filter((option): option is CrudFieldOption => option !== null)
}

/** Resolves a stored warehouse id to its display label, for a pick that is not on the first page. */
export async function resolveWarehouseLabel(warehouseId: string): Promise<string | null> {
  const scopedId = warehouseId.trim()
  if (!scopedId) return null
  const params = new URLSearchParams({ ids: scopedId, page: '1', pageSize: String(OPTION_ID_PAGE_SIZE) })
  const call = await apiCall<PagedItems>(`${WAREHOUSES_API_URL}?${params.toString()}`, undefined, { fallback: null })
  if (!call.ok) return null
  return optionFromWarehouse(call.result?.items?.[0] ?? {})?.label ?? null
}

/** Resolves a stored location id to its display label, for a pick that is not on the first page. */
export async function resolveLocationLabel(locationId: string): Promise<string | null> {
  const scopedId = locationId.trim()
  if (!scopedId) return null
  const params = new URLSearchParams({ ids: scopedId, page: '1', pageSize: String(OPTION_ID_PAGE_SIZE) })
  const call = await apiCall<PagedItems>(`${LOCATIONS_API_URL}?${params.toString()}`, undefined, { fallback: null })
  if (!call.ok) return null
  return optionFromLocation(call.result?.items?.[0] ?? {})?.label ?? null
}

/**
 * Purchase orders a consignment can still draw lines from: orders waiting to ship (`placed`) and
 * orders whose goods may already be travelling (`received`). Both are read because a shipment is
 * usually built from the first and topped up from the second.
 */
export async function loadAllocatablePurchaseOrderOptions(
  errorMessage: string,
  query?: string,
): Promise<CrudFieldOption[]> {
  const statuses: readonly string[] = ['placed', 'received']
  const pages = await Promise.all(statuses.map((status) => {
    const params = new URLSearchParams({
      status,
      page: '1',
      pageSize: String(OPTION_PAGE_SIZE),
    })
    const term = query?.trim()
    if (term) params.set('search', term)
    return readApiResultOrThrow<PagedItems>(
      `${PURCHASE_ORDERS_API_URL}?${params.toString()}`,
      undefined,
      { fallback: { items: [] }, errorMessage },
    )
  }))

  const options: CrudFieldOption[] = []
  const seen = new Set<string>()
  for (const page of pages) {
    for (const item of page.items ?? []) {
      const value = readText(item, 'id')
      if (!value || seen.has(value)) continue
      seen.add(value)
      const number = readText(item, 'number') || value
      const supplier = readText(item, 'supplierName', 'supplier_name')
      options.push({ value, label: supplier ? `${number} — ${supplier}` : number })
    }
  }
  return options
}

/**
 * A picked order's display label: the option list's label when the picker on screen already cached
 * it, otherwise resolved from the order's own option source — so an operator who picks an order
 * without typing (the suggestions load unfiltered) never sees a raw uuid in a row. `t` is what the
 * sales source needs to word its options' direction the same way the picker did.
 */
export async function resolveOrderOptionLabel(
  t: TranslateFn,
  errorMessage: string,
  kind: 'purchase' | 'sales',
  orderId: string,
  cachedLabel?: string | null,
): Promise<string> {
  const cached = (cachedLabel ?? '').trim()
  if (cached && cached !== orderId) return cached
  try {
    if (kind === 'sales') {
      // Display only: the allocation gate must not hide an order that is already on the shipment.
      return await loadSalesOrderLabel(orderId) ?? orderId
    }
    const options = await loadAllocatablePurchaseOrderOptions(errorMessage, '')
    return options.find((option) => option.value === orderId)?.label ?? orderId
  } catch {
    return orderId
  }
}

/** A purchase-order line as `/api/purchasing/purchase-orders/lines` projects it. */
export type PurchaseOrderLineOption = {
  id: string
  lineNumber: number
  /** Owned-master reference; the contract-line match key (null on historical catalog-only lines). */
  productId: string
  catalogProductId: string
  productTitle: string | null
  productSku: string | null
  supplierSku: string | null
  quantity: string
  receivedQuantity: string
}

function toPurchaseOrderLineOption(item: Record<string, unknown>): PurchaseOrderLineOption {
  return {
    id: readText(item, 'id'),
    lineNumber: Number(item.lineNumber ?? 0),
    productId: readText(item, 'productId', 'product_id'),
    catalogProductId: readText(item, 'catalogProductId', 'catalog_product_id'),
    productTitle: readOptionalText(item, 'productTitle', 'product_title'),
    productSku: readOptionalText(item, 'productSku', 'product_sku'),
    supplierSku: readOptionalText(item, 'supplierSku', 'supplier_sku'),
    quantity: readText(item, 'quantity') || '0',
    receivedQuantity: readText(item, 'receivedQuantity', 'received_quantity') || '0',
  }
}

/** The lines of one purchase order — the candidates an allocation can be built from. */
export async function loadPurchaseOrderLines(
  errorMessage: string,
  orderId: string,
): Promise<PurchaseOrderLineOption[]> {
  const scopedOrderId = orderId.trim()
  if (!scopedOrderId) return []
  const params = new URLSearchParams({
    orderId: scopedOrderId,
    page: '1',
    pageSize: '200',
  })
  const payload = await readApiResultOrThrow<PagedItems>(
    `${PURCHASE_ORDER_LINES_API_URL}?${params.toString()}`,
    undefined,
    { fallback: { items: [] }, errorMessage },
  )
  return (payload.items ?? []).map(toPurchaseOrderLineOption).filter((line) => line.id.length > 0)
}

/**
 * One allocation row. `key` keeps React anchored to a row while rows are added and removed;
 * `purchaseOrderLabel` and the product snapshot are display-only and never submitted — the
 * server resolves the order, the product and the snapshot from `purchaseOrderLineId`.
 */
export type ShipmentAllocationValues = {
  key: string
  purchaseOrderId: string
  purchaseOrderLabel: string
  purchaseOrderLineId: string
  productTitle: string
  productSku: string
  supplierSku: string
  orderedQuantity: string
  allocatedQuantity: string
}

/**
 * One **sales** allocation row. `key` keeps React anchored to a row while rows are added and
 * removed; the order/line labels, product snapshot and catalog id are the row's own display and
 * payload data. The sales order/line and the product snapshot are re-resolved server-side from
 * `salesOrderLineId`, so a tampered label cannot change what is written.
 */
export type ShipmentSalesAllocationValues = {
  key: string
  salesOrderId: string
  salesOrderLabel: string
  salesOrderLineId: string
  lineNumber: number
  /** App-owned product master id, used only to resolve the catalog link in the editor. */
  productId: string
  /** Installed-catalog product the line is bridged to; the allocation is stored against it. */
  catalogProductId: string
  productTitle: string
  productSku: string
  orderedQuantity: string
  quantity: string
  unitPrice: string
  currencyCode: string
}

export type ShipmentFormValues = {
  carrierName: string
  forwarderContact: string
  departurePort: string
  containerType: string
  containerNumber: string
  sealNumber: string
  bookingNumber: string
  etd: string
  eta: string
  notes: string
  /** Keyed by the destination picker, whose warehouse decides which locations are offered. */
  destinationWarehouseId: string
  destinationLocationId: string
  contracts: ShipmentContractValues[]
  allocations: ShipmentAllocationValues[]
  salesAllocations: ShipmentSalesAllocationValues[]
}

/**
 * One linked-contract row. `key` keeps React anchored to a row while rows are added and removed;
 * `contractLabel` is display-only and never submitted — the server resolves the contract number
 * and direction from `contractId` and freezes them on the link row.
 */
export type ShipmentContractValues = {
  key: string
  contractId: string
  contractLabel: string
}

const EMPTY_SHIPMENT_VALUES: ShipmentFormValues = {
  carrierName: '',
  forwarderContact: '',
  departurePort: '',
  containerType: '',
  containerNumber: '',
  sealNumber: '',
  bookingNumber: '',
  etd: '',
  eta: '',
  notes: '',
  destinationWarehouseId: '',
  destinationLocationId: '',
  contracts: [],
  allocations: [],
  salesAllocations: [],
}

function newRowKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `allocation-${Date.now()}-${Math.round(performance.now())}`
}

/**
 * Reads the linked-contract rows out of a form value or an API payload. A row the operator added
 * but has not picked a contract for yet stays visible (it is part of the edited set); the payload
 * builder drops it so an empty pick never reaches the command. The label is display-only and gets
 * re-resolved by the picker's option source.
 */
export function readContracts(value: unknown): ShipmentContractValues[] {
  if (!Array.isArray(value)) return []
  return value.flatMap<ShipmentContractValues>((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const row = entry as Record<string, unknown>
    return [{
      key: typeof row.key === 'string' && row.key.length ? row.key : newRowKey(),
      contractId: readText(row, 'contractId', 'contract_id'),
      contractLabel: readText(row, 'contractLabel', 'contractNumber', 'contract_number'),
    }]
  })
}

export function readAllocations(value: unknown): ShipmentAllocationValues[] {
  if (!Array.isArray(value)) return []
  return value.flatMap<ShipmentAllocationValues>((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const row = entry as Record<string, unknown>
    return [{
      key: typeof row.key === 'string' && row.key.length ? row.key : newRowKey(),
      purchaseOrderId: readText(row, 'purchaseOrderId'),
      purchaseOrderLabel: readText(row, 'purchaseOrderLabel'),
      purchaseOrderLineId: readText(row, 'purchaseOrderLineId'),
      productTitle: readText(row, 'productTitle'),
      productSku: readText(row, 'productSku'),
      supplierSku: readText(row, 'supplierSku'),
      orderedQuantity: readText(row, 'orderedQuantity'),
      allocatedQuantity: readText(row, 'allocatedQuantity'),
    }]
  })
}

export function readSalesAllocations(value: unknown): ShipmentSalesAllocationValues[] {
  if (!Array.isArray(value)) return []
  return value.flatMap<ShipmentSalesAllocationValues>((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const row = entry as Record<string, unknown>
    return [{
      key: typeof row.key === 'string' && row.key.length ? row.key : newRowKey(),
      salesOrderId: readText(row, 'salesOrderId'),
      salesOrderLabel: readText(row, 'salesOrderLabel'),
      salesOrderLineId: readText(row, 'salesOrderLineId'),
      lineNumber: typeof row.lineNumber === 'number' ? row.lineNumber : Number(row.lineNumber ?? 0) || 0,
      productId: readText(row, 'productId'),
      catalogProductId: readText(row, 'catalogProductId'),
      productTitle: readText(row, 'productTitle'),
      productSku: readText(row, 'productSku'),
      orderedQuantity: readText(row, 'orderedQuantity'),
      quantity: readText(row, 'quantity'),
      unitPrice: readText(row, 'unitPrice'),
      currencyCode: readText(row, 'currencyCode'),
    }]
  })
}

/**
 * Builds the create/update payload: only the contract's keys, every decimal as a string (the
 * command's validators normalize them onto their fixed-scale columns, so no digit is lost to a
 * float round trip) and blank optional fields as `null` so "not set" cannot be read as the
 * previous value.
 */
export function buildShipmentPayload(values: ShipmentFormValues): Record<string, unknown> {
  return {
    carrierName: toOptionalText(values.carrierName),
    forwarderContact: toOptionalText(values.forwarderContact),
    departurePort: toOptionalText(values.departurePort),
    containerType: toOptionalText(values.containerType),
    containerNumber: toOptionalText(values.containerNumber),
    sealNumber: toOptionalText(values.sealNumber),
    bookingNumber: toOptionalText(values.bookingNumber),
    destinationWarehouseId: toOptionalText(values.destinationWarehouseId),
    destinationLocationId: toOptionalText(values.destinationLocationId),
    etd: toOptionalText(values.etd),
    eta: toOptionalText(values.eta),
    notes: toOptionalText(values.notes),
    contracts: readContracts(values.contracts)
      .filter((row) => row.contractId.trim().length > 0)
      .map((row) => ({ contractId: row.contractId.trim() })),
    allocations: readAllocations(values.allocations).map((row) => ({
      purchaseOrderLineId: row.purchaseOrderLineId.trim(),
      // Decimals travel as strings on both allocation paths: the validator normalizes them onto
      // the quantity column's scale and rejects an over-precise value, so a float round trip here
      // could only lose a digit the operator typed.
      quantity: row.allocatedQuantity.trim() ? row.allocatedQuantity.trim() : '0',
    })),
    // The sales allocation is replaced wholesale on every save (an empty list clears it), exactly
    // like the purchase side. Decimals stay strings so no digit is lost to a float round trip; the
    // order number and snapshot are resolved from the line server-side, so they are not sent.
    salesAllocations: readSalesAllocations(values.salesAllocations).map((row) => ({
      salesOrderId: row.salesOrderId.trim(),
      salesOrderLineId: row.salesOrderLineId.trim(),
      catalogProductId: row.catalogProductId.trim(),
      quantity: row.quantity.trim() ? row.quantity.trim() : '0',
      unitPrice: toOptionalText(row.unitPrice),
      currencyCode: toOptionalText(row.currencyCode),
    })),
  }
}

/** The editable shape of the `记录节点` dialog, and the body its command accepts. */
export type ShipmentMilestoneFormValues = {
  milestone: string
  occurredAt: string
  note: string
}

/**
 * Milestone bodies: the stage is only sent when it named one of the six stages (a stray value
 * would otherwise be read as a stage the command cannot place), and the optional stamps are
 * omitted rather than sent blank so the command's "now" default applies.
 */
export function buildMilestonePayload(
  shipmentId: string,
  values: ShipmentMilestoneFormValues,
): Record<string, unknown> {
  const milestone = SHIPMENT_MILESTONES.includes(values.milestone as ShipmentMilestone) ? values.milestone : ''
  const occurredAt = toOptionalText(values.occurredAt)
  const note = toOptionalText(values.note)
  return {
    shipmentId,
    milestone,
    ...(occurredAt ? { occurredAt } : {}),
    ...(note ? { note } : {}),
  }
}

/** The editable shape of the `添加单证` dialog, and the body its command accepts. */
export type ShipmentDocumentFormValues = {
  docType: string
  documentNumber: string
  issuedAt: string
  attachmentId: string
  note: string
}

export function buildDocumentPayload(
  shipmentId: string,
  values: ShipmentDocumentFormValues,
): Record<string, unknown> {
  const docType = SHIPMENT_DOCUMENT_TYPES.includes(values.docType as ShipmentDocumentType)
    ? values.docType
    : 'other'
  return {
    shipmentId,
    docType,
    documentNumber: toOptionalText(values.documentNumber),
    issuedAt: toOptionalText(values.issuedAt),
    attachmentId: toOptionalText(values.attachmentId),
    note: toOptionalText(values.note),
  }
}

/**
 * The server reports allocation problems against a nested path (`allocations.0.quantity`), so the
 * editor surfaces the first error it owns instead of only the exact `allocations` key.
 */
function firstAllocationError(errors: Record<string, string>, field = 'allocations'): string | null {
  const key = Object.keys(errors).find(
    (candidate) => candidate === field || candidate.startsWith(`${field}.`),
  )
  return key ? errors[key] ?? null : null
}

/** The two picks are labelled per surface: the create form names the goods' destination, the
 * receive dialog names the warehouse the operator is booking into. */
const DESTINATION_LABEL_KEYS: Record<'form' | 'receive', { warehouse: string; location: string }> = {
  form: {
    warehouse: 'cross_border.shipments.form.field.destinationWarehouse',
    location: 'cross_border.shipments.form.field.destinationLocation',
  },
  receive: {
    warehouse: 'cross_border.shipments.receive.warehouse',
    location: 'cross_border.shipments.receive.location',
  },
}

/**
 * The destination warehouse + location pair. Exported because the receive dialog asks for the
 * same two picks with the same defaults, so both surfaces read one implementation. The pair is
 * rendered by hand (rather than as two `select` fields) because the location options depend on
 * the warehouse the operator has currently chosen.
 */
export function ShipmentDestinationFields({
  t,
  values,
  setValue,
  required = false,
  labels = 'form',
}: CrudFormGroupComponentProps & {
  t: TranslateFn
  required?: boolean
  labels?: 'form' | 'receive'
}) {
  const warehouseId = readText(values, 'destinationWarehouseId')
  const locationId = readText(values, 'destinationLocationId')
  const labelKeys = DESTINATION_LABEL_KEYS[labels]

  const handleWarehouseChange = React.useCallback((next: string) => {
    const value = next.trim()
    setValue('destinationWarehouseId', value)
    // A location belongs to exactly one warehouse, so a warehouse change invalidates the pick.
    setValue('destinationLocationId', value === warehouseId ? locationId : '')
  }, [locationId, setValue, warehouseId])

  // Stable identities: the pickers re-run their load effect whenever `loadSuggestions` changes, and
  // an inline arrow here changed on every render of the form (every keystroke anywhere re-rendered
  // the whole thing) — each re-render refetched the list and swapped the open options for the
  // loading line, which is what made a click miss the option it was aimed at.
  const loadWarehouseSuggestions = React.useCallback(
    (query?: string) => loadWarehouseOptions(t('cross_border.shipments.form.loadFailed'), query),
    [t],
  )
  const loadLocationSuggestions = React.useCallback(
    (query?: string) => loadLocationOptions(t('cross_border.shipments.form.loadFailed'), warehouseId, query),
    [t, warehouseId],
  )

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="space-y-1.5">
        <FieldLabel required={required}>{t(labelKeys.warehouse)}</FieldLabel>
        <ComboboxInput
          value={warehouseId}
          onChange={handleWarehouseChange}
          resolveLabel={async (value) => (await resolveWarehouseLabel(value)) ?? value}
          loadSuggestions={loadWarehouseSuggestions}
          allowCustomValues={false}
          clearable
        />
      </div>
      <div className="space-y-1.5">
        <FieldLabel required={required}>{t(labelKeys.location)}</FieldLabel>
        <ComboboxInput
          value={locationId}
          onChange={(next) => setValue('destinationLocationId', next.trim())}
          resolveLabel={async (value) => (await resolveLocationLabel(value)) ?? value}
          loadSuggestions={loadLocationSuggestions}
          allowCustomValues={false}
          disabled={warehouseId.length === 0}
          clearable
        />
      </div>
    </div>
  )
}

/**
 * One contract-picker row of `ShipmentContractEditor`. A component of its own so the row keeps a
 * **stable** `loadSuggestions` across renders: an inline arrow re-ran the picker's load effect on
 * every re-render of the editor (which happens whenever the contract list changes), refetching the
 * list under the operator's cursor and replacing the open options with the loading line.
 */
function ShipmentContractRow({
  t,
  row,
  index,
  labelCache,
  onPick,
  onRemove,
}: {
  t: TranslateFn
  row: ShipmentContractValues
  index: number
  labelCache: React.RefObject<Map<string, string>>
  onPick: (index: number, patch: Partial<ShipmentContractValues>) => void
  onRemove: (index: number) => void
}) {
  const loadSuggestions = React.useCallback(async (query?: string) => {
    const loaded = await loadContractOptions(query)
    for (const option of loaded) {
      labelCache.current.set(option.value, option.label)
    }
    return loaded
  }, [labelCache])

  return (
    <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-12">
      <div className="space-y-1.5 md:col-span-10">
        <FieldLabel htmlFor={`shipment-contract-${index}`}>
          {t('cross_border.shipments.contracts.contract')}
        </FieldLabel>
        <ComboboxInput
          value={row.contractId}
          onChange={(next) => {
            onPick(index, {
              contractId: next,
              contractLabel: next ? (labelCache.current.get(next) ?? row.contractLabel) : '',
            })
          }}
          placeholder={t('cross_border.shipments.contracts.select')}
          seedOptions={
            row.contractId && row.contractLabel
              ? [{ value: row.contractId, label: row.contractLabel }]
              : undefined
          }
          loadSuggestions={loadSuggestions}
          allowCustomValues={false}
          clearable
        />
      </div>
      <div className="flex items-end justify-end md:col-span-2">
        <IconButton
          type="button"
          variant="ghost"
          size="lg"
          aria-label={t('cross_border.shipments.contracts.remove')}
          onClick={() => onRemove(index)}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  )
}

/**
 * The linked-contract editor: one picker row per contract, with add and remove.
 *
 * A shipment carries **zero or more** contracts — a consolidated container may mix goods from
 * several, and one contract is usually fulfilled by several shipments — so this is a repeating row
 * editor rather than a single select. The set is replaced wholesale on save, exactly like the
 * allocations; the number and direction are frozen server-side from `contractId`, so the picker's
 * label is display-only and never submitted.
 */
export function ShipmentContractEditor({
  t,
  values,
  setValue,
}: CrudFormGroupComponentProps & { t: TranslateFn }) {
  const contracts = readContracts(values.contracts)
  const labelCache = React.useRef(new Map<string, string>())
  const resolvedIds = React.useRef(new Set<string>())

  /**
   * A row can arrive with an id but no label — the create page prefills one when the shipment is
   * started from a contract's hub. Resolving it here (instead of threading the number through the
   * URL) keeps the payload contract unchanged and shows the operator the contract they clicked,
   * not a bare uuid; a label the API cannot resolve stays empty and the picker shows the id.
   */
  React.useEffect(() => {
    const pending = contracts.filter(
      (row) => row.contractId && !row.contractLabel && !resolvedIds.current.has(row.contractId),
    )
    if (pending.length === 0) return
    let cancelled = false
    const resolve = async () => {
      let options: CrudFieldOption[] = []
      try {
        options = await loadContractOptions()
      } catch {
        return
      }
      if (cancelled) return
      for (const option of options) {
        labelCache.current.set(option.value, option.label)
      }
      for (const row of pending) resolvedIds.current.add(row.contractId)
      setValue(
        'contracts',
        contracts.map((row) =>
          row.contractId && !row.contractLabel
            ? { ...row, contractLabel: labelCache.current.get(row.contractId) ?? '' }
            : row,
        ),
      )
    }
    void resolve()
    return () => {
      cancelled = true
    }
  }, [contracts, setValue])

  const updateRow = React.useCallback((index: number, patch: Partial<ShipmentContractValues>) => {
    setValue('contracts', contracts.map((row, position) => (position === index ? { ...row, ...patch } : row)))
  }, [contracts, setValue])

  const removeRow = React.useCallback((index: number) => {
    setValue('contracts', contracts.filter((_, position) => position !== index))
  }, [contracts, setValue])

  const addRow = React.useCallback(() => {
    setValue('contracts', [...contracts, { key: newRowKey(), contractId: '', contractLabel: '' }])
  }, [contracts, setValue])

  return (
    <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
      <h3 className="text-sm font-medium">{t('cross_border.shipments.contracts.title')}</h3>
      <p className="text-xs text-muted-foreground">{t('cross_border.shipments.contracts.help')}</p>

      {contracts.map((row, index) => (
        <ShipmentContractRow
          key={row.key}
          t={t}
          row={row}
          index={index}
          labelCache={labelCache}
          onPick={updateRow}
          onRemove={removeRow}
        />
      ))}

      <Button type="button" variant="outline" onClick={addRow}>
        <Plus className="size-4" aria-hidden="true" />
        {t('cross_border.shipments.contracts.add')}
      </Button>
    </div>
  )
}

/**
 * One order line (already selected on this shipment) that a contract line can be matched to.
 * `productId` is the owned-master id both sides carry, which is the only match key that does not
 * depend on a supplier's spelling.
 */
export type AllocationReferenceCandidate = {
  orderId: string
  orderLabel: string
  lineId: string
  lineNumber: number
  productId: string
  productTitle: string
  productSku: string
  orderedQuantity: string
}

/**
 * The allocation-side contract reference: pick one of the shipment's contracts, read its line
 * items, and match each one to an order line the shipment already allocates from (by product
 * master id). A matched row becomes an allocation in one click; an unmatched row says why and
 * points at the order picker below, which is where the over-allocation guard lives — the dialog
 * never invents an order line.
 */
function ContractAllocationReferenceDialog({
  t,
  contracts,
  loadCandidates,
  onAdd,
}: {
  t: TranslateFn
  contracts: ShipmentContractValues[]
  loadCandidates: () => Promise<Map<string, AllocationReferenceCandidate>>
  onAdd: (candidate: AllocationReferenceCandidate, quantity: string) => void | Promise<void>
}) {
  const [open, setOpen] = React.useState(false)
  const [contractId, setContractId] = React.useState('')
  const [lines, setLines] = React.useState<ContractLineOption[]>([])
  const [candidates, setCandidates] = React.useState<Map<string, AllocationReferenceCandidate>>(new Map())
  const [addedLineIds, setAddedLineIds] = React.useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const dialogContentRef = React.useRef<HTMLDivElement | null>(null)

  const loadLinesFor = React.useCallback(async (nextContractId: string) => {
    const scopedContractId = nextContractId.trim()
    setLines(scopedContractId
      ? await loadContractLines(t('cross_border.shipments.allocations.reference.loadFailed'), scopedContractId)
      : [])
  }, [t])

  const handleOpen = React.useCallback(() => {
    const presetContractId = contracts.length === 1 ? contracts[0].contractId : ''
    setOpen(true)
    setContractId(presetContractId)
    setLines([])
    setAddedLineIds(new Set())
    setError(null)
    setIsLoading(true)
    void (async () => {
      try {
        setCandidates(await loadCandidates())
        if (presetContractId) await loadLinesFor(presetContractId)
      } catch (cause) {
        setCandidates(new Map())
        setError(cause instanceof Error && cause.message
          ? cause.message
          : t('cross_border.shipments.allocations.reference.loadFailed'))
      } finally {
        setIsLoading(false)
      }
    })()
  }, [contracts, loadCandidates, loadLinesFor, t])

  const handleSelectContract = React.useCallback((nextContractId: string) => {
    setContractId(nextContractId)
    setLines([])
    setError(null)
    setIsLoading(true)
    void loadLinesFor(nextContractId)
      .catch(() => setError(t('cross_border.shipments.allocations.reference.loadFailed')))
      .finally(() => setIsLoading(false))
  }, [loadLinesFor, t])

  const handleAdd = React.useCallback(async (line: ContractLineOption, candidate: AllocationReferenceCandidate) => {
    await onAdd(candidate, line.quantity || candidate.orderedQuantity)
    setAddedLineIds((current) => new Set(current).add(line.id))
  }, [onAdd])

  const matchedLines = lines.flatMap((line) => {
    const candidate = line.productId ? candidates.get(line.productId) : undefined
    return candidate ? [{ line, candidate }] : []
  })

  const handleAddAll = React.useCallback(async () => {
    for (const { line, candidate } of matchedLines) {
      if (addedLineIds.has(line.id)) continue
      await handleAdd(line, candidate)
    }
  }, [addedLineIds, handleAdd, matchedLines])

  const handleDialogKeyDown = useDialogKeyHandler({ onCancel: () => setOpen(false) })

  return (
    <>
      <Button type="button" variant="outline" onClick={handleOpen}>
        {t('cross_border.shipments.allocations.reference.action')}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent ref={dialogContentRef} onKeyDown={handleDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>{t('cross_border.shipments.allocations.reference.title')}</DialogTitle>
            <DialogDescription>{t('cross_border.shipments.allocations.reference.description')}</DialogDescription>
          </DialogHeader>

          {contracts.length > 0 ? (
            <div className="space-y-1.5">
              <FieldLabel htmlFor="allocation-reference-contract">
                {t('cross_border.shipments.allocations.reference.contract')}
              </FieldLabel>
              <Select value={contractId} onValueChange={handleSelectContract}>
                <SelectTrigger id="allocation-reference-contract">
                  <SelectValue placeholder={t('cross_border.shipments.allocations.reference.selectContract')} />
                </SelectTrigger>
                <SelectContent>
                  {contracts.map((contract) => (
                    <SelectItem key={contract.contractId} value={contract.contractId}>
                      {contract.contractLabel || contract.contractId.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-1.5">
              <FieldLabel htmlFor="allocation-reference-contract-search">
                {t('cross_border.shipments.allocations.reference.contract')}
              </FieldLabel>
              <ComboboxInput
                value={contractId}
                onChange={handleSelectContract}
                placeholder={t('cross_border.shipments.allocations.reference.selectContract')}
                loadSuggestions={loadContractOptions}
                allowCustomValues={false}
                clearable
              />
              <p className="text-xs text-muted-foreground">
                {t('cross_border.shipments.allocations.reference.noContracts')}
              </p>
            </div>
          )}

          {error ? <p className="text-xs text-status-error-text" role="alert">{error}</p> : null}
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t('cross_border.shipments.allocations.reference.loading')}</p>
          ) : null}
          {!isLoading && contractId && lines.length === 0 && !error ? (
            <p className="text-sm text-muted-foreground">{t('cross_border.shipments.allocations.reference.empty')}</p>
          ) : null}
          {!isLoading && lines.length > 0 && matchedLines.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('cross_border.shipments.allocations.reference.noneMatched')}</p>
          ) : null}

          {lines.length > 0 ? (
            <>
              <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {lines.map((line) => {
                  const candidate = line.productId ? candidates.get(line.productId) : undefined
                  const added = addedLineIds.has(line.id)
                  return (
                    <li key={line.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm">{line.name || line.sku || line.id.slice(0, 8)}</p>
                        <p className="text-xs text-muted-foreground">
                          {[line.sku, line.unit, line.quantity].filter(Boolean).join(' · ')}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {candidate
                            ? t('cross_border.shipments.allocations.reference.matched', {
                                order: candidate.orderLabel,
                                line: String(candidate.lineNumber),
                              })
                            : t('cross_border.shipments.allocations.reference.unmatched')}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!candidate || added}
                        onClick={() => { if (candidate) void handleAdd(line, candidate) }}
                      >
                        {added
                          ? t('cross_border.shipments.allocations.reference.added')
                          : t('cross_border.shipments.allocations.reference.add')}
                      </Button>
                    </li>
                  )
                })}
              </ul>
              {matchedLines.length > 0 ? (
                <div className="flex justify-end">
                  <Button type="button" onClick={() => void handleAddAll()}>
                    {t('cross_border.shipments.allocations.reference.addAll')}
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * The allocation editor: pick a purchase order, its lines load as candidates, allocate a
 * quantity per line, and the chosen rows stay editable until the shipment is saved. A line can
 * only appear once — re-adding it is prevented here, and the command rejects it besides.
 */
function ShipmentAllocationEditor({
  t,
  values,
  setValue,
  errors,
}: CrudFormGroupComponentProps & { t: TranslateFn }) {
  const allocations = readAllocations(values.allocations)
  const [orderId, setOrderId] = React.useState('')
  const [lines, setLines] = React.useState<PurchaseOrderLineOption[]>([])
  const [draftQuantities, setDraftQuantities] = React.useState<Record<string, string>>({})
  const [linesError, setLinesError] = React.useState<string | null>(null)
  const error = firstAllocationError(errors)
  /**
   * The last suggestion payload, kept in a **ref, not state**: it is read once, when a line is added,
   * to hand `resolveOrderOptionLabel` the label the operator just saw. Holding it in state re-rendered
   * this editor on every load, which minted a new `loadSuggestions` identity for the picker, which
   * re-ran its own load effect — an endless reload that kept swapping the options for the loading
   * line and swallowed the click that was meant to select one (2026-09-30). A ref also keeps
   * `loadOrderOptions` referentially stable, which is what breaks that loop.
   */
  const orderOptionsRef = React.useRef<CrudFieldOption[]>([])

  const loadOrderOptions = React.useCallback(async (query?: string) => {
    const next = await loadAllocatablePurchaseOrderOptions(t('cross_border.shipments.form.loadFailed'), query)
    orderOptionsRef.current = next
    return next
  }, [t])

  React.useEffect(() => {
    const scopedOrderId = orderId.trim()
    if (!scopedOrderId) {
      setLines([])
      setLinesError(null)
      return
    }
    let cancelled = false
    setLinesError(null)
    loadPurchaseOrderLines(t('cross_border.shipments.form.loadFailed'), scopedOrderId)
      .then((next) => {
        if (!cancelled) setLines(next)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setLinesError(shipmentErrorMessage(cause, t('cross_border.shipments.form.loadFailed')))
      })
    return () => {
      cancelled = true
    }
  }, [orderId, t])

  const allocatedLineIds = React.useMemo(
    () => new Set(allocations.map((row) => row.purchaseOrderLineId)),
    [allocations],
  )

  const candidates = React.useMemo(
    () => lines.filter((line) => !allocatedLineIds.has(line.id)),
    [allocatedLineIds, lines],
  )

  const handleOrderChange = React.useCallback((next: string) => {
    setOrderId(next.trim())
    setDraftQuantities({})
  }, [])

  const addAllocation = React.useCallback(async (line: PurchaseOrderLineOption) => {
    const label = await resolveOrderOptionLabel(
      t,
      t('cross_border.shipments.form.loadFailed'),
      'purchase',
      orderId,
      orderOptionsRef.current.find((option) => option.value === orderId)?.label,
    )
    setValue('allocations', [...allocations, {
      key: newRowKey(),
      purchaseOrderId: orderId,
      purchaseOrderLabel: label,
      purchaseOrderLineId: line.id,
      productTitle: line.productTitle ?? '',
      productSku: line.productSku ?? '',
      supplierSku: line.supplierSku ?? '',
      orderedQuantity: line.quantity,
      allocatedQuantity: draftQuantities[line.id] ?? '',
    } satisfies ShipmentAllocationValues])
    setDraftQuantities((current) => {
      const next = { ...current }
      delete next[line.id]
      return next
    })
  }, [allocations, draftQuantities, orderId, setValue, t])

  const updateAllocation = React.useCallback((index: number, quantity: string) => {
    setValue(
      'allocations',
      allocations.map((row, position) => (
        position === index ? { ...row, allocatedQuantity: quantity } : row
      )),
    )
  }, [allocations, setValue])

  const removeAllocation = React.useCallback((index: number) => {
    setValue('allocations', allocations.filter((_, position) => position !== index))
  }, [allocations, setValue])

  // Candidates for the contract reference: the lines of the orders this shipment already
  // allocates from, keyed by the owned product id. First line wins when a product repeats.
  const loadReferenceCandidates = React.useCallback(async () => {
    const byProduct = new Map<string, AllocationReferenceCandidate>()
    const orderIds = Array.from(new Set(allocations.map((row) => row.purchaseOrderId).filter(Boolean)))
    for (const scopedOrderId of orderIds) {
      const label = await resolveOrderOptionLabel(
        t,
        t('cross_border.shipments.form.loadFailed'),
        'purchase',
        scopedOrderId,
        allocations.find((row) => row.purchaseOrderId === scopedOrderId)?.purchaseOrderLabel,
      )
      const orderLines = await loadPurchaseOrderLines(t('cross_border.shipments.form.loadFailed'), scopedOrderId)
      for (const line of orderLines) {
        if (!line.productId || byProduct.has(line.productId)) continue
        byProduct.set(line.productId, {
          orderId: scopedOrderId,
          orderLabel: label,
          lineId: line.id,
          lineNumber: line.lineNumber,
          productId: line.productId,
          productTitle: line.productTitle ?? '',
          productSku: line.productSku ?? '',
          orderedQuantity: line.quantity,
        })
      }
    }
    return byProduct
  }, [allocations, t])

  const addReferenceAllocation = React.useCallback((candidate: AllocationReferenceCandidate, quantity: string) => {
    if (allocations.some((row) => row.purchaseOrderLineId === candidate.lineId)) return
    setValue('allocations', [...allocations, {
      key: newRowKey(),
      purchaseOrderId: candidate.orderId,
      purchaseOrderLabel: candidate.orderLabel,
      purchaseOrderLineId: candidate.lineId,
      productTitle: candidate.productTitle,
      productSku: candidate.productSku,
      supplierSku: '',
      orderedQuantity: candidate.orderedQuantity,
      allocatedQuantity: quantity,
    } satisfies ShipmentAllocationValues])
  }, [allocations, setValue])

  return (
    <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{t('cross_border.shipments.allocations.title')}</h3>
        <ContractAllocationReferenceDialog
          t={t}
          contracts={readContracts(values.contracts)}
          loadCandidates={loadReferenceCandidates}
          onAdd={addReferenceAllocation}
        />
      </div>

      {error ? <p className="text-xs text-status-error-text" role="alert">{error}</p> : null}

      <div className="space-y-1.5">
        <FieldLabel>{t('cross_border.shipments.allocations.purchaseOrder')}</FieldLabel>
        <ComboboxInput
          value={orderId}
          onChange={handleOrderChange}
          loadSuggestions={loadOrderOptions}
          allowCustomValues={false}
          clearable
        />
      </div>

      {linesError ? <p className="text-xs text-status-error-text" role="alert">{linesError}</p> : null}

      {candidates.map((line) => (
        <div key={line.id} className="flex flex-wrap items-end gap-3 rounded-md border bg-background p-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{line.productTitle ?? line.id}</p>
            <p className="text-xs text-muted-foreground">
              {line.productSku ? `${line.productSku} · ` : ''}
              {line.supplierSku ? `${t('cross_border.shipments.allocations.supplierSku')}: ${line.supplierSku} · ` : ''}
              {t('cross_border.shipments.allocations.ordered')}: {trimShipmentQuantity(line.quantity)}
            </p>
          </div>
          <div className="w-32 space-y-1.5">
            <FieldLabel>{t('cross_border.shipments.allocations.quantity')}</FieldLabel>
            <Input
              type="number"
              min="0"
              step="any"
              max={trimShipmentQuantity(line.quantity)}
              value={draftQuantities[line.id] ?? ''}
              onChange={(event) => {
                const value = event.target.value
                setDraftQuantities((current) => ({ ...current, [line.id]: value }))
              }}
            />
          </div>
          <Button type="button" variant="outline" onClick={() => addAllocation(line)}>
            <Plus className="size-4" aria-hidden="true" />
            {t('cross_border.shipments.allocations.add')}
          </Button>
        </div>
      ))}

      {allocations.map((row, index) => (
        <div key={row.key} className="rounded-md border bg-background p-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="md:col-span-4">
              <FieldLabel>{t('cross_border.shipments.allocations.purchaseOrder')}</FieldLabel>
              <p className="text-sm">{row.purchaseOrderLabel || row.purchaseOrderId}</p>
            </div>
            <div className="md:col-span-4">
              <FieldLabel>{t('cross_border.shipments.allocations.product')}</FieldLabel>
              <p className="truncate text-sm" title={row.productTitle}>
                {row.productTitle || row.purchaseOrderLineId}
              </p>
              {row.productSku ? (
                <p className="text-xs text-muted-foreground">{row.productSku}</p>
              ) : null}
              {row.supplierSku ? (
                <p className="text-xs text-muted-foreground">
                  {t('cross_border.shipments.allocations.supplierSku')}: {row.supplierSku}
                </p>
              ) : null}
            </div>
            <div className="md:col-span-1">
              <FieldLabel>{t('cross_border.shipments.allocations.ordered')}</FieldLabel>
              <p className="text-sm tabular-nums">{trimShipmentQuantity(row.orderedQuantity)}</p>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <FieldLabel required>{t('cross_border.shipments.allocations.quantity')}</FieldLabel>
              <Input
                type="number"
                min="0"
                step="any"
                value={row.allocatedQuantity}
                onChange={(event) => updateAllocation(index, event.target.value)}
              />
            </div>
            <div className="flex items-end justify-end md:col-span-1">
              <IconButton
                type="button"
                variant="ghost"
                size="lg"
                aria-label={t('cross_border.shipments.allocations.remove')}
                onClick={() => removeAllocation(index)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * The **sales** allocation editor: pick a sales order (either trade type, since 2026-09-30), its
 * lines load as candidates,
 * allocate a quantity per line, and the row carries the line's frozen price/currency. The product
 * is derived from the picked line — its app-owned product is resolved to the installed catalog
 * product through the same product picker the rest of the app uses — so a line that is not bridged
 * to the catalog cannot be allocated (the command refuses it too). A line can only appear once.
 */
function ShipmentSalesAllocationEditor({
  t,
  values,
  setValue,
  errors,
}: CrudFormGroupComponentProps & { t: TranslateFn }) {
  const { organizationId } = useOrganizationScopeDetail()
  const allocations = readSalesAllocations(values.salesAllocations)
  const [orderId, setOrderId] = React.useState('')
  const [lines, setLines] = React.useState<SalesOrderLineOption[]>([])
  const [draftQuantities, setDraftQuantities] = React.useState<Record<string, string>>({})
  const [linesError, setLinesError] = React.useState<string | null>(null)
  const productCache = React.useRef(new Map<string, ProductOption | null>())
  const error = firstAllocationError(errors, 'salesAllocations')
  /**
   * The last suggestion payload, in a ref for the same reason as the purchase editor's: it feeds the
   * picked row's label, and holding it in state re-rendered the editor on every load — which
   * re-minted the picker's `loadSuggestions` and reloaded the suggestions forever (2026-09-30).
   */
  const orderOptionsRef = React.useRef<CrudFieldOption[]>([])

  const loadOrderOptions = React.useCallback(async (query?: string) => {
    const next = await loadSalesOrderOptions(
      t,
      t('cross_border.shipments.salesAllocations.loadLinesFailed'),
      query,
      // A document written before statuses existed is still allocatable; its label says so.
      { unmarkedStatusLabel: t('cross_border.shipments.salesAllocations.unmarkedStatus', 'status not marked') },
    )
    orderOptionsRef.current = next
    return next
  }, [t])

  React.useEffect(() => {
    const scopedOrderId = orderId.trim()
    if (!scopedOrderId) {
      setLines([])
      setLinesError(null)
      return
    }
    let cancelled = false
    setLinesError(null)
    loadSalesOrderLineOptions(t('cross_border.shipments.salesAllocations.loadLinesFailed'), scopedOrderId)
      .then((next) => {
        if (!cancelled) setLines(next)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setLinesError(shipmentErrorMessage(cause, t('cross_border.shipments.salesAllocations.loadLinesFailed')))
      })
    return () => {
      cancelled = true
    }
  }, [orderId, t])

  const allocatedLineIds = React.useMemo(
    () => new Set(allocations.map((row) => row.salesOrderLineId)),
    [allocations],
  )

  const candidates = React.useMemo(
    () => lines.filter((line) => !allocatedLineIds.has(line.id)),
    [allocatedLineIds, lines],
  )

  const resolveProduct = React.useCallback(async (productId: string): Promise<ProductOption | null> => {
    if (!productId) return null
    if (productCache.current.has(productId)) return productCache.current.get(productId) ?? null
    const option = await loadProductOption(
      productId,
      t('cross_border.shipments.salesAllocations.loadLinesFailed'),
      organizationId,
    ).catch(() => null)
    productCache.current.set(productId, option)
    return option
  }, [organizationId, t])

  const handleOrderChange = React.useCallback((next: string) => {
    setOrderId(next.trim())
    setDraftQuantities({})
  }, [])

  const addAllocation = React.useCallback(async (line: SalesOrderLineOption) => {
    const option = await resolveProduct(line.productId)
    const catalogProductId = option?.catalogProductId ?? ''
    if (!catalogProductId) {
      // The catalog product is what a commercial invoice aggregates on; a line without the bridge
      // would be stored against nothing, so it is refused here with the reason instead of at save.
      flash(t('cross_border.shipments.salesAllocations.notBridged'), 'error')
      return
    }
    const label = await resolveOrderOptionLabel(
      t,
      t('cross_border.shipments.salesAllocations.loadLinesFailed'),
      'sales',
      orderId,
      orderOptionsRef.current.find((candidate) => candidate.value === orderId)?.label,
    )
    setValue('salesAllocations', [...allocations, {
      key: newRowKey(),
      salesOrderId: orderId,
      salesOrderLabel: label,
      salesOrderLineId: line.id,
      lineNumber: line.lineNumber,
      productId: line.productId,
      catalogProductId,
      productTitle: option?.name || line.productTitle,
      productSku: option?.sku || line.productSku,
      orderedQuantity: line.quantity,
      quantity: draftQuantities[line.id] ?? '',
      unitPrice: line.unitPrice,
      currencyCode: line.currencyCode,
    } satisfies ShipmentSalesAllocationValues])
    setDraftQuantities((current) => {
      const next = { ...current }
      delete next[line.id]
      return next
    })
  }, [allocations, draftQuantities, orderId, resolveProduct, setValue, t])

  const updateAllocation = React.useCallback((index: number, patch: Partial<ShipmentSalesAllocationValues>) => {
    setValue(
      'salesAllocations',
      allocations.map((row, position) => (position === index ? { ...row, ...patch } : row)),
    )
  }, [allocations, setValue])

  const removeAllocation = React.useCallback((index: number) => {
    setValue('salesAllocations', allocations.filter((_, position) => position !== index))
  }, [allocations, setValue])

  // Candidates for the contract reference: the lines of the sales orders this shipment already
  // allocates from, keyed by the owned product id (first line wins on a repeat).
  const loadReferenceCandidates = React.useCallback(async () => {
    const byProduct = new Map<string, AllocationReferenceCandidate>()
    const orderIds = Array.from(new Set(allocations.map((row) => row.salesOrderId).filter(Boolean)))
    for (const scopedOrderId of orderIds) {
      const label = await resolveOrderOptionLabel(
        t,
        t('cross_border.shipments.salesAllocations.loadLinesFailed'),
        'sales',
        scopedOrderId,
        allocations.find((row) => row.salesOrderId === scopedOrderId)?.salesOrderLabel,
      )
      const orderLines = await loadSalesOrderLineOptions(t('cross_border.shipments.salesAllocations.loadLinesFailed'), scopedOrderId)
      for (const line of orderLines) {
        if (!line.productId || byProduct.has(line.productId)) continue
        byProduct.set(line.productId, {
          orderId: scopedOrderId,
          orderLabel: label,
          lineId: line.id,
          lineNumber: line.lineNumber,
          productId: line.productId,
          productTitle: line.productTitle,
          productSku: line.productSku,
          orderedQuantity: line.quantity,
        })
      }
    }
    return byProduct
  }, [allocations, t])

  const addReferenceAllocation = React.useCallback(async (candidate: AllocationReferenceCandidate, quantity: string) => {
    if (allocations.some((row) => row.salesOrderLineId === candidate.lineId)) return
    const option = await resolveProduct(candidate.productId)
    const catalogProductId = option?.catalogProductId ?? ''
    if (!catalogProductId) {
      // Same rule as the manual add path: a line without a catalog bridge cannot be stored.
      flash(t('cross_border.shipments.salesAllocations.notBridged'), 'error')
      return
    }
    setValue('salesAllocations', [...allocations, {
      key: newRowKey(),
      salesOrderId: candidate.orderId,
      salesOrderLabel: candidate.orderLabel,
      salesOrderLineId: candidate.lineId,
      lineNumber: candidate.lineNumber,
      productId: candidate.productId,
      catalogProductId,
      productTitle: candidate.productTitle,
      productSku: candidate.productSku,
      orderedQuantity: candidate.orderedQuantity,
      quantity: quantity || candidate.orderedQuantity,
      unitPrice: '',
      currencyCode: '',
    } satisfies ShipmentSalesAllocationValues])
  }, [allocations, resolveProduct, setValue, t])

  return (
    <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{t('cross_border.shipments.salesAllocations.title')}</h3>
        <ContractAllocationReferenceDialog
          t={t}
          contracts={readContracts(values.contracts)}
          loadCandidates={loadReferenceCandidates}
          onAdd={addReferenceAllocation}
        />
      </div>

      {error ? <p className="text-xs text-status-error-text" role="alert">{error}</p> : null}

      <div className="space-y-1.5">
        <FieldLabel>{t('cross_border.shipments.salesAllocations.salesOrder')}</FieldLabel>
        <ComboboxInput
          value={orderId}
          onChange={handleOrderChange}
          loadSuggestions={loadOrderOptions}
          allowCustomValues={false}
          clearable
        />
      </div>

      {linesError ? <p className="text-xs text-status-error-text" role="alert">{linesError}</p> : null}

      {lines.length > 0 && candidates.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('cross_border.shipments.salesAllocations.noLines')}</p>
      ) : null}

      {candidates.map((line) => (
        <div key={line.id} className="flex flex-wrap items-end gap-3 rounded-md border bg-background p-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{line.productTitle || line.id}</p>
            <p className="text-xs text-muted-foreground">
              {line.productSku ? `${line.productSku} · ` : ''}
              {t('cross_border.shipments.salesAllocations.line')}: {line.lineNumber} ·{' '}
              {t('cross_border.shipments.salesAllocations.ordered')}: {trimShipmentQuantity(line.quantity)}
            </p>
          </div>
          <div className="w-32 space-y-1.5">
            <FieldLabel>{t('cross_border.shipments.salesAllocations.quantity')}</FieldLabel>
            <Input
              type="number"
              min="0"
              step="any"
              value={draftQuantities[line.id] ?? ''}
              onChange={(event) => {
                const value = event.target.value
                setDraftQuantities((current) => ({ ...current, [line.id]: value }))
              }}
            />
          </div>
          <Button type="button" variant="outline" onClick={() => { void addAllocation(line) }}>
            <Plus className="size-4" aria-hidden="true" />
            {t('cross_border.shipments.salesAllocations.add')}
          </Button>
        </div>
      ))}

      {allocations.map((row, index) => (
        <div key={row.key} className="rounded-md border bg-background p-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="md:col-span-3">
              <FieldLabel>{t('cross_border.shipments.salesAllocations.salesOrder')}</FieldLabel>
              <p className="text-sm">{row.salesOrderLabel || row.salesOrderId}</p>
            </div>
            <div className="md:col-span-3">
              <FieldLabel>{t('cross_border.shipments.salesAllocations.product')}</FieldLabel>
              <p className="truncate text-sm" title={row.productTitle}>
                {row.productTitle || row.salesOrderLineId}
              </p>
              {row.productSku ? (
                <p className="text-xs text-muted-foreground">{row.productSku}</p>
              ) : null}
            </div>
            <div className="md:col-span-1">
              <FieldLabel>{t('cross_border.shipments.salesAllocations.ordered')}</FieldLabel>
              <p className="text-sm tabular-nums">{trimShipmentQuantity(row.orderedQuantity)}</p>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <FieldLabel required>{t('cross_border.shipments.salesAllocations.quantity')}</FieldLabel>
              <Input
                type="number"
                min="0"
                step="any"
                value={row.quantity}
                onChange={(event) => updateAllocation(index, { quantity: event.target.value })}
              />
            </div>
            <div className="space-y-1.5 md:col-span-1">
              <FieldLabel>{t('cross_border.shipments.salesAllocations.unitPrice')}</FieldLabel>
              <Input
                type="number"
                min="0"
                step="any"
                value={row.unitPrice}
                onChange={(event) => updateAllocation(index, { unitPrice: event.target.value })}
              />
            </div>
            <div className="space-y-1.5 md:col-span-1">
              <FieldLabel>{t('cross_border.shipments.salesAllocations.currency')}</FieldLabel>
              <Input
                maxLength={3}
                value={row.currencyCode}
                onChange={(event) => updateAllocation(index, { currencyCode: event.target.value.toUpperCase() })}
              />
            </div>
            <div className="flex items-end justify-end md:col-span-1">
              <IconButton
                type="button"
                variant="ghost"
                size="lg"
                aria-label={t('cross_border.shipments.salesAllocations.remove')}
                onClick={() => removeAllocation(index)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function useShipmentFields(t: TranslateFn): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    {
      id: 'carrierName',
      label: t('cross_border.shipments.form.field.carrierName'),
      // Suggestions from the `carrier` dictionary this module seeds; typing stays allowed so a
      // carrier or forwarder the list does not carry yet never blocks a shipment.
      type: 'combobox',
      layout: 'half',
      description: t('cross_border.shipments.form.field.carrierNameHelp'),
      allowCustomValues: true,
      resolveLabel: (value) => value,
      loadOptions: (query) => loadCarrierOptions(query),
    },
    {
      id: 'forwarderContact',
      label: t('cross_border.shipments.form.field.forwarderContact'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'departurePort',
      label: t('cross_border.shipments.form.field.departurePort'),
      // Same `port` dictionary the contract header's 目的地 reads; a port it does not list yet can
      // still be typed, because a booking is never held up by a dictionary gap.
      type: 'combobox',
      layout: 'half',
      description: t('cross_border.shipments.form.field.departurePortHelp'),
      allowCustomValues: true,
      resolveLabel: (value) => value,
      loadOptions: (query) => loadPortOptions(query),
    },
    {
      id: 'containerType',
      label: t('cross_border.shipments.field.containerType'),
      type: 'select',
      layout: 'half',
      loadOptions: (query) => loadContainerTypeOptions(query),
    },
    {
      id: 'containerNumber',
      label: t('cross_border.shipments.field.containerNumber'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'sealNumber',
      label: t('cross_border.shipments.field.sealNumber'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'bookingNumber',
      label: t('cross_border.shipments.field.bookingNumber'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'etd',
      label: t('cross_border.shipments.form.field.etd'),
      type: 'date',
      layout: 'half',
    },
    {
      id: 'eta',
      label: t('cross_border.shipments.form.field.eta'),
      type: 'date',
      layout: 'half',
    },
    {
      id: 'notes',
      label: t('cross_border.shipments.form.field.notes'),
      type: 'textarea',
      layout: 'half',
    },
  ], [t])
}

export default function ShipmentForm() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const fields = useShipmentFields(t)

  /**
   * Arriving from a contract's hub (`?contractId=`) starts the shipment with that contract already
   * linked: the click said which contract this container belongs to, and re-picking it is busywork.
   * The label stays empty because it is display-only — the picker resolves it from its options.
   */
  const initialValues = React.useMemo<ShipmentFormValues>(() => {
    const contractId = searchParams.get('contractId')?.trim() ?? ''
    if (!contractId) return EMPTY_SHIPMENT_VALUES
    return {
      ...EMPTY_SHIPMENT_VALUES,
      contracts: [{ key: newRowKey(), contractId, contractLabel: '' }],
    }
  }, [searchParams])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'header',
      column: 1,
      fields: [
        'carrierName',
        'forwarderContact',
        'departurePort',
        'containerType',
        'containerNumber',
        'sealNumber',
        'bookingNumber',
        'etd',
        'eta',
        'notes',
      ],
    },
    {
      id: 'destination',
      column: 1,
      bare: true,
      component: (context) => <ShipmentDestinationFields {...context} t={t} />,
    },
    {
      id: 'contracts',
      column: 1,
      bare: true,
      component: (context) => <ShipmentContractEditor {...context} t={t} />,
    },
    {
      id: 'allocations',
      column: 1,
      bare: true,
      component: (context) => <ShipmentAllocationEditor {...context} t={t} />,
    },
    {
      id: 'salesAllocations',
      column: 1,
      bare: true,
      component: (context) => <ShipmentSalesAllocationEditor {...context} t={t} />,
    },
  ], [t])

  const handleSubmit = React.useCallback(async (values: ShipmentFormValues) => {
    try {
      const result = await createCrud<{ id?: string }>(
        SHIPMENTS_API_PATH,
        buildShipmentPayload(values),
      )
      const createdId = typeof result.result?.id === 'string' ? result.result.id : null
      if (createdId) {
        // The detail page is the only surface that shows the allocations, the milestone
        // timeline and the documents, so the create flow hands the user straight to it.
        pushWithFlash(
          router,
          `${SHIPMENTS_LIST_HREF}/${encodeURIComponent(createdId)}`,
          t('cross_border.shipments.form.saved'),
          'success',
        )
        return
      }
      pushWithFlash(router, SHIPMENTS_LIST_HREF, t('cross_border.shipments.form.saved'), 'success')
    } catch (error) {
      flash(t('cross_border.shipments.form.saveFailed'), 'error')
      throw error
    }
  }, [router, t])

  return (
    <CrudForm<ShipmentFormValues>
      title={t('cross_border.shipments.form.createTitle')}
      titleHeadingLevel={1}
      backHref={SHIPMENTS_LIST_HREF}
      fields={fields}
      groups={groups}
      initialValues={initialValues}
      submitLabel={t('cross_border.shipments.form.save')}
      cancelHref={SHIPMENTS_LIST_HREF}
      onSubmit={handleSubmit}
    />
  )
}
