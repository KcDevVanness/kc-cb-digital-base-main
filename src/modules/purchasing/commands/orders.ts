import { z } from 'zod'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, emitCrudUndoSideEffects, requireId } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { badRequest, conflict, CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE } from '@open-mercato/shared/lib/auth/organizationScope'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import {
  PurchasingPurchaseOrder,
  PurchasingPurchaseOrderDocument,
  PurchasingPurchaseOrderLine,
  PurchasingPurchasePayment,
  PurchasingSupplier,
} from '../data/entities'
import {
  purchaseOrderDocumentCreateSchema,
  purchaseOrderDocumentUpdateSchema,
} from '../data/validators'
import { assertCurrencyInDictionary } from '../lib/currencyDictionary'
import { computeLineTotals, computeOrderTotals, type OrderTotals, type PaymentRow } from '../lib/orderTotals'
import { loadSupplierProducts } from '../lib/sourcingReads'
import { eventsConfig } from '../events'

const ORDER_ENTITY_ID = 'purchasing:purchasing_purchase_order' as const
const PAYMENT_ENTITY_ID = 'purchasing:purchasing_purchase_payment' as const
const DOCUMENT_ENTITY_ID = 'purchasing:purchasing_purchase_order_document' as const
const ORDER_RESOURCE_KIND = 'purchasing.purchase_order' as const
const PAYMENT_RESOURCE_KIND = 'purchasing.purchase_payment' as const
const DOCUMENT_RESOURCE_KIND = 'purchasing.purchase_order_document' as const

export const ORDER_STATUSES = ['draft', 'placed', 'shipped', 'received', 'closed', 'cancelled'] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

/**
 * Header metadata an operator may still correct after the order left `draft`. Everything else —
 * the supplier, the currency, the deposit terms, and the lines — carries the price the order was
 * placed at, so a non-draft update touching any of them is rejected instead of silently repriced.
 */
const POST_PLACEMENT_UPDATE_FIELDS = [
  'businessNumber',
  'productCategory',
  'ownerUserId',
  'ownerSnapshot',
  'customerId',
  'customerSnapshot',
  'expectedShipAt',
  'notes',
] as const

/** Allowed transitions; everything else is rejected with the state unchanged. */
const ALLOWED_TRANSITIONS: Record<string, { from: OrderStatus[]; to: OrderStatus }> = {
  place: { from: ['draft'], to: 'placed' },
  mark_shipped: { from: ['placed'], to: 'shipped' },
  mark_received: { from: ['shipped'], to: 'received' },
  close: { from: ['received'], to: 'closed' },
  cancel: { from: ['draft', 'placed'], to: 'cancelled' },
}

/**
 * A line references exactly one product: the app-owned product master (`products_products.id`), a
 * supplier product library row (`supplierProductId`, which resolves through the master once the row
 * has been synced), or — historical rows only — the installed catalog (`catalogProductId`).
 *
 * This widens the previous contract instead of replacing it: a payload that carried a product
 * master id alone, or a catalog id alone, parses and resolves exactly as it did before, and the
 * library reference is a third option next to them. A line that mixes the library reference with
 * either master reference is rejected here, so a client can never send two contradictory
 * identities and have the server pick one of them silently. A line with none cannot be priced or
 * received, hence the "at least one" rule.
 */
const lineInputSchema = z
  .object({
    productId: z.string().uuid().nullable().optional(),
    catalogProductId: z.string().uuid().nullable().optional(),
    supplierProductId: z.string().uuid().nullable().optional(),
    quantity: z.coerce.number().positive(),
    unitPrice: z.coerce.number().min(0),
    taxRate: z.coerce.number().min(0).max(100).default(0),
    priceIncludesTax: z.boolean().default(true),
    note: z.string().max(500).nullable().optional(),
  })
  .refine((line) => Boolean(line.productId || line.catalogProductId || line.supplierProductId), {
    message: 'each line needs a product reference (productId, catalogProductId or supplierProductId)',
    path: ['productId'],
  })
  .refine((line) => !(line.supplierProductId && (line.productId || line.catalogProductId)), {
    message: 'a line cannot combine supplierProductId with productId or catalogProductId',
    path: ['supplierProductId'],
  })

export const purchaseOrderCreateSchema = z.object({
  supplierId: z.string().uuid(),
  businessNumber: z.string().trim().max(64).nullable().optional(),
  productCategory: z.string().trim().max(64).nullable().optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  ownerSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  customerId: z.string().uuid().nullable().optional(),
  customerSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  currencyCode: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()),
  depositPercent: z.coerce.number().min(0).max(100).nullable().optional(),
  depositAmount: z.coerce.number().min(0).nullable().optional(),
  expectedShipAt: z.string().min(1).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  lines: z.array(lineInputSchema).min(1),
})

export const purchaseOrderUpdateSchema = purchaseOrderCreateSchema.partial().extend({
  id: z.string().uuid(),
  lines: z.array(lineInputSchema).min(1).optional(),
})

export const purchaseOrderTransitionSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(['place', 'mark_shipped', 'mark_received', 'close', 'cancel']),
  reason: z.string().max(500).optional(),
})

export const purchasePaymentCreateSchema = z.object({
  orderId: z.string().uuid(),
  stage: z.enum(['deposit', 'balance', 'other']),
  amount: z.coerce.number().positive(),
  paidAt: z.string().min(1),
  reference: z.string().max(200).nullable().optional(),
  methodNote: z.string().max(500).nullable().optional(),
  attachmentId: z.string().uuid().nullable().optional(),
})

export type PurchaseOrderCreateInput = z.infer<typeof purchaseOrderCreateSchema>
export type PurchaseOrderTransitionInput = z.infer<typeof purchaseOrderTransitionSchema>
export type PurchasePaymentCreateInput = z.infer<typeof purchasePaymentCreateSchema>

export const purchaseOrderCrudEvents: CrudEventsConfig<PurchasingPurchaseOrder> = {
  module: 'purchasing',
  entity: 'purchase_order',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    status: ctx.entity?.status ?? null,
  }),
}

export const purchaseOrderCrudIndexer: CrudIndexerConfig<PurchasingPurchaseOrder> = {
  entityType: ORDER_ENTITY_ID,
}

export const purchasePaymentCrudEvents: CrudEventsConfig<PurchasingPurchasePayment> = {
  module: 'purchasing',
  entity: 'purchase_payment',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    stage: ctx.entity?.stage ?? null,
  }),
}

export const purchasePaymentCrudIndexer: CrudIndexerConfig<PurchasingPurchasePayment> = {
  entityType: PAYMENT_ENTITY_ID,
}

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

function orderFilter(scope: { tenantId: string; organizationId: string }, id: string): FilterQuery<PurchasingPurchaseOrder> {
  return { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null } as FilterQuery<PurchasingPurchaseOrder>
}

async function loadOrder(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  id: string,
): Promise<PurchasingPurchaseOrder> {
  const order = await em.fork().findOne(PurchasingPurchaseOrder, orderFilter(scope, id))
  if (!order) throw notFound('Purchase order not found')
  return order
}

type ResolvedLine = {
  productId: string | null
  catalogProductId: string | null
  /** The library row this line was ordered from; null for a master-only or catalog-only line. */
  supplierProductId: string | null
  productSnapshot: Record<string, unknown>
  quantity: string
  unitPrice: string
  taxRate: string
  priceIncludesTax: boolean
  note: string | null
  netTotal: string
  taxAmount: string
  lineTotal: string
}

/**
 * Resolves the products referenced by the order lines and computes each line's money fields.
 *
 * New lines point at the app-owned master (`products_products`, see
 * .ai/specs/2026-09-22-products-and-trade-docs.md) or at the supplier product library
 * (`sourcing_supplier_products`); lines written before that slice point at the installed catalog.
 * All three are read with raw, scoped Kysely queries — this module must not import another
 * module's entities, and it only needs a handful of display columns for the snapshot.
 * A product that is not visible in this organization fails the whole order: silently dropping a
 * line would ship a wrong order.
 *
 * Resolution runs again on every save, so a line whose library row has since been synced into the
 * master picks up `productId` and the catalog bridge the next time the draft is saved. What freezes
 * is the snapshot written onto the line, not the rule that produced it.
 */
async function resolveOrderLines(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  supplierId: string,
  lines: PurchaseOrderCreateInput['lines'],
): Promise<{ lines: ResolvedLine[]; totals: OrderTotals }> {
  const supplierProductIds = Array.from(
    new Set(
      lines
        .map((line) => line.supplierProductId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  )
  const supplierProducts = await loadSupplierProducts(em, scope, supplierProductIds)

  const ownedProductIds = Array.from(
    new Set([
      ...lines
        .map((line) => line.productId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
      // A library row that has been synced carries the master reference on the row itself, so its
      // line resolves through the very same read an explicitly picked master product does.
      ...supplierProductIds
        .map((id) => supplierProducts[id]?.productId ?? null)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ]),
  )
  const legacyProductIds = Array.from(
    new Set(
      lines
        .map((line) => (line.productId ? null : line.catalogProductId))
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  )

  const ownedById: Record<string, Record<string, unknown>> = {}
  if (ownedProductIds.length > 0) {
    const rows = (await (em.fork().getKysely<any>())
      .selectFrom('products_products')
      .select(['id', 'name', 'sku', 'manufacturer_model', 'spec_summary', 'unit', 'catalog_product_id'])
      .where('id', 'in', ownedProductIds)
      .where('tenant_id', '=', scope.tenantId)
      .where('organization_id', '=', scope.organizationId)
      .where('deleted_at', 'is', null)
      .execute()) as Array<Record<string, unknown>>
    for (const row of rows) ownedById[String(row.id)] = row
  }

  const legacyById: Record<string, Record<string, unknown>> = {}
  if (legacyProductIds.length > 0) {
    const rows = (await (em.fork().getKysely<any>())
      .selectFrom('catalog_products')
      .select(['id', 'title', 'sku', 'default_unit'])
      .where('id', 'in', legacyProductIds)
      .where('tenant_id', '=', scope.tenantId)
      .where('organization_id', '=', scope.organizationId)
      .where('deleted_at', 'is', null)
      .execute()) as Array<Record<string, unknown>>
    for (const row of rows) legacyById[String(row.id)] = row
  }

  const resolved = lines.map((line) => {
    const totals = computeLineTotals({
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      taxRate: line.taxRate,
      priceIncludesTax: line.priceIncludesTax,
    })

    const supplierProduct = line.supplierProductId ? supplierProducts[line.supplierProductId] : undefined
    if (line.supplierProductId && !supplierProduct) {
      throw badRequest(`Supplier product not found in this organization: ${line.supplierProductId}`)
    }
    if (supplierProduct && supplierProduct.supplierId !== supplierId) {
      throw new CrudHttpError(422, {
        error: `Supplier product ${supplierProduct.supplierSku} belongs to another supplier`,
        code: 'supplier_product_supplier_mismatch',
      })
    }
    // The supplier's own item number is what the packing list and the shipment allocation print, so
    // it travels in the snapshot: the goods stay identifiable after the library row is renamed.
    const supplierSku = supplierProduct ? supplierProduct.itemNo ?? supplierProduct.supplierSku : null
    // A synced library row is the master record in disguise, so both references resolve here.
    const productId = line.productId ?? supplierProduct?.productId ?? null

    if (productId) {
      const product = ownedById[productId]
      if (!product) throw badRequest(`Product not found in this organization: ${productId}`)
      // `title` is the key every purchasing surface already renders; `model`/`spec` are additive
      // so an order line prints the same detail a contract line does.
      const snapshot: Record<string, unknown> = {
        title: product.name ?? null,
        sku: product.sku ?? null,
        unit: product.unit ?? null,
        model: product.manufacturer_model ?? null,
        spec: product.spec_summary ?? null,
      }
      // Only a line that came from the library carries the supplier code; an ordinary master line
      // has no library row and therefore no key — the reader treats a missing key as null.
      if (supplierSku) snapshot.supplierSku = supplierSku
      return {
        productId,
        // Bridge, not a client input: the shipment receive path books stock at *variant* level and
        // resolves the variant through the installed catalog, so a line keeps the linked catalog
        // product when the master record has one. An unlinked product therefore cannot be
        // received — the receive command says so explicitly instead of writing stock against
        // nothing.
        catalogProductId: (product.catalog_product_id as string | null) ?? null,
        supplierProductId: supplierProduct?.id ?? null,
        productSnapshot: snapshot,
        quantity: Number(line.quantity).toFixed(4),
        unitPrice: Number(line.unitPrice).toFixed(4),
        taxRate: Number(line.taxRate).toFixed(3),
        priceIncludesTax: line.priceIncludesTax,
        note: line.note ?? null,
        ...totals,
      }
    }

    if (supplierProduct) {
      // Library-only line: no master record yet, so no catalog bridge either. Receipt and shipment
      // allocation require that link and say so in their own message, which is why an unsynced row
      // is orderable but not yet receivable.
      return {
        productId: null,
        catalogProductId: null,
        supplierProductId: supplierProduct.id,
        productSnapshot: {
          title: supplierProduct.name,
          sku: supplierProduct.supplierSku,
          unit: supplierProduct.unit,
          model: null,
          spec: supplierProduct.description,
          supplierSku: supplierProduct.itemNo ?? supplierProduct.supplierSku,
        },
        quantity: Number(line.quantity).toFixed(4),
        unitPrice: Number(line.unitPrice).toFixed(4),
        taxRate: Number(line.taxRate).toFixed(3),
        priceIncludesTax: line.priceIncludesTax,
        note: line.note ?? null,
        ...totals,
      }
    }

    const catalogProductId = line.catalogProductId ?? ''
    const product = legacyById[catalogProductId]
    if (!product) throw badRequest(`Catalog product not found in this organization: ${catalogProductId}`)
    return {
      productId: null,
      catalogProductId,
      supplierProductId: null,
      productSnapshot: {
        title: product.title ?? null,
        sku: product.sku ?? null,
        unit: product.default_unit ?? null,
      },
      quantity: Number(line.quantity).toFixed(4),
      unitPrice: Number(line.unitPrice).toFixed(4),
      taxRate: Number(line.taxRate).toFixed(3),
      priceIncludesTax: line.priceIncludesTax,
      note: line.note ?? null,
      ...totals,
    }
  })

  return { lines: resolved, totals: computeOrderTotals(resolved) }
}

async function persistLines(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  order: PurchasingPurchaseOrder,
  lines: ResolvedLine[],
): Promise<void> {
  await em.nativeDelete(PurchasingPurchaseOrderLine, { order: order.id } as FilterQuery<PurchasingPurchaseOrderLine>)
  lines.forEach((line, index) => {
    const now = new Date()
    em.persist(
      em.create(PurchasingPurchaseOrderLine, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        order,
        lineNumber: index + 1,
        productId: line.productId,
        catalogProductId: line.catalogProductId,
        supplierProductId: line.supplierProductId,
        productSnapshot: line.productSnapshot,
        quantity: line.quantity,
        receivedQuantity: '0.0000',
        taxRate: line.taxRate,
        priceIncludesTax: line.priceIncludesTax,
        unitPrice: line.unitPrice,
        netTotal: line.netTotal,
        taxAmount: line.taxAmount,
        lineTotal: line.lineTotal,
        note: line.note,
        createdAt: now,
        updatedAt: now,
      }),
    )
  })
  await em.flush()
}

async function supplierSnapshotFor(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  supplierId: string,
): Promise<Record<string, unknown>> {
  const supplier = await em.fork().findOne(PurchasingSupplier, {
    id: supplierId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  } as FilterQuery<PurchasingSupplier>)
  if (!supplier) throw badRequest('Supplier not found in this organization')
  return {
    name: supplier.name,
    code: supplier.code,
    contactName: supplier.contactName ?? null,
    defaultCurrencyCode: supplier.defaultCurrencyCode,
  }
}

/**
 * Per-organization order number, assigned at `place`. The unique constraint on
 * (tenant, organization, number) is the real guarantee — this only picks the next value,
 * so two concurrent places can collide and the loser retries with a fresh number.
 */
async function nextOrderNumber(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `PO-${year}-`
  const rows = await (em.fork().getKysely<any>())
    .selectFrom('purchasing_purchase_orders')
    .select('number')
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('number', 'like', `${prefix}%`)
    .orderBy('number', 'desc')
    .limit(1)
    .execute()
  const last = (rows as Array<{ number: string }>)[0]?.number ?? null
  const lastSequence = last ? Number.parseInt(last.slice(prefix.length), 10) : 0
  const next = Number.isFinite(lastSequence) ? lastSequence + 1 : 1
  return `${prefix}${String(next).padStart(4, '0')}`
}

const createOrderCommand: CommandHandler<Record<string, unknown>, PurchasingPurchaseOrder> = {
  id: 'purchasing.purchase-orders.create',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const parsed = purchaseOrderCreateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    await assertCurrencyInDictionary(em, scope, parsed.currencyCode)
    const supplierSnapshot = await supplierSnapshotFor(em, scope, parsed.supplierId)
    const { lines, totals } = await resolveOrderLines(em, scope, parsed.supplierId, parsed.lines)

    const order = await de.createOrmEntity({
      entity: PurchasingPurchaseOrder,
      data: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        supplierId: parsed.supplierId,
        supplierSnapshot,
        businessNumber: parsed.businessNumber ?? null,
        productCategory: parsed.productCategory ?? null,
        ownerUserId: parsed.ownerUserId ?? null,
        ownerSnapshot: parsed.ownerSnapshot ?? null,
        customerId: parsed.customerId ?? null,
        customerSnapshot: parsed.customerSnapshot ?? null,
        status: 'draft',
        currencyCode: parsed.currencyCode,
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        depositPercent: parsed.depositPercent === null || parsed.depositPercent === undefined ? null : String(parsed.depositPercent),
        depositAmount: parsed.depositAmount === null || parsed.depositAmount === undefined ? null : Number(parsed.depositAmount).toFixed(4),
        expectedShipAt: parsed.expectedShipAt ? new Date(parsed.expectedShipAt) : null,
        notes: parsed.notes ?? null,
      },
    })

    await persistLines(em, scope, order, lines)

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: order,
      identifiers: { id: String(order.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: purchaseOrderCrudEvents,
      indexer: purchaseOrderCrudIndexer,
    })

    return order
  },
  captureAfter: (_input, result) => ({ id: String(result.id), tenantId: String(result.tenantId), organizationId: String(result.organizationId) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Create purchase order',
    resourceKind: ORDER_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id) },
  }),
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<{ after?: { id: string } }>(logEntry)
    const id = payload?.after?.id ?? logEntry?.resourceId
    if (!id) throw new Error('[internal] Missing purchase order id for undo')
    const scope = ensureScope(ctx)
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const removed = await de.deleteOrmEntity({
      entity: PurchasingPurchaseOrder,
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
      events: purchaseOrderCrudEvents,
      indexer: purchaseOrderCrudIndexer,
    })
  },
}

const updateOrderCommand: CommandHandler<Record<string, unknown>, PurchasingPurchaseOrder> = {
  id: 'purchasing.purchase-orders.update',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = purchaseOrderUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const order = await loadOrder(em, scope, parsed.id)

    enforceCommandOptimisticLock({
      resourceKind: ORDER_RESOURCE_KIND,
      resourceId: String(order.id),
      current: order.updatedAt,
      request: ctx.request ?? null,
    })

    // A placed order is a commitment: only header metadata may still be corrected. Only the keys
    // the caller actually sent are judged — an omitted field is never a change, and an optional key
    // that arrived as an explicit `undefined` (zod keeps it) is not one either.
    const headerOnly = order.status !== 'draft'
    if (headerOnly) {
      const sentKeys = Object.entries(parsed).filter(([key, value]) => key !== 'id' && value !== undefined)
      const rejected = sentKeys.filter(
        ([key]) => !(POST_PLACEMENT_UPDATE_FIELDS as readonly string[]).includes(key),
      )
      if (rejected.length > 0) {
        throw conflict(`Only header metadata can be updated in status ${order.status}`)
      }
    }

    if (parsed.currencyCode) await assertCurrencyInDictionary(em, scope, parsed.currencyCode)

    const supplierSnapshot = headerOnly || !parsed.supplierId ? null : await supplierSnapshotFor(em, scope, parsed.supplierId)
    const resolved = headerOnly || !parsed.lines
      ? null
      : await resolveOrderLines(em, scope, parsed.supplierId ?? order.supplierId, parsed.lines)

    const updated = await de.updateOrmEntity({
      entity: PurchasingPurchaseOrder,
      where: orderFilter(scope, parsed.id),
      apply: (entity) => {
        // The allow-listed header metadata, writable in every status.
        if (parsed.businessNumber !== undefined) entity.businessNumber = parsed.businessNumber
        if (parsed.productCategory !== undefined) entity.productCategory = parsed.productCategory
        if (parsed.ownerUserId !== undefined) entity.ownerUserId = parsed.ownerUserId
        if (parsed.ownerSnapshot !== undefined) entity.ownerSnapshot = parsed.ownerSnapshot
        if (parsed.customerId !== undefined) entity.customerId = parsed.customerId
        if (parsed.customerSnapshot !== undefined) entity.customerSnapshot = parsed.customerSnapshot
        if (parsed.expectedShipAt !== undefined) entity.expectedShipAt = parsed.expectedShipAt ? new Date(parsed.expectedShipAt) : null
        if (parsed.notes !== undefined) entity.notes = parsed.notes
        // Commercial terms freeze at `place`; the gate above already rejected them on a non-draft
        // order, so this branch only ever runs for a draft.
        if (headerOnly) return
        if (parsed.supplierId) entity.supplierId = parsed.supplierId
        if (supplierSnapshot) entity.supplierSnapshot = supplierSnapshot
        if (parsed.currencyCode) entity.currencyCode = parsed.currencyCode
        if (parsed.depositPercent !== undefined) entity.depositPercent = parsed.depositPercent === null ? null : String(parsed.depositPercent)
        if (parsed.depositAmount !== undefined) entity.depositAmount = parsed.depositAmount === null ? null : Number(parsed.depositAmount).toFixed(4)
        if (resolved) {
          entity.subtotal = resolved.totals.subtotal
          entity.taxTotal = resolved.totals.taxTotal
          entity.total = resolved.totals.total
        }
      },
    })
    if (!updated) throw notFound('Purchase order not found')
    if (resolved) await persistLines(em, scope, updated, resolved.lines)

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: purchaseOrderCrudEvents,
      indexer: purchaseOrderCrudIndexer,
    })

    return updated
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Update purchase order',
    resourceKind: ORDER_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id), status: result.status },
  }),
}

const deleteOrderCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  PurchasingPurchaseOrder
> = {
  id: 'purchasing.purchase-orders.delete',
  isUndoable: false,
  async execute(input, ctx) {
    const id = requireId(input, 'Purchase order id required')
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const order = await loadOrder(em, scope, id)
    if (order.status !== 'draft' && order.status !== 'cancelled') {
      throw conflict('Only a draft or cancelled purchase order can be deleted')
    }

    const removed = await de.deleteOrmEntity({
      entity: PurchasingPurchaseOrder,
      where: orderFilter(scope, id),
      soft: true,
      softDeleteField: 'deletedAt',
    })
    if (!removed) throw notFound('Purchase order not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: { id: String(removed.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: purchaseOrderCrudEvents,
      indexer: purchaseOrderCrudIndexer,
    })

    return removed
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Delete purchase order',
    resourceKind: ORDER_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id) },
  }),
}

/** Transition action → the declared event id it emits (declarations live in `../events`). */
const TRANSITION_EVENT_IDS = {
  place: 'purchasing.purchase_order.placed',
  mark_shipped: 'purchasing.purchase_order.shipped',
  mark_received: 'purchasing.purchase_order.received',
  close: 'purchasing.purchase_order.closed',
  cancel: 'purchasing.purchase_order.cancelled',
} as const

/**
 * Status transitions share one command surface so the allowed-transition table is the only
 * place that decides what is legal — a route or a UI button can never widen it.
 */
const transitionOrderCommand: CommandHandler<Record<string, unknown>, PurchasingPurchaseOrder> = {
  id: 'purchasing.purchase-orders.transition',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = purchaseOrderTransitionSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const order = await loadOrder(em, scope, parsed.id)
    const transition = ALLOWED_TRANSITIONS[parsed.action]
    if (!transition) throw badRequest(`Unknown transition: ${parsed.action}`)
    if (!transition.from.includes(order.status as OrderStatus)) {
      throw new CrudHttpError(422, {
        error: `Cannot ${parsed.action} a purchase order in status ${order.status}`,
      })
    }
    if (parsed.action === 'cancel' && !parsed.reason) {
      throw badRequest('A cancellation reason is required')
    }

    const now = new Date()
    const updated = await de.updateOrmEntity({
      entity: PurchasingPurchaseOrder,
      where: orderFilter(scope, parsed.id),
      apply: (entity) => {
        entity.status = transition.to
        if (transition.to === 'placed') {
          entity.number = entity.number ?? `PO-PENDING-${String(entity.id).slice(0, 8)}`
          entity.placedAt = now
          entity.supplierSnapshot = entity.supplierSnapshot ?? null
        }
        if (transition.to === 'shipped') entity.shippedAt = now
        if (transition.to === 'received') entity.receivedAt = now
        if (transition.to === 'closed') entity.closedAt = now
        if (parsed.reason) entity.notes = `${entity.notes ? `${entity.notes}\n` : ''}${parsed.action}: ${parsed.reason}`
      },
    })
    if (!updated) throw notFound('Purchase order not found')

    if (transition.to === 'placed' && (!updated.number || updated.number.startsWith('PO-PENDING-'))) {
      updated.number = await nextOrderNumber(em, scope)
      await em.fork().nativeUpdate(PurchasingPurchaseOrder, { id: updated.id }, { number: updated.number })
    }

    await eventsConfig.emit(TRANSITION_EVENT_IDS[parsed.action], {
      id: String(updated.id),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      status: updated.status,
      number: updated.number ?? null,
    })

    return updated
  },
  captureAfter: (_input, result) => ({ id: String(result.id), status: result.status }),
  buildLog: async ({ result }) => ({
    actionLabel: `Purchase order ${result.status}`,
    resourceKind: ORDER_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id), status: result.status, number: result.number ?? null },
  }),
}

const recordPaymentCommand: CommandHandler<Record<string, unknown>, PurchasingPurchasePayment> = {
  id: 'purchasing.purchase-payments.record',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = purchasePaymentCreateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const order = await loadOrder(em, scope, parsed.orderId)
    if (order.status === 'cancelled') throw conflict('A cancelled purchase order cannot receive payments')
    if (order.status === 'closed') throw conflict('A closed purchase order cannot receive payments')

    const payment = await de.createOrmEntity({
      entity: PurchasingPurchasePayment,
      data: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        order,
        stage: parsed.stage,
        amount: Number(parsed.amount).toFixed(4),
        // Payments are recorded in the order's currency; a mismatch is rejected rather than
        // converted, because this module performs no FX.
        currencyCode: order.currencyCode,
        paidAt: new Date(parsed.paidAt),
        reference: parsed.reference ?? null,
        methodNote: parsed.methodNote ?? null,
        attachmentId: parsed.attachmentId ?? null,
      },
    })

    await eventsConfig.emit('purchasing.purchase_payment.recorded', {
      id: String(payment.id),
      orderId: String(order.id),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      stage: payment.stage,
      amount: payment.amount,
    })

    return payment
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Record purchase payment',
    resourceKind: PAYMENT_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id), amount: result.amount, stage: result.stage },
  }),
}

const deletePaymentCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  PurchasingPurchasePayment
> = {
  id: 'purchasing.purchase-payments.delete',
  isUndoable: false,
  async execute(input, ctx) {
    const id = requireId(input, 'Payment id required')
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager

    const payment = await em.fork().findOne(PurchasingPurchasePayment, {
      id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    } as FilterQuery<PurchasingPurchasePayment>)
    if (!payment) throw notFound('Payment not found')

    const order = await loadOrder(em, scope, String(payment.order.id))
    if (order.status === 'closed') throw conflict('A closed purchase order cannot have its payments removed')

    await em.fork().nativeDelete(PurchasingPurchasePayment, { id } as FilterQuery<PurchasingPurchasePayment>)

    await eventsConfig.emit('purchasing.purchase_payment.deleted', {
      id: String(payment.id),
      orderId: String(order.id),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })

    return payment
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Delete purchase payment',
    resourceKind: PAYMENT_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id) },
  }),
}

/**
 * Receipt application: the seam `cross_border` calls when a consignment lands in the overseas
 * warehouse. It lives here because purchasing owns the ordered/received quantities — the
 * shipment module must not write them, and a rejected receipt has to leave the line untouched.
 *
 * The ordered quantity is the ceiling: over-receipt is refused rather than silently clamped, so a
 * mis-declared consignment surfaces instead of corrupting the outstanding balance. When the last
 * open line is fully received the order itself advances to `received`.
 */
export const purchaseReceiptSchema = z.object({
  purchaseOrderLineId: z.string().uuid(),
  quantity: z.coerce.number().positive(),
  sourceType: z.string().max(64).optional(),
  sourceId: z.string().uuid().optional(),
  note: z.string().max(500).optional(),
})

const applyReceiptCommand: CommandHandler<Record<string, unknown>, { lineId: string; orderId: string; receivedQuantity: string; orderStatus: string }> = {
  id: 'purchasing.purchase-orders.apply-receipt',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = purchaseReceiptSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const line = await em.fork().findOne(PurchasingPurchaseOrderLine, {
      id: parsed.purchaseOrderLineId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    } as FilterQuery<PurchasingPurchaseOrderLine>)
    if (!line) throw notFound('Purchase order line not found')

    const order = await loadOrder(em, scope, String(line.order.id))
    if (order.status === 'cancelled') throw conflict('A cancelled purchase order cannot receive goods')
    if (order.status === 'draft' || order.status === 'placed') {
      throw new CrudHttpError(422, {
        error: `Purchase order ${order.number ?? order.id} must be shipped before goods can be received`,
      })
    }

    const ordered = Number.parseFloat(line.quantity)
    const alreadyReceived = Number.parseFloat(line.receivedQuantity ?? '0')
    const next = alreadyReceived + Number(parsed.quantity)
    if (next > ordered + 1e-6) {
      throw new CrudHttpError(422, {
        error: `Receiving ${parsed.quantity} exceeds the ordered quantity ${line.quantity} (already received ${alreadyReceived})`,
      })
    }

    const receivedQuantity = next.toFixed(4)
    await em.fork().nativeUpdate(PurchasingPurchaseOrderLine, { id: line.id }, { receivedQuantity })

    const openLines = await em.fork().find(PurchasingPurchaseOrderLine, {
      order: order.id,
    } as FilterQuery<PurchasingPurchaseOrderLine>)
    const fullyReceived = openLines.every((candidate) => {
      const current = String(candidate.id) === String(line.id) ? receivedQuantity : String(candidate.receivedQuantity ?? '0')
      return Number.parseFloat(current) + 1e-6 >= Number.parseFloat(candidate.quantity)
    })

    let orderStatus = order.status
    if (fullyReceived && order.status === 'shipped') {
      const now = new Date()
      await em.fork().nativeUpdate(PurchasingPurchaseOrder, { id: order.id }, { status: 'received', receivedAt: now })
      orderStatus = 'received'
      await eventsConfig.emit('purchasing.purchase_order.received', {
        id: String(order.id),
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        status: orderStatus,
        number: order.number ?? null,
      })
    }

    await de.emitOrmEntityEvent({
      action: 'updated',
      entity: order,
      identifiers: { id: String(order.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: purchaseOrderCrudEvents,
      indexer: purchaseOrderCrudIndexer,
    })

    return {
      lineId: String(line.id),
      orderId: String(order.id),
      receivedQuantity,
      orderStatus,
    }
  },
  captureAfter: (_input, result) => result,
  buildLog: async ({ result }) => ({
    actionLabel: 'Apply purchase receipt',
    resourceKind: ORDER_RESOURCE_KIND,
    resourceId: result.orderId,
    tenantId: null,
    organizationId: null,
    snapshotAfter: { lineId: result.lineId, receivedQuantity: result.receivedQuantity, orderStatus: result.orderStatus },
  }),
}

/**
 * Attaches (or clears) the proof-of-payment file on an existing payment.
 *
 * A separate command from `record` on purpose: the file can only be uploaded once the payment
 * row exists (the attachments module keys files by record id), so the UI creates the payment
 * first and attaches second. Keeping it a command preserves the audit trail and the closed-order
 * guard instead of letting the route write the column.
 */
export const purchasePaymentAttachSchema = z.object({
  id: z.string().uuid(),
  attachmentId: z.string().uuid().nullable(),
})

const attachPaymentCommand: CommandHandler<Record<string, unknown>, { id: string; attachmentId: string | null }> = {
  id: 'purchasing.purchase-payments.attach',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = purchasePaymentAttachSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager

    const payment = await em.fork().findOne(PurchasingPurchasePayment, {
      id: parsed.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    } as FilterQuery<PurchasingPurchasePayment>)
    if (!payment) throw notFound('Payment not found')

    const order = await loadOrder(em, scope, String(payment.order.id))
    if (order.status === 'closed') throw conflict('A closed purchase order cannot have its payments changed')

    await em.fork().nativeUpdate(
      PurchasingPurchasePayment,
      { id: payment.id },
      { attachmentId: parsed.attachmentId },
    )

    return { id: String(payment.id), attachmentId: parsed.attachmentId }
  },
  captureAfter: (_input, result) => result,
  buildLog: async ({ result }) => ({
    actionLabel: 'Attach purchase payment file',
    resourceKind: PAYMENT_RESOURCE_KIND,
    resourceId: result.id,
    tenantId: null,
    organizationId: null,
    snapshotAfter: { id: result.id, attachmentId: result.attachmentId },
  }),
}

export const purchaseOrderDocumentCrudEvents: CrudEventsConfig<PurchasingPurchaseOrderDocument> = {
  module: 'purchasing',
  entity: 'purchase_order_document',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    docType: ctx.entity?.docType ?? null,
  }),
}

export const purchaseOrderDocumentCrudIndexer: CrudIndexerConfig<PurchasingPurchaseOrderDocument> = {
  entityType: DOCUMENT_ENTITY_ID,
}

function documentFilter(
  scope: { tenantId: string; organizationId: string },
  id: string,
): FilterQuery<PurchasingPurchaseOrderDocument> {
  return {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  } as FilterQuery<PurchasingPurchaseOrderDocument>
}

const createOrderDocumentCommand: CommandHandler<Record<string, unknown>, PurchasingPurchaseOrderDocument> = {
  id: 'purchasing.order-documents.create',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const parsed = purchaseOrderDocumentCreateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    // The order is loaded scoped first: a document may only hang on an order the caller can
    // actually see, which keeps a guessed order id from becoming a cross-organization write.
    const order = await loadOrder(em, scope, parsed.orderId)

    const document = await de.createOrmEntity({
      entity: PurchasingPurchaseOrderDocument,
      data: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        order,
        docType: parsed.docType,
        documentNumber: parsed.documentNumber ?? null,
        issuedAt: parsed.issuedAt ? new Date(parsed.issuedAt) : null,
        attachmentId: parsed.attachmentId ?? null,
        note: parsed.note ?? null,
      },
    })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: document,
      identifiers: { id: String(document.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: purchaseOrderDocumentCrudEvents,
      indexer: purchaseOrderDocumentCrudIndexer,
    })

    return document
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Create purchase order document',
    resourceKind: DOCUMENT_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id), docType: result.docType },
  }),
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<{ after?: { id: string } }>(logEntry)
    const id = payload?.after?.id ?? logEntry?.resourceId
    if (!id) throw new Error('[internal] Missing purchase order document id for undo')
    const scope = ensureScope(ctx)
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const removed = await de.deleteOrmEntity({
      entity: PurchasingPurchaseOrderDocument,
      where: documentFilter(scope, id),
      soft: true,
      softDeleteField: 'deletedAt',
    })
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: { id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: purchaseOrderDocumentCrudEvents,
      indexer: purchaseOrderDocumentCrudIndexer,
    })
  },
}

const updateOrderDocumentCommand: CommandHandler<Record<string, unknown>, PurchasingPurchaseOrderDocument> = {
  id: 'purchasing.order-documents.update',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = purchaseOrderDocumentUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const existing = await em.fork().findOne(PurchasingPurchaseOrderDocument, documentFilter(scope, parsed.id))
    if (!existing) throw notFound('Purchase order document not found')

    const updated = await de.updateOrmEntity({
      entity: PurchasingPurchaseOrderDocument,
      where: documentFilter(scope, parsed.id),
      apply: (entity) => {
        if (parsed.docType !== undefined) entity.docType = parsed.docType
        if (parsed.documentNumber !== undefined) entity.documentNumber = parsed.documentNumber
        if (parsed.issuedAt !== undefined) entity.issuedAt = parsed.issuedAt ? new Date(parsed.issuedAt) : null
        if (parsed.attachmentId !== undefined) entity.attachmentId = parsed.attachmentId
        if (parsed.note !== undefined) entity.note = parsed.note
      },
    })
    if (!updated) throw notFound('Purchase order document not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: purchaseOrderDocumentCrudEvents,
      indexer: purchaseOrderDocumentCrudIndexer,
    })

    return updated
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Update purchase order document',
    resourceKind: DOCUMENT_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id) },
  }),
}

const deleteOrderDocumentCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  PurchasingPurchaseOrderDocument
> = {
  id: 'purchasing.order-documents.delete',
  isUndoable: false,
  async execute(input, ctx) {
    const id = requireId(input, 'Purchase order document id required')
    const scope = ensureScope(ctx)
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const removed = await de.deleteOrmEntity({
      entity: PurchasingPurchaseOrderDocument,
      where: documentFilter(scope, id),
      soft: true,
      softDeleteField: 'deletedAt',
    })
    if (!removed) throw notFound('Purchase order document not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: { id: String(removed.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: purchaseOrderDocumentCrudEvents,
      indexer: purchaseOrderDocumentCrudIndexer,
    })

    return removed
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Delete purchase order document',
    resourceKind: DOCUMENT_RESOURCE_KIND,
    resourceId: String(result.id),
    tenantId: String(result.tenantId),
    organizationId: String(result.organizationId),
    snapshotAfter: { id: String(result.id) },
  }),
}

registerCommand(createOrderCommand)
registerCommand(updateOrderCommand)
registerCommand(deleteOrderCommand)
registerCommand(transitionOrderCommand)
registerCommand(recordPaymentCommand)
registerCommand(deletePaymentCommand)
registerCommand(applyReceiptCommand)
registerCommand(attachPaymentCommand)
registerCommand(createOrderDocumentCommand)
registerCommand(updateOrderDocumentCommand)
registerCommand(deleteOrderDocumentCommand)

export {
  createOrderCommand,
  updateOrderCommand,
  deleteOrderCommand,
  transitionOrderCommand,
  recordPaymentCommand,
  deletePaymentCommand,
  applyReceiptCommand,
  attachPaymentCommand,
  createOrderDocumentCommand,
  updateOrderDocumentCommand,
  deleteOrderDocumentCommand,
}

export type { PaymentRow }
