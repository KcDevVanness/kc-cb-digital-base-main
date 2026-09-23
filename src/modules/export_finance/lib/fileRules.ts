import { parseExactDecimal, type ExactDecimal } from '@open-mercato/core/modules/dashboards/lib/exactDecimal'
import {
  multiplyExactDecimal,
  quantizeExactDecimal,
  STORED_AMOUNT_SCALE,
  toAmountString,
} from '../../trade_docs/lib/money'
import type { OrderFileStatus } from '../data/validators'

/**
 * The derivation rules of the 订单档案 (order file) and the 柜档案 (container file): every column
 * that is not simply a stored field is defined here and nowhere else.
 *
 * Deliberately I/O-free — no database, no request, no framework import beyond the money engine and
 * the status enum — so the rules can be unit tested directly and the two projections that use them
 * can only fetch and assemble. Nothing here is persisted: the derived business status, the finance
 * view, the tax-refund allocation and the document checklists are recomputed per request and
 * therefore cannot drift from their sources.
 */

const STATUS_LEVELS: Record<string, number> = {
  unknown: 0,
  not_started: 1,
  applied: 2,
  completed: 3,
}

/** 采购·合同类 — the seven documents that belong to the order itself. */
export const ORDER_PURCHASE_CHECKLIST_KEYS = [
  'supplierInvoice',
  'packingList',
  'purchasePaymentReceipt',
  'purchaseContract',
  'salesContract',
  'kcInvoiceStamped',
  'foreignIncomeCertificate',
] as const

/**
 * 出口类 — the five documents that belong to a container, and therefore to every order inside it.
 * The order file and the container file check the same five keys, so the list lives once here.
 */
export const EXPORT_DOCUMENT_CHECKLIST_KEYS = [
  'so',
  'telexRelease',
  'customsDeclaration',
  'domesticFreight',
  'bookingCharges',
] as const

export const ORDER_EXPORT_CHECKLIST_KEYS = EXPORT_DOCUMENT_CHECKLIST_KEYS

export const ORDER_CHECKLIST_KEYS = [
  ...ORDER_PURCHASE_CHECKLIST_KEYS,
  ...ORDER_EXPORT_CHECKLIST_KEYS,
] as const

export type OrderChecklistKey = (typeof ORDER_CHECKLIST_KEYS)[number]
export type OrderChecklist = Record<OrderChecklistKey, boolean>
export type ExportDocumentChecklist = Record<(typeof EXPORT_DOCUMENT_CHECKLIST_KEYS)[number], boolean>

export type ChecklistDocumentRow = {
  docType: string
  attachmentId: string | null
}

export type ContractRow = {
  id: string
  direction: string
  status: string
  sourceKind: string | null
  sourceId: string | null
  financeTotal: string
  currencyCode: string
  exchangeRate: string | null
  attachmentId: string | null
  generatedAttachmentId: string | null
  updatedAt: Date | string | null
}

export type InvoiceRow = {
  id: string
  contractId: string | null
  direction: string
  status: string
  total: string
  currencyCode: string
  attachmentId: string | null
  issuedAt: Date | string | null
  updatedAt: Date | string | null
}

export type AllocationOrder = {
  purchaseOrderId: string
  number: string | null
  total: string
}

export type OrderContainerRef = {
  shipmentId: string
  shipmentNumber: string | null
  shipmentStatus: string
  currentMilestone: string | null
  pickedUp: boolean
  departed: boolean
  departedAt: Date | string | null
  receivedAt: Date | string | null
  etd: Date | string | null
  containerType: string | null
  containerNumber: string | null
  sealNumber: string | null
  bookingNumber: string | null
  createdAt: Date | string | null
  taxRefundStatus: string
  taxRefundAmount: string | null
  taxRefundNote: string | null
}

export type FinanceView = {
  orderAmount: string
  depositPlanned: string | null
  balancePlanned: string | null
  paidAmount: string
  outstandingAmount: string
  kcPriceAmount: string | null
  kcPriceCurrency: string | null
  subsidiaryInvoiceAmount: string | null
  subsidiaryInvoiceCurrency: string | null
  exchangeRate: string | null
}

export type OrderFileRow = {
  purchaseOrderId: string
  number: string | null
  businessNumber: string | null
  supplierName: string | null
  ownerName: string | null
  customerName: string | null
  productCategory: string | null
  businessStatus: OrderFileStatus
  placedAt: string | null
  expectedDeliveryAt: string | null
  shipmentEtd: string | null
  shipmentDepartedAt: string | null
  receivedAt: string | null
  containerType: string | null
  containerNumber: string | null
  sealNumber: string | null
  bookingNumber: string | null
  shipmentCount: number
  finance: FinanceView
  collectionStatus: string
  refundStatus: string
  allocatedRefundAmount: string | null
  containers: Array<{
    shipmentId: string
    shipmentNumber: string | null
    status: string
    currentMilestone: string | null
    containerNumber: string | null
    departedAt: string | null
    receivedAt: string | null
    taxRefundStatus: string
    taxRefundAmount: string | null
    taxRefundNote: string | null
  }>
  checklist: OrderChecklist
  checklistMissing: string[]
}

export type OrderFileFilters = {
  /** Locks the projection to one order — how a detail page loads exactly its own row. */
  purchaseOrderId?: string
  status?: OrderFileStatus
  collectionStatus?: string
  taxRefundStatus?: string
  search?: string
}

export type OrderFileListParams = {
  tenantId: string
  organizationIds: string[]
  filters: OrderFileFilters
  page: number
  pageSize: number
  sortField: 'placed_at' | 'expected_delivery' | 'total'
  sortDir: 'asc' | 'desc'
}

function parseAmount(value: string | number | null | undefined): ExactDecimal | null {
  if (value === null || value === undefined) return null
  return parseExactDecimal(value)
}

/** Quantizes an amount to a display scale; `null` stays `null` (never 0). */
function quantizeAmount(value: string | null | undefined, scale: number): string | null {
  const parsed = parseAmount(value)
  if (!parsed) return null
  return toAmountString(parsed, scale)
}

/**
 * Scaled-integer units of an amount at `scale`. All money comparisons and ratios in this module
 * go through scaled integers: comparing `numeric(18,4)` strings as floats would lose cents
 * beyond 2^53 and would make a refund total depend on the machine's arithmetic.
 */
export function toScaledUnits(value: string | number | null | undefined, scale: number): bigint {
  const parsed = parseAmount(value)
  return parsed ? quantizeExactDecimal(parsed, scale).units : 0n
}

/** Scaled-integer division, half away from zero — the only rounding this module performs itself. */
export function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) return 0n
  const negative = (numerator < 0n) !== (denominator < 0n)
  const absNumerator = numerator < 0n ? -numerator : numerator
  const absDenominator = denominator < 0n ? -denominator : denominator
  let quotient = absNumerator / absDenominator
  if ((absNumerator % absDenominator) * 2n >= absDenominator) quotient += 1n
  return negative ? -quotient : quotient
}

/**
 * `total × percent ÷ 100` quantized to the currency scale.
 *
 * The division is folded into the percentage's scale (`scale + 2`) instead of dividing, so the
 * whole computation stays in scaled integers: `20%` of `6000.005` is rounded once, by the money
 * engine, and never by a float.
 */
function depositFromPercent(totalValue: string, percentValue: string, currencyScale: number): string | null {
  const total = parseAmount(totalValue)
  const percent = parseAmount(percentValue)
  if (!total || !percent) return null
  const shiftedPercent: ExactDecimal = { units: percent.units, scale: percent.scale + 2 }
  return toAmountString(multiplyExactDecimal(total, shiftedPercent), currencyScale)
}

/**
 * The 订单状态 column of the business view — derived, never stored.
 *
 * Priority, highest first: `cancelled` > `closed` > `received` > `shipped` (the order is shipped
 * or the goods actually departed) > `factory_pickup` (the order is placed and at least one of its
 * containers has the `picked_up` milestone) > `placed` > `draft`.
 */
export function deriveBusinessStatus(input: { poStatus: string; pickedUp: boolean; departed: boolean }): OrderFileStatus {
  if (input.poStatus === 'cancelled') return 'cancelled'
  if (input.poStatus === 'closed') return 'closed'
  if (input.poStatus === 'received') return 'received'
  if (input.poStatus === 'shipped' || input.departed) return 'shipped'
  if (input.poStatus === 'placed' && input.pickedUp) return 'factory_pickup'
  if (input.poStatus === 'placed') return 'placed'
  return 'draft'
}

/**
 * The finance half of one order, on one currency scale.
 *
 * The planned deposit uses the explicit amount when the order set one, otherwise the percentage;
 * both absent means `null` — "nobody planned a deposit" is not "a deposit of zero". Actual money
 * (`paidAmount`) always comes from the payment rows, so the plan and the reality are never mixed.
 */
export function computeFinanceView(input: {
  total: string
  depositAmount: string | null
  depositPercent: string | null
  currencyScale: number
  paymentAmounts: string[]
  kcPriceAmount: string | null
  kcPriceCurrency: string | null
  subsidiaryInvoiceAmount: string | null
  subsidiaryInvoiceCurrency: string | null
  exchangeRate: string | null
}): FinanceView {
  const orderAmount = quantizeAmount(input.total, input.currencyScale) ?? '0'

  const depositPlanned = input.depositAmount !== null && input.depositAmount !== undefined
    ? quantizeAmount(input.depositAmount, input.currencyScale)
    : input.depositPercent !== null && input.depositPercent !== undefined
      ? depositFromPercent(input.total, input.depositPercent, input.currencyScale)
      : null

  const orderAmountDecimal = parseAmount(orderAmount)
  const depositDecimal = parseAmount(depositPlanned)
  const balancePlanned = orderAmountDecimal && depositDecimal
    ? toAmountString({ units: orderAmountDecimal.units - depositDecimal.units, scale: orderAmountDecimal.scale }, input.currencyScale)
    : null

  let paidUnits = 0n
  for (const amount of input.paymentAmounts) {
    const parsed = parseAmount(amount)
    if (!parsed) continue
    paidUnits += quantizeExactDecimal(parsed, input.currencyScale).units
  }
  const paidAmount = toAmountString({ units: paidUnits, scale: input.currencyScale }, input.currencyScale)
  const outstandingAmount = orderAmountDecimal
    ? toAmountString({ units: orderAmountDecimal.units - paidUnits, scale: input.currencyScale }, input.currencyScale)
    : '0'

  return {
    orderAmount,
    depositPlanned,
    balancePlanned,
    paidAmount,
    outstandingAmount,
    kcPriceAmount: quantizeAmount(input.kcPriceAmount, input.currencyScale),
    kcPriceCurrency: input.kcPriceAmount === null ? null : input.kcPriceCurrency,
    subsidiaryInvoiceAmount: quantizeAmount(input.subsidiaryInvoiceAmount, input.currencyScale),
    subsidiaryInvoiceCurrency: input.subsidiaryInvoiceAmount === null ? null : input.subsidiaryInvoiceCurrency,
    exchangeRate: input.exchangeRate,
  }
}

/**
 * 本单分摊退税额 for every order of one container.
 *
 * `share_i = HALF_UP(refundAmount × total_i / Σ total, 2)`; the rounding remainder lands on the
 * order with the largest share (ties broken by the lowest `number`, then the lowest id), so the
 * shares always sum to the container amount. No orders, no refund amount, or a zero denominator
 * all mean "cannot allocate": every order maps to `null`, never to `0`.
 */
export function allocateTaxRefund(input: {
  refundAmount: string | null | undefined
  orders: AllocationOrder[]
}): Map<string, string | null> {
  const result = new Map<string, string | null>()
  for (const order of input.orders) result.set(order.purchaseOrderId, null)

  const refund = parseAmount(input.refundAmount ?? null)
  if (!refund || input.orders.length === 0) return result

  const target = quantizeExactDecimal(refund, 2)
  const totals = input.orders.map((order) => toScaledUnits(order.total, STORED_AMOUNT_SCALE))
  const denominator = totals.reduce((sum, units) => sum + units, 0n)
  if (denominator === 0n) return result

  const shares = totals.map((units) => divideHalfUp(target.units * units, denominator))
  const allocated = shares.reduce((sum, units) => sum + units, 0n)
  const remainder = target.units - allocated

  if (remainder !== 0n) {
    let winner = 0
    for (let index = 1; index < shares.length; index += 1) {
      const current = shares[index]
      const best = shares[winner]
      if (current > best) {
        winner = index
        continue
      }
      if (current !== best) continue
      const currentNumber = input.orders[index].number ?? ''
      const bestNumber = input.orders[winner].number ?? ''
      if (currentNumber < bestNumber) {
        winner = index
        continue
      }
      // Numbers can tie too (two drafts of one order); the id keeps the winner deterministic and
      // identical no matter which page ran the allocation.
      if (currentNumber === bestNumber && input.orders[index].purchaseOrderId < input.orders[winner].purchaseOrderId) {
        winner = index
      }
    }
    shares[winner] += remainder
  }

  input.orders.forEach((order, index) => {
    result.set(order.purchaseOrderId, toAmountString({ units: shares[index], scale: 2 }, 2))
  })
  return result
}

/**
 * The order's 退税状态 is the **least advanced** status of its containers: work is only finished
 * when every container's declaration is finished. An order with no container record at all
 * answers `unknown`, and so does an unrecognized stored value (a state this module cannot rank
 * must not be reported as progress).
 */
export function aggregateRefundStatus(statuses: string[]): string {
  if (statuses.length === 0) return 'unknown'
  // Starts above every level so the first ranked status becomes the running minimum: starting at
  // `unknown` (level 0) would make every input answer `unknown`.
  let lowest = Number.POSITIVE_INFINITY
  for (const status of statuses) {
    const level = STATUS_LEVELS[status]
    if (level === undefined) return 'unknown'
    if (level < lowest) lowest = level
  }
  for (const [status, level] of Object.entries(STATUS_LEVELS)) {
    if (level === lowest) return status
  }
  return 'unknown'
}

/**
 * KC订单价格 comes from the sales contract sourced from this order — the most recently updated
 * one that is not cancelled. A contract that was cancelled never becomes the KC price.
 */
export function selectKcContract(contracts: ContractRow[], purchaseOrderId: string): ContractRow | null {
  const candidates = contracts.filter(
    (contract) =>
      contract.direction === 'sales' &&
      contract.sourceKind === 'purchase_order' &&
      contract.sourceId === purchaseOrderId &&
      contract.status !== 'cancelled',
  )
  const sorted = candidates.slice().sort((left, right) => {
    const leftTime = toTime(left.updatedAt)
    const rightTime = toTime(right.updatedAt)
    if (leftTime !== rightTime) return rightTime - leftTime
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  })
  return sorted[0] ?? null
}

/**
 * USD comes from the KC contract's newest non-void outbound invoice — the subsidiary's invoice,
 * which is what the USD column of the order file means.
 */
export function selectSubsidiaryInvoice(invoices: InvoiceRow[], contractId: string | null): InvoiceRow | null {
  if (!contractId) return null
  const candidates = invoices.filter(
    (invoice) => invoice.contractId === contractId && invoice.direction === 'outbound' && invoice.status !== 'void',
  )
  const sorted = candidates.slice().sort((left, right) => {
    const leftIssued = toTime(left.issuedAt)
    const rightIssued = toTime(right.issuedAt)
    if (leftIssued !== rightIssued) return rightIssued - leftIssued
    const leftUpdated = toTime(left.updatedAt)
    const rightUpdated = toTime(right.updatedAt)
    if (leftUpdated !== rightUpdated) return rightUpdated - leftUpdated
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  })
  return sorted[0] ?? null
}

/**
 * One checklist hit per document type, and only when a file is actually attached: a document row
 * without a file is paperwork the system knows about but nobody can produce.
 */
function attachedTypes(rows: ChecklistDocumentRow[]): Set<string> {
  const types = new Set<string>()
  for (const row of rows) {
    if (row.attachmentId) types.add(row.docType)
  }
  return types
}

/** A contract counts as filed when either its stamped scan or its generated document exists. */
function hasContractFile(contract: ContractRow | null): boolean {
  if (!contract) return false
  return Boolean(contract.attachmentId ?? contract.generatedAttachmentId)
}

function exportChecklistFromTypes(rows: ChecklistDocumentRow[]): ExportDocumentChecklist {
  const types = attachedTypes(rows)
  return {
    so: types.has('so'),
    telexRelease: types.has('telex_release'),
    customsDeclaration: types.has('customs_declaration'),
    domesticFreight: types.has('domestic_freight_receipt'),
    bookingCharges: types.has('booking_charges_receipt'),
  }
}

export { exportChecklistFromTypes }

/**
 * Sum of the per-container allocations of one order; `null` when no container contributed.
 *
 * `null` is not zero: it means "nothing could be allocated" (no container has an amount, or the
 * container's order totals are all zero), and a page must render that as an em dash rather than as
 * a refund of nothing.
 */
export function sumAllocationShares(shares: Array<string | null>): string | null {
  let total: ExactDecimal | null = null
  for (const share of shares) {
    const parsed = parseAmount(share)
    if (!parsed) continue
    total = total ? { units: total.units + parsed.units, scale: parsed.scale } : parsed
  }
  return total ? toAmountString(total, 2) : null
}

export type OrderChecklistSources = {
  purchaseDocuments: ChecklistDocumentRow[]
  purchaseContract: ContractRow | null
  salesContract: ContractRow | null
  kcInvoices: InvoiceRow[]
  exportDocuments: ChecklistDocumentRow[]
  collectionDocuments: ChecklistDocumentRow[]
}

/** 单据齐套 of one order: which of the twelve documents are filed, and which are still missing. */
export function buildOrderChecklist(sources: OrderChecklistSources): { checklist: OrderChecklist; checklistMissing: string[] } {
  const purchaseTypes = attachedTypes(sources.purchaseDocuments)
  const collectionTypes = attachedTypes(sources.collectionDocuments)
  const exportHits = exportChecklistFromTypes(sources.exportDocuments)

  const checklist: OrderChecklist = {
    supplierInvoice: purchaseTypes.has('supplier_invoice'),
    packingList: purchaseTypes.has('packing_list'),
    purchasePaymentReceipt: purchaseTypes.has('purchase_payment_receipt'),
    purchaseContract: hasContractFile(sources.purchaseContract),
    salesContract: hasContractFile(sources.salesContract),
    kcInvoiceStamped: sources.kcInvoices.some((invoice) => Boolean(invoice.attachmentId) && invoice.status !== 'void'),
    foreignIncomeCertificate: collectionTypes.has('foreign_income_certificate'),
    ...exportHits,
  }

  return {
    checklist,
    checklistMissing: ORDER_CHECKLIST_KEYS.filter((key) => !checklist[key]),
  }
}

/** Timestamp/date serialization and display-snapshot reads shared by the two projections. */
export function toTime(value: Date | string | null | undefined): number {
  if (!value) return 0
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

export function toIsoTimestamp(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function snapshotName(snapshot: Record<string, unknown> | null | undefined): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const name = (snapshot as { name?: unknown }).name
  return typeof name === 'string' && name.length > 0 ? name : null
}

export const CONTAINER_EXPORT_CHECKLIST_KEYS = EXPORT_DOCUMENT_CHECKLIST_KEYS

export const CONTAINER_REFUND_CHECKLIST_KEYS = ['taxRefundPackage', 'reportDraft'] as const

export const CONTAINER_CHECKLIST_KEYS = [
  ...CONTAINER_EXPORT_CHECKLIST_KEYS,
  ...CONTAINER_REFUND_CHECKLIST_KEYS,
] as const

export type ContainerChecklistKey = (typeof CONTAINER_CHECKLIST_KEYS)[number]
export type ContainerChecklist = Record<ContainerChecklistKey, boolean>

export type ContainerOrderRow = {
  purchaseOrderId: string
  number: string | null
  businessNumber: string | null
  ownerName: string | null
  customerName: string | null
  total: string
  /** `HALF_UP(refund × this order's total / Σ totals, 2)`, or null when nothing can be allocated. */
  allocatedRefundAmount: string | null
  sharePercent: string | null
}

export type ContainerFileRow = {
  shipmentId: string
  shipmentNumber: string | null
  shipmentStatus: string
  currentMilestone: string | null
  carrierName: string | null
  departurePort: string | null
  departedAt: string | null
  receivedAt: string | null
  etd: string | null
  eta: string | null
  containerType: string | null
  containerNumber: string | null
  sealNumber: string | null
  bookingNumber: string | null
  orders: ContainerOrderRow[]
  taxRefundStatus: string
  taxRefundAmount: string | null
  taxRefundNote: string | null
  checklist: ContainerChecklist
  checklistMissing: string[]
}

export type ContainerFileFilters = {
  /** Locks the projection to one container — how a detail page loads exactly its own row. */
  shipmentId?: string
  status?: string
  taxRefundStatus?: string
  search?: string
}

export type ContainerFileListParams = {
  tenantId: string
  organizationIds: string[]
  filters: ContainerFileFilters
  page: number
  pageSize: number
  sortField: 'departed_at' | 'eta' | 'number'
  sortDir: 'asc' | 'desc'
}

export type ContainerChecklistSources = {
  exportDocuments: ChecklistDocumentRow[]
  refundDocuments: ChecklistDocumentRow[]
}

/**
 * 单据齐套 of one container: the five export documents plus the two refund-application files.
 * A document counts only when a file is attached, exactly like the order checklist.
 */
export function buildContainerChecklist(sources: ContainerChecklistSources): {
  checklist: ContainerChecklist
  checklistMissing: string[]
} {
  const refundTypes = new Set<string>()
  for (const row of sources.refundDocuments) {
    if (row.attachmentId) refundTypes.add(row.docType)
  }

  const exportHits: ExportDocumentChecklist = exportChecklistFromTypes(sources.exportDocuments)

  const checklist: ContainerChecklist = {
    ...exportHits,
    taxRefundPackage: refundTypes.has('tax_refund_package'),
    reportDraft: refundTypes.has('report_draft'),
  }

  return {
    checklist,
    checklistMissing: CONTAINER_CHECKLIST_KEYS.filter((key) => !checklist[key]),
  }
}

/**
 * Share of the container's refund each order carries, as a two-decimal percentage.
 *
 * Derived from the same totals the allocation uses, so the percentages and the amounts on the
 * page always tell the same story; a zero denominator yields `null` rather than a division by
 * zero rendered as 0%. Basis points are scaled integers, like every other ratio in this module.
 */
export function sharePercentages(orders: AllocationOrder[]): Array<string | null> {
  const units = orders.map((order) => toScaledUnits(order.total, STORED_AMOUNT_SCALE))
  const denominator = units.reduce((sum, value) => sum + value, 0n)
  if (denominator === 0n) return orders.map(() => null)
  return units.map((value) => {
    const basisPoints = divideHalfUp(value * 10000n, denominator)
    const fraction = String(basisPoints % 100n).padStart(2, '0')
    return `${basisPoints / 100n}.${fraction}`
  })
}
