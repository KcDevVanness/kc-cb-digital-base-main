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
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { pushWithFlash } from '@open-mercato/ui/backend/utils/flash'
import { Button } from '@open-mercato/ui/primitives/button'
import { FieldLabel } from '@open-mercato/ui/primitives/label'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import {
  formatDisplayDate,
  toUtcDateInputValue,
} from '@open-mercato/ui/primitives/date-format'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { loadCarrierOptions, loadContainerTypeOptions, loadPortOptions } from './shipmentFormOptions'

/**
 * This file owns the shipment contract shared with the list and detail surfaces: the record
 * shape and its payload mapper, the status/milestone vocabularies, the date renderers, the
 * option loaders for the fields that reference other modules, and the two allocation-sized
 * editors (destination picker, allocation rows). Keeping them here means the value the list
 * renders, the value the form submits, and the value the detail page shows cannot drift apart.
 */

export const SHIPMENTS_API_PATH = 'cross_border/shipments'
export const SHIPMENT_ALLOCATIONS_API_PATH = 'cross_border/shipments/allocations'
export const SHIPMENT_MILESTONES_API_PATH = 'cross_border/shipments/milestones'
export const SHIPMENT_DOCUMENTS_API_PATH = 'cross_border/shipments/documents'
export const SHIPMENT_DEPART_API_PATH = 'cross_border/shipments/depart'
export const SHIPMENT_RECEIVE_API_PATH = 'cross_border/shipments/receive'
export const SHIPMENT_CANCEL_API_PATH = 'cross_border/shipments/cancel'
export const SHIPMENTS_LIST_HREF = '/backend/cross_border/shipments'

const PURCHASE_ORDERS_API_URL = '/api/purchasing/purchase-orders'
const PURCHASE_ORDER_LINES_API_URL = '/api/purchasing/purchase-orders/lines'
const WAREHOUSES_API_URL = '/api/wms/warehouses'
const LOCATIONS_API_URL = '/api/wms/locations'
const OPTION_PAGE_SIZE = 50
const OPTION_ID_PAGE_SIZE = 1

/** Statuses the list filter offers, in the order the state machine walks them. */
export const SHIPMENT_STATUSES = ['draft', 'in_transit', 'received', 'cancelled'] as const
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number]

const SHIPMENT_STATUS_MAP: StatusMap<ShipmentStatus> = {
  draft: 'neutral',
  in_transit: 'info',
  received: 'success',
  cancelled: 'error',
}

const SHIPMENT_STATUS_LABEL_KEYS: Record<ShipmentStatus, string> = {
  draft: 'cross_border.shipments.status.draft',
  in_transit: 'cross_border.shipments.status.in_transit',
  received: 'cross_border.shipments.status.received',
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
 * CrudForm's number fields hand back a number once edited and the raw string while untouched,
 * and a cleared field hands back `undefined`; every decimal the form produces goes through here.
 */
export function toShipmentNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed.length) return null
  const numeric = Number(trimmed)
  return Number.isFinite(numeric) ? numeric : null
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

/** A purchase-order line as `/api/purchasing/purchase-orders/lines` projects it. */
export type PurchaseOrderLineOption = {
  id: string
  lineNumber: number
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
  allocations: ShipmentAllocationValues[]
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
  allocations: [],
}

function newRowKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `allocation-${Date.now()}-${Math.round(performance.now())}`
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

/**
 * Builds the create/update payload: only the contract's keys, decimals as numbers (the command
 * coerces them onto their fixed-scale columns) and blank optional fields as `null` so "not set"
 * cannot be read as the previous value.
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
    allocations: readAllocations(values.allocations).map((row) => ({
      purchaseOrderLineId: row.purchaseOrderLineId.trim(),
      quantity: toShipmentNumber(row.allocatedQuantity) ?? 0,
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
function firstAllocationError(errors: Record<string, string>): string | null {
  const key = Object.keys(errors).find(
    (candidate) => candidate === 'allocations' || candidate.startsWith('allocations.'),
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

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="space-y-1.5">
        <FieldLabel required={required}>{t(labelKeys.warehouse)}</FieldLabel>
        <ComboboxInput
          value={warehouseId}
          onChange={handleWarehouseChange}
          resolveLabel={async (value) => (await resolveWarehouseLabel(value)) ?? value}
          loadSuggestions={(query) => loadWarehouseOptions(t('cross_border.shipments.form.loadFailed'), query)}
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
          loadSuggestions={(query) => loadLocationOptions(
            t('cross_border.shipments.form.loadFailed'),
            warehouseId,
            query,
          )}
          allowCustomValues={false}
          disabled={warehouseId.length === 0}
          clearable
        />
      </div>
    </div>
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
  const [orderOptions, setOrderOptions] = React.useState<CrudFieldOption[]>([])
  const [lines, setLines] = React.useState<PurchaseOrderLineOption[]>([])
  const [draftQuantities, setDraftQuantities] = React.useState<Record<string, string>>({})
  const [linesError, setLinesError] = React.useState<string | null>(null)
  const error = firstAllocationError(errors)

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

  const addAllocation = React.useCallback((line: PurchaseOrderLineOption) => {
    const label = orderOptions.find((option) => option.value === orderId)?.label ?? orderId
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
  }, [allocations, draftQuantities, orderId, orderOptions, setValue])

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

  return (
    <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
      <h3 className="text-sm font-medium">{t('cross_border.shipments.allocations.title')}</h3>

      {error ? <p className="text-xs text-status-error-text" role="alert">{error}</p> : null}

      <div className="space-y-1.5">
        <FieldLabel>{t('cross_border.shipments.allocations.purchaseOrder')}</FieldLabel>
        <ComboboxInput
          value={orderId}
          onChange={handleOrderChange}
          loadSuggestions={async (query) => {
            const next = await loadAllocatablePurchaseOrderOptions(
              t('cross_border.shipments.form.loadFailed'),
              query,
            )
            setOrderOptions(next)
            return next
          }}
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
  const fields = useShipmentFields(t)

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
      id: 'allocations',
      column: 1,
      bare: true,
      component: (context) => <ShipmentAllocationEditor {...context} t={t} />,
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
      initialValues={EMPTY_SHIPMENT_VALUES}
      submitLabel={t('cross_border.shipments.form.save')}
      cancelHref={SHIPMENTS_LIST_HREF}
      onSubmit={handleSubmit}
    />
  )
}
