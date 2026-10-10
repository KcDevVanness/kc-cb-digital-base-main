import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import type { ReadScope } from './scope'

/**
 * Every peer fact this module reads, in one file.
 *
 * Raw Kysely reads on purpose: the app-wide rule forbids importing another module's entities, and
 * each query is filtered by the same tenant + organization the caller is acting in. Nothing here
 * writes — peer state changes go through the owning module's commands. Column names are the raw
 * table columns (`product_id`, not the entity property name), because Kysely works on columns.
 *
 * Declaring only the columns this module reads keeps the join types honest: a typo in a selected
 * column is a compile error instead of a runtime `undefined`.
 */
type FinanceReadDatabase = {
  cross_border_shipments: {
    id: string
    number: string | null
    status: string
    received_at: Date | string | null
    deleted_at: Date | null
    tenant_id: string
    organization_id: string
  }
  cross_border_shipment_allocations: {
    id: string
    shipment_id: string
    purchase_order_id: string
    purchase_order_line_id: string
    purchase_order_number: string | null
    quantity: string
    tenant_id: string
    organization_id: string
  }
  purchasing_purchase_order_lines: {
    id: string
    order_id: string
    line_number: number
    catalog_product_id: string | null
    quantity: string
    net_total: string
    product_snapshot: Record<string, unknown> | null
    tenant_id: string
    organization_id: string
  }
  purchasing_purchase_orders: {
    id: string
    number: string | null
    business_number: string | null
    currency_code: string
    deleted_at: Date | null
    tenant_id: string
    organization_id: string
  }
  catalog_products: {
    id: string
    sku: string | null
    title: string
    is_active: boolean
    deleted_at: Date | null
    tenant_id: string
    organization_id: string
  }
  catalog_product_variant_prices: {
    id: string
    product_id: string | null
    price_kind_id: string
    currency_code: string
    unit_price_net: string | null
    min_quantity: number
    starts_at: Date | null
    ends_at: Date | null
    tenant_id: string
    organization_id: string
  }
  catalog_price_kinds: {
    id: string
    code: string
    deleted_at: Date | null
    tenant_id: string
  }
  custom_field_values: {
    entity_id: string
    record_id: string
    field_key: string
    value_text: string | null
    value_int: number | null
    value_float: number | null
    value_bool: boolean | null
    deleted_at: Date | null
    tenant_id: string | null
    organization_id: string | null
  }
  wms_inventory_balances: {
    warehouse_id: string
    catalog_variant_id: string
    quantity_on_hand: string
    deleted_at: Date | null
    tenant_id: string
    organization_id: string
  }
  wms_warehouses: {
    id: string
    name: string
    deleted_at: Date | null
    tenant_id: string
    organization_id: string
  }
  catalog_product_variants: {
    id: string
    product_id: string
    name: string | null
    sku: string | null
    tenant_id: string
    organization_id: string
  }
  platform_ops_channels: {
    id: string
    name: string
    code: string
    deleted_at: Date | null
    tenant_id: string
    organization_id: string
  }
}

/**
 * One provider-typed read handle. `em.fork()` per read keeps a peer query out of the caller's
 * identity map; the DB is the same connection pool either way.
 */
function readDb(em: EntityManager) {
  return em.fork().getKysely<FinanceReadDatabase>()
}

export type ShipmentRef = {
  id: string
  number: string | null
  status: string
}

export async function loadShipmentRef(em: EntityManager, scope: ReadScope, shipmentId: string): Promise<ShipmentRef | null> {
  const row = await readDb(em)
    .selectFrom('cross_border_shipments')
    .select(['id', 'number', 'status'])
    .where('id', '=', shipmentId)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', 'in', scope.organizationIds)
    .where('deleted_at', 'is', null)
    .limit(1)
    .executeTakeFirst()

  if (!row) return null
  return { id: String(row.id), number: row.number ?? null, status: String(row.status ?? 'draft') }
}

export type ShipmentPurchaseLineRow = {
  /** The allocation row (one purchase line is allocated once per shipment). */
  allocationId: string
  purchaseOrderLineId: string
  purchaseOrderId: string
  purchaseOrderNumber: string | null
  businessNumber: string | null
  lineNumber: number
  productId: string | null
  productTitle: string | null
  sku: string | null
  orderCurrencyCode: string
  netTotal: string
  orderedQuantity: string
  /** Quantity allocated to this container — the quantity basis of the allocation. */
  allocatedQuantity: string
}

/**
 * The purchase lines of one container: the allocations of a shipment joined with the order lines
 * they point at. A line allocated to the container is the allocation unit of landed cost, because
 * that is the quantity physically on board.
 */
export async function loadShipmentPurchaseLines(
  em: EntityManager,
  scope: ReadScope,
  shipmentId: string,
): Promise<ShipmentPurchaseLineRow[]> {
  const rows = await readDb(em)
    .selectFrom('cross_border_shipment_allocations as a')
    .innerJoin('purchasing_purchase_order_lines as l', 'l.id', 'a.purchase_order_line_id')
    .innerJoin('purchasing_purchase_orders as o', 'o.id', 'a.purchase_order_id')
    .leftJoin('catalog_products as p', (join) =>
      join.onRef('p.id', '=', 'l.catalog_product_id').on('p.deleted_at', 'is', null),
    )
    .select([
      'a.id as allocation_id',
      'a.purchase_order_line_id as purchase_order_line_id',
      'a.purchase_order_id as purchase_order_id',
      'a.purchase_order_number as purchase_order_number',
      'o.business_number as business_number',
      'o.currency_code as currency_code',
      'l.line_number as line_number',
      'l.catalog_product_id as product_id',
      'l.quantity as quantity',
      'l.net_total as net_total',
      'l.product_snapshot as product_snapshot',
      'a.quantity as allocated_quantity',
      'p.sku as product_sku',
      'p.title as product_name',
    ])
    .where('a.shipment_id', '=', shipmentId)
    .where('a.tenant_id', '=', scope.tenantId)
    .where('a.organization_id', 'in', scope.organizationIds)
    .where('o.deleted_at', 'is', null)
    .orderBy('l.line_number', 'asc')
    .execute()

  return rows.map((row) => {
    const snapshot = row.product_snapshot ?? null
    const snapshotSku = snapshot && typeof snapshot.sku === 'string' ? snapshot.sku : null
    const snapshotTitle = snapshot && typeof snapshot.title === 'string' ? snapshot.title : null
    return {
      allocationId: String(row.allocation_id),
      purchaseOrderLineId: String(row.purchase_order_line_id),
      purchaseOrderId: String(row.purchase_order_id),
      purchaseOrderNumber: row.purchase_order_number ?? null,
      businessNumber: row.business_number ?? null,
      lineNumber: Number(row.line_number ?? 0),
      productId: row.product_id ?? null,
      productTitle: row.product_name ?? snapshotTitle,
      sku: row.product_sku ?? snapshotSku,
      orderCurrencyCode: String(row.currency_code ?? 'CNY'),
      netTotal: String(row.net_total ?? '0'),
      orderedQuantity: String(row.quantity ?? '0'),
      allocatedQuantity: String(row.allocated_quantity ?? '0'),
    }
  })
}

/** Products of this organization, keyed by id — the authoritative SKU and title for a line. */
export type ProductRefRow = { id: string; sku: string; title: string | null }

export async function loadProductRefs(
  em: EntityManager,
  scope: ReadScope,
  productIds: readonly string[],
): Promise<Map<string, ProductRefRow>> {
  const ids = [...new Set(productIds.filter((value) => value.length > 0))]
  if (ids.length === 0) return new Map()
  const rows = await readDb(em)
    .selectFrom('catalog_products')
    .select(['id', 'sku', 'title'])
    .where('id', 'in', ids)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', 'in', scope.organizationIds)
    .where('deleted_at', 'is', null)
    .execute()

  return new Map(
    rows.map((row) => [
      String(row.id),
      { id: String(row.id), sku: String(row.sku ?? ''), title: row.title ?? null },
    ]),
  )
}

export type InventoryBalanceRow = {
  warehouseId: string
  warehouseName: string | null
  catalogVariantId: string
  quantityOnHand: string
}

/** On-hand stock of the organization (optionally one warehouse), one row per warehouse+variant. */
export async function loadInventoryBalances(
  em: EntityManager,
  scope: ReadScope,
  filter: { warehouseId?: string } = {},
): Promise<InventoryBalanceRow[]> {
  let query = readDb(em)
    .selectFrom('wms_inventory_balances as b')
    .innerJoin('wms_warehouses as w', 'w.id', 'b.warehouse_id')
    .select([
      'b.warehouse_id as warehouse_id',
      'w.name as warehouse_name',
      'b.catalog_variant_id as catalog_variant_id',
      'b.quantity_on_hand as quantity_on_hand',
    ])
    .where('b.tenant_id', '=', scope.tenantId)
    .where('b.organization_id', 'in', scope.organizationIds)
    .where('b.deleted_at', 'is', null)
    .where('w.deleted_at', 'is', null)
    .orderBy('w.name', 'asc')

  if (filter.warehouseId) query = query.where('b.warehouse_id', '=', filter.warehouseId)

  const rows = await query.execute()
  return rows.map((row) => ({
    warehouseId: String(row.warehouse_id),
    warehouseName: row.warehouse_name ?? null,
    catalogVariantId: String(row.catalog_variant_id),
    quantityOnHand: String(row.quantity_on_hand ?? '0'),
  }))
}

export type VariantRefRow = {
  variantId: string
  catalogProductId: string
  name: string | null
  sku: string | null
}

/**
 * Inventory is booked against the installed catalog's **variant**, so a balance maps back to a
 * product through `catalog_product_variants.product_id` — which **is** the product id the app uses
 * everywhere since the single-store cutover removed the second identity.
 */
export async function loadVariantRefs(
  em: EntityManager,
  scope: ReadScope,
  variantIds: readonly string[],
): Promise<Map<string, VariantRefRow>> {
  const ids = [...new Set(variantIds.filter((value) => value.length > 0))]
  if (ids.length === 0) return new Map()
  const rows = await readDb(em)
    .selectFrom('catalog_product_variants')
    .select(['id', 'product_id', 'name', 'sku'])
    .where('id', 'in', ids)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', 'in', scope.organizationIds)
    .execute()

  return new Map(
    rows.map((row) => [
      String(row.id),
      {
        variantId: String(row.id),
        catalogProductId: String(row.product_id),
        name: row.name ?? null,
        sku: row.sku ?? null,
      },
    ]),
  )
}

/** `catalog_products` rows of one organization keyed by id; the title prefers the English custom field. */
export async function loadProductsByCatalogId(
  em: EntityManager,
  scope: ReadScope,
  catalogProductIds: readonly string[],
): Promise<Map<string, ProductRefRow>> {
  const ids = [...new Set(catalogProductIds.filter((value) => value.length > 0))]
  if (ids.length === 0) return new Map()
  const refs = await loadProductRefs(em, scope, ids)
  const englishNames = await readDb(em)
    .selectFrom('custom_field_values')
    .select(['record_id', 'value_text'])
    .where('entity_id', '=', 'catalog:catalog_product')
    .where('field_key', '=', 'name_en')
    .where('record_id', 'in', ids)
    .where('deleted_at', 'is', null)
    .execute()
  for (const row of englishNames) {
    const ref = refs.get(String(row.record_id))
    if (ref && row.value_text) ref.title = row.value_text
  }
  return refs
}

export type ChannelRef = { id: string; name: string; code: string }

/**
 * One marketplace channel of the caller's organization. The write path uses it to reject an
 * expense booked against another organization's channel with a 404 instead of storing a dangling
 * reference.
 */
export async function loadChannelRef(
  em: EntityManager,
  scope: ReadScope,
  channelId: string,
): Promise<ChannelRef | null> {
  const row = await readDb(em)
    .selectFrom('platform_ops_channels')
    .select(['id', 'name', 'code'])
    .where('id', '=', channelId)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', 'in', scope.organizationIds)
    .where('deleted_at', 'is', null)
    .limit(1)
    .executeTakeFirst()

  if (!row) return null
  return { id: String(row.id), name: String(row.name ?? ''), code: String(row.code ?? '') }
}

export type PurchaseTierPriceRow = {
  productId: string
  priceTier: string
  currencyCode: string
  unitPrice: string
  minQuantity: number
}

/** Active price rows of the given products; the resolver picks the `purchase` tier. */
export async function loadActivePriceRows(
  em: EntityManager,
  scope: ReadScope,
  productIds: readonly string[],
): Promise<Map<string, PurchaseTierPriceRow[]>> {
  const ids = [...new Set(productIds.filter((value) => value.length > 0))]
  const result = new Map<string, PurchaseTierPriceRow[]>()
  if (ids.length === 0) return result

  const rows = await readDb(em)
    .selectFrom('catalog_product_variant_prices as p')
    .innerJoin('catalog_price_kinds as k', 'k.id', 'p.price_kind_id')
    .select([
      'p.product_id as product_id',
      'k.code as price_tier',
      'p.currency_code as currency_code',
      'p.unit_price_net as unit_price',
      'p.min_quantity as min_quantity',
      'p.ends_at as ends_at',
    ])
    .where('p.product_id', 'in', ids)
    .where('p.tenant_id', '=', scope.tenantId)
    .where('p.organization_id', 'in', scope.organizationIds)
    .where('k.deleted_at', 'is', null)
    .orderBy('p.min_quantity', 'asc')
    .execute()

  const now = Date.now()
  for (const row of rows) {
    // The catalog price table has no soft-delete column: a closed window (`ends_at` in the past) is
    // what "no longer an active price" means since the single-store cutover.
    if (row.ends_at && new Date(row.ends_at).getTime() <= now) continue
    const productId = String(row.product_id)
    const list = result.get(productId) ?? []
    list.push({
      productId,
      priceTier: String(row.price_tier),
      currencyCode: String(row.currency_code),
      unitPrice: String(row.unit_price ?? '0'),
      minQuantity: Number(row.min_quantity ?? 1),
    })
    result.set(productId, list)
  }
  return result
}

export type ReceivedShipmentRow = {
  id: string
  number: string | null
  receivedAt: string | null
}

/**
 * Containers that carry a given SKU, newest first. Matches both the authoritative product SKU
 * (through the line's `catalog_product_id` link) and the line's own display snapshot, so a
 * historical line whose product has since been renamed is found too. Bounded: the caller is a
 * report, not an export of the whole table.
 */
export async function findShipmentIdsBySku(
  em: EntityManager,
  scope: ReadScope,
  sku: string,
  limit = 50,
): Promise<string[]> {
  const rows = await readDb(em)
    .selectFrom('cross_border_shipment_allocations as a')
    .innerJoin('cross_border_shipments as s', 's.id', 'a.shipment_id')
    .innerJoin('purchasing_purchase_order_lines as l', 'l.id', 'a.purchase_order_line_id')
    .leftJoin('catalog_products as p', (join) =>
      join.onRef('p.id', '=', 'l.catalog_product_id').on('p.deleted_at', 'is', null),
    )
    .select(['a.shipment_id as shipment_id'])
    .distinct()
    .where('a.tenant_id', '=', scope.tenantId)
    .where('a.organization_id', 'in', scope.organizationIds)
    .where('s.deleted_at', 'is', null)
    .where((eb) =>
      eb.or([eb('p.sku', '=', sku), sql<boolean>`l.product_snapshot->>'sku' = ${sku}`]),
    )
    .orderBy('a.shipment_id', 'asc')
    .limit(limit)
    .execute()

  return rows.map((row) => String(row.shipment_id))
}

/** Received containers, newest first — the source of "the latest landed cost of a SKU". */
export async function loadReceivedShipments(
  em: EntityManager,
  scope: ReadScope,
  limit = 100,
): Promise<ReceivedShipmentRow[]> {
  const rows = await readDb(em)
    .selectFrom('cross_border_shipments')
    .select(['id', 'number', 'received_at'])
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', 'in', scope.organizationIds)
    .where('deleted_at', 'is', null)
    // `received` covers the landed-cost scan and `closed` must not drop out of it: archiving a
    // container is paperwork/settlement, not a shipment that never landed. Filtering on `received`
    // alone silently changed SKU landed costs (and every valuation reading them) the moment the
    // archival status existed.
    .where('status', 'in', ['received', 'closed'])
    .orderBy('received_at', 'desc')
    .limit(limit)
    .execute()

  return rows.map((row) => {
    const raw = row.received_at
    const receivedAt = raw instanceof Date ? raw.toISOString() : raw ? String(raw) : null
    return { id: String(row.id), number: row.number ?? null, receivedAt }
  })
}
