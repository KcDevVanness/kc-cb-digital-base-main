import type { EntityManager } from '@mikro-orm/postgresql'
import type { Kysely } from 'kysely'

/**
 * The stage projection behind the order workbench: for a batch of **company orders**, how far each
 * one has been filled in — 采购 / 发运 / 单证 / 收汇·退税.
 *
 * A company order is a container: its stages are the union of its linked children's stages. The
 * per-stage caliber is unchanged from the previous (sales-order-keyed) projection; only the key is —
 * the union of linked children instead of one document's own relations. Every query carries the
 * caller's tenant and organization set and skips soft-deleted rows, so an id from another
 * organization produces no entry at all.
 *
 * Nothing here writes. The columns are declared locally because a cross-module read is a projection,
 * not an entity dependency; the handle is cast once because MikroORM types `getKysely()`'s DB generic
 * as `never` (see lesson `.ai/lessons/kysely-bare-handle-types-tables-away.md`).
 */
type CompanyOrderReadTables = {
  order_hub_company_orders: {
    id: string
    tenant_id: string
    organization_id: string
    deleted_at: Date | null
  }
  order_hub_company_order_collaborators: {
    company_order_id: string
    organization_id: string
    tenant_id: string
  }
  order_hub_company_order_links: {
    company_order_id: string
    kind: string
    ref_id: string
    ref_number: string | null
    ref_counterparty: string | null
    tenant_id: string
    organization_id: string
  }
  purchasing_purchase_orders: {
    id: string
    status: string | null
    tenant_id: string
    organization_id: string
    deleted_at: Date | null
  }
  cross_border_shipments: { id: string; deleted_at: Date | null }
  cross_border_shipment_sales_allocations: {
    shipment_id: string
    sales_order_id: string
    tenant_id: string
    organization_id: string
  }
  cross_border_shipment_allocations: {
    shipment_id: string
    purchase_order_id: string
    tenant_id: string
    organization_id: string
  }
  cross_border_export_documents: {
    id: string
    shipment_id: string
    tenant_id: string
    organization_id: string
    deleted_at: Date | null
  }
  trade_docs_contract_orders: {
    contract_id: string
    order_id: string
    tenant_id: string
    organization_id: string
  }
  trade_docs_documents: {
    id: string
    contract_id: string | null
    tenant_id: string
    organization_id: string
    deleted_at: Date | null
  }
  trade_docs_invoices: {
    id: string
    contract_id: string | null
    tenant_id: string
    organization_id: string
    deleted_at: Date | null
  }
  trade_docs_order_documents: {
    order_kind: string
    order_id: string
    document_kind: string
    document_id: string
    tenant_id: string
    organization_id: string
  }
  export_finance_collections: {
    purchase_order_id: string
    collection_status: string | null
    tenant_id: string
    organization_id: string
    deleted_at: Date | null
  }
  export_finance_refunds: {
    shipment_id: string
    tenant_id: string
    organization_id: string
    deleted_at: Date | null
  }
}

const readDb = (em: EntityManager): Kysely<CompanyOrderReadTables> =>
  em.fork().getKysely() as unknown as Kysely<CompanyOrderReadTables>

export type OrderStageSource = 'sales_order' | 'purchase_order'

export type CompanyOrderStageSummary = {
  id: string
  /** Derived: `sales_order` when the container has any sales child, else `purchase_order`. */
  source: OrderStageSource
  /** Linked purchase children that are not cancelled. */
  procurementCount: number
  /** Distinct shipments carrying goods from any linked child. */
  shipmentCount: number
  /** Distinct documents: sales children's own links + their contracts' PI/CI + child shipments' export docs. */
  documentCount: number
  /** Any linked purchase child has a received collection. */
  collected: boolean
  /** Any child shipment carries a tax-refund record. */
  refunded: boolean
  /** First sales child's frozen counterparty, else the first purchase child's. */
  counterparty: string | null
  /** The linked children's frozen numbers. */
  childNumbers: string[]
  /** The distinct child kinds present. */
  kinds: string[]
}

export type OrderStageScope = {
  tenantId: string
  organizationIds: readonly string[]
}

const PURCHASE_ORDER_CANCELLED = 'cancelled'
const COLLECTION_RECEIVED = 'received'
const SALES_KINDS = new Set(['internal_sales_order', 'external_sales_order'])

function addToSet<K>(map: Map<K, Set<string>>, key: K, value: string): void {
  const existing = map.get(key)
  if (existing) {
    existing.add(value)
    return
  }
  map.set(key, new Set([value]))
}

function distinctIds(values: readonly (string | null | undefined)[]): string[] {
  const out = new Set<string>()
  for (const value of values) if (value) out.add(value)
  return [...out]
}

type LinkRow = {
  company_order_id: string
  kind: string
  ref_id: string
  ref_number: string | null
  ref_counterparty: string | null
}

export async function loadCompanyOrderSummaries(
  em: EntityManager,
  scope: OrderStageScope,
  companyOrderIds: readonly string[],
): Promise<CompanyOrderStageSummary[]> {
  if (companyOrderIds.length === 0) return []
  if (!scope.tenantId || scope.organizationIds.length === 0) return []
  const db = readDb(em)
  const tenantId = scope.tenantId
  const organizationIds = [...scope.organizationIds]

  // Only company orders that exist in scope (and are not deleted) can have a summary entry. The
  // scope is the caller's own organization set **plus the roots its organizations collaborate on**
  // (REQ-016) — one module-local read of the collaborator table, the same predicate the workbench
  // list applies, so an id from an unrelated organization still produces no entry at all.
  const orderRows = (await db
    .selectFrom('order_hub_company_orders')
    .select(['id', 'organization_id'])
    .where('id', 'in', [...companyOrderIds])
    .where('tenant_id', '=', tenantId)
    .where('deleted_at', 'is', null)
    .where((eb) => eb.or([
      eb('organization_id', 'in', childOrganizationIds),
      eb(
        'id',
        'in',
        eb
          .selectFrom('order_hub_company_order_collaborators')
          .select('company_order_id')
          .where('tenant_id', '=', tenantId)
          .where('organization_id', 'in', childOrganizationIds),
      ),
    ]))
    .execute()) as Array<{ id: string; organization_id: string }>
  const visibleIds = orderRows.map((row) => String(row.id))
  if (visibleIds.length === 0) return []

  // A collaborator's root is owned by another organization: every projection below still filters by
  // organization (defence in depth), so it must run with the owners' organizations added — otherwise
  // the children of exactly the collaborator roots whose ids we just admitted would read empty.
  const childOrganizationIds = Array.from(
    new Set([...organizationIds, ...orderRows.map((row) => String(row.organization_id))]),
  )

  const linkRows = (await db
    .selectFrom('order_hub_company_order_links')
    .select(['company_order_id', 'kind', 'ref_id', 'ref_number', 'ref_counterparty'])
    .where('company_order_id', 'in', visibleIds)
    .where('tenant_id', '=', tenantId)
    .where('organization_id', 'in', childOrganizationIds)
    .execute()) as LinkRow[]

  const salesIdToCompany = new Map<string, Set<string>>()
  const purchaseIdToCompany = new Map<string, Set<string>>()
  const childNumbers = new Map<string, string[]>()
  const kinds = new Map<string, Set<string>>()
  // The row's counterparty prefers a sales child (the customer the deal is for) over a purchase
  // child (the supplier), independent of the order the links were created in — so the two kinds
  // are collected separately and merged below.
  const salesCounterparty = new Map<string, string>()
  const purchaseCounterparty = new Map<string, string>()
  const hasSales = new Set<string>()

  for (const row of linkRows) {
    const companyOrderId = String(row.company_order_id)
    const refId = String(row.ref_id)
    const isSales = SALES_KINDS.has(String(row.kind))
    if (isSales) {
      addToSet(salesIdToCompany, refId, companyOrderId)
      hasSales.add(companyOrderId)
    } else {
      addToSet(purchaseIdToCompany, refId, companyOrderId)
    }
    if (row.ref_number) {
      const list = childNumbers.get(companyOrderId) ?? []
      list.push(String(row.ref_number))
      childNumbers.set(companyOrderId, list)
    }
    addToSet(kinds, companyOrderId, String(row.kind))
    if (row.ref_counterparty) {
      const target = isSales ? salesCounterparty : purchaseCounterparty
      if (!target.has(companyOrderId)) target.set(companyOrderId, String(row.ref_counterparty))
    }
  }

  const counterparty = new Map<string, string>(purchaseCounterparty)
  for (const [companyOrderId, name] of salesCounterparty) counterparty.set(companyOrderId, name)

  const salesIds = distinctIds([...salesIdToCompany.keys()])
  const purchaseIds = distinctIds([...purchaseIdToCompany.keys()])
  const allChildIds = distinctIds([...salesIds, ...purchaseIds])

  const procurementCount = new Map<string, number>()
  if (purchaseIds.length > 0) {
    const rows = (await db
      .selectFrom('purchasing_purchase_orders')
      .select(['id', 'status'])
      .where('id', 'in', purchaseIds)
      .where('tenant_id', '=', tenantId)
      .where('organization_id', 'in', childOrganizationIds)
      .where('deleted_at', 'is', null)
      .execute()) as Array<{ id: string; status: string | null }>
    for (const row of rows) {
      if ((row.status ?? '') === PURCHASE_ORDER_CANCELLED) continue
      for (const companyOrderId of purchaseIdToCompany.get(String(row.id)) ?? []) {
        procurementCount.set(companyOrderId, (procurementCount.get(companyOrderId) ?? 0) + 1)
      }
    }
  }

  const shipmentsByCompany = new Map<string, Set<string>>()
  if (salesIds.length > 0) {
    const rows = (await db
      .selectFrom('cross_border_shipment_sales_allocations as a')
      .innerJoin('cross_border_shipments as s', 's.id', 'a.shipment_id')
      .select(['a.shipment_id as shipment_id', 'a.sales_order_id as order_id'])
      .where('a.sales_order_id', 'in', salesIds)
      .where('a.tenant_id', '=', tenantId)
      .where('a.organization_id', 'in', childOrganizationIds)
      .where('s.deleted_at', 'is', null)
      .execute()) as Array<{ shipment_id: string; order_id: string }>
    for (const row of rows) {
      for (const companyOrderId of salesIdToCompany.get(String(row.order_id)) ?? []) {
        addToSet(shipmentsByCompany, companyOrderId, String(row.shipment_id))
      }
    }
  }
  if (purchaseIds.length > 0) {
    const rows = (await db
      .selectFrom('cross_border_shipment_allocations as a')
      .innerJoin('cross_border_shipments as s', 's.id', 'a.shipment_id')
      .select(['a.shipment_id as shipment_id', 'a.purchase_order_id as order_id'])
      .where('a.purchase_order_id', 'in', purchaseIds)
      .where('a.tenant_id', '=', tenantId)
      .where('a.organization_id', 'in', childOrganizationIds)
      .where('s.deleted_at', 'is', null)
      .execute()) as Array<{ shipment_id: string; order_id: string }>
    for (const row of rows) {
      for (const companyOrderId of purchaseIdToCompany.get(String(row.order_id)) ?? []) {
        addToSet(shipmentsByCompany, companyOrderId, String(row.shipment_id))
      }
    }
  }
  const allShipmentIds = distinctIds([...shipmentsByCompany.values()].flatMap((set) => [...set]))
  const shipmentToCompany = new Map<string, Set<string>>()
  for (const [companyOrderId, set] of shipmentsByCompany) {
    for (const shipmentId of set) addToSet(shipmentToCompany, shipmentId, companyOrderId)
  }

  const documentsByCompany = new Map<string, Set<string>>()

  // Sales children's own document links.
  if (salesIds.length > 0) {
    const rows = (await db
      .selectFrom('trade_docs_order_documents')
      .select(['order_id', 'document_id'])
      .where('order_id', 'in', salesIds)
      .where('tenant_id', '=', tenantId)
      .where('organization_id', 'in', childOrganizationIds)
      .execute()) as Array<{ order_id: string; document_id: string }>
    for (const row of rows) {
      for (const companyOrderId of salesIdToCompany.get(String(row.order_id)) ?? []) {
        addToSet(documentsByCompany, companyOrderId, String(row.document_id))
      }
    }
  }

  // Contracts of the children, then the PI/CI those contracts carry.
  const contractsByCompany = new Map<string, Set<string>>()
  if (allChildIds.length > 0) {
    const rows = (await db
      .selectFrom('trade_docs_contract_orders')
      .select(['contract_id', 'order_id'])
      .where('order_id', 'in', allChildIds)
      .where('tenant_id', '=', tenantId)
      .where('organization_id', 'in', childOrganizationIds)
      .execute()) as Array<{ contract_id: string; order_id: string }>
    for (const row of rows) {
      const owners = new Set([
        ...(salesIdToCompany.get(String(row.order_id)) ?? []),
        ...(purchaseIdToCompany.get(String(row.order_id)) ?? []),
      ])
      for (const companyOrderId of owners) addToSet(contractsByCompany, companyOrderId, String(row.contract_id))
    }
  }
  const contractIds = distinctIds([...contractsByCompany.values()].flatMap((set) => [...set]))
  if (contractIds.length > 0) {
    const [documentRows, invoiceRows] = await Promise.all([
      db
        .selectFrom('trade_docs_documents')
        .select(['id', 'contract_id'])
        .where('contract_id', 'in', contractIds)
        .where('tenant_id', '=', tenantId)
        .where('organization_id', 'in', childOrganizationIds)
        .where('deleted_at', 'is', null)
        .execute() as Promise<Array<{ id: string; contract_id: string | null }>>,
      db
        .selectFrom('trade_docs_invoices')
        .select(['id', 'contract_id'])
        .where('contract_id', 'in', contractIds)
        .where('tenant_id', '=', tenantId)
        .where('organization_id', 'in', childOrganizationIds)
        .where('deleted_at', 'is', null)
        .execute() as Promise<Array<{ id: string; contract_id: string | null }>>,
    ])
    const contractToCompany = new Map<string, Set<string>>()
    for (const [companyOrderId, set] of contractsByCompany) {
      for (const contractId of set) addToSet(contractToCompany, contractId, companyOrderId)
    }
    for (const row of [...documentRows, ...invoiceRows]) {
      const contractId = row.contract_id ? String(row.contract_id) : null
      if (!contractId) continue
      for (const companyOrderId of contractToCompany.get(contractId) ?? []) {
        addToSet(documentsByCompany, companyOrderId, String(row.id))
      }
    }
  }

  // Export documents belong to a shipment: they count for the company orders that shipment serves.
  if (allShipmentIds.length > 0) {
    const rows = (await db
      .selectFrom('cross_border_export_documents')
      .select(['id', 'shipment_id'])
      .where('shipment_id', 'in', allShipmentIds)
      .where('tenant_id', '=', tenantId)
      .where('organization_id', 'in', childOrganizationIds)
      .where('deleted_at', 'is', null)
      .execute()) as Array<{ id: string; shipment_id: string }>
    for (const row of rows) {
      for (const companyOrderId of shipmentToCompany.get(String(row.shipment_id)) ?? []) {
        addToSet(documentsByCompany, companyOrderId, String(row.id))
      }
    }
  }

  const collectedCompanies = new Set<string>()
  if (purchaseIds.length > 0) {
    const rows = (await db
      .selectFrom('export_finance_collections')
      .select(['purchase_order_id', 'collection_status'])
      .where('purchase_order_id', 'in', purchaseIds)
      .where('tenant_id', '=', tenantId)
      .where('organization_id', 'in', childOrganizationIds)
      .where('deleted_at', 'is', null)
      .execute()) as Array<{ purchase_order_id: string; collection_status: string | null }>
    for (const row of rows) {
      if ((row.collection_status ?? '') !== COLLECTION_RECEIVED) continue
      for (const companyOrderId of purchaseIdToCompany.get(String(row.purchase_order_id)) ?? []) {
        collectedCompanies.add(companyOrderId)
      }
    }
  }

  const refundedCompanies = new Set<string>()
  if (allShipmentIds.length > 0) {
    const rows = (await db
      .selectFrom('export_finance_refunds')
      .select(['shipment_id'])
      .where('shipment_id', 'in', allShipmentIds)
      .where('tenant_id', '=', tenantId)
      .where('organization_id', 'in', childOrganizationIds)
      .where('deleted_at', 'is', null)
      .execute()) as Array<{ shipment_id: string }>
    for (const row of rows) {
      for (const companyOrderId of shipmentToCompany.get(String(row.shipment_id)) ?? []) {
        refundedCompanies.add(companyOrderId)
      }
    }
  }

  return visibleIds.map((id) => ({
    id,
    source: hasSales.has(id) ? 'sales_order' : 'purchase_order',
    procurementCount: procurementCount.get(id) ?? 0,
    shipmentCount: shipmentsByCompany.get(id)?.size ?? 0,
    documentCount: documentsByCompany.get(id)?.size ?? 0,
    collected: collectedCompanies.has(id),
    refunded: refundedCompanies.has(id),
    counterparty: counterparty.get(id) ?? null,
    childNumbers: childNumbers.get(id) ?? [],
    kinds: [...(kinds.get(id) ?? new Set<string>())],
  }))
}
