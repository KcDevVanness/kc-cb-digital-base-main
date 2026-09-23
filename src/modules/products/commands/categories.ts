import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import {
  buildChanges,
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
  requireId,
} from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { conflict, CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEmitContext, CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { ProductsCategory, ProductsProduct } from '../data/entities'
import { productCategoryCreateSchema, productCategoryUpdateSchema } from '../data/validators'
import { rebuildProductCategoryHierarchyForOrganization, wouldCreateCategoryCycle } from '../lib/categoryTree'
import { ensureScope } from './types'

const ENTITY_ID = 'products:products_category' as const
const RESOURCE_KIND = 'products.product_category' as const

type SerializedCategory = {
  id: string
  code: string
  name: string
  nameEn: string | null
  parentId: string | null
  rootId: string | null
  treePath: string | null
  depth: number
  ancestorIds: string[]
  childIds: string[]
  descendantIds: string[]
  sortOrder: number
  isActive: boolean
  tenantId: string
  organizationId: string
}

function serializeCategory(entity: ProductsCategory): SerializedCategory {
  return {
    id: String(entity.id),
    code: entity.code,
    name: entity.name,
    nameEn: entity.nameEn ?? null,
    parentId: entity.parentId ? String(entity.parentId) : null,
    rootId: entity.rootId ? String(entity.rootId) : null,
    treePath: entity.treePath ?? null,
    depth: entity.depth,
    ancestorIds: Array.isArray(entity.ancestorIds) ? entity.ancestorIds.map(String) : [],
    childIds: Array.isArray(entity.childIds) ? entity.childIds.map(String) : [],
    descendantIds: Array.isArray(entity.descendantIds) ? entity.descendantIds.map(String) : [],
    sortOrder: entity.sortOrder,
    isActive: entity.isActive,
    tenantId: String(entity.tenantId),
    organizationId: String(entity.organizationId),
  }
}

export const productCategoryCrudEvents: CrudEventsConfig<ProductsCategory> = {
  module: 'products',
  // Entity name is the event-id segment: `products.category.created|updated|deleted`.
  entity: 'category',
  persistent: true,
  buildPayload: (ctx: CrudEmitContext<ProductsCategory>) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    code: ctx.entity?.code ?? null,
    treePath: ctx.entity?.treePath ?? null,
  }),
}

export const productCategoryCrudIndexer: CrudIndexerConfig<ProductsCategory> = {
  entityType: ENTITY_ID,
}

function categoryFilter(
  scope: { tenantId: string; organizationId: string },
  id: string,
): FilterQuery<ProductsCategory> {
  return {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  } as FilterQuery<ProductsCategory>
}

async function assertCodeAvailable(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  code: string,
  exceptId?: string,
): Promise<void> {
  const existing = await em.fork().findOne(ProductsCategory, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    code,
  } as FilterQuery<ProductsCategory>)
  if (existing && String(existing.id) !== exceptId) {
    throw conflict('A category with this code already exists in this organization')
  }
}

/**
 * A parent must resolve inside the caller's own organization: a cross-organization id would
 * silently produce a tree whose paths mix scopes.
 */
async function assertParentVisible(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  parentId: string,
): Promise<void> {
  const parent = await em.fork().findOne(ProductsCategory, categoryFilter(scope, parentId))
  if (!parent) throw new CrudHttpError(400, { error: 'Parent category not found in this organization' })
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'UniqueConstraintViolationException'
  )
}

const createCategoryCommand: CommandHandler<Record<string, unknown>, ProductsCategory> = {
  id: 'products.categories.create',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const parsed = productCategoryCreateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    await assertCodeAvailable(em, scope, parsed.code)
    if (parsed.parentId) await assertParentVisible(em, scope, parsed.parentId)

    let created!: ProductsCategory
    await withAtomicFlush(
      em,
      [
        async () => {
          created = await de
            .createOrmEntity({
              entity: ProductsCategory,
              data: {
                tenantId: scope.tenantId,
                organizationId: scope.organizationId,
                code: parsed.code,
                name: parsed.name,
                nameEn: parsed.nameEn ?? null,
                parentId: parsed.parentId ?? null,
                sortOrder: parsed.sortOrder,
                isActive: parsed.isActive,
              },
            })
            .catch((error: unknown) => {
              if (isUniqueViolation(error)) {
                throw conflict('A category with this code already exists in this organization')
              }
              throw error
            })
        },
        // Second phase: the row is already flushed, so the rebuild reads it back and can set
        // the derived columns before the transaction commits.
        async () => {
          await rebuildProductCategoryHierarchyForOrganization(em, scope)
        },
      ],
      { transaction: true, label: 'products.categories.create' },
    )

    const persisted = await em.fork().findOne(ProductsCategory, categoryFilter(scope, String(created.id)))
    const result = persisted ?? created

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: result,
      identifiers: { id: String(result.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: productCategoryCrudEvents,
      indexer: productCategoryCrudIndexer,
    })

    return result
  },
  captureAfter: (_input, result) => serializeCategory(result),
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    const after = serializeCategory(result)
    return {
      actionLabel: translate('products.audit.categories.create', 'Create product category'),
      resourceKind: RESOURCE_KIND,
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
    }
  },
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<{ after?: SerializedCategory }>(logEntry)
    const snapshot = payload?.after ?? (logEntry?.snapshotAfter as SerializedCategory | undefined)
    const id = snapshot?.id ?? logEntry?.resourceId
    if (!id) throw new Error('[internal] Missing product category id for undo')
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine
    await withAtomicFlush(
      em,
      [
        async () => {
          await de.deleteOrmEntity({
            entity: ProductsCategory,
            where: categoryFilter(scope, id),
            soft: true,
            softDeleteField: 'deletedAt',
          })
        },
        async () => {
          await rebuildProductCategoryHierarchyForOrganization(em, scope)
        },
      ],
      { transaction: true, label: 'products.categories.create.undo' },
    )
    const removed = await em.fork().findOne(ProductsCategory, {
      id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    } as FilterQuery<ProductsCategory>)
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: { id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: productCategoryCrudEvents,
      indexer: productCategoryCrudIndexer,
    })
  },
}

const updateCategoryCommand: CommandHandler<Record<string, unknown>, ProductsCategory> = {
  id: 'products.categories.update',
  isUndoable: true,
  async prepare(rawInput, ctx) {
    const parsed = productCategoryUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const current = await em.fork().findOne(ProductsCategory, categoryFilter(scope, parsed.id))
    if (!current) return {}
    return { before: serializeCategory(current) }
  },
  async execute(rawInput, ctx) {
    const parsed = productCategoryUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const current = await em.fork().findOne(ProductsCategory, categoryFilter(scope, parsed.id))
    if (!current) throw notFound('Product category not found')

    enforceCommandOptimisticLock({
      resourceKind: RESOURCE_KIND,
      resourceId: String(current.id),
      current: current.updatedAt,
      request: ctx.request ?? null,
    })

    if (parsed.code !== undefined && parsed.code !== current.code) {
      await assertCodeAvailable(em, scope, parsed.code, String(current.id))
    }
    if (parsed.parentId) {
      await assertParentVisible(em, scope, parsed.parentId)
      // Rejected before the write: the rebuild would otherwise silently break the ring at an
      // arbitrary node and the tree would look plausible while being wrong.
      if (await wouldCreateCategoryCycle(em, scope, String(current.id), parsed.parentId)) {
        throw new CrudHttpError(422, {
          error: 'A category cannot be moved under itself or one of its descendants',
        })
      }
    }

    await withAtomicFlush(
      em,
      [
        async () => {
          const updated = await de
            .updateOrmEntity({
              entity: ProductsCategory,
              where: categoryFilter(scope, parsed.id),
              apply: (entity) => {
                if (parsed.code !== undefined) entity.code = parsed.code
                if (parsed.name !== undefined) entity.name = parsed.name
                if (parsed.nameEn !== undefined) entity.nameEn = parsed.nameEn
                if (parsed.parentId !== undefined) entity.parentId = parsed.parentId
                if (parsed.sortOrder !== undefined) entity.sortOrder = parsed.sortOrder
                if (parsed.isActive !== undefined) entity.isActive = parsed.isActive
              },
            })
            .catch((error: unknown) => {
              if (isUniqueViolation(error)) {
                throw conflict('A category with this code already exists in this organization')
              }
              throw error
            })
          if (!updated) throw notFound('Product category not found')
        },
        async () => {
          await rebuildProductCategoryHierarchyForOrganization(em, scope)
        },
      ],
      { transaction: true, label: 'products.categories.update' },
    )

    const persisted = await em.fork().findOne(ProductsCategory, categoryFilter(scope, parsed.id))
    if (!persisted) throw notFound('Product category not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: persisted,
      identifiers: { id: String(persisted.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: productCategoryCrudEvents,
      indexer: productCategoryCrudIndexer,
    })

    return persisted
  },
  captureAfter: (_input, result) => serializeCategory(result),
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as SerializedCategory | undefined
    const after = serializeCategory(result)
    return {
      actionLabel: translate('products.audit.categories.update', 'Update product category'),
      resourceKind: RESOURCE_KIND,
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      changes: buildChanges(
        (before ?? null) as unknown as Record<string, unknown> | null,
        after as unknown as Record<string, unknown>,
        ['code', 'name', 'nameEn', 'parentId', 'sortOrder', 'isActive'],
      ),
      snapshotBefore: before ?? null,
      snapshotAfter: after,
    }
  },
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<{ before?: SerializedCategory }>(logEntry)
    const before = payload?.before ?? (logEntry?.snapshotBefore as SerializedCategory | undefined)
    if (!before?.id) throw new Error('[internal] Missing previous product category snapshot for undo')
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine
    await withAtomicFlush(
      em,
      [
        async () => {
          await de.updateOrmEntity({
            entity: ProductsCategory,
            where: categoryFilter(scope, before.id),
            apply: (entity) => {
              entity.code = before.code
              entity.name = before.name
              entity.nameEn = before.nameEn
              entity.parentId = before.parentId
              entity.sortOrder = before.sortOrder
              entity.isActive = before.isActive
            },
          })
        },
        async () => {
          await rebuildProductCategoryHierarchyForOrganization(em, scope)
        },
      ],
      { transaction: true, label: 'products.categories.update.undo' },
    )
    const restored = await em.fork().findOne(ProductsCategory, categoryFilter(scope, before.id))
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: restored,
      identifiers: { id: before.id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: productCategoryCrudEvents,
      indexer: productCategoryCrudIndexer,
    })
  },
}

const deleteCategoryCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  ProductsCategory
> = {
  id: 'products.categories.delete',
  isUndoable: true,
  async prepare(input, ctx) {
    const id = requireId(input, 'Product category id required')
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const existing = await em.fork().findOne(ProductsCategory, categoryFilter(scope, id))
    if (!existing) return {}
    return { before: serializeCategory(existing) }
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Product category id required')
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const current = await em.fork().findOne(ProductsCategory, categoryFilter(scope, id))
    if (!current) throw notFound('Product category not found')

    enforceCommandOptimisticLock({
      resourceKind: RESOURCE_KIND,
      resourceId: String(current.id),
      current: current.updatedAt,
      request: ctx.request ?? null,
    })

    const childCount = await em.fork().count(ProductsCategory, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      parentId: id,
      deletedAt: null,
    } as FilterQuery<ProductsCategory>)
    if (childCount > 0) {
      throw new CrudHttpError(422, { error: 'This category has sub-categories; delete or move them first' })
    }
    const productCount = await em.fork().count(ProductsProduct, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      categoryId: id,
      deletedAt: null,
    } as FilterQuery<ProductsProduct>)
    if (productCount > 0) {
      throw new CrudHttpError(422, { error: 'This category is used by existing products; deactivate it instead of deleting' })
    }

    await withAtomicFlush(
      em,
      [
        async () => {
          const removed = await de.deleteOrmEntity({
            entity: ProductsCategory,
            where: categoryFilter(scope, id),
            soft: true,
            softDeleteField: 'deletedAt',
          })
          if (!removed) throw notFound('Product category not found')
        },
        async () => {
          await rebuildProductCategoryHierarchyForOrganization(em, scope)
        },
      ],
      { transaction: true, label: 'products.categories.delete' },
    )

    const removed = await em.fork().findOne(ProductsCategory, {
      id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    } as FilterQuery<ProductsCategory>)

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: { id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: productCategoryCrudEvents,
      indexer: productCategoryCrudIndexer,
    })

    return removed ?? current
  },
  captureAfter: (_input, result) => serializeCategory(result),
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    const after = serializeCategory(result)
    return {
      actionLabel: translate('products.audit.categories.delete', 'Delete product category'),
      resourceKind: RESOURCE_KIND,
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
    }
  },
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<{ after?: SerializedCategory }>(logEntry)
    const snapshot = payload?.after ?? (logEntry?.snapshotAfter as SerializedCategory | undefined)
    const id = snapshot?.id ?? logEntry?.resourceId
    if (!id) throw new Error('[internal] Missing product category id for undo')
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine
    await withAtomicFlush(
      em,
      [
        async () => {
          await de.updateOrmEntity({
            entity: ProductsCategory,
            where: {
              id,
              tenantId: scope.tenantId,
              organizationId: scope.organizationId,
            } as FilterQuery<ProductsCategory>,
            apply: (entity) => {
              entity.deletedAt = null
            },
          })
        },
        async () => {
          await rebuildProductCategoryHierarchyForOrganization(em, scope)
        },
      ],
      { transaction: true, label: 'products.categories.delete.undo' },
    )
    const restored = await em.fork().findOne(ProductsCategory, categoryFilter(scope, id))
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'created',
      entity: restored,
      identifiers: { id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: productCategoryCrudEvents,
      indexer: productCategoryCrudIndexer,
    })
  },
}

registerCommand(createCategoryCommand)
registerCommand(updateCategoryCommand)
registerCommand(deleteCategoryCommand)

export { createCategoryCommand, updateCategoryCommand, deleteCategoryCommand }
export type { SerializedCategory }
