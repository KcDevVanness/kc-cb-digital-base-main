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
import {
  CompanyOrder,
  CompanyOrderCollaborator,
  CompanyOrderLink,
} from '../data/entities'
import {
  companyOrderCollaboratorsReplaceSchema,
  companyOrderCreateSchema,
  companyOrderLinkChildSchema,
  companyOrderLinksReplaceSchema,
  companyOrderUpdateSchema,
} from '../data/validators'
import {
  COMPANY_ORDER_LINK_KINDS,
  freezeNameSnapshot,
  linkChild,
  linkKey,
  listLinkedPurchaseOrderIds,
  loadCompanyOrder,
  loadCompanyOrderRefs,
  moveCompanyOrderChildren,
  persistCompanyOrderLink,
  resolveCompanyOrderParty,
  resolveCompanyOrderSupplier,
  type CompanyOrderLinkKind,
  type CompanyOrderNameRef,
  type CompanyOrderRef,
  type CompanyOrderScope,
  type LinkChildResult,
} from '../lib/companyOrder'
import {
  assertCollaboratorOrganizationsExist,
  forbiddenCollaboratorFields,
  collaboratorFieldRefused,
  loadCompanyOrderCollaboratorOrganizationIds,
  ownerRequired,
  resolveCompanyOrderAccess,
} from '../lib/collaborators'
import { nextCompanyOrderNumber } from '../lib/companyOrderNumber'
import {
  invalidateCompanyOrderCaches,
  invalidateCompanyOrderCollaboratorCaches,
  invalidateCompanyOrderLinkCaches,
} from '../lib/cacheInvalidation'
import { eventsConfig } from '../events'

const ORDER_ENTITY_ID = 'order_hub:company_order' as const
const LINK_ENTITY_ID = 'order_hub:company_order_link' as const
const ORDER_RESOURCE_KIND = 'order_hub.company_order' as const
const LINK_RESOURCE_KIND = 'order_hub.company_order.link' as const

/** Trusted scope only — never from a payload. Mirrors the module's other command scope helpers. */
export function ensureCompanyOrderScope(ctx: CommandRuntimeContext): CompanyOrderScope {
  const tenantId = ctx.auth?.tenantId ?? null
  if (!tenantId) throw new CrudHttpError(400, { error: 'Tenant context is required' })
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: 'Select an organization to access this resource',
      code: ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE,
    })
  }
  // The expanded visible set answers "am I a collaborator on this root" (a parent organization acts
  // for its descendants); the writes themselves still land in the single selected organization.
  const expanded = Array.isArray(ctx.organizationIds)
    ? ctx.organizationIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : []
  return {
    tenantId,
    organizationId,
    organizationIds: expanded.length > 0 ? Array.from(new Set(expanded)) : [organizationId],
  }
}

/**
 * Every organization whose cached company-order list can show this root: its owner organization and
 * the organizations that collaborate on it.
 *
 * The CRUD list cache is keyed per organization, so a write through one organization's session (a
 * collaborator writing status, an HQ user editing an HQ root) leaves the *other* organizations'
 * cached pages stale unless their tags are cleared too. A failed read here only delays that clearing
 * to the cache TTL and must never fail the already-committed write.
 */
async function rootInvalidationOrganizations(
  em: EntityManager,
  scope: CompanyOrderScope,
  companyOrderId: string,
): Promise<string[]> {
  try {
    const root = await em.fork().findOne(CompanyOrder, { id: companyOrderId, tenantId: scope.tenantId })
    const collaborators = await loadCompanyOrderCollaboratorOrganizationIds(em, scope, companyOrderId)
    return [root ? String(root.organizationId) : "", ...collaborators].filter((id) => id.length > 0)
  } catch {
    return []
  }
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
  paymentStatus: string | null
  notes: string | null
  productCategory: string | null
  ownerUserId: string | null
  ownerSnapshot: Record<string, unknown> | null
  customerPartyId: string | null
  customerSnapshot: Record<string, unknown> | null
  supplierId: string | null
  supplierSnapshot: Record<string, unknown> | null
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
    paymentStatus: order.paymentStatus ?? null,
    notes: order.notes ?? null,
    productCategory: order.productCategory ?? null,
    ownerUserId: order.ownerUserId ? String(order.ownerUserId) : null,
    ownerSnapshot: order.ownerSnapshot ?? null,
    customerPartyId: order.customerPartyId ? String(order.customerPartyId) : null,
    customerSnapshot: order.customerSnapshot ?? null,
    supplierId: order.supplierId ? String(order.supplierId) : null,
    supplierSnapshot: order.supplierSnapshot ?? null,
  }
}

/**
 * 订单描述 / 采购负责人 — the fields a company order **holds** for its purchase orders.
 *
 * Whenever these change on the root, or a purchase order newly hangs off the root, this announces
 * the **stored** values to the given purchase-order ids so `purchasing` can mirror them (owner
 * 2026-10-10: the entry point is the root, the purchase side is read-only). Duplicate ids collapse;
 * an empty recipient list is a no-op — removing the last purchase link mirrors nothing. A root read
 * that answered nothing is skipped too: the mirror is a best-effort courtesy and the next root edit
 * resyncs, exactly like the link-cache invalidation above never failing the committed write.
 */
async function emitPurchaseOrderFieldMirror(
  identifiers: { id: string; tenantId: string; organizationId: string },
  order: CompanyOrder | null,
  purchaseOrderIds: readonly string[],
): Promise<void> {
  const recipients = Array.from(new Set(purchaseOrderIds.filter((id) => typeof id === 'string' && id.length > 0)))
  if (!order || recipients.length === 0) return
  const snapshot = serializeCompanyOrder(order)
  await eventsConfig.emit('order_hub.company_order.order_fields_updated', {
    id: identifiers.id,
    tenantId: identifiers.tenantId,
    organizationId: identifiers.organizationId,
    productCategory: snapshot.productCategory,
    ownerUserId: snapshot.ownerUserId,
    ownerSnapshot: snapshot.ownerSnapshot,
    purchaseOrderIds: recipients,
  })
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
 * The write predicate for a root whose **access has already been resolved** (`resolveCompanyOrderAccess`)
 * — tenant + id + not deleted, deliberately without the organization: a collaborating organization
 * owns no row here, so an organization-scoped predicate would silently match nothing and turn a
 * permitted `status`/`notes` write into a "not found".
 */
function orderWriteFilter(scope: CompanyOrderScope, id: string): FilterQuery<CompanyOrder> {
  return {
    id,
    tenantId: scope.tenantId,
    deletedAt: null,
  } as FilterQuery<CompanyOrder>
}

/**
 * Creates the root, its default-customer/supplier snapshots and its initial child links in **one**
 * `withAtomicFlush({ transaction: true })` transaction, retrying **once** on a number collision.
 *
 * The unique index is the real guarantee; two concurrent creates can compute the same `CO-…`, and
 * the loser retries with a fresh number. Each attempt runs on its own fork because a unique
 * violation aborts that transaction (postgreSQL refuses further statements after a failed one) and
 * leaves the identity map holding the rejected entity — a reused one would replay the collision. A
 * second collision is a 409 rather than an unbounded loop.
 *
 * Resolution/validation also runs inside the transaction: a reference outside the writer's scope is
 * a 422 that rolls the whole attempt back before anything is committed. A duplicate `(kind, refId)`
 * in the payload is refused before the unique index sees it.
 *
 * A child already attached to **another** root in this scope is **moved**: the other root's link row
 * (and any row left by a soft-deleted root) is deleted in the same transaction, because one child
 * document belongs to at most one company order. The other roots' ids come back so the caller can
 * clear their cached attach blocks and broadcast the change to them too.
 */
async function createCompanyOrderAtomic(
  em: EntityManager,
  scope: CompanyOrderScope,
  data: {
    title: string | null
    orderDate: Date
    etaDate: Date | null
    status: string
    paymentStatus: string | null
    notes: string | null
    productCategory: string | null
    ownerUserId: string | null
    ownerSnapshot: Record<string, unknown> | null
    customerPartyId: string | null
    supplierId: string | null
    links: Array<{ kind: CompanyOrderLinkKind; refId: string }>
  },
): Promise<{ order: CompanyOrder; movedFrom: string[] }> {
  const keys = data.links.map((link) => linkKey(link.kind, link.refId))
  if (new Set(keys).size !== keys.length) {
    throw new CrudHttpError(422, { error: 'The same document is listed twice in links', code: 'duplicate_link' })
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const tx = em.fork()
    let created: CompanyOrder | null = null
    let movedFrom: string[] = []
    try {
      await withAtomicFlush(
        tx,
        [
          async () => {
            const party = data.customerPartyId
              ? await resolveCompanyOrderParty(tx, scope, data.customerPartyId)
              : null
            if (data.customerPartyId && !party) {
              throw new CrudHttpError(422, {
                error: `Default customer not found in this organization: ${data.customerPartyId}`,
                code: 'customer_party_not_found',
              })
            }
            const supplier = data.supplierId
              ? await resolveCompanyOrderSupplier(tx, scope, data.supplierId)
              : null
            if (data.supplierId && !supplier) {
              throw new CrudHttpError(422, {
                error: `Default supplier not found in this organization: ${data.supplierId}`,
                code: 'supplier_not_found',
              })
            }

            const resolved: Map<string, CompanyOrderRef> = data.links.length > 0
              ? await loadCompanyOrderRefs(tx, scope, data.links)
              : new Map()
            for (const link of data.links) {
              if (!resolved.has(linkKey(link.kind, link.refId))) {
                throw new CrudHttpError(422, {
                  error: `Child document not found in this organization: ${link.kind} ${link.refId}`,
                  code: 'link_not_found',
                })
              }
            }
            movedFrom = await moveCompanyOrderChildren(tx, scope, data.links)

            const number = await nextCompanyOrderNumber(tx, scope)
            const order = tx.create(CompanyOrder, {
              tenantId: scope.tenantId,
              organizationId: scope.organizationId,
              number,
              title: data.title,
              orderDate: data.orderDate,
              etaDate: data.etaDate,
              status: data.status,
              paymentStatus: data.paymentStatus,
              notes: data.notes,
              productCategory: data.productCategory,
              ownerUserId: data.ownerUserId,
              ownerSnapshot: data.ownerSnapshot,
              customerPartyId: party ? party.id : null,
              customerSnapshot: party ? freezeNameSnapshot(party) : null,
              supplierId: supplier ? supplier.id : null,
              supplierSnapshot: supplier ? freezeNameSnapshot(supplier) : null,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            tx.persist(order)
            for (const link of data.links) {
              const ref = resolved.get(linkKey(link.kind, link.refId))
              if (ref) persistCompanyOrderLink(tx, scope, order, ref)
            }
            created = order
          },
        ],
        { transaction: true, label: 'order_hub.orders.create' },
      )
      const order = created as CompanyOrder | null
      if (!order) throw new Error('[internal] create produced no company order')
      return { order, movedFrom }
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

    const { order, movedFrom } = await createCompanyOrderAtomic(em, scope, {
      title: parsed.title ?? null,
      orderDate: parsed.orderDate ? new Date(parsed.orderDate) : new Date(),
      etaDate: parsed.etaDate ? new Date(parsed.etaDate) : null,
      // The first stage of the current vocabulary, and the fresh-order payment answer the owner
      // specified: a root created today is 已下单 / 未收款 unless the caller says otherwise — an
      // explicit `null` is the caller saying "not recorded", which stays “—”.
      status: parsed.status ?? 'placed',
      paymentStatus: parsed.paymentStatus === undefined ? 'unpaid' : parsed.paymentStatus,
      notes: parsed.notes ?? null,
      // 订单描述 / 采购负责人: `null` and absent are the same on create — a fresh root simply has no
      // recorded value, and the form sends an explicit `null` for an empty pick.
      productCategory: parsed.productCategory ?? null,
      ownerUserId: parsed.ownerUserId ?? null,
      ownerSnapshot: parsed.ownerSnapshot ?? null,
      customerPartyId: parsed.customerPartyId ?? null,
      supplierId: parsed.supplierId ?? null,
      links: parsed.links ?? [],
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
    // Child links created in the same transaction are a link-collection change too: announce them
    // and drop the same caches `links.replace`/`link-child` do, so the hub's attach block is fresh.
    if ((parsed.links ?? []).length > 0) {
      await eventsConfig.emit('order_hub.company_order.links.updated', {
        ...identifiers,
        count: (parsed.links ?? []).length,
      })
      await invalidateCompanyOrderLinkCaches(
        { container: ctx.container, ...scope },
        identifiers,
        'company-order-created-with-links',
      )
    }
    // A purchase order created onto the root mirrors the root's 订单描述/采购负责人 at once.
    await emitPurchaseOrderFieldMirror(
      identifiers,
      order,
      (parsed.links ?? []).filter((link) => link.kind === 'purchase_order').map((link) => link.refId),
    )
    // A child moved off another root changed that root's attach block without writing to it: clear
    // its cached collections and broadcast the same link event under its id.
    for (const movedFromId of movedFrom) {
      const movedIdentifiers = { id: movedFromId, tenantId: scope.tenantId, organizationId: scope.organizationId }
      await eventsConfig.emit('order_hub.company_order.links.updated', { ...movedIdentifiers, count: 0, movedTo: identifiers.id })
      const movedOrgs = await rootInvalidationOrganizations(em, scope, movedFromId)
      await invalidateCompanyOrderLinkCaches(
        { container: ctx.container, ...scope },
        movedIdentifiers,
        'company-order-child-moved',
        movedOrgs,
      )
    }
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
    const access = await resolveCompanyOrderAccess(em, scope, parsed.id)
    if (!access) return { before: null }
    return { before: serializeCompanyOrder(access.order) }
  },
  async execute(rawInput, ctx) {
    const parsed = companyOrderUpdateSchema.parse(rawInput)
    const scope = ensureCompanyOrderScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    // The root is resolved inside the *tenant*, and the caller's side decides what may be written:
    // the owner organization edits everything, a collaborating organization (REQ-014/REQ-016) only
    // `status`/`notes`, and anyone else cannot learn the row exists (404, exactly as before).
    const access = await resolveCompanyOrderAccess(em, scope, parsed.id)
    if (!access) throw notFound('Company order not found')
    const order = access.order
    if (access.side === 'collaborator') {
      const refused = forbiddenCollaboratorFields(rawInput as Record<string, unknown>)
      if (refused.length > 0) throw collaboratorFieldRefused(refused)
    }

    enforceCommandOptimisticLock({
      resourceKind: ORDER_RESOURCE_KIND,
      resourceId: String(order.id),
      current: order.updatedAt,
      // The form sends the version in the body; the platform header still works on top.
      expected: parsed.updatedAt ?? undefined,
      request: ctx.request ?? null,
    })

    // Resolve the default customer/supplier outside the synchronous `apply` (it is async + scoped).
    // Three states per field: absent leaves the stored pair alone, `null` clears both halves, and an
    // id re-resolves and re-freezes the snapshot — an id outside the scope is 422 (fail closed).
    let customer: CompanyOrderNameRef | null | undefined
    if (parsed.customerPartyId === null) {
      customer = null
    } else if (typeof parsed.customerPartyId === 'string') {
      customer = await resolveCompanyOrderParty(em, scope, parsed.customerPartyId)
      if (!customer) {
        throw new CrudHttpError(422, {
          error: `Default customer not found in this organization: ${parsed.customerPartyId}`,
          code: 'customer_party_not_found',
        })
      }
    }
    let supplier: CompanyOrderNameRef | null | undefined
    if (parsed.supplierId === null) {
      supplier = null
    } else if (typeof parsed.supplierId === 'string') {
      supplier = await resolveCompanyOrderSupplier(em, scope, parsed.supplierId)
      if (!supplier) {
        throw new CrudHttpError(422, {
          error: `Default supplier not found in this organization: ${parsed.supplierId}`,
          code: 'supplier_not_found',
        })
      }
    }

    // 订单描述 / 采购负责人: three-state like the counterparty ids — absent leaves the stored value
    // alone, `null` clears it (for the owner that clears the id **and** its frozen snapshot), and a
    // value writes. The owner pair is decided here so `apply` stays synchronous, and the values this
    // write **will** store are kept so the mirror fires only on a real change (see below).
    const previousProductCategory = order.productCategory ?? null
    const previousOwnerUserId = order.ownerUserId ? String(order.ownerUserId) : null
    const previousOwnerSnapshot = order.ownerSnapshot ?? null
    const nextOwnerSnapshot: Record<string, unknown> | null =
      parsed.ownerUserId === null ? null : (parsed.ownerSnapshot ?? null)

    // The write predicate is the tenant + id (the side was already decided above): a collaborator's
    // organization owns no row here, so an organization-scoped `where` would match nothing.
    const updated = await de.updateOrmEntity({
      entity: CompanyOrder,
      where: orderWriteFilter(scope, parsed.id),
      apply: (entity) => {
        if (parsed.title !== undefined) entity.title = parsed.title
        if (parsed.orderDate !== undefined) entity.orderDate = new Date(parsed.orderDate)
        if (parsed.etaDate !== undefined) entity.etaDate = parsed.etaDate ? new Date(parsed.etaDate) : null
        if (parsed.status !== undefined) entity.status = parsed.status
        if (parsed.paymentStatus !== undefined) entity.paymentStatus = parsed.paymentStatus
        if (parsed.notes !== undefined) entity.notes = parsed.notes
        if (parsed.productCategory !== undefined) entity.productCategory = parsed.productCategory
        if (parsed.ownerUserId !== undefined) {
          entity.ownerUserId = parsed.ownerUserId
          entity.ownerSnapshot = nextOwnerSnapshot
        }
        if (parsed.customerPartyId !== undefined) {
          entity.customerPartyId = customer ? customer.id : null
          entity.customerSnapshot = customer ? freezeNameSnapshot(customer) : null
        }
        if (parsed.supplierId !== undefined) {
          entity.supplierId = supplier ? supplier.id : null
          entity.supplierSnapshot = supplier ? freezeNameSnapshot(supplier) : null
        }
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
    // Only a **real** change of the two root-held fields reaches the linked purchase orders — an
    // unrelated save (status, notes, a date) must not resend the same values across the module line.
    const productCategoryChanged =
      parsed.productCategory !== undefined && (parsed.productCategory ?? null) !== previousProductCategory
    const ownerUserIdChanged = parsed.ownerUserId !== undefined && (parsed.ownerUserId ?? null) !== previousOwnerUserId
    const ownerSnapshotChanged =
      parsed.ownerUserId !== undefined &&
      JSON.stringify(nextOwnerSnapshot) !== JSON.stringify(previousOwnerSnapshot)
    if (productCategoryChanged || ownerUserIdChanged || ownerSnapshotChanged) {
      const recipients = await listLinkedPurchaseOrderIds(em, scope, String(updated.id))
      await emitPurchaseOrderFieldMirror(identifiers, updated, recipients)
    }
    const updatedOrgs = await rootInvalidationOrganizations(em, scope, String(updated.id))
    await invalidateCompanyOrderCaches(
      { container: ctx.container, ...scope },
      identifiers,
      'company-order-updated',
      updatedOrgs,
    )

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
      where: orderWriteFilter(scope, before.id),
      apply: (entity) => {
        entity.title = before.title
        entity.orderDate = new Date(before.orderDate)
        entity.etaDate = before.etaDate ? new Date(before.etaDate) : null
        entity.status = before.status
        entity.paymentStatus = before.paymentStatus ?? null
        entity.notes = before.notes
        entity.productCategory = before.productCategory ?? null
        entity.ownerUserId = before.ownerUserId ?? null
        entity.ownerSnapshot = before.ownerSnapshot ?? null
        entity.customerPartyId = before.customerPartyId ?? null
        entity.customerSnapshot = before.customerSnapshot ?? null
        entity.supplierId = before.supplierId ?? null
        entity.supplierSnapshot = before.supplierSnapshot ?? null
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

    // Deleting a root is the owner's action: a collaborator may see it and write status/notes, but
    // never remove it. An unrelated organization still gets the plain not-found (no existence leak).
    const access = await resolveCompanyOrderAccess(em, scope, id)
    if (!access) throw notFound('Company order not found')
    if (access.side !== 'owner') throw ownerRequired()
    const order = access.order

    enforceCommandOptimisticLock({
      resourceKind: ORDER_RESOURCE_KIND,
      resourceId: String(order.id),
      current: order.updatedAt,
      expected: readUpdatedAt(input),
      request: ctx.request ?? null,
    })

    // Read the visibility set before the row (and its cascaded collaborator rows) is gone: the
    // collaborators' cached lists must drop the root too.
    const deletedOrgs = await rootInvalidationOrganizations(em, scope, id)
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
    await invalidateCompanyOrderCaches(
      { container: ctx.container, ...scope },
      identifiers,
      'company-order-deleted',
      deletedOrgs,
    )

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
      entity.paymentStatus = before.paymentStatus ?? null
      entity.notes = before.notes
      entity.productCategory = before.productCategory ?? null
      entity.ownerUserId = before.ownerUserId ?? null
      entity.ownerSnapshot = before.ownerSnapshot ?? null
      entity.customerPartyId = before.customerPartyId ?? null
      entity.customerSnapshot = before.customerSnapshot ?? null
      entity.supplierId = before.supplierId ?? null
      entity.supplierSnapshot = before.supplierSnapshot ?? null
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
          paymentStatus: before.paymentStatus ?? null,
          notes: before.notes,
          productCategory: before.productCategory ?? null,
          ownerUserId: before.ownerUserId ?? null,
          ownerSnapshot: before.ownerSnapshot ?? null,
          customerPartyId: before.customerPartyId ?? null,
          customerSnapshot: before.customerSnapshot ?? null,
          supplierId: before.supplierId ?? null,
          supplierSnapshot: before.supplierSnapshot ?? null,
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
    // silently re-linked; a genuinely missing id is a 404. Only the owner organization may re-link:
    // a collaborator is refused with the named owner-required code, an outsider gets the 404.
    const access = await resolveCompanyOrderAccess(em, scope, parsed.companyOrderId, { includeDeleted: true })
    if (!access) throw notFound('Company order not found')
    if (access.side !== 'owner') throw ownerRequired()
    const companyOrder = access.order
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

    // A child that currently sits on **another** root is moved here (one child, one root): its old
    // link row goes in the same transaction, and the old root is reported so its cached attach block
    // is cleared and the move is broadcast under its id too.
    let movedFrom: string[] = []
    await withAtomicFlush(
      em,
      [
        async () => {
          movedFrom = await moveCompanyOrderChildren(em, scope, parsed.refs.map((ref) => ({
            kind: parsed.kind,
            refId: ref.refId,
          })), { keepCompanyOrderId: String(companyOrder.id) })
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
    // A purchase order re-hung on the root mirrors the root's 订单描述/采购负责人 at once; the whole
    // resulting set is the recipient list, so a child moved here is covered too.
    if (parsed.kind === 'purchase_order') {
      await emitPurchaseOrderFieldMirror(identifiers, companyOrder, parsed.refs.map((ref) => ref.refId))
    }
    const replaceOrgs = await rootInvalidationOrganizations(em, scope, String(companyOrder.id))
    await invalidateCompanyOrderLinkCaches(
      { container: ctx.container, ...scope },
      identifiers,
      'company-order-links-replaced',
      replaceOrgs,
    )
    for (const movedFromId of movedFrom) {
      const movedIdentifiers = { id: movedFromId, tenantId: scope.tenantId, organizationId: scope.organizationId }
      await eventsConfig.emit('order_hub.company_order.links.updated', {
        ...movedIdentifiers,
        kind: parsed.kind,
        count: 0,
        movedTo: identifiers.id,
      })
      const movedOrgs = await rootInvalidationOrganizations(em, scope, movedFromId)
      await invalidateCompanyOrderLinkCaches(
        { container: ctx.container, ...scope },
        movedIdentifiers,
        'company-order-child-moved',
        movedOrgs,
      )
    }

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

    // Naming an existing root is a write *on that root*, so it stays the owner's: a collaborating
    // organization may not attach a document to someone else's order (the no-target case below
    // creates a root in the caller's own organization, which is always theirs).
    if (parsed.companyOrderId) {
      const access = await resolveCompanyOrderAccess(em, scope, parsed.companyOrderId)
      if (!access) throw notFound('Company order not found')
      if (access.side !== 'owner') throw ownerRequired()
    }

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
    const linkChildOrgs = await rootInvalidationOrganizations(em, scope, result.companyOrderId)
    await invalidateCompanyOrderLinkCaches(
      { container: ctx.container, ...scope },
      identifiers,
      'company-order-link-child',
      linkChildOrgs,
    )
    // A purchase order that just hung off the root mirrors the root's 订单描述/采购负责人 at once; the
    // root is read back so the mirror carries the **stored** values, not the request's.
    if (parsed.kind === 'purchase_order') {
      const root = await loadCompanyOrder(em, scope, result.companyOrderId)
      await emitPurchaseOrderFieldMirror(identifiers, root, [parsed.refId])
    }

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

const replaceCompanyOrderCollaboratorsCommand: CommandHandler<
  Record<string, unknown>,
  { companyOrderId: string; organizationIds: string[]; tenantId: string; organizationId: string }
> = {
  id: 'order_hub.orders.collaborators.replace',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = companyOrderCollaboratorsReplaceSchema.parse(rawInput)
    const scope = ensureCompanyOrderScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager

    // Owner-only, like every other write that changes who may touch the root. Loaded including
    // soft-deleted rows so a deleted root is refused explicitly rather than silently re-scoped.
    const access = await resolveCompanyOrderAccess(em, scope, parsed.companyOrderId, { includeDeleted: true })
    if (!access) throw notFound('Company order not found')
    if (access.side !== 'owner') throw ownerRequired()
    const companyOrder = access.order
    if (companyOrder.deletedAt) {
      throw new CrudHttpError(422, { error: 'A deleted company order cannot be re-collaborated' })
    }

    enforceCommandOptimisticLock({
      resourceKind: ORDER_RESOURCE_KIND,
      resourceId: String(companyOrder.id),
      current: companyOrder.updatedAt,
      expected: parsed.updatedAt ?? undefined,
      request: ctx.request ?? null,
    })

    // The owner's own organization is not a collaborator (it already owns the root), and a repeated
    // organization collapses onto one row — both before the unique key and the existence check.
    const requested = Array.from(new Set(parsed.organizationIds))
      .filter((id) => id !== String(companyOrder.organizationId))
    await assertCollaboratorOrganizationsExist(em, scope.tenantId, requested)
    // The set being replaced: an organization that lost the row needs its cached list cleared just
    // as much as one that gained it.
    const previous = await loadCompanyOrderCollaboratorOrganizationIds(em, scope, String(companyOrder.id))

    await withAtomicFlush(
      em,
      [
        async () => {
          await em.nativeDelete(CompanyOrderCollaborator, {
            companyOrder: companyOrder.id,
          } as FilterQuery<CompanyOrderCollaborator>)
          for (const organizationId of requested) {
            em.persist(em.create(CompanyOrderCollaborator, {
              tenantId: scope.tenantId,
              organizationId,
              companyOrder,
              createdAt: new Date(),
              updatedAt: new Date(),
            }))
          }
        },
      ],
      { transaction: true, label: 'order_hub.orders.collaborators.replace' },
    )

    const identifiers = {
      id: String(companyOrder.id),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
    await eventsConfig.emit('order_hub.company_order.collaborators.updated', {
      ...identifiers,
      count: requested.length,
    })
    await invalidateCompanyOrderCollaboratorCaches(
      { container: ctx.container, ...scope },
      identifiers,
      'company-order-collaborators-replaced',
      [...previous, ...requested],
    )

    return {
      companyOrderId: String(companyOrder.id),
      organizationIds: requested,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
  captureAfter: (_input, result) => ({ id: result.companyOrderId, count: result.organizationIds.length }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Company order collaborators replaced',
    resourceKind: ORDER_RESOURCE_KIND,
    resourceId: result.companyOrderId,
    tenantId: result.tenantId,
    organizationId: result.organizationId,
    snapshotAfter: { companyOrderId: result.companyOrderId, count: result.organizationIds.length },
  }),
}

registerCommand(createCompanyOrderCommand)
registerCommand(updateCompanyOrderCommand)
registerCommand(deleteCompanyOrderCommand)
registerCommand(replaceCompanyOrderLinksCommand)
registerCommand(linkChildCommand)
registerCommand(replaceCompanyOrderCollaboratorsCommand)

export {
  createCompanyOrderCommand,
  updateCompanyOrderCommand,
  deleteCompanyOrderCommand,
  replaceCompanyOrderLinksCommand,
  linkChildCommand,
  replaceCompanyOrderCollaboratorsCommand,
}

export { loadCompanyOrder }
