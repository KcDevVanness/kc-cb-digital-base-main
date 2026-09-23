import {
  EXPORT_FINANCE_COLLECTION_STATUSES,
  EXPORT_FINANCE_TAX_REFUND_STATUSES,
  ORDER_FILE_STATUSES,
  type ExportFinanceCollectionStatus,
  type ExportFinanceTaxRefundStatus,
  type OrderFileStatus,
} from '../data/validators'
import { ORDER_CHECKLIST_KEYS, type OrderChecklistKey } from '../lib/orderFileProjection'
import {
  CONTAINER_CHECKLIST_KEYS,
  type ContainerChecklistKey,
} from '../lib/containerFileProjection'
import { SHIPMENT_MILESTONES, SHIPMENT_STATUSES, type ShipmentMilestone, type ShipmentStatus } from '../../cross_border/data/validators'

/**
 * Enum → i18n key maps for this module's surfaces.
 *
 * Every enum the module renders is mapped here once, so a table cell, a filter, a tooltip and the
 * server-side CSV cannot drift into naming the same state differently. Values are keys, not
 * labels: the reader's locale decides the text.
 */

export const BUSINESS_STATUS_LABEL_KEYS: Record<OrderFileStatus, string> = {
  draft: 'export_finance.orders.status.draft',
  placed: 'export_finance.orders.status.placed',
  factory_pickup: 'export_finance.orders.status.factory_pickup',
  shipped: 'export_finance.orders.status.shipped',
  received: 'export_finance.orders.status.received',
  closed: 'export_finance.orders.status.closed',
  cancelled: 'export_finance.orders.status.cancelled',
}

export const COLLECTION_STATUS_LABEL_KEYS: Record<ExportFinanceCollectionStatus, string> = {
  received: 'export_finance.collection.status.received',
  not_received: 'export_finance.collection.status.not_received',
  unknown: 'export_finance.collection.status.unknown',
}

export const REFUND_STATUS_LABEL_KEYS: Record<ExportFinanceTaxRefundStatus, string> = {
  completed: 'export_finance.refund.status.completed',
  applied: 'export_finance.refund.status.applied',
  not_started: 'export_finance.refund.status.not_started',
  unknown: 'export_finance.refund.status.unknown',
}

export const SHIPMENT_STATUS_LABEL_KEYS: Record<ShipmentStatus, string> = {
  draft: 'cross_border.shipments.status.draft',
  in_transit: 'cross_border.shipments.status.in_transit',
  received: 'cross_border.shipments.status.received',
  cancelled: 'cross_border.shipments.status.cancelled',
}

export const SHIPMENT_MILESTONE_LABEL_KEYS: Record<ShipmentMilestone, string> = {
  picked_up: 'cross_border.shipments.milestones.picked_up',
  export_customs: 'cross_border.shipments.milestones.export_customs',
  in_transit: 'cross_border.shipments.milestones.in_transit',
  arrived: 'cross_border.shipments.milestones.arrived',
  cleared: 'cross_border.shipments.milestones.cleared',
  warehoused: 'cross_border.shipments.milestones.warehoused',
}

export const ORDER_CHECKLIST_LABEL_KEYS: Record<OrderChecklistKey, string> = {
  supplierInvoice: 'export_finance.orders.checklist.supplierInvoice',
  packingList: 'export_finance.orders.checklist.packingList',
  purchasePaymentReceipt: 'export_finance.orders.checklist.purchasePaymentReceipt',
  purchaseContract: 'export_finance.orders.checklist.purchaseContract',
  salesContract: 'export_finance.orders.checklist.salesContract',
  kcInvoiceStamped: 'export_finance.orders.checklist.kcInvoiceStamped',
  foreignIncomeCertificate: 'export_finance.orders.checklist.foreignIncomeCertificate',
  so: 'export_finance.orders.checklist.so',
  telexRelease: 'export_finance.orders.checklist.telexRelease',
  customsDeclaration: 'export_finance.orders.checklist.customsDeclaration',
  domesticFreight: 'export_finance.orders.checklist.domesticFreight',
  bookingCharges: 'export_finance.orders.checklist.bookingCharges',
}

export const CONTAINER_CHECKLIST_LABEL_KEYS: Record<ContainerChecklistKey, string> = {
  so: 'export_finance.cabinets.checklist.so',
  telexRelease: 'export_finance.cabinets.checklist.telexRelease',
  customsDeclaration: 'export_finance.cabinets.checklist.customsDeclaration',
  domesticFreight: 'export_finance.cabinets.checklist.domesticFreight',
  bookingCharges: 'export_finance.cabinets.checklist.bookingCharges',
  taxRefundPackage: 'export_finance.cabinets.checklist.taxRefundPackage',
  reportDraft: 'export_finance.cabinets.checklist.reportDraft',
}

export type TranslateFn = (key: string, fallback?: string) => string

/**
 * Filter option lists — built from the enums so a new status can never be missing a filter entry,
 * and the "all" option is the caller's business (the query simply omits the key).
 */
export const ORDER_STATUS_OPTIONS: OrderFileStatus[] = [...ORDER_FILE_STATUSES]
export const COLLECTION_STATUS_OPTIONS: ExportFinanceCollectionStatus[] = [...EXPORT_FINANCE_COLLECTION_STATUSES]
export const REFUND_STATUS_OPTIONS: ExportFinanceTaxRefundStatus[] = [...EXPORT_FINANCE_TAX_REFUND_STATUSES]
export const SHIPMENT_STATUS_OPTIONS: ShipmentStatus[] = [...SHIPMENT_STATUSES]
export const SHIPMENT_MILESTONE_OPTIONS: ShipmentMilestone[] = [...SHIPMENT_MILESTONES]

/** Keys of a checklist class, in display order, so a page can count its own badge. */
export const ORDER_CHECKLIST_KEY_LIST = ORDER_CHECKLIST_KEYS
export const CONTAINER_CHECKLIST_KEY_LIST = CONTAINER_CHECKLIST_KEYS

/** `n/total` for one checklist class, rendered next to the missing-item tooltip. */
export function checklistCounter(
  checklist: Record<string, boolean>,
  keys: readonly string[],
): { hits: number; total: number } {
  return { hits: keys.filter((key) => checklist[key]).length, total: keys.length }
}
