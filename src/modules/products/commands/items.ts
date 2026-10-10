import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId } from '@open-mercato/shared/lib/commands/helpers'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { badRequest, conflict, notFound } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  createStoreProduct,
  deleteStoreProduct,
  findStoreProductBySku,
  getStoreProduct,
  updateStoreProduct,
  type StoreProduct,
  type StoreProductInput,
  type StoreVariantInput,
} from '../lib/store'
import {
  productCreateSchema,
  productUpdateSchema,
  SKU_PATTERN,
  type ProductCreateInput,
  type ProductVariantInput,
} from '../data/validators'
import { ensureScope } from './types'

/**
 * The product aggregate's write commands.
 *
 * A product — its identity, its SKUs and (through `products.prices.replace`) its prices — is a
 * catalog product: these commands contain no product storage of their own, they translate the
 * module's payload onto `lib/store.ts`, which runs the platform's `catalog.products.*` /
 * `catalog.variants.*` commands. The platform's `catalog.product.*` events, audit trail, custom
 * field storage and index side effects therefore fire from the peer command, which is why the
 * app-level events are no longer emitted here (see `../events.ts`).
 */

type Scope = { tenantId: string; organizationId: string }

const RESOURCE_KIND = 'products.product' as const

/** The product fields the audit log diffs; scope is added because catalog rows carry none. */
const PRODUCT_COLUMNS = [
  'sku',
  'name',
  'nameEn',
  'brand',
  'series',
  'manufacturerModel',
  'specSummary',
  'barcode',
  'unit',
  'hsCode',
  'cnCode',
  'countryOfOriginCode',
  'netWeight',
  'grossWeight',
  'volume',
  'dimensions',
  'cartonQuantity',
  'batteryCapacityMah',
  'batteryWh',
  'containsLithiumBattery',
  'certifications',
  'status',
  'notes',
  'sourceProductId',
  'variants',
] as const

type SerializedProduct = StoreProduct & { tenantId: string; organizationId: string }

function serializeProduct(product: StoreProduct, scope: Scope): SerializedProduct {
  return { ...product, tenantId: scope.tenantId, organizationId: scope.organizationId }
}

/**
 * The catalog write payload for a product.
 *
 * The catalog-native half has no "absent" state — the store always sends `title`, `sku`,
 * `is_active`, `hs_code`, `cn_code`, `country_of_origin_code`, `weight_value` and `dimensions` — so
 * on a partial update every native value falls back to what the store read back. Without that, a
 * payload that only renamed a product would blank its HS code, origin, weight and dimensions. The
 * custom-field half (`cf_*`) is passed through as submitted: the store omits absent values there,
 * so an untouched field costs no write and is never erased.
 */
function toStoreInput(payload: Partial<ProductCreateInput>, current?: StoreProduct): StoreProductInput {
  return {
    sku: payload.sku ?? current?.sku ?? '',
    name: payload.name ?? current?.name ?? '',
    unit: payload.unit ?? current?.unit ?? 'PCS',
    status: payload.status ?? current?.status ?? 'active',
    hsCode: payload.hsCode !== undefined ? payload.hsCode : current?.hsCode ?? null,
    cnCode: payload.cnCode !== undefined ? payload.cnCode : current?.cnCode ?? null,
    countryOfOriginCode:
      payload.countryOfOriginCode !== undefined ? payload.countryOfOriginCode : current?.countryOfOriginCode ?? null,
    netWeight: payload.netWeight !== undefined ? payload.netWeight : current?.netWeight ?? null,
    dimensions: payload.dimensions !== undefined ? payload.dimensions : current?.dimensions ?? null,
    containsLithiumBattery: payload.containsLithiumBattery ?? current?.containsLithiumBattery ?? false,
    nameEn: payload.nameEn,
    brand: payload.brand,
    series: payload.series,
    manufacturerModel: payload.manufacturerModel,
    specSummary: payload.specSummary,
    barcode: payload.barcode,
    grossWeight: payload.grossWeight,
    volume: payload.volume,
    cartonQuantity: payload.cartonQuantity,
    batteryCapacityMah: payload.batteryCapacityMah,
    batteryWh: payload.batteryWh,
    certifications: payload.certifications,
    notes: payload.notes,
    // Write-by-command only: no form sends it, and an absent value leaves the copy's provenance.
    sourceProductId: payload.sourceProductId,
  }
}

/** The module's variant payload on the store's vocabulary (a row code is catalog's variant `sku`). */
function toStoreVariants(rows: ProductVariantInput[]): StoreVariantInput[] {
  return rows.map((row) => ({
    id: row.id ?? null,
    sku: row.code,
    name: row.name,
    barcode: row.barcode ?? null,
    isDefault: row.isDefault,
    isActive: row.status === 'active',
  }))
}

/**
 * The two rules the variant set must satisfy on its own, checked before anything is written so the
 * operator is told what to fix (a duplicate code is a typing mistake, not a race).
 */
function assertVariantPayloadRows(rows: ProductVariantInput[]): void {
  const seen = new Set<string>()
  let defaultRows = 0
  for (const row of rows) {
    if (seen.has(row.code)) throw badRequest(`Duplicate variant code ${row.code} in this submission`)
    seen.add(row.code)
    if (row.isDefault) defaultRows += 1
  }
  if (defaultRows > 1) throw badRequest('Only one variant of a product can be the default')
}

/**
 * Replace semantics can only address variants of **this** product: the store writes a named row in
 * place, so an id that belongs to another product would move that product's SKU onto this one.
 */
function assertVariantIdsBelongToProduct(rows: ProductVariantInput[], current: StoreProduct): void {
  const owned = new Set(current.variants.map((variant) => variant.id))
  for (const row of rows) {
    if (row.id && !owned.has(row.id)) throw badRequest('Variant not found on this product')
  }
}

const createProductCommand: CommandHandler<Record<string, unknown>, StoreProduct> = {
  id: 'products.items.create',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = productCreateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager

    const existing = await findStoreProductBySku({ em, scope, sku: parsed.sku })
    if (existing) throw conflict('A product with this SKU already exists in this organization')

    const variantRows = parsed.variants
    if (variantRows) {
      assertVariantPayloadRows(variantRows)
      for (const row of variantRows) {
        if (row.id) throw badRequest('A variant id cannot be submitted when creating a product')
      }
    }

    const created = await createStoreProduct({
      em,
      ctx,
      scope,
      input: toStoreInput(parsed),
      // An empty submission is not a state an operator can mean: the store then creates the
      // product's default variant from its SKU, which is what a product without explicit SKUs is.
      variants: variantRows && variantRows.length > 0 ? toStoreVariants(variantRows) : undefined,
      origin: 'products.items.create',
    })

    const product = await getStoreProduct({ em, scope, id: created.id })
    if (!product) throw notFound('Product not found after it was created')
    return product
  },
  captureAfter: (_input, result, ctx) => serializeProduct(result, ensureScope(ctx)),
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    const after = serializeProduct(result, ensureScope(ctx))
    return {
      actionLabel: translate('products.audit.items.create', 'Create product'),
      resourceKind: RESOURCE_KIND,
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
    }
  },
}

const updateProductCommand: CommandHandler<Record<string, unknown>, StoreProduct> = {
  id: 'products.items.update',
  isUndoable: false,
  async prepare(rawInput, ctx) {
    const parsed = productUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const current = await getStoreProduct({ em, scope, id: parsed.id })
    return current ? { before: serializeProduct(current, scope) } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = productUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager

    const current = await getStoreProduct({ em, scope, id: parsed.id })
    if (!current) throw notFound('Product not found')

    enforceCommandOptimisticLock({
      resourceKind: RESOURCE_KIND,
      resourceId: current.id,
      current: current.updatedAt,
      request: ctx.request ?? null,
    })

    // The schema no longer carries the charset rule (a legacy SKU must stay editable), so it is
    // enforced here — but only for a value that actually changes. An unchanged SKU is not
    // re-validated at all: it is already stored, and refusing it would make the whole row uneditable.
    if (parsed.sku !== undefined && parsed.sku !== current.sku) {
      if (!SKU_PATTERN.test(parsed.sku)) {
        throw badRequest('sku must be letters, digits, dot, dash, slash or underscore')
      }
      const holder = await findStoreProductBySku({ em, scope, sku: parsed.sku })
      if (holder) throw conflict('A product with this SKU already exists in this organization')
    }

    const variantRows = parsed.variants
    if (variantRows) {
      assertVariantPayloadRows(variantRows)
      assertVariantIdsBelongToProduct(variantRows, current)
    }

    await updateStoreProduct({
      em,
      ctx,
      scope,
      id: current.id,
      input: toStoreInput(parsed, current),
      // Omitted leaves the SKUs untouched; a submitted set — empty included — is the new truth, so
      // the store deletes the rows the payload does not name and inserts the rows without an id.
      variants: variantRows ? toStoreVariants(variantRows) : undefined,
      origin: 'products.items.update',
    })

    const updated = await getStoreProduct({ em, scope, id: current.id })
    if (!updated) throw notFound('Product not found after it was updated')
    return updated
  },
  captureAfter: (_input, result, ctx) => serializeProduct(result, ensureScope(ctx)),
  buildLog: async ({ result, ctx, snapshots }) => {
    const { translate } = await resolveTranslations()
    const after = serializeProduct(result, ensureScope(ctx))
    const before = snapshots.before as SerializedProduct | undefined
    return {
      actionLabel: translate('products.audit.items.update', 'Update product'),
      resourceKind: RESOURCE_KIND,
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      changes: buildChanges(
        (before ?? null) as unknown as Record<string, unknown> | null,
        after as unknown as Record<string, unknown>,
        [...PRODUCT_COLUMNS],
      ),
      snapshotBefore: before ?? null,
      snapshotAfter: after,
    }
  },
}

const deleteProductCommand: CommandHandler<
  { id?: string; body?: Record<string, unknown>; query?: Record<string, unknown> },
  StoreProduct
> = {
  id: 'products.items.delete',
  isUndoable: false,
  async execute(input, ctx) {
    const id = requireId(input, 'Product id required')
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager

    const current = await getStoreProduct({ em, scope, id })
    if (!current) throw notFound('Product not found')

    enforceCommandOptimisticLock({
      resourceKind: RESOURCE_KIND,
      resourceId: current.id,
      current: current.updatedAt,
      request: ctx.request ?? null,
    })

    await deleteStoreProduct({ em, ctx, scope, id: current.id })
    // The store's reads exclude deleted rows, so the row as it was read is the log snapshot: an
    // audit reader must still see what was removed.
    return current
  },
  captureAfter: (_input, result, ctx) => serializeProduct(result, ensureScope(ctx)),
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    const after = serializeProduct(result, ensureScope(ctx))
    return {
      actionLabel: translate('products.audit.items.delete', 'Delete product'),
      resourceKind: RESOURCE_KIND,
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
    }
  },
}

registerCommand(createProductCommand)
registerCommand(updateProductCommand)
registerCommand(deleteProductCommand)

export { createProductCommand, updateProductCommand, deleteProductCommand }
