import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
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
import {
  badRequest,
  conflict,
  isUniqueViolation as isUniqueConstraintViolation,
  notFound,
} from '@open-mercato/shared/lib/crud/errors'
import type { CrudEmitContext, CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { ProductsCategory, ProductsProduct, ProductsType, ProductsVariant } from '../data/entities'
import {
  productCreateSchema,
  productUpdateSchema,
  SKU_PATTERN,
  type ProductCreateInput,
  type ProductVariantInput,
} from '../data/validators'
import { ensureScope } from './types'

type Scope = { tenantId: string; organizationId: string }

const ENTITY_ID = 'products:products_product' as const
const RESOURCE_KIND = 'products.product' as const

export type SerializedProduct = {
  id: string
  sku: string
  name: string
  nameEn: string | null
  brand: string
  series: string | null
  manufacturerModel: string | null
  typeId: string | null
  categoryId: string | null
  specSummary: string | null
  barcode: string | null
  unit: string
  hsCode: string | null
  cnCode: string | null
  countryOfOriginCode: string | null
  netWeight: string | null
  grossWeight: string | null
  volume: string | null
  dimensions: Record<string, unknown> | null
  cartonQuantity: number | null
  batteryCapacityMah: number | null
  batteryWh: string | null
  containsLithiumBattery: boolean
  certifications: string[] | null
  status: string
  catalogProductId: string | null
  catalogSnapshot: Record<string, unknown> | null
  notes: string | null
  tenantId: string
  organizationId: string
}

export function serializeProduct(entity: ProductsProduct): SerializedProduct {
  return {
    id: String(entity.id),
    sku: entity.sku,
    name: entity.name,
    nameEn: entity.nameEn ?? null,
    brand: entity.brand,
    series: entity.series ?? null,
    manufacturerModel: entity.manufacturerModel ?? null,
    typeId: entity.typeId ? String(entity.typeId) : null,
    categoryId: entity.categoryId ? String(entity.categoryId) : null,
    specSummary: entity.specSummary ?? null,
    barcode: entity.barcode ?? null,
    unit: entity.unit,
    hsCode: entity.hsCode ?? null,
    cnCode: entity.cnCode ?? null,
    countryOfOriginCode: entity.countryOfOriginCode ?? null,
    netWeight: entity.netWeight ?? null,
    grossWeight: entity.grossWeight ?? null,
    volume: entity.volume ?? null,
    dimensions: entity.dimensions ?? null,
    cartonQuantity: entity.cartonQuantity ?? null,
    batteryCapacityMah: entity.batteryCapacityMah ?? null,
    batteryWh: entity.batteryWh ?? null,
    containsLithiumBattery: !!entity.containsLithiumBattery,
    certifications: Array.isArray(entity.certifications) ? [...entity.certifications] : null,
    status: entity.status,
    catalogProductId: entity.catalogProductId ? String(entity.catalogProductId) : null,
    catalogSnapshot: entity.catalogSnapshot ?? null,
    notes: entity.notes ?? null,
    tenantId: String(entity.tenantId),
    organizationId: String(entity.organizationId),
  }
}

export const productCrudEvents: CrudEventsConfig<ProductsProduct> = {
  module: 'products',
  // Entity name is the event-id segment: `products.item.created|updated|deleted`.
  entity: 'item',
  persistent: true,
  buildPayload: (ctx: CrudEmitContext<ProductsProduct>) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    sku: ctx.entity?.sku ?? null,
    status: ctx.entity?.status ?? null,
  }),
}

export const productCrudIndexer: CrudIndexerConfig<ProductsProduct> = {
  entityType: ENTITY_ID,
}

export function productFilter(
  scope: { tenantId: string; organizationId: string },
  id: string,
): FilterQuery<ProductsProduct> {
  return {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  } as FilterQuery<ProductsProduct>
}

/**
 * `sku` is unique per organization and the database constraint does not exclude soft-deleted
 * rows, so the check includes them: a SKU that belonged to a deleted product is still taken and
 * the caller gets a readable 409 rather than a driver error surfacing as 500.
 */
async function assertSkuAvailable(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  sku: string,
  exceptId?: string,
): Promise<void> {
  const existing = await em.fork().findOne(ProductsProduct, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    sku,
  } as FilterQuery<ProductsProduct>)
  if (existing && String(existing.id) !== exceptId) {
    throw conflict('A product with this SKU already exists in this organization')
  }
}

/**
 * Type and category are scalar ids into this module's own tables, but a caller can still send a
 * foreign id or another organization's id; both are rejected so a product never points at a
 * record the operator cannot open.
 */
async function assertReferencesVisible(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  input: { typeId?: string | null; categoryId?: string | null },
): Promise<void> {
  if (input.typeId) {
    const type = await em.fork().findOne(ProductsType, {
      id: input.typeId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    } as FilterQuery<ProductsType>)
    if (!type) throw badRequest('Product type not found in this organization')
  }
  if (input.categoryId) {
    const category = await em.fork().findOne(ProductsCategory, {
      id: input.categoryId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    } as FilterQuery<ProductsCategory>)
    if (!category) throw badRequest('Product category not found in this organization')
  }
}

const PRODUCT_COLUMNS = [
  'sku',
  'name',
  'nameEn',
  'brand',
  'series',
  'manufacturerModel',
  'typeId',
  'categoryId',
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
] as const

/**
 * Explicit per-column assignment rather than a loop over `PRODUCT_COLUMNS`: the loop form
 * needs an unchecked cast into the entity, which would let a renamed column write a new
 * property instead of failing to compile.
 */
function applyProductInput(entity: ProductsProduct, parsed: Partial<ProductCreateInput>): void {
  if (parsed.sku !== undefined) entity.sku = parsed.sku
  if (parsed.name !== undefined) entity.name = parsed.name
  if (parsed.nameEn !== undefined) entity.nameEn = parsed.nameEn
  if (parsed.brand !== undefined) entity.brand = parsed.brand
  if (parsed.series !== undefined) entity.series = parsed.series
  if (parsed.manufacturerModel !== undefined) entity.manufacturerModel = parsed.manufacturerModel
  if (parsed.typeId !== undefined) entity.typeId = parsed.typeId
  if (parsed.categoryId !== undefined) entity.categoryId = parsed.categoryId
  if (parsed.specSummary !== undefined) entity.specSummary = parsed.specSummary
  if (parsed.barcode !== undefined) entity.barcode = parsed.barcode
  if (parsed.unit !== undefined) entity.unit = parsed.unit
  if (parsed.hsCode !== undefined) entity.hsCode = parsed.hsCode
  if (parsed.cnCode !== undefined) entity.cnCode = parsed.cnCode
  if (parsed.countryOfOriginCode !== undefined) entity.countryOfOriginCode = parsed.countryOfOriginCode
  if (parsed.netWeight !== undefined) entity.netWeight = parsed.netWeight
  if (parsed.grossWeight !== undefined) entity.grossWeight = parsed.grossWeight
  if (parsed.volume !== undefined) entity.volume = parsed.volume
  if (parsed.dimensions !== undefined) entity.dimensions = parsed.dimensions
  if (parsed.cartonQuantity !== undefined) entity.cartonQuantity = parsed.cartonQuantity
  if (parsed.batteryCapacityMah !== undefined) entity.batteryCapacityMah = parsed.batteryCapacityMah
  if (parsed.batteryWh !== undefined) entity.batteryWh = parsed.batteryWh
  if (parsed.containsLithiumBattery !== undefined) entity.containsLithiumBattery = parsed.containsLithiumBattery
  if (parsed.certifications !== undefined) entity.certifications = parsed.certifications
  if (parsed.status !== undefined) entity.status = parsed.status
  if (parsed.notes !== undefined) entity.notes = parsed.notes
  // The optional link to the installed catalog is editable: it is what lets the shipment receive
  // path resolve a variant for stock booking (see the module README), so an operator must be able
  // to set or clear it after the product exists.
  if (parsed.catalogProductId !== undefined) entity.catalogProductId = parsed.catalogProductId
}

/**
 * Freezes a small snapshot of the linked catalog product.
 *
 * The link is used by the logistics half of the app (variant resolution on receipt), and the
 * product page shows what the link points at without calling the catalog API on every render. A
 * link that no longer resolves is dropped rather than stored as a dangling id.
 */
async function resolveCatalogSnapshot(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  catalogProductId: string | null | undefined,
): Promise<{ catalogProductId: string | null; catalogSnapshot: Record<string, unknown> | null }> {
  if (!catalogProductId) return { catalogProductId: null, catalogSnapshot: null }
  const rows = (await (em.fork().getKysely<any>())
    .selectFrom('catalog_products')
    .select(['id', 'title', 'sku', 'default_unit'])
    .where('id', '=', catalogProductId)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('deleted_at', 'is', null)
    .limit(1)
    .execute()) as Array<Record<string, unknown>>
  const row = rows[0]
  if (!row) {
    throw badRequest('Catalog product not found in this organization')
  }
  return {
    catalogProductId: String(row.id),
    catalogSnapshot: { title: row.title ?? null, sku: row.sku ?? null, unit: row.default_unit ?? null },
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'UniqueConstraintViolationException'
  )
}

/**
 * Variant rows carry the same two rules the database enforces, checked on the payload alone so the
 * operator is told what to fix before anything is written (a duplicate is a typing mistake, not a
 * race). Order matters: the index is only consulted after these pass.
 */
function assertVariantPayloadRows(rows: ProductVariantInput[]): void {
  const seen = new Set<string>()
  let defaultRows = 0
  for (const row of rows) {
    if (seen.has(row.code)) {
      throw badRequest(`Duplicate variant code ${row.code} in this submission`)
    }
    seen.add(row.code)
    if (row.isDefault) defaultRows += 1
  }
  if (defaultRows > 1) {
    throw badRequest('Only one variant of a product can be the default')
  }
}

/** Live variants of one product, in the order the form renders them. */
async function loadProductVariants(em: EntityManager, scope: Scope, productId: string): Promise<ProductsVariant[]> {
  return em.fork().find(
    ProductsVariant,
    {
      product: productId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    } as FilterQuery<ProductsVariant>,
    { orderBy: { sortOrder: 'asc', createdAt: 'asc' } },
  )
}

/**
 * Replace semantics can only address variants of **this** product: an id that belongs to another
 * product would otherwise silently take a row away from it, and an id from a soft-deleted row would
 * resurrect a SKU the operator already removed.
 */
function assertVariantIdsBelongToProduct(
  rows: ProductVariantInput[],
  existing: Map<string, ProductsVariant>,
): void {
  for (const row of rows) {
    if (!row.id) continue
    if (!existing.has(row.id)) throw badRequest('Variant not found on this product')
  }
}

/**
 * `code` is unique per organization and the database constraint deliberately does **not** exclude
 * soft-deleted rows, so this check looks at them too: the code of a removed SKU is still taken and
 * the caller gets a readable 409 instead of the driver's unique violation surfacing as 500. Rows the
 * payload itself updates are excluded — they are allowed to keep their own code.
 */
async function assertVariantCodesAvailable(
  em: EntityManager,
  scope: Scope,
  rows: ProductVariantInput[],
): Promise<void> {
  if (rows.length === 0) return
  const updatedIds = new Set(
    rows.map((row) => row.id).filter((id): id is string => typeof id === 'string' && id.length > 0),
  )
  // One query for the whole payload rather than one per row: a wholesale SKU list is a normal edit,
  // and a round trip per row would make it the slowest thing the form does.
  const taken = await em.fork().find(ProductsVariant, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    code: { $in: [...new Set(rows.map((row) => row.code))] },
  } as FilterQuery<ProductsVariant>)
  for (const variant of taken) {
    if (updatedIds.has(String(variant.id))) continue
    throw conflict(`A variant with the code ${variant.code} already exists in this organization`)
  }
}

/**
 * The database constraint is the real guarantee; two concurrent saves can still race past the checks
 * above, so the driver's violation is mapped onto the same readable 409 the checks produce. Which
 * index was violated decides the message: the default marker has its own partial unique index.
 */
function mapVariantWriteError(error: unknown): never {
  if (isUniqueConstraintViolation(error, 'products_variants_scope_code_uniq')) {
    throw conflict('A variant with this code already exists in this organization')
  }
  if (isUniqueConstraintViolation(error, 'products_variants_default_unique_idx')) {
    throw conflict('Only one variant of a product can be the default')
  }
  throw error
}

/**
 * Rows the payload no longer names are **soft-deleted**, never removed: a SKU code and its id stay
 * reserved, so historical stock and receipt references cannot silently re-point at a different item
 * (J-V-002). This runs before the upsert because a row that is about to be replaced may be the one
 * currently carrying the default marker — the partial unique index only allows one live default per
 * product, so the previous one has to release it first.
 */
async function softDeleteRemovedVariants(
  de: DataEngine,
  scope: Scope,
  rows: ProductVariantInput[],
  existing: Map<string, ProductsVariant>,
): Promise<void> {
  const kept = new Set(
    rows.map((row) => row.id).filter((id): id is string => typeof id === 'string' && id.length > 0),
  )
  for (const variant of existing.values()) {
    if (kept.has(String(variant.id))) continue
    await de.deleteOrmEntity({
      entity: ProductsVariant,
      where: {
        id: String(variant.id),
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      } as FilterQuery<ProductsVariant>,
      soft: true,
      softDeleteField: 'deletedAt',
    })
  }
}

/**
 * Writes the payload's rows in place: rows with an id are updated, rows without are inserted.
 *
 * Non-default rows are written **before** the default one: flipping a product's default from A to B or
 * adding a new default must not leave two live default rows at any point in the transaction.
 *
 * `undefined` means "not part of this submission" (the column is left alone), `null` means "clear it":
 * the form submits every field it renders, so clearing a barcode sends `null`, while `attributes` —
 * written by another integration and not rendered by the form — survives a save it never took part in.
 *
 * `sortOrder` follows the position in the payload, so the order the operator arranged the rows in is
 * the order the SKUs come back in.
 */
async function upsertProductVariants(
  de: DataEngine,
  em: EntityManager,
  scope: Scope,
  productId: string,
  rows: ProductVariantInput[],
  existing: Map<string, ProductsVariant>,
): Promise<void> {
  const ordered = rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => Number(left.row.isDefault) - Number(right.row.isDefault))
  const product = em.getReference(ProductsProduct, productId)

  for (const { row, index } of ordered) {
    const current = row.id ? existing.get(row.id) : undefined
    if (row.id && !current) throw badRequest('Variant not found on this product')
    if (current) {
      await de.updateOrmEntity({
        entity: ProductsVariant,
        where: {
          id: String(current.id),
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        } as FilterQuery<ProductsVariant>,
        apply: (entity) => {
          entity.code = row.code
          entity.name = row.name
          if (row.barcode !== undefined) entity.barcode = row.barcode ?? null
          entity.status = row.status
          entity.isDefault = row.isDefault
          if (row.attributes !== undefined) entity.attributes = row.attributes ?? null
          entity.sortOrder = index
        },
      })
      continue
    }
    await de.createOrmEntity({
      entity: ProductsVariant,
      data: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        product,
        code: row.code,
        name: row.name,
        barcode: row.barcode ?? null,
        status: row.status,
        isDefault: row.isDefault,
        attributes: row.attributes ?? null,
        sortOrder: index,
      },
    })
  }
}

/**
 * A product's variants arrive as one set: the payload is the new truth, so it is validated as a whole
 * before anything is written (ids that belong to another product, duplicate codes, two defaults) and
 * written inside the product's own transaction, together with the product row itself.
 */
async function prepareVariantRows(
  em: EntityManager,
  scope: Scope,
  rows: ProductVariantInput[],
  productId: string | null,
): Promise<Map<string, ProductsVariant>> {
  assertVariantPayloadRows(rows)
  if (!productId) {
    for (const row of rows) {
      if (row.id) throw badRequest('A variant id cannot be submitted when creating a product')
    }
    await assertVariantCodesAvailable(em, scope, rows)
    return new Map()
  }
  const existing = await loadProductVariants(em, scope, productId)
  const existingById = new Map(existing.map((variant) => [String(variant.id), variant]))
  assertVariantIdsBelongToProduct(rows, existingById)
  await assertVariantCodesAvailable(em, scope, rows)
  return existingById
}

const createProductCommand: CommandHandler<Record<string, unknown>, ProductsProduct> = {
  id: 'products.items.create',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const parsed = productCreateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    await assertSkuAvailable(em, scope, parsed.sku)
    await assertReferencesVisible(em, scope, { typeId: parsed.typeId ?? null, categoryId: parsed.categoryId ?? null })
    const catalogLink = await resolveCatalogSnapshot(em, scope, parsed.catalogProductId ?? null)
    const variantRows = parsed.variants
    // Validated against the payload and the organization's existing codes before the transaction
    // opens, so a duplicate is answered with what to fix rather than a rolled-back write.
    const variantSet = variantRows === undefined
      ? null
      : await prepareVariantRows(em, scope, variantRows, null)

    const createdRows: ProductsProduct[] = []
    await withAtomicFlush(
      em,
      [
        async () => {
          const row = await de
            .createOrmEntity({
              entity: ProductsProduct,
              data: {
                tenantId: scope.tenantId,
                organizationId: scope.organizationId,
                sku: parsed.sku,
                name: parsed.name,
                nameEn: parsed.nameEn ?? null,
                brand: parsed.brand,
                series: parsed.series ?? null,
                manufacturerModel: parsed.manufacturerModel ?? null,
                typeId: parsed.typeId ?? null,
                categoryId: parsed.categoryId ?? null,
                specSummary: parsed.specSummary ?? null,
                barcode: parsed.barcode ?? null,
                unit: parsed.unit,
                hsCode: parsed.hsCode ?? null,
                cnCode: parsed.cnCode ?? null,
                countryOfOriginCode: parsed.countryOfOriginCode ?? null,
                netWeight: parsed.netWeight,
                grossWeight: parsed.grossWeight,
                volume: parsed.volume,
                dimensions: parsed.dimensions ?? null,
                cartonQuantity: parsed.cartonQuantity,
                batteryCapacityMah: parsed.batteryCapacityMah,
                batteryWh: parsed.batteryWh,
                containsLithiumBattery: parsed.containsLithiumBattery,
                certifications: parsed.certifications ?? null,
                status: parsed.status,
                catalogProductId: catalogLink.catalogProductId,
                catalogSnapshot: catalogLink.catalogSnapshot,
                notes: parsed.notes ?? null,
              },
            })
            .catch((error: unknown) => {
              if (isUniqueViolation(error)) {
                throw conflict('A product with this SKU already exists in this organization')
              }
              throw error
            })
          createdRows.push(row)
        },
        // The SKUs are written in the product's own transaction: a rejected row must never leave a
        // product behind without the variants it was submitted with.
        async () => {
          const product = createdRows[0]
          if (!product || variantRows === undefined || variantSet === null) return
          await upsertProductVariants(de, em, scope, String(product.id), variantRows, variantSet)
            .catch(mapVariantWriteError)
        },
      ],
      { transaction: true, label: 'products.items.create' },
    )

    const created = createdRows[0]
    if (!created) throw badRequest('Product was not created')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: created,
      identifiers: { id: String(created.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: productCrudEvents,
      indexer: productCrudIndexer,
    })

    return created
  },
  captureAfter: (_input, result) => serializeProduct(result),
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    const after = serializeProduct(result)
    return {
      actionLabel: translate('products.audit.items.create', 'Create product'),
      resourceKind: RESOURCE_KIND,
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
    }
  },
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<{ after?: SerializedProduct }>(logEntry)
    const snapshot = payload?.after ?? (logEntry?.snapshotAfter as SerializedProduct | undefined)
    const id = snapshot?.id ?? logEntry?.resourceId
    if (!id) throw new Error('[internal] Missing product id for undo')
    const scope = ensureScope(ctx)
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const removed = await de.deleteOrmEntity({
      entity: ProductsProduct,
      where: productFilter(scope, id),
      soft: true,
      softDeleteField: 'deletedAt',
    })
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: { id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: productCrudEvents,
      indexer: productCrudIndexer,
    })
  },
}

const updateProductCommand: CommandHandler<Record<string, unknown>, ProductsProduct> = {
  id: 'products.items.update',
  isUndoable: true,
  async prepare(rawInput, ctx) {
    const parsed = productUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const current = await em.fork().findOne(ProductsProduct, productFilter(scope, parsed.id))
    if (!current) return {}
    return { before: serializeProduct(current) }
  },
  async execute(rawInput, ctx) {
    const parsed = productUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const current = await em.fork().findOne(ProductsProduct, productFilter(scope, parsed.id))
    if (!current) throw notFound('Product not found')

    enforceCommandOptimisticLock({
      resourceKind: RESOURCE_KIND,
      resourceId: String(current.id),
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
      await assertSkuAvailable(em, scope, parsed.sku, String(current.id))
    }
    await assertReferencesVisible(em, scope, {
      typeId: parsed.typeId === undefined ? current.typeId ?? null : parsed.typeId,
      categoryId: parsed.categoryId === undefined ? current.categoryId ?? null : parsed.categoryId,
    })
    const catalogLink = parsed.catalogProductId === undefined
      ? null
      : await resolveCatalogSnapshot(em, scope, parsed.catalogProductId)
    const variantRows = parsed.variants
    // `variants` omitted leaves the SKUs untouched; an explicit array — empty included — is the new
    // truth and is validated as a whole before the transaction opens.
    const variantSet = variantRows === undefined
      ? null
      : await prepareVariantRows(em, scope, variantRows, String(current.id))

    const updatedRows: ProductsProduct[] = []
    const phases: Array<() => Promise<void>> = [
      async () => {
        const row = await de
          .updateOrmEntity({
            entity: ProductsProduct,
            where: productFilter(scope, parsed.id),
            apply: (entity) => {
              applyProductInput(entity, parsed)
              if (catalogLink) {
                entity.catalogProductId = catalogLink.catalogProductId
                entity.catalogSnapshot = catalogLink.catalogSnapshot
              }
            },
          })
          .catch((error: unknown) => {
            if (isUniqueViolation(error)) {
              throw conflict('A product with this SKU already exists in this organization')
            }
            throw error
          })
        if (row) updatedRows.push(row)
      },
    ]
    if (variantRows !== undefined && variantSet !== null) {
      // Removals first, then the rows: the partial unique index on the default marker only allows one
      // live default per product, so the previous one must release it before its replacement claims it.
      phases.push(async () => {
        await softDeleteRemovedVariants(de, scope, variantRows, variantSet).catch(mapVariantWriteError)
      })
      phases.push(async () => {
        await upsertProductVariants(de, em, scope, String(current.id), variantRows, variantSet)
          .catch(mapVariantWriteError)
      })
      phases.push(async () => {
        // The SKUs belong to the aggregate the lock protects, so a variant-only save must still advance
        // the product's version: `updated_at` is what the next save is compared against, and a payload
        // that changed nothing but the child rows would otherwise leave the version behind — letting a
        // stale form pass the version check and silently replace these rows.
        await de.updateOrmEntity({
          entity: ProductsProduct,
          where: productFilter(scope, parsed.id),
          apply: (entity) => {
            entity.updatedAt = new Date()
          },
        })
      })
    }

    await withAtomicFlush(em, phases, { transaction: true, label: 'products.items.update' })

    const updated = updatedRows[0]
    if (!updated) throw notFound('Product not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: productCrudEvents,
      indexer: productCrudIndexer,
    })

    return updated
  },
  captureAfter: (_input, result) => serializeProduct(result),
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as SerializedProduct | undefined
    const after = serializeProduct(result)
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
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<{ before?: SerializedProduct }>(logEntry)
    const before = payload?.before ?? (logEntry?.snapshotBefore as SerializedProduct | undefined)
    if (!before?.id) throw new Error('[internal] Missing previous product snapshot for undo')
    const scope = ensureScope(ctx)
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const restored = await de.updateOrmEntity({
      entity: ProductsProduct,
      where: productFilter(scope, before.id),
      apply: (entity) => {
        entity.sku = before.sku
        entity.name = before.name
        entity.nameEn = before.nameEn
        entity.brand = before.brand
        entity.series = before.series
        entity.manufacturerModel = before.manufacturerModel
        entity.typeId = before.typeId
        entity.categoryId = before.categoryId
        entity.specSummary = before.specSummary
        entity.barcode = before.barcode
        entity.unit = before.unit
        entity.hsCode = before.hsCode
        entity.cnCode = before.cnCode
        entity.countryOfOriginCode = before.countryOfOriginCode
        entity.netWeight = before.netWeight
        entity.grossWeight = before.grossWeight
        entity.volume = before.volume
        entity.dimensions = before.dimensions
        entity.cartonQuantity = before.cartonQuantity
        entity.batteryCapacityMah = before.batteryCapacityMah
        entity.batteryWh = before.batteryWh
        entity.containsLithiumBattery = before.containsLithiumBattery
        entity.certifications = before.certifications
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
      events: productCrudEvents,
      indexer: productCrudIndexer,
    })
  },
}

/**
 * Products are soft-deleted. Contracts and invoices keep their own snapshots, so deleting a
 * product never rewrites an issued document — the row simply stops appearing in selectors.
 */
const deleteProductCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  ProductsProduct
> = {
  id: 'products.items.delete',
  isUndoable: true,
  async prepare(input, ctx) {
    const id = requireId(input, 'Product id required')
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const existing = await em.fork().findOne(ProductsProduct, productFilter(scope, id))
    if (!existing) return {}
    return { before: serializeProduct(existing) }
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Product id required')
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const current = await em.fork().findOne(ProductsProduct, productFilter(scope, id))
    if (!current) throw notFound('Product not found')

    enforceCommandOptimisticLock({
      resourceKind: RESOURCE_KIND,
      resourceId: String(current.id),
      current: current.updatedAt,
      request: ctx.request ?? null,
    })

    const removed = await de.deleteOrmEntity({
      entity: ProductsProduct,
      where: productFilter(scope, id),
      soft: true,
      softDeleteField: 'deletedAt',
    })
    if (!removed) throw notFound('Product not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: { id: String(removed.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: productCrudEvents,
      indexer: productCrudIndexer,
    })

    return removed
  },
  captureAfter: (_input, result) => serializeProduct(result),
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    const after = serializeProduct(result)
    return {
      actionLabel: translate('products.audit.items.delete', 'Delete product'),
      resourceKind: RESOURCE_KIND,
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
    }
  },
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<{ after?: SerializedProduct }>(logEntry)
    const snapshot = payload?.after ?? (logEntry?.snapshotAfter as SerializedProduct | undefined)
    const id = snapshot?.id ?? logEntry?.resourceId
    if (!id) throw new Error('[internal] Missing product id for undo')
    const scope = ensureScope(ctx)
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const restored = await de.updateOrmEntity({
      entity: ProductsProduct,
      where: {
        id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      } as FilterQuery<ProductsProduct>,
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
      events: productCrudEvents,
      indexer: productCrudIndexer,
    })
  },
}

registerCommand(createProductCommand)
registerCommand(updateProductCommand)
registerCommand(deleteProductCommand)

export { createProductCommand, updateProductCommand, deleteProductCommand }
