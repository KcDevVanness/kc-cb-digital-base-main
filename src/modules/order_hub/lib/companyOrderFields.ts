import type { EntityManager } from '@mikro-orm/postgresql'
import type { Kysely } from 'kysely'
import { loadCollaboratorCompanyOrderIds } from './collaborators'
import { derivePaymentState } from '../../purchasing/lib/orderTotals'
import { sumAmounts } from '../../trade_docs/lib/money'
import { COMPANY_ORDER_DOCUMENT_SLOTS, type CompanyOrderDocumentSlot } from '../data/validators'

/** `$in []` is not a disjunct the planners accept; "nothing" is one impossible id. */
const NO_MATCH_ID = '00000000-0000-0000-0000-000000000000'

/** The two installed attachment owners a purchase child's money documentation is filed under. */
const PURCHASE_ORDER_ENTITY = 'purchasing:purchase_order'
const PURCHASE_PAYMENT_ENTITY = 'purchasing:purchase_payment'

/** The collection document that is the 涉外收入证明. */
const FOREIGN_INCOME_CERTIFICATE = 'foreign_income_certificate'

/** The trade-docs document whose number is the deal's `INV.NO`. */
const COMMERCIAL_DOCUMENT_KIND = 'commercial'

const SALES_KINDS = new Set(['internal_sales_order', 'external_sales_order'])

/**
 * The child-source signals of a slot: where else (besides this order's own upload) the file a 35-
 * column field is about can live. The projection reads the signal from the child that owns it and
 * the UI shows it as a read-only badge with a deep link — the child's fact is never copied over.
 */
export type CompanyOrderDocumentSourceKind = 'contract' | 'shipment' | 'collection' | 'purchasing'

/** One child-derived source of a slot's document, as the summary reports it. */
export type CompanyOrderDocumentSlotSource = {
  source: CompanyOrderDocumentSourceKind
  /** The source artifact's number (`SC-…`/`CD-…`), or `''` when it carries none. */
  label: string
  /** How many child rows carry the signal (documents of one type, stamped contracts, …). */
  count?: number
}

/** One file filed on the order itself under a slot (REQ-020), with its frozen name. */
export type CompanyOrderDocumentSlotFile = {
  attachmentId: string
  fileName: string
  /** ISO-8601 registration timestamp. */
  createdAt: string
}

/** One named slot of the deal's documents: the order's own files plus the children's signals. */
export type CompanyOrderDocumentSlotGroup = {
  slot: CompanyOrderDocumentSlot
  files: CompanyOrderDocumentSlotFile[]
  childSources: CompanyOrderDocumentSlotSource[]
}

/**
 * The `cross_border` export-document types that line up with a named slot. `so` and `other` have no
 * slot (they are not one of the 35 columns), so their rows never become a source. The values mirror
 * `EXPORT_DOC_TYPES`; declared locally because a cross-module projection reads facts, not modules.
 */
const EXPORT_DOC_SLOT_BY_TYPE: Partial<Record<string, CompanyOrderDocumentSlot>> = {
  commercial_invoice: 'commercial_invoice',
  packing_list: 'packing_list',
  bill_of_lading: 'bill_of_lading',
  telex_release: 'telex_release',
  customs_declaration: 'customs_declaration',
  domestic_freight_receipt: 'domestic_freight_receipt',
  booking_charges_receipt: 'booking_charges_receipt',
}

/**
 * The 35-field summary of one company order (REQ-017), read as a scoped cross-module projection —
 * the same technique as `orderStages.ts`: the root and its links come from this module, every peer
 * is a scoped, batched read over the owner module's own table, and nothing here writes.
 *
 * Money is grouped by currency and never summed across currencies (`¥` and `$` are different money
 * for this projection); amounts travel as decimal strings, summed through the shared BigInt engine
 * so a cent is never lost. An id outside the caller's visible root set produces `null` — the caller
 * renders an empty object, never a leak.
 *
 * The columns are declared locally because a cross-module read is a projection, not an entity
 * dependency; the handle is cast once because MikroORM types `getKysely()`'s DB generic as `never`
 * (see lesson `.ai/lessons/kysely-bare-handle-types-tables-away.md`).
 */
type CompanyOrderFieldsTables = {
  order_hub_company_orders: {
    id: string
    tenant_id: string
    organization_id: string
    number: string
    title: string | null
    status: string
    order_date: Date | string
    eta_date: Date | string | null
    deleted_at: Date | null
  }
  order_hub_company_order_links: {
    company_order_id: string
    kind: string
    ref_id: string
    ref_number: string | null
    tenant_id: string
    organization_id: string
  }
  order_hub_company_order_documents: {
    id: string
    company_order_id: string
    slot: string
    attachment_id: string
    file_name: string
    created_at: Date | string
    tenant_id: string
    organization_id: string
  }
  sales_orders: {
    id: string
    tenant_id: string
    organization_id: string
    currency_code: string
    grand_total_gross_amount: string
    deleted_at: Date | null
  }
  purchasing_purchase_orders: {
    id: string
    tenant_id: string
    organization_id: string
    currency_code: string
    total: string
    deposit_amount: string | null
    deleted_at: Date | null
  }
  purchasing_purchase_payments: {
    id: string
    tenant_id: string
    organization_id: string
    order_id: string
    stage: string
    amount: string
    currency_code: string
  }
  trade_docs_order_documents: {
    order_id: string
    document_kind: string
    document_id: string
    tenant_id: string
    organization_id: string
  }
  trade_docs_contract_orders: {
    contract_id: string
    order_id: string
    tenant_id: string
    organization_id: string
  }
  trade_docs_contracts: {
    id: string
    number: string | null
    attachment_id: string | null
    tenant_id: string
    organization_id: string
    deleted_at: Date | null
  }
  trade_docs_documents: {
    id: string
    kind: string
    number: string | null
    contract_id: string | null
    tenant_id: string
    organization_id: string
    deleted_at: Date | null
  }
  trade_docs_invoices: {
    id: string
    number: string | null
    our_number: string | null
    contract_id: string | null
    tenant_id: string
    organization_id: string
    deleted_at: Date | null
  }
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
  cross_border_shipments: {
    id: string
    departed_at: Date | null
    tenant_id: string
    organization_id: string
    deleted_at: Date | null
  }
  cross_border_shipment_milestones: {
    shipment_id: string
    milestone: string
    occurred_at: Date
    tenant_id: string
    organization_id: string
  }
  cross_border_export_documents: {
    id: string
    shipment_id: string
    doc_type: string
    document_number: string | null
    attachment_id: string | null
    created_at: Date
    tenant_id: string
    organization_id: string
    deleted_at: Date | null
  }
  export_finance_collections: {
    id: string
    purchase_order_id: string
    collection_status: string
    tenant_id: string
    organization_id: string
    deleted_at: Date | null
  }
  export_finance_collection_documents: {
    collection_id: string
    doc_type: string
    tenant_id: string
    organization_id: string
    deleted_at: Date | null
  }
  export_finance_refunds: {
    id: string
    shipment_id: string
    tax_refund_status: string
    tax_refund_amount: string | null
    currency_code: string
    tenant_id: string
    organization_id: string
    deleted_at: Date | null
  }
  attachments: {
    id: string
    entity_id: string
    record_id: string
    tenant_id: string | null
    organization_id: string | null
  }
}

type ReadDb = Kysely<CompanyOrderFieldsTables>

const readDb = (em: EntityManager): ReadDb =>
  em.fork().getKysely() as unknown as ReadDb

export type OrderFieldsScope = {
  tenantId: string
  organizationIds: readonly string[]
}

/** One currency's slice of the deal: nothing here is ever added to another currency's slice. */
export type CompanyOrderCurrencyAmounts = {
  currencyCode: string
  /** Σ sales children's `grand_total_gross_amount`. */
  sales: string
  /** Σ purchase children's `total`. */
  purchase: string
  /** Σ purchase children's `deposit_amount`. */
  deposit: string
  /** Σ purchase payments (the purchasing module's own paid caliber). */
  paid: string
  /** Σ purchase children's `total − paid`, clamped at zero. */
  outstanding: string
}

export type CompanyOrderDocumentGroup = {
  /** `proforma` | `commercial` | `tax_invoice`. */
  kind: string
  numbers: string[]
}

export type CompanyOrderExportDocumentGroup = {
  docType: string
  count: number
  /** The newest row's number, or `null` when the newest row carries none. */
  latestNumber: string | null
  /** Whether the newest row has a filed scan. */
  latestHasAttachment: boolean
}

export type CompanyOrderFields = {
  order: {
    number: string | null
    title: string | null
    status: string | null
    orderDate: string | null
    etaDate: string | null
    childNumbers: string[]
  }
  amounts: CompanyOrderCurrencyAmounts[]
  dates: {
    orderedAt: string | null
    expectedDeliveryAt: string | null
    /** Earliest linked shipment's departure, else the newest milestone it recorded. */
    shippedAt: string | null
  }
  documents: {
    byKind: CompanyOrderDocumentGroup[]
    /** The `commercial` numbers — the deal's `INV.NO`. */
    invoiceNumbers: string[]
    /**
     * The named slots (REQ-023): every slot of `COMPANY_ORDER_DOCUMENT_SLOTS`, in enum order, with
     * the files this order holds for it and the child-derived signal of the same kind. Always one
     * entry per slot so the hub can render its upload rows deterministically.
     */
    bySlot: CompanyOrderDocumentSlotGroup[]
  }
  exportDocuments: CompanyOrderExportDocumentGroup[]
  purchaseFiles: {
    /** Attachment rows on the linked purchase orders and their payment rows. */
    attachmentCount: number
  }
  collections: Array<{ status: string; hasForeignIncomeCertificate: boolean }>
  refunds: Array<{ currencyCode: string; status: string; amount: string | null }>
  /** Any linked contract carries a stamped scan (`attachment_id`). */
  kcStamp: boolean
}

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

/** A `date` column rendered `YYYY-MM-DD` in the frame it was written in. */
function toDateString(value: Date | string | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  return String(value).slice(0, 10)
}

/** A timestamp column rendered ISO-8601; a bare string passes through. */
function toIsoTimestamp(value: Date | string | null | undefined): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : String(value)
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * The currency-grouped amount slice of a batch of company orders, from the linked sales and
 * purchase children. Shared by the fields projection and the workbench's `stages` addition so both
 * read the money exactly once and with one caliber.
 *
 * `salesIdToCompany` / `purchaseIdToCompany` are the link-derived child→root maps (a child may serve
 * more than one root). Every read carries tenant, organization set and soft-delete scope.
 */
export async function loadLinkedCurrencyAmounts(
  em: EntityManager,
  scope: OrderFieldsScope,
  salesIdToCompany: Map<string, Set<string>>,
  purchaseIdToCompany: Map<string, Set<string>>,
): Promise<Map<string, CompanyOrderCurrencyAmounts[]>> {
  const out = new Map<string, CompanyOrderCurrencyAmounts[]>()
  if (!scope.tenantId || scope.organizationIds.length === 0) return out
  const db = readDb(em)
  const tenantId = scope.tenantId
  const organizationIds = [...scope.organizationIds]

  const salesIds = distinctIds([...salesIdToCompany.keys()])
  const purchaseIds = distinctIds([...purchaseIdToCompany.keys()])

  // currencyCode → the values that still have to be summed, per root.
  type Bucket = {
    sales: Map<string, string[]>
    purchase: Map<string, string[]>
    deposit: Map<string, string[]>
    paid: Map<string, string[]>
    outstanding: Map<string, string[]>
  }
  const buckets = new Map<string, Bucket>()
  const bucketFor = (companyOrderId: string): Bucket => {
    const existing = buckets.get(companyOrderId)
    if (existing) return existing
    const created: Bucket = { sales: new Map(), purchase: new Map(), deposit: new Map(), paid: new Map(), outstanding: new Map() }
    buckets.set(companyOrderId, created)
    return created
  }
  const push = (target: Map<string, string[]>, currency: string, value: string) => {
    const list = target.get(currency)
    if (list) list.push(value)
    else target.set(currency, [value])
  }

  if (salesIds.length > 0) {
    const rows = (await db
      .selectFrom('sales_orders')
      .select(['id', 'currency_code', 'grand_total_gross_amount'])
      .where('id', 'in', salesIds)
      .where('tenant_id', '=', tenantId)
      .where('organization_id', 'in', organizationIds)
      .where('deleted_at', 'is', null)
      .execute()) as Array<{ id: string; currency_code: string; grand_total_gross_amount: string }>
    for (const row of rows) {
      const currency = row.currency_code || 'CNY'
      for (const companyOrderId of salesIdToCompany.get(String(row.id)) ?? []) {
        push(bucketFor(companyOrderId).sales, currency, String(row.grand_total_gross_amount))
      }
    }
  }

  const purchaseCurrency = new Map<string, string>()
  const purchaseTotal = new Map<string, string>()
  if (purchaseIds.length > 0) {
    const rows = (await db
      .selectFrom('purchasing_purchase_orders')
      .select(['id', 'currency_code', 'total', 'deposit_amount'])
      .where('id', 'in', purchaseIds)
      .where('tenant_id', '=', tenantId)
      .where('organization_id', 'in', organizationIds)
      .where('deleted_at', 'is', null)
      .execute()) as Array<{ id: string; currency_code: string; total: string; deposit_amount: string | null }>
    for (const row of rows) {
      const purchaseOrderId = String(row.id)
      const currency = row.currency_code || 'CNY'
      purchaseCurrency.set(purchaseOrderId, currency)
      purchaseTotal.set(purchaseOrderId, String(row.total))
      for (const companyOrderId of purchaseIdToCompany.get(purchaseOrderId) ?? []) {
        const bucket = bucketFor(companyOrderId)
        push(bucket.purchase, currency, String(row.total))
        push(bucket.deposit, currency, row.deposit_amount === null ? '0.00' : String(row.deposit_amount))
      }
    }
  }

  if (purchaseIds.length > 0) {
    const rows = (await db
      .selectFrom('purchasing_purchase_payments')
      .select(['order_id', 'stage', 'amount'])
      .where('order_id', 'in', purchaseIds)
      .where('tenant_id', '=', tenantId)
      .where('organization_id', 'in', organizationIds)
      .execute()) as Array<{ order_id: string; stage: string; amount: string }>
    const paymentsByOrder = new Map<string, Array<{ stage: string; amount: string }>>()
    for (const row of rows) {
      const orderId = String(row.order_id)
      const list = paymentsByOrder.get(orderId)
      const payment = { stage: String(row.stage), amount: String(row.amount) }
      if (list) list.push(payment)
      else paymentsByOrder.set(orderId, [payment])
    }
    for (const [orderId, payments] of paymentsByOrder) {
      const currency = purchaseCurrency.get(orderId) ?? 'CNY'
      const state = derivePaymentState(purchaseTotal.get(orderId) ?? '0.00', payments)
      for (const companyOrderId of purchaseIdToCompany.get(orderId) ?? []) {
        const bucket = bucketFor(companyOrderId)
        push(bucket.paid, currency, state.paidTotal)
        push(bucket.outstanding, currency, state.outstanding)
      }
    }
  }

  const sum = (values: string[] | undefined): string => (values && values.length > 0 ? sumAmounts(values) : '0.00')
  for (const [companyOrderId, bucket] of buckets) {
    const currencies = [...new Set([
      ...bucket.sales.keys(),
      ...bucket.purchase.keys(),
      ...bucket.deposit.keys(),
      ...bucket.paid.keys(),
      ...bucket.outstanding.keys(),
    ])].sort(compareStrings)
    out.set(
      companyOrderId,
      currencies.map((currencyCode) => ({
        currencyCode,
        sales: sum(bucket.sales.get(currencyCode)),
        purchase: sum(bucket.purchase.get(currencyCode)),
        deposit: sum(bucket.deposit.get(currencyCode)),
        paid: sum(bucket.paid.get(currencyCode)),
        outstanding: sum(bucket.outstanding.get(currencyCode)),
      })),
    )
  }
  return out
}

/**
 * The full 35-field summary of one company order, or `null` when the root is not visible to the
 * caller's organizations (the route answers an empty object rather than a leak).
 */
export async function loadCompanyOrderFields(
  em: EntityManager,
  scope: OrderFieldsScope,
  companyOrderId: string,
): Promise<CompanyOrderFields | null> {
  if (!companyOrderId) return null
  if (!scope.tenantId || scope.organizationIds.length === 0) return null
  const db = readDb(em)
  const tenantId = scope.tenantId
  const organizationIds = [...scope.organizationIds]

  const collaboratorRootIds = await loadCollaboratorCompanyOrderIds(em, tenantId, organizationIds)
  const collaboratorIds = collaboratorRootIds.length > 0 ? collaboratorRootIds : [NO_MATCH_ID]

  const root = (await db
    .selectFrom('order_hub_company_orders')
    .select(['id', 'organization_id', 'number', 'title', 'status', 'order_date', 'eta_date'])
    .where('id', '=', companyOrderId)
    .where('tenant_id', '=', tenantId)
    .where('deleted_at', 'is', null)
    .where((eb) => eb.or([
      eb('organization_id', 'in', organizationIds),
      eb('id', 'in', collaboratorIds),
    ]))
    .executeTakeFirst()) as
    | { id: string; organization_id: string; number: string; title: string | null; status: string; order_date: Date | string; eta_date: Date | string | null }
    | undefined
  if (!root) return null

  // A collaborator's root is owned by another organization: the child reads still filter by
  // organization (defence in depth), so they run with the owner's organization added.
  const childOrganizationIds = Array.from(new Set([...organizationIds, String(root.organization_id)]))

  const linkRows = (await db
    .selectFrom('order_hub_company_order_links')
    .select(['kind', 'ref_id', 'ref_number'])
    .where('company_order_id', '=', companyOrderId)
    .where('tenant_id', '=', tenantId)
    .where('organization_id', 'in', childOrganizationIds)
    .execute()) as Array<{ kind: string; ref_id: string; ref_number: string | null }>

  const salesIdToCompany = new Map<string, Set<string>>()
  const purchaseIdToCompany = new Map<string, Set<string>>()
  const childNumbers: string[] = []
  for (const row of linkRows) {
    const refId = String(row.ref_id)
    if (SALES_KINDS.has(String(row.kind))) addToSet(salesIdToCompany, refId, companyOrderId)
    else addToSet(purchaseIdToCompany, refId, companyOrderId)
    if (row.ref_number) childNumbers.push(String(row.ref_number))
  }

  const salesIds = distinctIds([...salesIdToCompany.keys()])
  const purchaseIds = distinctIds([...purchaseIdToCompany.keys()])
  const allChildIds = distinctIds([...salesIds, ...purchaseIds])

  const amountsByCompany = await loadLinkedCurrencyAmounts(
    em,
    { tenantId, organizationIds: childOrganizationIds },
    salesIdToCompany,
    purchaseIdToCompany,
  )

  // Shipments serving any linked child: sales allocations and purchase allocations, deduped.
  const shipmentIds = new Set<string>()
  if (salesIds.length > 0) {
    const rows = (await db
      .selectFrom('cross_border_shipment_sales_allocations as a')
      .innerJoin('cross_border_shipments as s', 's.id', 'a.shipment_id')
      .select(['a.shipment_id as shipment_id'])
      .where('a.sales_order_id', 'in', salesIds)
      .where('a.tenant_id', '=', tenantId)
      .where('a.organization_id', 'in', childOrganizationIds)
      .where('s.deleted_at', 'is', null)
      .execute()) as Array<{ shipment_id: string }>
    for (const row of rows) shipmentIds.add(String(row.shipment_id))
  }
  if (purchaseIds.length > 0) {
    const rows = (await db
      .selectFrom('cross_border_shipment_allocations as a')
      .innerJoin('cross_border_shipments as s', 's.id', 'a.shipment_id')
      .select(['a.shipment_id as shipment_id'])
      .where('a.purchase_order_id', 'in', purchaseIds)
      .where('a.tenant_id', '=', tenantId)
      .where('a.organization_id', 'in', childOrganizationIds)
      .where('s.deleted_at', 'is', null)
      .execute()) as Array<{ shipment_id: string }>
    for (const row of rows) shipmentIds.add(String(row.shipment_id))
  }
  const allShipmentIds = [...shipmentIds]

  // Dates: the earliest departure wins; without one, the newest milestone the shipments recorded.
  let shippedAt: string | null = null
  if (allShipmentIds.length > 0) {
    const shipmentRows = (await db
      .selectFrom('cross_border_shipments')
      .select(['id', 'departed_at'])
      .where('id', 'in', allShipmentIds)
      .where('tenant_id', '=', tenantId)
      .where('organization_id', 'in', childOrganizationIds)
      .where('deleted_at', 'is', null)
      .execute()) as Array<{ id: string; departed_at: Date | null }>
    let earliest: Date | null = null
    for (const row of shipmentRows) {
      if (!row.departed_at) continue
      const at = row.departed_at instanceof Date ? row.departed_at : new Date(row.departed_at)
      if (!earliest || at.getTime() < earliest.getTime()) earliest = at
    }
    if (earliest) {
      shippedAt = earliest.toISOString()
    } else {
      const milestoneRows = (await db
        .selectFrom('cross_border_shipment_milestones')
        .select(['occurred_at'])
        .where('shipment_id', 'in', allShipmentIds)
        .where('tenant_id', '=', tenantId)
        .where('organization_id', 'in', childOrganizationIds)
        .execute()) as Array<{ occurred_at: Date }>
      let latest: Date | null = null
      for (const row of milestoneRows) {
        const at = row.occurred_at instanceof Date ? row.occurred_at : new Date(row.occurred_at)
        if (!latest || at.getTime() > latest.getTime()) latest = at
      }
      if (latest) shippedAt = latest.toISOString()
    }
  }

  // Documents: the children's own order-document links, then their contracts' PI/CI and tax invoices.
  const byKind = new Map<string, Set<string>>()
  const contractIds = new Set<string>()
  if (allChildIds.length > 0) {
    const rows = (await db
      .selectFrom('trade_docs_contract_orders')
      .select(['contract_id'])
      .where('order_id', 'in', allChildIds)
      .where('tenant_id', '=', tenantId)
      .where('organization_id', 'in', childOrganizationIds)
      .execute()) as Array<{ contract_id: string }>
    for (const row of rows) contractIds.add(String(row.contract_id))
  }
  const allContractIds = [...contractIds]

  let kcStamp = false
  const stampedContractNumbers: string[] = []
  if (allContractIds.length > 0) {
    const contractRows = (await db
      .selectFrom('trade_docs_contracts')
      .select(['id', 'number', 'attachment_id'])
      .where('id', 'in', allContractIds)
      .where('tenant_id', '=', tenantId)
      .where('organization_id', 'in', childOrganizationIds)
      .where('deleted_at', 'is', null)
      .execute()) as Array<{ id: string; number: string | null; attachment_id: string | null }>
    for (const row of contractRows) {
      if (!row.attachment_id) continue
      kcStamp = true
      if (row.number) stampedContractNumbers.push(String(row.number))
    }
  }

  if (allChildIds.length > 0) {
    const linkRowsForDocs = (await db
      .selectFrom('trade_docs_order_documents')
      .select(['document_kind', 'document_id'])
      .where('order_id', 'in', allChildIds)
      .where('tenant_id', '=', tenantId)
      .where('organization_id', 'in', childOrganizationIds)
      .execute()) as Array<{ document_kind: string; document_id: string }>
    const documentIds = new Set<string>()
    const invoiceIds = new Set<string>()
    for (const row of linkRowsForDocs) {
      if (String(row.document_kind) === 'tax_invoice') invoiceIds.add(String(row.document_id))
      else documentIds.add(String(row.document_id))
    }
    if (documentIds.size > 0) {
      const rows = (await db
        .selectFrom('trade_docs_documents')
        .select(['kind', 'number'])
        .where('id', 'in', [...documentIds])
        .where('tenant_id', '=', tenantId)
        .where('organization_id', 'in', childOrganizationIds)
        .where('deleted_at', 'is', null)
        .execute()) as Array<{ kind: string; number: string | null }>
      for (const row of rows) if (row.number) addToSet(byKind, String(row.kind), String(row.number))
    }
    if (invoiceIds.size > 0) {
      const rows = (await db
        .selectFrom('trade_docs_invoices')
        .select(['number', 'our_number'])
        .where('id', 'in', [...invoiceIds])
        .where('tenant_id', '=', tenantId)
        .where('organization_id', 'in', childOrganizationIds)
        .where('deleted_at', 'is', null)
        .execute()) as Array<{ number: string | null; our_number: string | null }>
      for (const row of rows) {
        const number = row.number ?? row.our_number
        if (number) addToSet(byKind, 'tax_invoice', String(number))
      }
    }
  }

  if (allContractIds.length > 0) {
    const rows = (await db
      .selectFrom('trade_docs_documents')
      .select(['kind', 'number'])
      .where('contract_id', 'in', allContractIds)
      .where('tenant_id', '=', tenantId)
      .where('organization_id', 'in', childOrganizationIds)
      .where('deleted_at', 'is', null)
      .execute()) as Array<{ kind: string; number: string | null }>
    for (const row of rows) if (row.number) addToSet(byKind, String(row.kind), String(row.number))

    const invoiceRows = (await db
      .selectFrom('trade_docs_invoices')
      .select(['number', 'our_number'])
      .where('contract_id', 'in', allContractIds)
      .where('tenant_id', '=', tenantId)
      .where('organization_id', 'in', childOrganizationIds)
      .where('deleted_at', 'is', null)
      .execute()) as Array<{ number: string | null; our_number: string | null }>
    for (const row of invoiceRows) {
      const number = row.number ?? row.our_number
      if (number) addToSet(byKind, 'tax_invoice', String(number))
    }
  }

  const documentsByKind = [...byKind.entries()]
    .map(([kind, numbers]) => ({ kind, numbers: [...numbers].sort(compareStrings) }))
    .sort((left, right) => compareStrings(left.kind, right.kind))
  const invoiceNumbers = byKind.get(COMMERCIAL_DOCUMENT_KIND)
    ? [...(byKind.get(COMMERCIAL_DOCUMENT_KIND) as Set<string>)].sort(compareStrings)
    : []

  // Export documents by type: count, and the newest row's number / scan presence.
  const exportDocuments: CompanyOrderExportDocumentGroup[] = []
  if (allShipmentIds.length > 0) {
    const rows = (await db
      .selectFrom('cross_border_export_documents')
      .select(['doc_type', 'document_number', 'attachment_id', 'created_at'])
      .where('shipment_id', 'in', allShipmentIds)
      .where('tenant_id', '=', tenantId)
      .where('organization_id', 'in', childOrganizationIds)
      .where('deleted_at', 'is', null)
      .execute()) as Array<{ doc_type: string; document_number: string | null; attachment_id: string | null; created_at: Date }>
    const groups = new Map<string, { count: number; latest: { number: string | null; hasAttachment: boolean; at: number } }>()
    for (const row of rows) {
      const docType = String(row.doc_type)
      const at = row.created_at instanceof Date ? row.created_at.getTime() : new Date(row.created_at).getTime()
      const existing = groups.get(docType)
      if (!existing) {
        groups.set(docType, { count: 1, latest: { number: row.document_number, hasAttachment: row.attachment_id != null, at } })
        continue
      }
      existing.count += 1
      if (at >= existing.latest.at) {
        existing.latest = { number: row.document_number, hasAttachment: row.attachment_id != null, at }
      }
    }
    for (const [docType, group] of [...groups.entries()].sort((left, right) => compareStrings(left[0], right[0]))) {
      exportDocuments.push({
        docType,
        count: group.count,
        latestNumber: group.latest.number,
        latestHasAttachment: group.latest.hasAttachment,
      })
    }
  }

  // Purchase files: attachment rows on the linked purchase orders and their payments.
  let attachmentCount = 0
  const paymentIds: string[] = []
  if (purchaseIds.length > 0) {
    const rows = (await db
      .selectFrom('purchasing_purchase_payments')
      .select(['id'])
      .where('order_id', 'in', purchaseIds)
      .where('tenant_id', '=', tenantId)
      .where('organization_id', 'in', childOrganizationIds)
      .execute()) as Array<{ id: string }>
    for (const row of rows) paymentIds.push(String(row.id))
  }
  if (purchaseIds.length > 0 || paymentIds.length > 0) {
    const rows = (await db
      .selectFrom('attachments')
      .select(['id'])
      .where('tenant_id', '=', tenantId)
      .where((eb) => eb.or([
        purchaseIds.length > 0
          ? eb.and([eb('entity_id', '=', PURCHASE_ORDER_ENTITY), eb('record_id', 'in', purchaseIds)])
          : eb('id', '=', NO_MATCH_ID),
        paymentIds.length > 0
          ? eb.and([eb('entity_id', '=', PURCHASE_PAYMENT_ENTITY), eb('record_id', 'in', paymentIds)])
          : eb('id', '=', NO_MATCH_ID),
      ]))
      .execute()) as Array<{ id: string }>
    attachmentCount = rows.length
  }

  // Collections: one archive per linked purchase order, plus whether the 涉外收入证明 is filed.
  const collections: CompanyOrderFields['collections'] = []
  let foreignIncomeCertificateCount = 0
  if (purchaseIds.length > 0) {
    const rows = (await db
      .selectFrom('export_finance_collections')
      .select(['id', 'collection_status'])
      .where('purchase_order_id', 'in', purchaseIds)
      .where('tenant_id', '=', tenantId)
      .where('organization_id', 'in', childOrganizationIds)
      .where('deleted_at', 'is', null)
      .execute()) as Array<{ id: string; collection_status: string }>
    const collectionIds = rows.map((row) => String(row.id))
    const certificate = new Set<string>()
    if (collectionIds.length > 0) {
      const documentRows = (await db
        .selectFrom('export_finance_collection_documents')
        .select(['collection_id'])
        .where('collection_id', 'in', collectionIds)
        .where('doc_type', '=', FOREIGN_INCOME_CERTIFICATE)
        .where('tenant_id', '=', tenantId)
        .where('organization_id', 'in', childOrganizationIds)
        .where('deleted_at', 'is', null)
        .execute()) as Array<{ collection_id: string }>
      foreignIncomeCertificateCount = documentRows.length
      for (const row of documentRows) certificate.add(String(row.collection_id))
    }
    for (const row of rows) {
      collections.push({
        status: String(row.collection_status),
        hasForeignIncomeCertificate: certificate.has(String(row.id)),
      })
    }
  }

  // Refunds: one archive per linked shipment, with its amount grouped by currency.
  const refunds: CompanyOrderFields['refunds'] = []
  if (allShipmentIds.length > 0) {
    const rows = (await db
      .selectFrom('export_finance_refunds')
      .select(['tax_refund_status', 'tax_refund_amount', 'currency_code'])
      .where('shipment_id', 'in', allShipmentIds)
      .where('tenant_id', '=', tenantId)
      .where('organization_id', 'in', childOrganizationIds)
      .where('deleted_at', 'is', null)
      .execute()) as Array<{ tax_refund_status: string; tax_refund_amount: string | null; currency_code: string }>
    for (const row of rows) {
      refunds.push({
        currencyCode: row.currency_code || 'CNY',
        status: String(row.tax_refund_status),
        amount: row.tax_refund_amount === null ? null : String(row.tax_refund_amount),
      })
    }
  }

  // Named document slots (REQ-023): the order's own files plus the child-derived signals the reads
  // above already established, grouped by slot. No second read of any child — a slot's `childSources`
  // is exactly the signal of the same kind, so the summary can never disagree with itself.
  const slotSources = new Map<CompanyOrderDocumentSlot, CompanyOrderDocumentSlotSource[]>()
  const addSlotSource = (slot: CompanyOrderDocumentSlot, source: CompanyOrderDocumentSlotSource): void => {
    const existing = slotSources.get(slot)
    if (existing) existing.push(source)
    else slotSources.set(slot, [source])
  }
  for (const group of exportDocuments) {
    const slot = EXPORT_DOC_SLOT_BY_TYPE[group.docType]
    if (slot) addSlotSource(slot, { source: 'shipment', label: group.latestNumber ?? '', count: group.count })
  }
  if (stampedContractNumbers.length > 0) {
    addSlotSource('kc_invoice_stamp', {
      source: 'contract',
      label: [...new Set(stampedContractNumbers)].sort(compareStrings).join(', '),
      count: stampedContractNumbers.length,
    })
  }
  if (foreignIncomeCertificateCount > 0) {
    addSlotSource('foreign_income_certificate', { source: 'collection', label: '', count: foreignIncomeCertificateCount })
  }
  if (attachmentCount > 0) {
    addSlotSource('purchase_slip_invoice', { source: 'purchasing', label: '', count: attachmentCount })
  }

  const slotFiles = new Map<string, CompanyOrderDocumentSlotFile[]>()
  const documentRows = (await db
    .selectFrom('order_hub_company_order_documents')
    .select(['slot', 'attachment_id', 'file_name', 'created_at'])
    .where('company_order_id', '=', companyOrderId)
    .where('tenant_id', '=', tenantId)
    .where('organization_id', 'in', childOrganizationIds)
    .orderBy('created_at', 'desc')
    .execute()) as Array<{ slot: string; attachment_id: string; file_name: string; created_at: Date | string }>
  for (const row of documentRows) {
    const slot = String(row.slot)
    const file: CompanyOrderDocumentSlotFile = {
      attachmentId: String(row.attachment_id),
      fileName: String(row.file_name),
      createdAt: toIsoTimestamp(row.created_at) ?? '',
    }
    const existing = slotFiles.get(slot)
    if (existing) existing.push(file)
    else slotFiles.set(slot, [file])
  }

  const bySlot: CompanyOrderDocumentSlotGroup[] = COMPANY_ORDER_DOCUMENT_SLOTS.map((slot) => ({
    slot,
    files: slotFiles.get(slot) ?? [],
    childSources: slotSources.get(slot) ?? [],
  }))

  return {
    order: {
      number: root.number ? String(root.number) : null,
      title: root.title ? String(root.title) : null,
      status: root.status ? String(root.status) : null,
      orderDate: toDateString(root.order_date),
      etaDate: toDateString(root.eta_date),
      childNumbers,
    },
    amounts: amountsByCompany.get(companyOrderId) ?? [],
    dates: {
      orderedAt: toDateString(root.order_date),
      expectedDeliveryAt: toDateString(root.eta_date),
      shippedAt,
    },
    documents: { byKind: documentsByKind, invoiceNumbers, bySlot },
    exportDocuments,
    purchaseFiles: { attachmentCount },
    collections,
    refunds,
    kcStamp,
  }
}
