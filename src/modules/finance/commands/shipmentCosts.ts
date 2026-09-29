import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, requireId } from '@open-mercato/shared/lib/commands/helpers'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { conflict, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { FinanceShipmentCost } from '../data/entities'
import { shipmentCostCreateSchema, shipmentCostUpdateSchema } from '../data/validators'
import { assertDictionaryValue, SHIPMENT_COST_TYPE_DICTIONARY_KEY } from '../lib/dictionaries'
import { loadShipmentRef } from '../lib/peerReads'
import { ensureScope, type Scope } from '../lib/scope'

const SHIPMENT_COST_ENTITY_ID = 'finance:finance_shipment_cost' as const
const SHIPMENT_COST_RESOURCE_KIND = 'finance.shipment-costs' as const

/**
 * The `entity` string is what makes the emitted CRUD event id the declared
 * `finance.shipment_cost.*`: the platform composes `<module>.<entity>.<action>`.
 */
export const shipmentCostCrudEvents: CrudEventsConfig<FinanceShipmentCost> = {
  module: 'finance',
  entity: 'shipment_cost',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    costType: ctx.entity?.costType ?? null,
    amount: ctx.entity?.amount ?? null,
    currencyCode: ctx.entity?.currencyCode ?? null,
  }),
}

export const shipmentCostCrudIndexer: CrudIndexerConfig<FinanceShipmentCost> = {
  entityType: SHIPMENT_COST_ENTITY_ID,
}

function shipmentCostFilter(scope: Scope, id: string): FilterQuery<FinanceShipmentCost> {
  return { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null } as FilterQuery<FinanceShipmentCost>
}

/**
 * A cost row must point at a container of the caller's organization that is still live.
 *
 * A cancelled container is a 409, not a 404: the id is real and the operator should see that the
 * container was cancelled rather than think the cost row vanished. Same tradeoff as
 * `export_finance.refunds.save`.
 */
async function assertShipmentUsable(
  em: EntityManager,
  scope: Scope,
  shipmentId: string,
): Promise<{ number: string | null }> {
  const shipment = await loadShipmentRef(em, { tenantId: scope.tenantId, organizationIds: [scope.organizationId] }, shipmentId)
  if (!shipment) throw notFound('Shipment not found in this organization')
  if (shipment.status === 'cancelled') throw conflict('A cancelled shipment cannot carry costs')
  return { number: shipment.number }
}

const createShipmentCostCommand: CommandHandler<Record<string, unknown>, FinanceShipmentCost> = {
  id: 'finance.shipment-costs.create',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = shipmentCostCreateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    await assertDictionaryValue(em, scope, SHIPMENT_COST_TYPE_DICTIONARY_KEY, parsed.costType)
    const shipment = await assertShipmentUsable(em, scope, parsed.shipmentId)

    const cost = await de.createOrmEntity({
      entity: FinanceShipmentCost,
      data: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        shipmentId: parsed.shipmentId,
        shipmentNumber: parsed.shipmentNumber ?? shipment.number,
        costType: parsed.costType,
        allocationBasis: parsed.allocationBasis,
        amount: parsed.amount,
        currencyCode: parsed.currencyCode,
        exchangeRate: parsed.exchangeRate ?? null,
        incurredAt: parsed.incurredAt ? new Date(parsed.incurredAt) : null,
        partyId: parsed.partyId ?? null,
        partySnapshot: parsed.partySnapshot ?? null,
        attachmentId: parsed.attachmentId ?? null,
        note: parsed.note ?? null,
      },
    })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: cost,
      identifiers: { id: String(cost.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: shipmentCostCrudEvents,
      indexer: shipmentCostCrudIndexer,
    })

    return cost
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Record shipment cost',
    resourceKind: SHIPMENT_COST_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id), costType: result.costType, amount: String(result.amount) },
  }),
}

const updateShipmentCostCommand: CommandHandler<Record<string, unknown>, FinanceShipmentCost> = {
  id: 'finance.shipment-costs.update',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = shipmentCostUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const existing = await em.fork().findOne(FinanceShipmentCost, shipmentCostFilter(scope, parsed.id))
    if (!existing) throw notFound('Shipment cost not found')

    enforceCommandOptimisticLock({
      resourceKind: SHIPMENT_COST_RESOURCE_KIND,
      resourceId: String(existing.id),
      current: existing.updatedAt,
      expected: parsed.updatedAt,
      request: ctx.request ?? null,
    })

    await assertDictionaryValue(em, scope, SHIPMENT_COST_TYPE_DICTIONARY_KEY, parsed.costType)
    const shipment = await assertShipmentUsable(em, scope, parsed.shipmentId)

    const updated = await de.updateOrmEntity({
      entity: FinanceShipmentCost,
      where: shipmentCostFilter(scope, parsed.id),
      apply: (entity) => {
        entity.shipmentId = parsed.shipmentId
        entity.shipmentNumber = parsed.shipmentNumber ?? shipment.number
        entity.costType = parsed.costType
        entity.allocationBasis = parsed.allocationBasis
        entity.amount = parsed.amount
        entity.currencyCode = parsed.currencyCode
        entity.exchangeRate = parsed.exchangeRate ?? null
        entity.incurredAt = parsed.incurredAt ? new Date(parsed.incurredAt) : null
        entity.partyId = parsed.partyId ?? null
        entity.partySnapshot = parsed.partySnapshot ?? null
        entity.attachmentId = parsed.attachmentId ?? null
        entity.note = parsed.note ?? null
      },
    })
    if (!updated) throw notFound('Shipment cost not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: shipmentCostCrudEvents,
      indexer: shipmentCostCrudIndexer,
    })

    return updated
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Update shipment cost',
    resourceKind: SHIPMENT_COST_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id), costType: result.costType, amount: String(result.amount) },
  }),
}

const deleteShipmentCostCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  FinanceShipmentCost
> = {
  id: 'finance.shipment-costs.delete',
  isUndoable: false,
  async execute(input, ctx) {
    const id = requireId(input, 'Shipment cost id required')
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const existing = await em.fork().findOne(FinanceShipmentCost, shipmentCostFilter(scope, id))
    if (!existing) throw notFound('Shipment cost not found')

    const body = (input.body ?? {}) as { updatedAt?: unknown }
    enforceCommandOptimisticLock({
      resourceKind: SHIPMENT_COST_RESOURCE_KIND,
      resourceId: String(existing.id),
      current: existing.updatedAt,
      expected: typeof body.updatedAt === 'string' ? body.updatedAt : undefined,
      request: ctx.request ?? null,
    })

    const removed = await de.deleteOrmEntity({
      entity: FinanceShipmentCost,
      where: shipmentCostFilter(scope, id),
      soft: true,
      softDeleteField: 'deletedAt',
    })
    if (!removed) throw notFound('Shipment cost not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: { id: String(removed.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: shipmentCostCrudEvents,
      indexer: shipmentCostCrudIndexer,
    })

    return removed
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Delete shipment cost',
    resourceKind: SHIPMENT_COST_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id) },
  }),
}

registerCommand(createShipmentCostCommand)
registerCommand(updateShipmentCostCommand)
registerCommand(deleteShipmentCostCommand)

export { createShipmentCostCommand, updateShipmentCostCommand, deleteShipmentCostCommand }
