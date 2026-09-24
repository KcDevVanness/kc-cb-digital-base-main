import { z } from 'zod'

export const SHIPMENT_STATUSES = ['draft', 'in_transit', 'received', 'cancelled'] as const
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number]

/** Ordered transit stages: a lower stage may never follow a higher one. */
export const SHIPMENT_MILESTONES = ['picked_up', 'export_customs', 'in_transit', 'arrived', 'cleared', 'warehoused'] as const
export type ShipmentMilestone = (typeof SHIPMENT_MILESTONES)[number]

/**
 * Export paperwork kinds. `so` and `telex_release` are the booking and release documents — their
 * number lives on the shipment's `booking_number`, never on the row — and the two receipt kinds
 * are recorded as several rows when one shipment collects more than one file.
 */
export const EXPORT_DOC_TYPES = [
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
export type ExportDocType = (typeof EXPORT_DOC_TYPES)[number]

const uuid = () => z.string().uuid()
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional()
const optionalDate = () => z.string().min(1).nullable().optional()

const allocationInputSchema = z.object({
  purchaseOrderLineId: uuid(),
  quantity: z.coerce.number().positive(),
})

export const shipmentCreateSchema = z.object({
  carrierName: optionalText(200),
  forwarderContact: optionalText(200),
  departurePort: optionalText(200),
  containerType: optionalText(64),
  containerNumber: optionalText(64),
  sealNumber: optionalText(64),
  bookingNumber: optionalText(64),
  destinationWarehouseId: uuid().nullable().optional(),
  destinationLocationId: uuid().nullable().optional(),
  etd: optionalDate(),
  eta: optionalDate(),
  notes: optionalText(2000),
  allocations: z.array(allocationInputSchema).min(1),
})

export const shipmentUpdateSchema = shipmentCreateSchema.partial().extend({
  id: uuid(),
  allocations: z.array(allocationInputSchema).min(1).optional(),
})

export const shipmentListSchema = z.object({
  id: uuid().optional(),
  ids: z.string().optional(),
  search: z.string().max(200).optional(),
  containerNumber: z.string().max(64).optional(),
  status: z.enum(SHIPMENT_STATUSES).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  sortField: z.enum(['id', 'number', 'status', 'eta', 'created_at', 'updated_at']).optional().default('created_at'),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
})

export const shipmentDepartSchema = z.object({ id: uuid() })

export const shipmentReceiveSchema = z.object({
  id: uuid(),
  warehouseId: uuid(),
  locationId: uuid(),
})

export const shipmentCancelSchema = z.object({
  id: uuid(),
  reason: z.string().trim().min(1).max(500),
})

export const milestoneAdvanceSchema = z.object({
  shipmentId: uuid(),
  milestone: z.enum(SHIPMENT_MILESTONES),
  occurredAt: optionalDate(),
  note: optionalText(500),
})

export const milestoneListSchema = z.object({
  id: uuid().optional(),
  shipmentId: uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(100),
})

export const allocationListSchema = z.object({
  id: uuid().optional(),
  shipmentId: uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(100),
})

export const documentCreateSchema = z.object({
  shipmentId: uuid(),
  docType: z.enum(EXPORT_DOC_TYPES),
  documentNumber: optionalText(200),
  issuedAt: optionalDate(),
  purchaseOrderId: uuid().nullable().optional(),
  attachmentId: uuid().nullable().optional(),
  note: optionalText(1000),
})

export const documentUpdateSchema = documentCreateSchema.partial().extend({ id: uuid() })

export const documentListSchema = z.object({
  id: uuid().optional(),
  shipmentId: uuid().optional(),
  docType: z.enum(EXPORT_DOC_TYPES).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(100),
})

export type ShipmentCreateInput = z.infer<typeof shipmentCreateSchema>
export type ShipmentUpdateInput = z.infer<typeof shipmentUpdateSchema>
export type ShipmentListQuery = z.infer<typeof shipmentListSchema>
export type ShipmentReceiveInput = z.infer<typeof shipmentReceiveSchema>
export type MilestoneAdvanceInput = z.infer<typeof milestoneAdvanceSchema>
export type DocumentCreateInput = z.infer<typeof documentCreateSchema>
export type DocumentUpdateInput = z.infer<typeof documentUpdateSchema>
