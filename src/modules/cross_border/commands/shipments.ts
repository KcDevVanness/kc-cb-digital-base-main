import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, emitCrudUndoSideEffects, requireId } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { badRequest, conflict, CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import {
  CrossBorderShipment,
  CrossBorderShipmentAllocation,
  CrossBorderShipmentMilestone,
} from '../data/entities'
import {
  SHIPMENT_MILESTONES,
  shipmentCancelSchema,
  shipmentCreateSchema,
  shipmentDepartSchema,
  shipmentReceiveSchema,
  shipmentUpdateSchema,
  milestoneAdvanceSchema,
  type ShipmentCreateInput,
  type ShipmentMilestone,
} from '../data/validators'
import { ensureScope, type Scope } from '../lib/scope'
import {
  loadAllocatedQuantities,
  loadPurchaseOrderLines,
  resolveDefaultVariantId,
  type PurchaseOrderLineRef,
} from '../lib/purchasingReads'
import { eventsConfig } from '../events'

const SHIPMENT_ENTITY_ID = 'cross_border:cross_border_shipment' as const
const SHIPMENT_RESOURCE_KIND = 'cross_border.shipment' as const

/** Orders whose goods may be allocated: committed, possibly already partly received. */
const ALLOCATABLE_ORDER_STATUSES = ['placed', 'shipped', 'received']

export const shipmentCrudEvents: CrudEventsConfig<CrossBorderShipment> = {
  module: 'cross_border',
  entity: 'shipment',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    status: ctx.entity?.status ?? null,
  }),
}

export const shipmentCrudIndexer: CrudIndexerConfig<CrossBorderShipment> = {
  entityType: SHIPMENT_ENTITY_ID,
}

function shipmentFilter(scope: Scope, id: string): FilterQuery<CrossBorderShipment> {
  return { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null } as FilterQuery<CrossBorderShipment>
}

async function loadShipment(em: EntityManager, scope: Scope, id: string): Promise<CrossBorderShipment> {
  const shipment = await em.fork().findOne(CrossBorderShipment, shipmentFilter(scope, id))
  if (!shipment) throw notFound('Shipment not found')
  return shipment
}

/**
 * Validates the allocation set against the purchase-order lines it points at.
 *
 * Three rules, all enforced before anything is written: the line must exist in the caller's
 * organization, its order must be committed (a draft order cannot be shipped), and the sum of
 * this shipment's quantities plus everything already allocated to non-cancelled shipments must
 * not exceed what was ordered. Quantities already *received* are not subtracted again — a
 * received line is fully allocated by definition, and the allocated total already covers it.
 */
/**
 * A validated allocation, with the catalog link narrowed to a string: the guard below refuses a
 * line without one, so every value this function returns can be persisted on the allocation row
 * (whose `catalog_product_id` stays required — stock is received at variant level).
 */
type ResolvedAllocation = {
  line: PurchaseOrderLineRef & { catalogProductId: string }
  quantity: string
}

async function resolveAllocations(
  em: EntityManager,
  scope: Scope,
  allocations: ShipmentCreateInput['allocations'],
  excludeShipmentId?: string | null,
): Promise<ResolvedAllocation[]> {
  const lineIds = allocations.map((allocation) => allocation.purchaseOrderLineId)
  if (new Set(lineIds).size !== lineIds.length) {
    throw new CrudHttpError(422, { error: 'The same purchase order line is listed twice in this shipment' })
  }

  const lines = await loadPurchaseOrderLines(em, scope, lineIds)
  const alreadyAllocated = await loadAllocatedQuantities(em, scope, lineIds, excludeShipmentId)

  return allocations.map((allocation) => {
    const line = lines[allocation.purchaseOrderLineId]
    if (!line) {
      throw new CrudHttpError(422, { error: `Purchase order line not found in this organization: ${allocation.purchaseOrderLineId}` })
    }
    if (!ALLOCATABLE_ORDER_STATUSES.includes(line.orderStatus)) {
      throw new CrudHttpError(422, {
        error: `Purchase order ${line.orderNumber ?? line.orderId} is ${line.orderStatus}; only placed, shipped or received orders can be shipped`,
      })
    }
    // Stock is booked at *variant* level (`wms.inventory.receive`), and the variant is resolved
    // through the installed catalog. A line whose product is not linked to a catalog product could
    // be shipped but never received, so the allocation is refused here — early and with the fix —
    // instead of failing weeks later at the warehouse.
    if (!line.catalogProductId) {
      throw new CrudHttpError(422, {
        error: `Purchase order line ${allocation.purchaseOrderLineId} has no catalog product link, so the goods cannot be received into stock; sync the supplier product to the product master and link it to a catalog product first`,
      })
    }
    const ordered = Number.parseFloat(line.quantity)
    const committed = alreadyAllocated[allocation.purchaseOrderLineId] ?? 0
    const next = committed + Number(allocation.quantity)
    if (next > ordered + 1e-6) {
      throw new CrudHttpError(422, {
        error: `Allocating ${allocation.quantity} exceeds the ordered quantity of ${line.quantity} (already allocated ${committed}) for ${line.orderNumber ?? line.orderId}`,
      })
    }
    return { line: { ...line, catalogProductId: line.catalogProductId }, quantity: Number(allocation.quantity).toFixed(4) }
  })
}

async function replaceAllocations(
  em: EntityManager,
  scope: Scope,
  shipment: CrossBorderShipment,
  resolved: ResolvedAllocation[],
): Promise<void> {
  await em.nativeDelete(CrossBorderShipmentAllocation, { shipment: shipment.id } as FilterQuery<CrossBorderShipmentAllocation>)
  for (const entry of resolved) {
    em.persist(
      em.create(CrossBorderShipmentAllocation, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        shipment,
        purchaseOrderId: entry.line.orderId,
        purchaseOrderLineId: entry.line.id,
        purchaseOrderNumber: entry.line.orderNumber,
        catalogProductId: entry.line.catalogProductId,
        productSnapshot: entry.line.productSnapshot,
        quantity: entry.quantity,
        receivedQuantity: null,
      }),
    )
  }
  await em.flush()
}

/** `SHP-<year>-<4 digits>`, assigned at depart; the unique constraint is the real guarantee. */
async function nextShipmentNumber(em: EntityManager, scope: Scope): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `SHP-${year}-`
  const row = (await (em.fork().getKysely<any>())
    .selectFrom('cross_border_shipments')
    .select('number')
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('number', 'like', `${prefix}%`)
    .orderBy('number', 'desc')
    .limit(1)
    .executeTakeFirst()) as { number: string | null } | undefined
  const last = row?.number ?? null
  const lastSequence = last ? Number.parseInt(last.slice(prefix.length), 10) : 0
  return `${prefix}${String(Number.isFinite(lastSequence) ? lastSequence + 1 : 1).padStart(4, '0')}`
}

/**
 * Peer commands are dispatched over the DI command bus so the neighbouring module keeps
 * ownership of its own invariants (ledger math in `wms`, ordered/received quantities in
 * `purchasing`). A missing or rejecting peer command aborts the caller: reporting a state the
 * system did not reach would be worse than failing the operation.
 */
async function dispatchPeerCommand(
  ctx: CommandRuntimeContext,
  commandId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const commandBus = ctx.container.resolve('commandBus') as {
    execute: (id: string, options: { input: unknown; ctx: CommandRuntimeContext }) => Promise<{ result?: unknown } | unknown>
  }
  let outcome: { result?: unknown } | unknown
  try {
    outcome = await commandBus.execute(commandId, { input, ctx: { ...ctx, request: undefined } })
  } catch (error) {
    if (error instanceof CrudHttpError) throw error
    const message = error instanceof Error ? error.message : String(error)
    throw new CrudHttpError(422, { error: `Peer command ${commandId} failed: ${message}` })
  }
  const envelope = outcome as { result?: unknown }
  return (envelope && typeof envelope === 'object' && 'result' in envelope ? envelope.result : outcome) as Record<string, unknown>
}

const createShipmentCommand: CommandHandler<Record<string, unknown>, CrossBorderShipment> = {
  id: 'cross_border.shipments.create',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const parsed = shipmentCreateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const resolved = await resolveAllocations(em, scope, parsed.allocations)

    const shipment = await de.createOrmEntity({
      entity: CrossBorderShipment,
      data: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        status: 'draft',
        carrierName: parsed.carrierName ?? null,
        forwarderContact: parsed.forwarderContact ?? null,
        departurePort: parsed.departurePort ?? null,
        containerType: parsed.containerType ?? null,
        containerNumber: parsed.containerNumber ?? null,
        sealNumber: parsed.sealNumber ?? null,
        bookingNumber: parsed.bookingNumber ?? null,
        destinationWarehouseId: parsed.destinationWarehouseId ?? null,
        destinationLocationId: parsed.destinationLocationId ?? null,
        etd: parsed.etd ? new Date(parsed.etd) : null,
        eta: parsed.eta ? new Date(parsed.eta) : null,
        notes: parsed.notes ?? null,
      },
    })
    await replaceAllocations(em, scope, shipment, resolved)

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: shipment,
      identifiers: { id: String(shipment.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: shipmentCrudEvents,
      indexer: shipmentCrudIndexer,
    })

    return shipment
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Create shipment',
    resourceKind: SHIPMENT_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id) },
  }),
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<{ after?: { id: string } }>(logEntry)
    const id = payload?.after?.id ?? logEntry?.resourceId
    if (!id) throw new Error('[internal] Missing shipment id for undo')
    const scope = ensureScope(ctx)
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const removed = await de.deleteOrmEntity({
      entity: CrossBorderShipment,
      where: shipmentFilter(scope, id),
      soft: true,
      softDeleteField: 'deletedAt',
    })
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: { id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: shipmentCrudEvents,
      indexer: shipmentCrudIndexer,
    })
  },
}

const updateShipmentCommand: CommandHandler<Record<string, unknown>, CrossBorderShipment> = {
  id: 'cross_border.shipments.update',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = shipmentUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const shipment = await loadShipment(em, scope, parsed.id)
    if (shipment.status !== 'draft') throw conflict('Only a draft shipment can be edited')

    enforceCommandOptimisticLock({
      resourceKind: SHIPMENT_RESOURCE_KIND,
      resourceId: String(shipment.id),
      current: shipment.updatedAt,
      request: ctx.request ?? null,
    })

    const resolved = parsed.allocations ? await resolveAllocations(em, scope, parsed.allocations, String(shipment.id)) : null

    const updated = await de.updateOrmEntity({
      entity: CrossBorderShipment,
      where: shipmentFilter(scope, parsed.id),
      apply: (entity) => {
        if (parsed.carrierName !== undefined) entity.carrierName = parsed.carrierName
        if (parsed.forwarderContact !== undefined) entity.forwarderContact = parsed.forwarderContact
        if (parsed.departurePort !== undefined) entity.departurePort = parsed.departurePort
        if (parsed.containerType !== undefined) entity.containerType = parsed.containerType
        if (parsed.containerNumber !== undefined) entity.containerNumber = parsed.containerNumber
        if (parsed.sealNumber !== undefined) entity.sealNumber = parsed.sealNumber
        if (parsed.bookingNumber !== undefined) entity.bookingNumber = parsed.bookingNumber
        if (parsed.destinationWarehouseId !== undefined) entity.destinationWarehouseId = parsed.destinationWarehouseId
        if (parsed.destinationLocationId !== undefined) entity.destinationLocationId = parsed.destinationLocationId
        if (parsed.etd !== undefined) entity.etd = parsed.etd ? new Date(parsed.etd) : null
        if (parsed.eta !== undefined) entity.eta = parsed.eta ? new Date(parsed.eta) : null
        if (parsed.notes !== undefined) entity.notes = parsed.notes
      },
    })
    if (!updated) throw notFound('Shipment not found')
    if (resolved) await replaceAllocations(em, scope, updated, resolved)

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: shipmentCrudEvents,
      indexer: shipmentCrudIndexer,
    })

    return updated
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Update shipment',
    resourceKind: SHIPMENT_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id), status: result.status },
  }),
}

const deleteShipmentCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  CrossBorderShipment
> = {
  id: 'cross_border.shipments.delete',
  isUndoable: false,
  async execute(input, ctx) {
    const id = requireId(input, 'Shipment id required')
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const shipment = await loadShipment(em, scope, id)
    if (shipment.status !== 'draft' && shipment.status !== 'cancelled') {
      throw conflict('Only a draft or cancelled shipment can be deleted')
    }

    const removed = await de.deleteOrmEntity({
      entity: CrossBorderShipment,
      where: shipmentFilter(scope, id),
      soft: true,
      softDeleteField: 'deletedAt',
    })
    if (!removed) throw notFound('Shipment not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: { id: String(removed.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: shipmentCrudEvents,
      indexer: shipmentCrudIndexer,
    })

    return removed
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Delete shipment',
    resourceKind: SHIPMENT_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id) },
  }),
}

/**
 * Depart = the goods physically left. The number is assigned here, the first milestone is
 * recorded, and every allocated purchase order that is still `placed` is advanced to `shipped`
 * through the purchasing command — so the commercial record follows the physical one instead of
 * being updated by hand.
 */
const departShipmentCommand: CommandHandler<Record<string, unknown>, CrossBorderShipment> = {
  id: 'cross_border.shipments.depart',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = shipmentDepartSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const shipment = await loadShipment(em, scope, parsed.id)
    if (shipment.status !== 'draft') {
      throw new CrudHttpError(422, { error: `Cannot depart a shipment in status ${shipment.status}` })
    }

    const allocations = await em.fork().find(CrossBorderShipmentAllocation, {
      shipment: shipment.id,
    } as FilterQuery<CrossBorderShipmentAllocation>)
    if (allocations.length === 0) throw badRequest('A shipment needs at least one allocation before it can depart')

    const now = new Date()
    const number = await nextShipmentNumber(em, scope)
    const updated = await de.updateOrmEntity({
      entity: CrossBorderShipment,
      where: shipmentFilter(scope, parsed.id),
      apply: (entity) => {
        entity.number = number
        entity.status = 'in_transit'
        entity.departedAt = now
        entity.currentMilestone = entity.currentMilestone ?? 'picked_up'
      },
    })
    if (!updated) throw notFound('Shipment not found')

    if (!updated.currentMilestone) {
      updated.currentMilestone = 'picked_up'
      await em.fork().nativeUpdate(CrossBorderShipment, { id: updated.id }, { currentMilestone: 'picked_up' })
    }
    const hasMilestone = await em.fork().count(CrossBorderShipmentMilestone, { shipment: updated.id } as FilterQuery<CrossBorderShipmentMilestone>)
    if (hasMilestone === 0) {
      em.persist(
        em.create(CrossBorderShipmentMilestone, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          shipment: updated,
          milestone: 'picked_up',
          occurredAt: now,
          note: null,
          recordedBy: ctx.auth?.sub ?? null,
        }),
      )
      await em.flush()
    }

    const orderIds = Array.from(new Set(allocations.map((allocation) => String(allocation.purchaseOrderId))))
    for (const orderId of orderIds) {
      const lines = await loadPurchaseOrderLines(
        em,
        scope,
        allocations.filter((allocation) => String(allocation.purchaseOrderId) === orderId).map((allocation) => String(allocation.purchaseOrderLineId)),
      )
      const anyPlaced = Object.values(lines).some((line) => line.orderStatus === 'placed')
      if (!anyPlaced) continue
      await dispatchPeerCommand(ctx, 'purchasing.purchase-orders.transition', { id: orderId, action: 'mark_shipped' })
    }

    await eventsConfig.emit('cross_border.shipment.departed', {
      id: String(updated.id),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      number,
      orderIds,
    })

    return updated
  },
  captureAfter: (_input, result) => ({ id: String(result.id), status: result.status }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Depart shipment',
    resourceKind: SHIPMENT_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id), status: result.status, number: result.number ?? null },
  }),
}

const advanceMilestoneCommand: CommandHandler<Record<string, unknown>, CrossBorderShipment> = {
  id: 'cross_border.shipments.advance-milestone',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = milestoneAdvanceSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager

    const shipment = await loadShipment(em, scope, parsed.shipmentId)
    if (shipment.status !== 'in_transit') {
      throw new CrudHttpError(422, { error: `Milestones can only be recorded while a shipment is in transit (currently ${shipment.status})` })
    }

    const current = shipment.currentMilestone as ShipmentMilestone | null | undefined
    const currentIndex = current ? SHIPMENT_MILESTONES.indexOf(current) : -1
    const nextIndex = SHIPMENT_MILESTONES.indexOf(parsed.milestone)
    if (nextIndex < currentIndex) {
      throw new CrudHttpError(422, {
        error: `Cannot move the shipment back from ${current} to ${parsed.milestone}`,
      })
    }
    if (nextIndex === currentIndex) return shipment

    const occurredAt = parsed.occurredAt ? new Date(parsed.occurredAt) : new Date()
    em.persist(
      em.create(CrossBorderShipmentMilestone, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        shipment,
        milestone: parsed.milestone,
        occurredAt,
        note: parsed.note ?? null,
        recordedBy: ctx.auth?.sub ?? null,
      }),
    )
    await em.flush()
    await em.fork().nativeUpdate(CrossBorderShipment, { id: shipment.id }, { currentMilestone: parsed.milestone })
    shipment.currentMilestone = parsed.milestone

    await eventsConfig.emit('cross_border.shipment.milestone_recorded', {
      id: String(shipment.id),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      milestone: parsed.milestone,
    })

    return shipment
  },
  captureAfter: (_input, result) => ({ id: String(result.id), currentMilestone: result.currentMilestone ?? null }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Record shipment milestone',
    resourceKind: SHIPMENT_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id), currentMilestone: result.currentMilestone ?? null },
  }),
}

/**
 * Receive = the overseas warehouse booked the goods in.
 *
 * Two peer calls per allocation, in order: `wms.inventory.receive` moves the ledger (the
 * variant is resolved from the product because purchase orders are product-level), then
 * `purchasing.purchase-orders.apply-receipt` raises the line's received quantity. Allocations
 * that already carry a received quantity are skipped, so a retry after a partial failure
 * converges instead of double-counting stock.
 */
const receiveShipmentCommand: CommandHandler<
  Record<string, unknown>,
  { id: string; status: string; tenantId: string; organizationId: string; received: Array<{ allocationId: string; quantity: string }> }
> = {
  id: 'cross_border.shipments.receive',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = shipmentReceiveSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager

    const shipment = await loadShipment(em, scope, parsed.id)
    if (shipment.status !== 'in_transit') {
      throw new CrudHttpError(422, { error: `Only an in-transit shipment can be received (currently ${shipment.status})` })
    }
    const performedBy = ctx.auth?.sub ?? null
    if (!performedBy) throw badRequest('Receiving requires an authenticated user')

    const allocations = await em.fork().find(CrossBorderShipmentAllocation, {
      shipment: shipment.id,
    } as FilterQuery<CrossBorderShipmentAllocation>)
    if (allocations.length === 0) throw badRequest('A shipment without allocations cannot be received')

    const received: Array<{ allocationId: string; quantity: string }> = []
    for (const allocation of allocations) {
      if (allocation.receivedQuantity !== null && allocation.receivedQuantity !== undefined) continue

      const variantId = await resolveDefaultVariantId(em, scope, String(allocation.catalogProductId))
      if (!variantId) {
        throw new CrudHttpError(422, {
          error: `Product ${String(allocation.catalogProductId)} has no variant, so stock cannot be received for it`,
        })
      }

      await dispatchPeerCommand(ctx, 'wms.inventory.receive', {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        warehouseId: parsed.warehouseId,
        locationId: parsed.locationId,
        catalogVariantId: variantId,
        quantity: allocation.quantity,
        referenceType: 'transfer',
        referenceId: String(shipment.id),
        performedBy,
        reason: `Shipment ${shipment.number ?? shipment.id}`,
      })

      await dispatchPeerCommand(ctx, 'purchasing.purchase-orders.apply-receipt', {
        purchaseOrderLineId: String(allocation.purchaseOrderLineId),
        quantity: allocation.quantity,
        sourceType: 'cross_border_shipment',
        sourceId: String(shipment.id),
      })

      await em.fork().nativeUpdate(
        CrossBorderShipmentAllocation,
        { id: allocation.id },
        { receivedQuantity: allocation.quantity },
      )
      received.push({ allocationId: String(allocation.id), quantity: allocation.quantity })
    }

    const now = new Date()
    await em.fork().nativeUpdate(
      CrossBorderShipment,
      { id: shipment.id },
      { status: 'received', receivedAt: now, destinationWarehouseId: parsed.warehouseId, destinationLocationId: parsed.locationId },
    )
    shipment.status = 'received'
    shipment.receivedAt = now
    shipment.destinationWarehouseId = parsed.warehouseId
    shipment.destinationLocationId = parsed.locationId

    await eventsConfig.emit('cross_border.shipment.received', {
      id: String(shipment.id),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      warehouseId: parsed.warehouseId,
      allocations: received.length,
    })

    return {
      id: String(shipment.id),
      status: shipment.status,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      received,
    }
  },
  captureAfter: (_input, result) => ({ id: result.id, status: result.status }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Receive shipment',
    resourceKind: SHIPMENT_RESOURCE_KIND,
    resourceId: result.id,
    tenantId: result.tenantId,
    organizationId: result.organizationId,
    snapshotAfter: { id: result.id, status: result.status, received: result.received.length },
  }),
}

const cancelShipmentCommand: CommandHandler<Record<string, unknown>, CrossBorderShipment> = {
  id: 'cross_border.shipments.cancel',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = shipmentCancelSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager

    const shipment = await loadShipment(em, scope, parsed.id)
    if (shipment.status !== 'draft' && shipment.status !== 'in_transit') {
      throw new CrudHttpError(422, { error: `Cannot cancel a shipment in status ${shipment.status}` })
    }

    const now = new Date()
    await em.fork().nativeUpdate(
      CrossBorderShipment,
      { id: shipment.id },
      { status: 'cancelled', cancelledAt: now, cancelReason: parsed.reason },
    )
    shipment.status = 'cancelled'
    shipment.cancelledAt = now
    shipment.cancelReason = parsed.reason

    await eventsConfig.emit('cross_border.shipment.cancelled', {
      id: String(shipment.id),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      reason: parsed.reason,
    })

    return shipment
  },
  captureAfter: (_input, result) => ({ id: String(result.id), status: result.status }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Cancel shipment',
    resourceKind: SHIPMENT_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id), status: result.status },
  }),
}

registerCommand(createShipmentCommand)
registerCommand(updateShipmentCommand)
registerCommand(deleteShipmentCommand)
registerCommand(departShipmentCommand)
registerCommand(advanceMilestoneCommand)
registerCommand(receiveShipmentCommand)
registerCommand(cancelShipmentCommand)

export {
  createShipmentCommand,
  updateShipmentCommand,
  deleteShipmentCommand,
  departShipmentCommand,
  advanceMilestoneCommand,
  receiveShipmentCommand,
  cancelShipmentCommand,
}
