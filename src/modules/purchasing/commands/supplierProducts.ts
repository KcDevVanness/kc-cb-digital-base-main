import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, requireId } from '@open-mercato/shared/lib/commands/helpers'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { badRequest, CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { PurchasingSupplierProduct } from '../data/entities'
import {
  supplierProductCreateSchema,
  supplierProductImportSchema,
  supplierProductLinkSchema,
  supplierProductPromoteBatchSchema,
  supplierProductPromoteSchema,
  supplierProductSyncFieldsSchema,
  supplierProductUpdateSchema,
  type SupplierProductImportInput,
} from '../data/validators'
import { importQuoteLinesIntoLibraries, type SupplierProductImportResult } from '../lib/supplierProductImport'
import { writeSupplierProductLink } from '../lib/supplierProductLinking'
import {
  applySupplierProductToMaster,
  promoteSupplierProduct,
  type CommandBusLike,
  type SupplierProductPromotionResult,
} from '../lib/supplierProductPromotion'
import { loadQuote } from '../lib/quoteLineReads'
import {
  SUPPLIER_PRODUCT_RESOURCE_KIND,
  ensureScope,
  findSupplierProductBySku,
  loadSupplierProduct,
  loadSupplierName,
  supplierProductCrudEvents,
  supplierProductCrudIndexer,
  supplierProductFilter,
} from './shared'

/**
 * The supplier product library's commands.
 *
 * A library row is "this supplier sells this item", so two rules shape every write: the supplier
 * is fixed at creation (a code is only unique *per supplier*, so moving a row would silently
 * collide) and a code is owned forever, including by a soft-deleted row — a duplicate is a
 * readable 409, never a unique-index 500.
 *
 * `sourcing` reaches this library only through these commands: the quotation promotion calls
 * `purchasing.supplier-products.import-from-quote` with the line it just promoted, so the library
 * stays a by-product of the workflow the buyer already runs.
 */

const createSupplierProductCommand: CommandHandler<Record<string, unknown>, PurchasingSupplierProduct> = {
  id: 'purchasing.supplier-products.create',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = supplierProductCreateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const supplierName = await loadSupplierName(em, scope, parsed.supplierId)
    if (!supplierName) throw badRequest(`Supplier not found in this organization: ${parsed.supplierId}`)

    const duplicate = await findSupplierProductBySku(em, scope, parsed.supplierId, parsed.supplierSku)
    if (duplicate) {
      throw new CrudHttpError(409, {
        error: `Supplier product code ${parsed.supplierSku} already exists for this supplier`,
        code: 'supplier_product_sku_taken',
      })
    }

    const created = await de.createOrmEntity({
      entity: PurchasingSupplierProduct,
      data: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        supplierId: parsed.supplierId,
        supplierNameSnapshot: supplierName,
        supplierSku: parsed.supplierSku,
        itemNo: parsed.itemNo ?? null,
        name: parsed.name,
        nameZh: parsed.nameZh ?? null,
        nameEn: parsed.nameEn ?? null,
        description: parsed.description ?? null,
        declarationElements: parsed.declarationElements ?? null,
        unit: parsed.unit,
        hsCode: parsed.hsCode ?? null,
        moqQuantity: parsed.moqQuantity ?? null,
        cartonQuantity: parsed.cartonQuantity ?? null,
        unitNetWeight: parsed.unitNetWeight ?? null,
        innerPacking: parsed.innerPacking,
        imageAttachmentIds: parsed.imageAttachmentIds ?? [],
        status: parsed.status,
        source: 'manual',
        notes: parsed.notes ?? null,
      },
    })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: created,
      identifiers: { id: String(created.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      events: supplierProductCrudEvents,
      indexer: supplierProductCrudIndexer,
    })
    return created
  },
}

const updateSupplierProductCommand: CommandHandler<Record<string, unknown>, PurchasingSupplierProduct> = {
  id: 'purchasing.supplier-products.update',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = supplierProductUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const product = await loadSupplierProduct(em, scope, parsed.id)
    enforceCommandOptimisticLock({
      resourceKind: SUPPLIER_PRODUCT_RESOURCE_KIND,
      resourceId: String(product.id),
      current: product.updatedAt,
      request: ctx.request,
    })

    const updated = await de.updateOrmEntity({
      entity: PurchasingSupplierProduct,
      where: supplierProductFilter(scope, parsed.id),
      apply: (entity) => {
        // `supplierId` and `source` are deliberately absent: the first because a code is unique per
        // supplier, the second because the row's provenance is history, not a form field.
        entity.supplierSku = parsed.supplierSku
        if (parsed.itemNo !== undefined) entity.itemNo = parsed.itemNo ?? null
        entity.name = parsed.name
        if (parsed.nameZh !== undefined) entity.nameZh = parsed.nameZh ?? null
        if (parsed.nameEn !== undefined) entity.nameEn = parsed.nameEn ?? null
        if (parsed.description !== undefined) entity.description = parsed.description ?? null
        if (parsed.declarationElements !== undefined) entity.declarationElements = parsed.declarationElements ?? null
        entity.unit = parsed.unit
        if (parsed.hsCode !== undefined) entity.hsCode = parsed.hsCode ?? null
        if (parsed.moqQuantity !== undefined) entity.moqQuantity = parsed.moqQuantity ?? null
        if (parsed.cartonQuantity !== undefined) entity.cartonQuantity = parsed.cartonQuantity ?? null
        if (parsed.unitNetWeight !== undefined) entity.unitNetWeight = parsed.unitNetWeight ?? null
        if (parsed.innerPacking !== undefined) entity.innerPacking = parsed.innerPacking
        // Replace-set: the submitted list is the new photo list, `[]` clears it, and an omitted key
        // leaves it alone — binding a photo is a row write, so the list sits behind the same lock.
        if (parsed.imageAttachmentIds !== undefined) entity.imageAttachmentIds = parsed.imageAttachmentIds
        entity.status = parsed.status
        if (parsed.notes !== undefined) entity.notes = parsed.notes ?? null
      },
    })
    if (!updated) throw notFound('Supplier product not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      events: supplierProductCrudEvents,
      indexer: supplierProductCrudIndexer,
    })
    return updated
  },
}

/**
 * Soft delete. Deleting a row that purchase orders already reference is allowed on purpose: those
 * lines froze their own snapshot, so the order history stays readable while the item leaves the
 * picker.
 */
const deleteSupplierProductCommand: CommandHandler<Record<string, unknown>, { id: string }> = {
  id: 'purchasing.supplier-products.delete',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const id = requireId(rawInput, 'Supplier product id required')
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const product = await loadSupplierProduct(em, scope, id)

    const removed = await de.deleteOrmEntity({ entity: PurchasingSupplierProduct, where: supplierProductFilter(scope, id) })
    if (!removed) throw notFound('Supplier product not found')
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: product,
      identifiers: { id: String(product.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      events: supplierProductCrudEvents,
      indexer: supplierProductCrudIndexer,
    })
    return { id: String(product.id) }
  },
}

/**
 * `purchasing.supplier-products.import-from-quote` — feed quotation lines into the supplier's
 * library. The quotation is read through a scoped projection (`lib/quoteLineReads.ts`), never
 * through `sourcing`'s entities; the quotation must name a supplier (a library row is keyed by
 * one), and lines are matched to the quotation so a stale console cannot import somebody else's
 * rows.
 */
const importSupplierProductsCommand: CommandHandler<Record<string, unknown>, SupplierProductImportResult> = {
  id: 'purchasing.supplier-products.import-from-quote',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed: SupplierProductImportInput = supplierProductImportSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const quote = await loadQuote(em, scope, parsed.quoteId)
    if (!quote) throw notFound('Quotation not found in this organization')
    if (!quote.supplierId) {
      throw new CrudHttpError(422, {
        error: 'Select the supplier on the quotation before adding its lines to the supplier library',
        code: 'quote_supplier_required',
      })
    }

    return importQuoteLinesIntoLibraries({
      em,
      de,
      scope,
      quote,
      requestedLineIds: parsed.lineIds,
    })
  },
}

/**
 * `purchasing.supplier-products.promote` — the supplier list's only write into the product master.
 * Idempotent: a row that already carries `product_id` reports `skipped` instead of writing again.
 */
const promoteSupplierProductCommand: CommandHandler<Record<string, unknown>, SupplierProductPromotionResult> = {
  id: 'purchasing.supplier-products.promote',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = supplierProductPromoteSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const product = await loadSupplierProduct(em, scope, parsed.id)

    return promoteSupplierProduct({
      em,
      ctx,
      scope,
      de,
      commandBus: ctx.container.resolve('commandBus') as CommandBusLike,
      product,
    })
  },
}

/**
 * `purchasing.supplier-products.link` — point a library row at a product that already exists
 * (关联已有商品), re-point it (换绑), or clear the link (解除关联, `productId: null`).
 *
 * It writes **only** `product_id`: the master's fields and prices have their own owners, and a link
 * that also rewrote them would overwrite a product manager's edits with no review step. That is the
 * whole reason this action exists next to `promote` — a supplier code that deliberately differs
 * from our SKU can be linked instead of spawning a duplicate product.
 */
const linkSupplierProductCommand: CommandHandler<Record<string, unknown>, { id: string; productId: string | null }> = {
  id: 'purchasing.supplier-products.link',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = supplierProductLinkSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const productId = parsed.productId ?? null
    // The scope check, the target check and the write share one transaction (`writeSupplierProductLink`),
    // and the row is deliberately **not** loaded through the EM first: the write is raw Kysely, so a
    // pre-loaded entity could answer the side-effect read below from a stale identity map.
    await writeSupplierProductLink({ em, scope, supplierProductId: parsed.id, productId })

    const updated = await em.fork().findOne(PurchasingSupplierProduct, supplierProductFilter(scope, parsed.id))
    if (!updated) throw notFound('Supplier product not found')
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      events: supplierProductCrudEvents,
      indexer: supplierProductCrudIndexer,
    })
    return { id: String(updated.id), productId }
  },
}

/**
 * `purchasing.supplier-products.sync-fields` — push the row's current values onto the product it is
 * already linked to.
 *
 * `promote` is idempotent on a linked row (`skipped`), so without this a name, spec or price
 * corrected in the library would never reach the master again. The write is the same
 * non-destructive one `promote` performs — non-empty/changed fields plus the `purchase` price
 * tier — and it reports exactly what it changed, because "synced" alone tells a buyer nothing.
 */
const syncSupplierProductFieldsCommand: CommandHandler<
  Record<string, unknown>,
  { productId: string; fieldsChanged: string[]; priceChanged: boolean }
> = {
  id: 'purchasing.supplier-products.sync-fields',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = supplierProductSyncFieldsSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const product = await loadSupplierProduct(em, scope, parsed.id)
    if (!product.productId) {
      throw new CrudHttpError(422, {
        error: 'This library row is not linked to a product yet; create or link one first',
        code: 'supplier_product_not_linked',
      })
    }

    const result = await applySupplierProductToMaster({
      em,
      scope,
      commandBus: ctx.container.resolve('commandBus') as CommandBusLike,
      ctx,
      product,
      productId: String(product.productId),
    })
    return { productId: String(product.productId), ...result }
  },
}

/** One row's failure inside a batch: named by id, with the code the single-row action would raise. */
export type SupplierProductPromoteBatchFailure = { id: string; code: string; message: string }

export type SupplierProductPromoteBatchResult = {
  created: number
  updated: number
  skipped: number
  failed: SupplierProductPromoteBatchFailure[]
}

function promotionFailure(id: string, error: unknown): SupplierProductPromoteBatchFailure {
  const message = error instanceof Error && error.message ? error.message : 'Promotion failed'
  const code =
    error instanceof CrudHttpError && typeof error.body?.code === 'string' ? String(error.body.code) : 'promotion_failed'
  return { id, code, message }
}

/**
 * `purchasing.supplier-products.promote-batch` — clear a backlog without clicking row by row.
 *
 * Per-row isolation, exactly like the quotation import: one row whose SKU is owned by a deleted
 * product fails alone and the rest still land. Duplicate ids are collapsed to their first
 * occurrence, so the counts always describe distinct rows.
 */
const promoteSupplierProductsBatchCommand: CommandHandler<Record<string, unknown>, SupplierProductPromoteBatchResult> = {
  id: 'purchasing.supplier-products.promote-batch',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = supplierProductPromoteBatchSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const commandBus = ctx.container.resolve('commandBus') as CommandBusLike

    const result: SupplierProductPromoteBatchResult = { created: 0, updated: 0, skipped: 0, failed: [] }
    for (const id of Array.from(new Set(parsed.ids))) {
      try {
        const product = await loadSupplierProduct(em, scope, id)
        const promoted = await promoteSupplierProduct({ em, ctx, scope, de, commandBus, product })
        if (promoted.action === 'created') result.created += 1
        else if (promoted.action === 'updated') result.updated += 1
        else result.skipped += 1
      } catch (error) {
        result.failed.push(promotionFailure(id, error))
      }
    }
    return result
  },
}

registerCommand(createSupplierProductCommand)
registerCommand(updateSupplierProductCommand)
registerCommand(deleteSupplierProductCommand)
registerCommand(importSupplierProductsCommand)
registerCommand(promoteSupplierProductCommand)
registerCommand(linkSupplierProductCommand)
registerCommand(syncSupplierProductFieldsCommand)
registerCommand(promoteSupplierProductsBatchCommand)

export {
  createSupplierProductCommand,
  deleteSupplierProductCommand,
  importSupplierProductsCommand,
  linkSupplierProductCommand,
  promoteSupplierProductCommand,
  promoteSupplierProductsBatchCommand,
  syncSupplierProductFieldsCommand,
  updateSupplierProductCommand,
}
