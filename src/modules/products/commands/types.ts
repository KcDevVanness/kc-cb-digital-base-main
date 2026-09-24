import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import {
  buildChanges,
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
  requireId,
} from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { badRequest, conflict, CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE } from '@open-mercato/shared/lib/auth/organizationScope'
import type { CrudEmitContext, CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { ProductsProduct, ProductsType } from '../data/entities'
import { productTypeCreateSchema, productTypeUpdateSchema } from '../data/validators'

const ENTITY_ID = 'products:products_type' as const
const RESOURCE_KIND = 'products.product_type' as const

type SerializedType = {
  id: string
  code: string
  name: string
  nameEn: string | null
  sortOrder: number
  isActive: boolean
  tenantId: string
  organizationId: string
}

function serializeType(entity: ProductsType): SerializedType {
  return {
    id: String(entity.id),
    code: entity.code,
    name: entity.name,
    nameEn: entity.nameEn ?? null,
    sortOrder: entity.sortOrder,
    isActive: entity.isActive,
    tenantId: String(entity.tenantId),
    organizationId: String(entity.organizationId),
  }
}

export const productTypeCrudEvents: CrudEventsConfig<ProductsType> = {
  module: 'products',
  // Entity name is the event-id segment: `products.type.created|updated|deleted`.
  entity: 'type',
  persistent: true,
  buildPayload: (ctx: CrudEmitContext<ProductsType>) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    code: ctx.entity?.code ?? null,
  }),
}

export const productTypeCrudIndexer: CrudIndexerConfig<ProductsType> = {
  entityType: ENTITY_ID,
}

/**
 * Trusted scope only. A command never reads tenant/organization from its payload — the record
 * belongs to the organization the caller is acting in, and a missing scope fails closed
 * instead of defaulting to something wider.
 */
export function ensureScope(ctx: CommandRuntimeContext): { tenantId: string; organizationId: string } {
  const tenantId = ctx.auth?.tenantId ?? null
  if (!tenantId) throw badRequest('Tenant context is required')
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: 'Select an organization to access this resource',
      code: ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE,
    })
  }
  return { tenantId, organizationId }
}

export function typeFilter(scope: { tenantId: string; organizationId: string }, id: string): FilterQuery<ProductsType> {
  return {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  } as FilterQuery<ProductsType>
}

/**
 * `code` is unique per organization — the database constraint does **not** exclude soft-deleted
 * rows, so this check looks at them too: a code that belonged to a deleted type is still taken,
 * and the caller gets a readable 409 instead of the driver's unique violation surfacing as 500.
 */
async function assertCodeAvailable(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  code: string,
  exceptId?: string,
): Promise<void> {
  const existing = await em.fork().findOne(ProductsType, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    code,
  } as FilterQuery<ProductsType>)
  if (existing && String(existing.id) !== exceptId) {
    throw conflict('A product type with this code already exists in this organization')
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'UniqueConstraintViolationException'
}

/**
 * A type is referenced by products *and* by already-issued contracts (through line snapshots).
 * Deleting a type an operator still relies on would break the form's selector for those
 * products, so the delete is refused and the caller is told to deactivate instead.
 */
async function assertTypeUnreferenced(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  typeId: string,
): Promise<void> {
  const referencing = await em.fork().count(ProductsProduct, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    typeId,
    deletedAt: null,
  } as FilterQuery<ProductsProduct>)
  if (referencing > 0) {
    throw new CrudHttpError(422, {
      error: 'This product type is used by existing products; deactivate it instead of deleting',
    })
  }
}

const createTypeCommand: CommandHandler<Record<string, unknown>, ProductsType> = {
  id: 'products.types.create',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const parsed = productTypeCreateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    await assertCodeAvailable(em, scope, parsed.code)

    const created = await de
      .createOrmEntity({
        entity: ProductsType,
        data: {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          code: parsed.code,
          name: parsed.name,
          nameEn: parsed.nameEn ?? null,
          sortOrder: parsed.sortOrder,
          isActive: parsed.isActive,
        },
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw conflict('A product type with this code already exists in this organization')
        }
        throw error
      })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: created,
      identifiers: { id: String(created.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: productTypeCrudEvents,
      indexer: productTypeCrudIndexer,
    })

    return created
  },
  captureAfter: (_input, result) => serializeType(result),
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    const after = serializeType(result)
    return {
      actionLabel: translate('products.audit.types.create', 'Create product type'),
      resourceKind: RESOURCE_KIND,
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
    }
  },
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<{ after?: SerializedType }>(logEntry)
    const snapshot = payload?.after ?? (logEntry?.snapshotAfter as SerializedType | undefined)
    const id = snapshot?.id ?? logEntry?.resourceId
    if (!id) throw new Error('[internal] Missing product type id for undo')
    const scope = ensureScope(ctx)
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const removed = await de.deleteOrmEntity({
      entity: ProductsType,
      where: typeFilter(scope, id),
      soft: true,
      softDeleteField: 'deletedAt',
    })
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: { id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: productTypeCrudEvents,
      indexer: productTypeCrudIndexer,
    })
  },
}

const updateTypeCommand: CommandHandler<Record<string, unknown>, ProductsType> = {
  id: 'products.types.update',
  isUndoable: true,
  async prepare(rawInput, ctx) {
    const parsed = productTypeUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const current = await em.fork().findOne(ProductsType, typeFilter(scope, parsed.id))
    if (!current) return {}
    return { before: serializeType(current) }
  },
  async execute(rawInput, ctx) {
    const parsed = productTypeUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const current = await em.fork().findOne(ProductsType, typeFilter(scope, parsed.id))
    if (!current) throw notFound('Product type not found')

    enforceCommandOptimisticLock({
      resourceKind: RESOURCE_KIND,
      resourceId: String(current.id),
      current: current.updatedAt,
      request: ctx.request ?? null,
    })

    if (parsed.code !== undefined && parsed.code !== current.code) {
      await assertCodeAvailable(em, scope, parsed.code, String(current.id))
    }

    const updated = await de
      .updateOrmEntity({
        entity: ProductsType,
        where: typeFilter(scope, parsed.id),
        apply: (entity) => {
          if (parsed.code !== undefined) entity.code = parsed.code
          if (parsed.name !== undefined) entity.name = parsed.name
          if (parsed.nameEn !== undefined) entity.nameEn = parsed.nameEn
          if (parsed.sortOrder !== undefined) entity.sortOrder = parsed.sortOrder
          if (parsed.isActive !== undefined) entity.isActive = parsed.isActive
        },
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw conflict('A product type with this code already exists in this organization')
        }
        throw error
      })
    if (!updated) throw notFound('Product type not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: productTypeCrudEvents,
      indexer: productTypeCrudIndexer,
    })

    return updated
  },
  captureAfter: (_input, result) => serializeType(result),
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as SerializedType | undefined
    const after = serializeType(result)
    return {
      actionLabel: translate('products.audit.types.update', 'Update product type'),
      resourceKind: RESOURCE_KIND,
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      changes: buildChanges(
        (before ?? null) as unknown as Record<string, unknown> | null,
        after as unknown as Record<string, unknown>,
        ['code', 'name', 'nameEn', 'sortOrder', 'isActive'],
      ),
      snapshotBefore: before ?? null,
      snapshotAfter: after,
    }
  },
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<{ before?: SerializedType }>(logEntry)
    const before = payload?.before ?? (logEntry?.snapshotBefore as SerializedType | undefined)
    if (!before?.id) throw new Error('[internal] Missing previous product type snapshot for undo')
    const scope = ensureScope(ctx)
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const updated = await de.updateOrmEntity({
      entity: ProductsType,
      where: typeFilter(scope, before.id),
      apply: (entity) => {
        entity.code = before.code
        entity.name = before.name
        entity.nameEn = before.nameEn
        entity.sortOrder = before.sortOrder
        entity.isActive = before.isActive
      },
    })
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: { id: before.id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: productTypeCrudEvents,
      indexer: productTypeCrudIndexer,
    })
  },
}

const deleteTypeCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  ProductsType
> = {
  id: 'products.types.delete',
  isUndoable: true,
  async prepare(input, ctx) {
    const id = requireId(input, 'Product type id required')
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const existing = await em.fork().findOne(ProductsType, typeFilter(scope, id))
    if (!existing) return {}
    return { before: serializeType(existing) }
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Product type id required')
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const current = await em.fork().findOne(ProductsType, typeFilter(scope, id))
    if (!current) throw notFound('Product type not found')

    enforceCommandOptimisticLock({
      resourceKind: RESOURCE_KIND,
      resourceId: String(current.id),
      current: current.updatedAt,
      request: ctx.request ?? null,
    })

    await assertTypeUnreferenced(em, scope, id)

    const removed = await de.deleteOrmEntity({
      entity: ProductsType,
      where: typeFilter(scope, id),
      soft: true,
      softDeleteField: 'deletedAt',
    })
    if (!removed) throw notFound('Product type not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: { id: String(removed.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: productTypeCrudEvents,
      indexer: productTypeCrudIndexer,
    })

    return removed
  },
  captureAfter: (_input, result) => serializeType(result),
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    const after = serializeType(result)
    return {
      actionLabel: translate('products.audit.types.delete', 'Delete product type'),
      resourceKind: RESOURCE_KIND,
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
    }
  },
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<{ after?: SerializedType }>(logEntry)
    const snapshot = payload?.after ?? (logEntry?.snapshotAfter as SerializedType | undefined)
    const id = snapshot?.id ?? logEntry?.resourceId
    if (!id) throw new Error('[internal] Missing product type id for undo')
    const scope = ensureScope(ctx)
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const restored = await de.updateOrmEntity({
      entity: ProductsType,
      where: {
        id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      } as FilterQuery<ProductsType>,
      apply: (entity) => {
        entity.deletedAt = null
      },
    })
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'created',
      entity: restored,
      identifiers: { id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: productTypeCrudEvents,
      indexer: productTypeCrudIndexer,
    })
  },
}

registerCommand(createTypeCommand)
registerCommand(updateTypeCommand)
registerCommand(deleteTypeCommand)

export { createTypeCommand, updateTypeCommand, deleteTypeCommand }
