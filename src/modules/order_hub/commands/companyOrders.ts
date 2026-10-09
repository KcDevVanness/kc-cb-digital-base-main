import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, emitCrudUndoSideEffects, requireId } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { conflict, CrudHttpError, isUniqueViolation, notFound } from '@open-mercato/shared/lib/crud/errors'
import { ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE } from '@open-mercato/shared/lib/auth/organizationScope'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { CompanyOrder, CompanyOrderLink } from '../data/entities'
import {
  companyOrderCreateSchema,
  companyOrderLinkChildSchema,
  companyOrderLinksReplaceSchema,
  companyOrderUpdateSchema,
} from '../data/validators'
import {
  COMPANY_ORDER_LINK_KINDS,
  linkChild,
  loadCompanyOrder,
  loadCompanyOrderRefs,
  persistCompanyOrderLink,
  type CompanyOrderScope,
  type LinkChildResult,
} from '../lib/companyOrder'
import { nextCompanyOrderNumber } from '../lib/companyOrderNumber'
import { invalidateCompanyOrderCaches, invalidateCompanyOrderLinkCaches } from '../lib/cacheInvalidation'
import { eventsConfig } from '../events'

const ORDER_ENTITY_ID = 'order_hub:company_order' as const
const LINK_ENTITY_ID = 'order_hub:company_order_link' as const
const ORDER_RESOURCE_KIND = 'order_hub.company_order' as const
const LINK_RESOURCE_KIND = 'order_hub.company_order.link' as const

/** Trusted scope only — never from a payload. Mirrors the module's other command scope helpers. */
function ensureCompanyOrderScope(ctx: CommandRuntimeContext): CompanyOrderScope {
  const tenantId = ctx.auth?.tenantId ?? null
  if (!tenantId) throw new CrudHttpError(400, { error: 'Tenant context is required' })
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: 'Select an organization to access this resource',
      code: ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE,
    })
  }
  return { tenantId, organizationId }
}

export const companyOrderCrudEvents: CrudEventsConfig<CompanyOrder> = {
  module: 'order_hub',
  entity: 'company_order',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    status: ctx.entity?.status ?? null,
  }),
}

export const companyOrderCrudIndexer: CrudIndexerConfig<CompanyOrder> = {
  entityType: ORDER_ENTITY_ID,
}

export { COMPANY_ORDER_LINK_KINDS, LINK_ENTITY_ID }

type CompanyOrderSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  number: string
  title: string | null
  orderDate: string
  etaDate: string | null
  status: string
  notes: string | null
}

function toDateOnly(value: unknown): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

function serializeCompanyOrder(order: CompanyOrder): CompanyOrderSnapshot {
  return {
    id: String(order.id),
    tenantId: String(order.tenantId),
    organizationId: String(order.organizationId),
    number: order.number,
    title: order.title ?? null,
    orderDate: toDateOnly(order.orderDate) ?? toDateOnly(new Date())!,
    etaDate: toDateOnly(order.etaDate),
    status: order.status,
    notes: order.notes ?? null,
  }
}

function orderFilter(scope: CompanyOrderScope, id: string): FilterQuery<CompanyOrder> {
  return {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  } as FilterQuery<CompanyOrder>
}

/**
 * Creates the row under the scope's unique number key, retrying **once** on a collision.
 *
 * The unique index is the real guarantee; two concurrent creates can compute the same `CO-…`, and
 * the loser retries with a fresh number. Each attempt runs in its own fork because a failed flush
 * leaves the request identity map holding the rejected entity — reusing it would replay the
 * collision. A second collision is a 409 rather than an unbounded loop.
 */
async function createCompanyOrderRow(
  em: EntityManager,
  scope: CompanyOrderScope,
  data: {
    title: string | null
    orderDate: Date
    etaDate: Date | null
    status: string
    notes: string | null
  },
): Promise<CompanyOrder> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const number = await nextCompanyOrderNumber(em, scope)
    try {
      const scoped = em.fork()
      const order = scoped.create(CompanyOrder, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        number,
        title: data.title,
        orderDate: data.orderDate,
        etaDate: data.etaDate,
        status: data.status,
        notes: data.notes,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      await scoped.persist(order).flush()
      return order
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
    }
  }
  throw conflict('A company order number could not be issued; please retry')
}

const createCompanyOrderCommand: CommandHandler<Record<string, unknown>, CompanyOrder> = {
  id: 'order_hub.orders.create',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const parsed = companyOrderCreateSchema.parse(rawInput)
    const scope = ensureCompanyOrderScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const order = await createCompanyOrderRow(em, scope, {
      title: parsed.title ?? null,
      orderDate: parsed.orderDate ? new Date(parsed.orderDate) : new Date(),
      etaDate: parsed.etaDate ? new Date(parsed.etaDate) : null,
      status: parsed.status ?? 'draft',
      notes: parsed.notes ?? null,
    })

    const identifiers = {
      id: String(order.id),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: order,
      identifiers,
      syncOrigin: ctx.syncOrigin,
      events: companyOrderCrudEvents,
      indexer: companyOrderCrudIndexer,
    })
    await invalidateCompanyOrderCaches({ container: ctx.container, ...scope }, identifiers, 'company-order-created')

    return order
  },
  captureAfter: (_input, result) => serializeCompanyOrder(result),
  buildLog: async ({ result }) => {
    const after = serializeCompanyOrder(result)
    return {
      actionLabel: 'Create company order',
      resourceKind: ORDER_RESOURCE_KIND,
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
    }
  },
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<UndoPayload<CompanyOrderSnapshot>>(logEntry)
    const after = payload?.after
    const id = after?.id ?? logEntry?.resourceId
    if (!id) throw new Error('[internal] Missing company order id for undo')
    const scope = ensureCompanyOrderScope(ctx)
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const removed = await de.deleteOrmEntity({
      entity: CompanyOrder,
      where: orderFilter(scope, id),
      soft: true,
      softDeleteField: 'deletedAt',
    })
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: { id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: companyOrderCrudEvents,
      indexer: companyOrderCrudIndexer,
    })
  },
}

const updateCompanyOrderCommand: CommandHandler<Record<string, unknown>, CompanyOrder> = {
  id: 'order_hub.orders.update',
  isUndoable: true,
  async prepare(rawInput, ctx) {
    const parsed = companyOrderUpdateSchema.parse(rawInput)
    const scope = ensureCompanyOrderScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const current = await em.fork().findOne(CompanyOrder, orderFilter(scope, parsed.id))
    if (!current) return { before: null }
    return { before: serializeCompanyOrder(current) }
  },
  async execute(rawInput, ctx) {
    const parsed = companyOrderUpdateSchema.parse(rawInput)
    const scope = ensureCompanyOrderScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const order = await em.fork().findOne(CompanyOrder, orderFilter(scope, parsed.id))
    if (!order) throw notFound('Company order not found')

    enforceCommandOptimisticLock({
      resourceKind: ORDER_RESOURCE_KIND,
      resourceId: String(order.id),
      current: order.updatedAt,
      // The form sends the version in the body; the platform header still works on top.
      expected: parsed.updatedAt ?? undefined,
      request: ctx.request ?? null,
    })

    const updated = await de.updateOrmEntity({
      entity: CompanyOrder,
      where: orderFilter(scope, parsed.id),
      apply: (entity) => {
        if (parsed.title !== undefined) entity.title = parsed.title
        if (parsed.orderDate !== undefined) entity.orderDate = new Date(parsed.orderDate)
        if (parsed.etaDate !== undefined) entity.etaDate = parsed.etaDate ? new Date(parsed.etaDate) : null
        if (parsed.status !== undefined) entity.status = parsed.status
        if (parsed.notes !== undefined) entity.notes = parsed.notes
      },
    })
    if (!updated) throw notFound('Company order not found')

    const identifiers = {
      id: String(updated.id),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers,
      syncOrigin: ctx.syncOrigin,
      events: companyOrderCrudEvents,
      indexer: companyOrderCrudIndexer,
    })
    await invalidateCompanyOrderCaches({ container: ctx.container, ...scope }, identifiers, 'company-order-updated')

    return updated
  },
  captureAfter: (_input, result) => serializeCompanyOrder(result),
  buildLog: async ({ result, snapshots }) => {
    const after = serializeCompanyOrder(result)
    return {
      actionLabel: 'Update company order',
      resourceKind: ORDER_RESOURCE_KIND,
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotBefore: (snapshots?.before as CompanyOrderSnapshot | null) ?? null,
      snapshotAfter: after,
    }
  },
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<UndoPayload<CompanyOrderSnapshot>>(logEntry)
    const before = payload?.before
    if (!before?.id) throw new Error('[internal] Missing company order snapshot for undo')
    const scope = ensureCompanyOrderScope(ctx)
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const restored = await de.updateOrmEntity({
      entity: CompanyOrder,
      where: orderFilter(scope, before.id),
      apply: (entity) => {
        entity.title = before.title
        entity.orderDate = new Date(before.orderDate)
        entity.etaDate = before.etaDate ? new Date(before.etaDate) : null
        entity.status = before.status
        entity.notes = before.notes
      },
    })
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: restored,
      identifiers: { id: before.id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: companyOrderCrudEvents,
      indexer: companyOrderCrudIndexer,
    })
  },
}

/** The delete body may carry the version explicitly; otherwise the platform header is used. */
function readUpdatedAt(input: unknown): string | undefined {
  if (!input || typeof input !== 'object' || !('body' in input)) return undefined
  const body = input.body
  if (!body || typeof body !== 'object' || !('updatedAt' in body)) return undefined
  const value = body.updatedAt
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

const deleteCompanyOrderCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  CompanyOrder
> = {
  id: 'order_hub.orders.delete',
  isUndoable: true,
  async prepare(input, ctx) {
    const id = requireId(input, 'Company order id required')
    const scope = ensureCompanyOrderScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const current = await em.fork().findOne(CompanyOrder, orderFilter(scope, id))
    if (!current) return { before: null }
    return { before: serializeCompanyOrder(current) }
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Company order id required')
    const scope = ensureCompanyOrderScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const order = await em.fork().findOne(CompanyOrder, orderFilter(scope, id))
    if (!order) throw notFound('Company order not found')

    enforceCommandOptimisticLock({
      resourceKind: ORDER_RESOURCE_KIND,
      resourceId: String(order.id),
      current: order.updatedAt,
      expected: readUpdatedAt(input),
      request: ctx.request ?? null,
    })

    const removed = await de.deleteOrmEntity({
      entity: CompanyOrder,
      where: orderFilter(scope, id),
      soft: true,
      softDeleteField: 'deletedAt',
    })
    if (!removed) throw notFound('Company order not found')

    const identifiers = { id, tenantId: scope.tenantId, organizationId: scope.organizationId }
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers,
      syncOrigin: ctx.syncOrigin,
      events: companyOrderCrudEvents,
      indexer: companyOrderCrudIndexer,
    })
    await invalidateCompanyOrderCaches({ container: ctx.container, ...scope }, identifiers, 'company-order-deleted')

    return removed
  },
  captureAfter: (_input, result) => serializeCompanyOrder(result),
  buildLog: async ({ result, snapshots }) => {
    const after = serializeCompanyOrder(result)
    return {
      actionLabel: 'Delete company order',
      resourceKind: ORDER_RESOURCE_KIND,
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotBefore: (snapshots?.before as CompanyOrderSnapshot | null) ?? null,
    }
  },
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<UndoPayload<CompanyOrderSnapshot>>(logEntry)
    const before = payload?.before
    if (!before?.id) throw new Error('[internal] Missing company order snapshot for undo')
    const scope = ensureCompanyOrderScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine
    // Soft delete: the row survives, so undo simply clears `deletedAt` and restores the header.
    let entity = await em.findOne(CompanyOrder, {
      id: before.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    } as FilterQuery<CompanyOrder>)
    if (entity) {
      entity.deletedAt = null
      entity.title = before.title
      entity.orderDate = new Date(before.orderDate)
      entity.etaDate = before.etaDate ? new Date(before.etaDate) : null
      entity.status = before.status
      entity.notes = before.notes
      await em.persist(entity).flush()
    } else {
      entity = await de.createOrmEntity({
        entity: CompanyOrder,
        data: {
          id: before.id,
          tenantId: before.tenantId,
          organizationId: before.organizationId,
          number: before.number,
          title: before.title,
          orderDate: new Date(before.orderDate),
          etaDate: before.etaDate ? new Date(before.etaDate) : null,
          status: before.status,
          notes: before.notes,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    }
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'created',
      entity,
      identifiers: { id: before.id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: companyOrderCrudEvents,
      indexer: companyOrderCrudIndexer,
    })
  },
}

const replaceCompanyOrderLinksCommand: CommandHandler<
  Record<string, unknown>,
  { companyOrderId: string; kind: string; refIds: string[]; tenantId: string; organizationId: string }
> = {
  id: 'order_hub.orders.links.replace',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = companyOrderLinksReplaceSchema.parse(rawInput)
    const scope = ensureCompanyOrderScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager

    // Load including soft-deleted rows so a deleted root is refused explicitly (422) rather than
    // silently re-linked; a genuinely missing id is a 404.
    const companyOrder = await em.fork().findOne(CompanyOrder, {
      id: parsed.companyOrderId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    } as FilterQuery<CompanyOrder>)
    if (!companyOrder) throw notFound('Company order not found')
    if (companyOrder.deletedAt) {
      throw new CrudHttpError(422, { error: 'A deleted company order cannot be re-linked' })
    }

    enforceCommandOptimisticLock({
      resourceKind: ORDER_RESOURCE_KIND,
      resourceId: String(companyOrder.id),
      current: companyOrder.updatedAt,
      expected: parsed.updatedAt ?? undefined,
      request: ctx.request ?? null,
    })

    const keys = parsed.refs.map((ref) => `${parsed.kind}:${ref.refId}`)
    if (new Set(keys).size !== keys.length) {
      throw new CrudHttpError(422, { error: 'The same document is listed twice for this kind' })
    }

    const resolved = parsed.refs.length > 0
      ? await loadCompanyOrderRefs(
        em,
        scope,
        parsed.refs.map((ref) => ({ kind: parsed.kind, refId: ref.refId })),
      )
      : new Map()
    for (const ref of parsed.refs) {
      if (!resolved.has(`${parsed.kind}:${ref.refId}`)) {
        throw new CrudHttpError(422, {
          error: `Document not found in this organization: ${parsed.kind} ${ref.refId}`,
        })
      }
    }

    await withAtomicFlush(
      em,
      [
        async () => {
          await em.nativeDelete(CompanyOrderLink, {
            companyOrder: companyOrder.id,
            kind: parsed.kind,
          } as FilterQuery<CompanyOrderLink>)
          for (const ref of parsed.refs) {
            const resolvedRef = resolved.get(`${parsed.kind}:${ref.refId}`)
            if (!resolvedRef) continue
            persistCompanyOrderLink(em, scope, companyOrder, resolvedRef)
          }
        },
      ],
      { transaction: true, label: 'order_hub.orders.links.replace' },
    )

    const identifiers = {
      id: String(companyOrder.id),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
    await eventsConfig.emit('order_hub.company_order.links.updated', {
      ...identifiers,
      kind: parsed.kind,
      count: parsed.refs.length,
    })
    await invalidateCompanyOrderLinkCaches(
      { container: ctx.container, ...scope },
      identifiers,
      'company-order-links-replaced',
    )

    return {
      companyOrderId: String(companyOrder.id),
      kind: parsed.kind,
      refIds: parsed.refs.map((ref) => ref.refId),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
  captureAfter: (_input, result) => ({ id: result.companyOrderId, count: result.refIds.length }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Company order links replaced',
    resourceKind: LINK_RESOURCE_KIND,
    resourceId: result.companyOrderId,
    tenantId: result.tenantId,
    organizationId: result.organizationId,
    snapshotAfter: { companyOrderId: result.companyOrderId, kind: result.kind, count: result.refIds.length },
  }),
}

const linkChildCommand: CommandHandler<Record<string, unknown>, LinkChildResult> = {
  id: 'order_hub.orders.link-child',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = companyOrderLinkChildSchema.parse(rawInput)
    const scope = ensureCompanyOrderScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager

    let outcome: LinkChildResult | null = null
    await withAtomicFlush(
      em,
      [async () => { outcome = await linkChild(em, scope, parsed) }],
      { transaction: true, label: 'order_hub.orders.link-child' },
    )
    const result = outcome as LinkChildResult | null
    if (!result) throw new Error('[internal] link-child produced no result')

    const identifiers = {
      id: result.companyOrderId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
    await eventsConfig.emit('order_hub.company_order.links.updated', {
      ...identifiers,
      kind: parsed.kind,
      refId: parsed.refId,
      count: 1,
    })
    await invalidateCompanyOrderLinkCaches(
      { container: ctx.container, ...scope },
      identifiers,
      'company-order-link-child',
    )

    return result
  },
  captureAfter: (_input, result) => ({ id: result.companyOrderId, created: result.created }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Company order child linked',
    resourceKind: LINK_RESOURCE_KIND,
    resourceId: result.companyOrderId,
    snapshotAfter: { companyOrderId: result.companyOrderId, linked: result.linked, created: result.created },
  }),
}

registerCommand(createCompanyOrderCommand)
registerCommand(updateCompanyOrderCommand)
registerCommand(deleteCompanyOrderCommand)
registerCommand(replaceCompanyOrderLinksCommand)
registerCommand(linkChildCommand)

export {
  createCompanyOrderCommand,
  updateCompanyOrderCommand,
  deleteCompanyOrderCommand,
  replaceCompanyOrderLinksCommand,
  linkChildCommand,
}

export { loadCompanyOrder }
