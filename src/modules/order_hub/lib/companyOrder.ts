import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { Kysely } from 'kysely'
import { randomUUID } from 'node:crypto'
import { SalesOrder } from '@open-mercato/core/modules/sales/data/entities'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CompanyOrder, CompanyOrderLink } from '../data/entities'
import { Party } from '../../parties/data/entities'
import {
  COMPANY_ORDER_LINK_KINDS,
  type CompanyOrderLinkKind,
} from '../data/validators'
import { nextCompanyOrderNumber, type CompanyOrderScope } from './companyOrderNumber'

export { COMPANY_ORDER_LINK_KINDS, type CompanyOrderLinkKind }
export type { CompanyOrderScope }

/**
 * A resolved child document: the peer's display facts, frozen when it is attached.
 *
 * The counterparty comes from the peer's own snapshot column (`customer_snapshot.name` for a sales
 * order, `supplier_snapshot.name` for a purchase order) — never recomputed here — so the label the
 * hub shows is the one the owning module printed.
 */
export type CompanyOrderRef = {
  kind: CompanyOrderLinkKind
  id: string
  number: string | null
  counterparty: string | null
  status: string | null
  createdAt: string | null
  currencyCode: string | null
  totalGross: string | null
}

const PURCHASE_ORDER_TABLE = 'purchasing_purchase_orders'

// `supplier_snapshot` is plaintext, so the purchase read is a scoped raw projection. The handle is
// cast once because MikroORM types `getKysely()`'s DB generic as `never`
// (lesson `.ai/lessons/kysely-bare-handle-types-tables-away.md`).
type PurchaseRefReadTables = {
  purchasing_purchase_orders: {
    id: string
    number: string | null
    status: string | null
    supplier_snapshot: unknown
    created_at: unknown
    currency_code: string | null
    total: string | null
    tenant_id: string
    organization_id: string
    deleted_at: Date | null
  }
}

/** Stable map key for one `(kind, refId)` cell; the command derives duplicates through it. */
export const linkKey = (kind: string, refId: string): string => `${kind}:${refId}`

/** The frozen snapshot stored on a link row: status, date, and the money header when present. */
export function freezeLinkSnapshot(ref: CompanyOrderRef): Record<string, unknown> {
  return {
    status: ref.status,
    createdAt: ref.createdAt,
    currencyCode: ref.currencyCode,
    totalGross: ref.totalGross,
  }
}

function snapshotName(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object' || !('name' in snapshot)) return null
  const name: unknown = snapshot.name
  return typeof name === 'string' && name.trim().length > 0 ? name : null
}

function toIso(value: unknown): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function toNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value)
  return text.length > 0 ? text : null
}

/** A resolved default counterparty: the scalar id plus what is frozen onto the root. */
export type CompanyOrderNameRef = {
  id: string
  name: string
  code: string | null
}

/** `{ name, code }` — the display snapshot frozen onto the root for a default customer/supplier. */
export function freezeNameSnapshot(ref: { name: string; code?: string | null }): Record<string, unknown> {
  return { name: ref.name, code: ref.code ?? null }
}

/** The supplier master's plaintext columns this module reads (no ORM relation to a peer module). */
type SupplierReadTables = {
  purchasing_suppliers: {
    id: string
    name: string | null
    code: string | null
    tenant_id: string
    organization_id: string
    deleted_at: Date | null
  }
}

/**
 * Resolves the optional default customer — a `parties` row — in the caller's scope, or `null` when
 * it is missing, soft-deleted or owned by another organization (the caller turns a requested-but-
 * unresolved id into a 422).
 *
 * `name` is an encrypted column (`parties/encryption.ts` covers the whole counterparty block), so
 * this reads through `findOneWithDecryption` on purpose: a raw projection would freeze **ciphertext**
 * as the display name. Unlike the peer-ref reads below, no ORM relation is created — this is a
 * typed scoped read.
 */
export async function resolveCompanyOrderParty(
  em: EntityManager,
  scope: CompanyOrderScope,
  partyId: string,
): Promise<CompanyOrderNameRef | null> {
  const party = await findOneWithDecryption(
    em.fork(),
    Party,
    {
      id: partyId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    } as FilterQuery<Party>,
    {},
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  if (!party) return null
  const name = typeof party.name === 'string' ? party.name.trim() : ''
  if (!name) return null
  return { id: String(party.id), name, code: party.code ? String(party.code) : null }
}

/**
 * Resolves the optional default supplier — a `purchasing_suppliers` row — in the caller's scope with
 * the same scoped raw read the purchase-order refs use (`name`/`code` are plaintext there, so no
 * decryption and no ORM relation are involved). `null` when absent or out of scope.
 */
export async function resolveCompanyOrderSupplier(
  em: EntityManager,
  scope: CompanyOrderScope,
  supplierId: string,
): Promise<CompanyOrderNameRef | null> {
  const table = 'purchasing_suppliers'
  const row = (await (em.fork().getKysely() as unknown as Kysely<SupplierReadTables>)
    .selectFrom(`${table} as s`)
    .select(['s.id as id', 's.name as name', 's.code as code'])
    .where('s.id', '=', supplierId)
    .where('s.tenant_id', '=', scope.tenantId)
    .where('s.organization_id', '=', scope.organizationId)
    .where('s.deleted_at', 'is', null)
    .executeTakeFirst()) as { id: string; name: string | null; code: string | null } | undefined
  if (!row) return null
  const name = typeof row.name === 'string' ? row.name.trim() : ''
  if (!name) return null
  return { id: String(row.id), name, code: toNullableString(row.code) }
}

/**
 * Resolves the requested `(kind, refId)` documents in the caller's scope.
 *
 * Purchase orders are read with a scoped raw query — `supplier_snapshot` is plaintext
 * (`purchasing/encryption.ts` covers only the bank account), so no decryption is involved. Sales
 * orders are read through `findWithDecryption` on purpose: the installed sales encryption map
 * covers `customer_snapshot` as a whole field, so a raw read would freeze **ciphertext** as the
 * counterparty. Do not "optimize" the sales read back to raw SQL.
 *
 * Ids outside the caller's scope are simply absent from the result; the caller turns a missing one
 * into a 422 rather than storing a dangling link.
 */
export async function loadCompanyOrderRefs(
  em: EntityManager,
  scope: CompanyOrderScope,
  entries: Array<{ kind: CompanyOrderLinkKind; refId: string }>,
): Promise<Map<string, CompanyOrderRef>> {
  const resolved = new Map<string, CompanyOrderRef>()

  const purchaseIds = Array.from(
    new Set(entries.filter((entry) => entry.kind === 'purchase_order').map((entry) => entry.refId)),
  )
  if (purchaseIds.length > 0) {
    const rows = (await (em.fork().getKysely() as unknown as Kysely<PurchaseRefReadTables>)
      .selectFrom(`${PURCHASE_ORDER_TABLE} as o`)
      .select([
        'o.id as id',
        'o.number as number',
        'o.status as status',
        'o.supplier_snapshot as counterparty_snapshot',
        'o.created_at as created_at',
        'o.currency_code as currency_code',
        'o.total as total',
      ])
      .where('o.id', 'in', purchaseIds)
      .where('o.tenant_id', '=', scope.tenantId)
      .where('o.organization_id', '=', scope.organizationId)
      .where('o.deleted_at', 'is', null)
      .execute()) as Array<{
        id: string
        number: string | null
        status: string | null
        counterparty_snapshot: unknown
        created_at: unknown
        currency_code: string | null
        total: string | null
      }>
    for (const row of rows) {
      resolved.set(linkKey('purchase_order', String(row.id)), {
        kind: 'purchase_order',
        id: String(row.id),
        number: row.number ?? null,
        counterparty: snapshotName(row.counterparty_snapshot),
        status: row.status ?? null,
        createdAt: toIso(row.created_at),
        currencyCode: row.currency_code ?? null,
        totalGross: toNullableString(row.total),
      })
    }
  }

  const salesEntries = entries.filter((entry) => entry.kind !== 'purchase_order')
  const salesIds = Array.from(new Set(salesEntries.map((entry) => entry.refId)))
  if (salesIds.length > 0) {
    // Encrypted `customer_snapshot`: read through the decryption helper with the scope, never raw.
    const orders = await findWithDecryption(
      em.fork(),
      SalesOrder,
      {
        id: { $in: salesIds },
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      } as FilterQuery<SalesOrder>,
      {},
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
    const byId = new Map(orders.map((order) => [String(order.id), order]))
    for (const entry of salesEntries) {
      const order = byId.get(entry.refId)
      if (!order) continue
      resolved.set(linkKey(entry.kind, entry.refId), {
        kind: entry.kind,
        id: String(order.id),
        number: order.orderNumber ?? null,
        counterparty: snapshotName(order.customerSnapshot),
        status: order.status ?? null,
        createdAt: toIso(order.createdAt),
        currencyCode: order.currencyCode ?? null,
        totalGross: toNullableString(order.grandTotalGrossAmount),
      })
    }
  }

  return resolved
}

/**
 * Reverse lookup: which company order holds each of these child documents.
 *
 * One scoped read of the links table; a ref that is not linked (or is outside the caller's
 * organization) is simply absent. Used by the legacy-URL resolution and the backfill CLI.
 */
export async function resolveCompanyOrderIdsForRefs(
  em: EntityManager,
  scope: CompanyOrderScope,
  kind: CompanyOrderLinkKind,
  refIds: readonly string[],
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(refIds))
  const result = new Map<string, string>()
  if (unique.length === 0) return result
  const links = await em.fork().find(
    CompanyOrderLink,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      kind,
      refId: { $in: unique },
    } as FilterQuery<CompanyOrderLink>,
  )
  for (const link of links) {
    const refId = String(link.refId)
    if (!result.has(refId)) result.set(refId, String(link.companyOrder.id))
  }
  return result
}

/**
 * The purchase orders currently attached to one root — the tenth round's **mirror recipients** when
 * the root's `订单描述` / `采购负责人` change. Read by the `companyOrder` relation inside the
 * caller's own organization, the same scope every link write uses.
 */
export async function listLinkedPurchaseOrderIds(
  em: EntityManager,
  scope: CompanyOrderScope,
  companyOrderId: string,
): Promise<string[]> {
  const links = await em.fork().find(
    CompanyOrderLink,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      companyOrder: companyOrderId,
      kind: 'purchase_order',
    } as FilterQuery<CompanyOrderLink>,
  )
  return links.map((link) => String(link.refId))
}

/**
 * **Moves** the given children onto the caller's root.
 *
 * One child document belongs to at most one company order, so both writers that name a child
 * explicitly (`links.replace` and the create-time `links` of `order_hub.orders.create`) delete every
 * link row these `(kind, refId)` cells already have **in this scope** before persisting their own.
 * A row left behind by a soft-deleted root is moved too — that is how a child freed by deleting its
 * root is re-attachable without leaving an orphan behind that the reverse lookup could answer from.
 *
 * Returns the ids of the **other** roots the children moved off (the caller's own target root is
 * never reported), so the caller can invalidate those roots' cached link collections and announce
 * the move to them as well — their attach block changed even though they were not written.
 */
export async function moveCompanyOrderChildren(
  em: EntityManager,
  scope: CompanyOrderScope,
  entries: Array<{ kind: CompanyOrderLinkKind; refId: string }>,
  options: { keepCompanyOrderId?: string } = {},
): Promise<string[]> {
  if (entries.length === 0) return []
  const links = await em.fork().find(
    CompanyOrderLink,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      kind: { $in: [...new Set(entries.map((entry) => entry.kind))] },
      refId: { $in: [...new Set(entries.map((entry) => entry.refId))] },
    } as FilterQuery<CompanyOrderLink>,
    { populate: ['companyOrder'] },
  )
  const affected = new Set<string>()
  const doomed: string[] = []
  for (const link of links) {
    const ownerId = String(link.companyOrder.id)
    if (options.keepCompanyOrderId && ownerId === options.keepCompanyOrderId) continue
    doomed.push(String(link.id))
    affected.add(ownerId)
  }
  if (doomed.length > 0) {
    // Deleted by id, not by cell: a `nativeDelete` on the filter would have to repeat the ref set
    // and would touch rows this pass deliberately kept.
    await em.nativeDelete(CompanyOrderLink, { id: { $in: doomed } } as FilterQuery<CompanyOrderLink>)
  }
  return [...affected]
}

/** The company order must exist in this scope and not be soft-deleted. */
export async function loadCompanyOrder(
  em: EntityManager,
  scope: CompanyOrderScope,
  id: string,
): Promise<CompanyOrder> {
  const order = await em.fork().findOne(CompanyOrder, {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  } as FilterQuery<CompanyOrder>)
  if (!order) {
    throw new CrudHttpError(422, { error: `Company order not found in this organization: ${id}` })
  }
  return order
}

/**
 * Creates a fresh company order for a resolved child, allocating the number under the scope's unique
 * key. Persisted but not flushed — the caller owns the transaction (the command's atomic flush, or
 * the CLI's per-row flush) so the number's read-your-write assumption holds.
 */
export async function createCompanyOrderFromRef(
  em: EntityManager,
  scope: CompanyOrderScope,
  ref: CompanyOrderRef,
  options: { orderDate?: Date; status?: string; paymentStatus?: string | null } = {},
): Promise<CompanyOrder> {
  const number = await nextCompanyOrderNumber(em, scope)
  const order = em.create(CompanyOrder, {
    // Assigned here (not left to the DB default) so the id is readable before the caller flushes —
    // `link-child` returns it in its response from inside the same transaction.
    id: randomUUID(),
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    number,
    title: null,
    orderDate: options.orderDate ?? new Date(),
    etaDate: null,
    status: options.status ?? 'placed',
    // Absent = a fresh deal, which starts 未收款; an explicit `null` = a historical root whose
    // payment answer nobody recorded (the CLI backfill), rendered as “—” rather than as a claim.
    paymentStatus: options.paymentStatus === undefined ? 'unpaid' : options.paymentStatus,
    notes: null,
    customerPartyId: null,
    customerSnapshot: null,
    supplierId: null,
    supplierSnapshot: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  em.persist(order)
  return order
}

/** Freezes a resolved child onto a new link row (persisted, not flushed). */
export function persistCompanyOrderLink(
  em: EntityManager,
  scope: CompanyOrderScope,
  companyOrder: CompanyOrder,
  ref: CompanyOrderRef,
): CompanyOrderLink {
  const link = em.create(CompanyOrderLink, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    companyOrder,
    kind: ref.kind,
    refId: ref.id,
    refNumber: ref.number,
    refCounterparty: ref.counterparty,
    refSnapshot: freezeLinkSnapshot(ref),
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  em.persist(link)
  return link
}

async function findExistingLink(
  em: EntityManager,
  scope: CompanyOrderScope,
  kind: CompanyOrderLinkKind,
  refId: string,
): Promise<CompanyOrderLink | null> {
  return em.fork().findOne(CompanyOrderLink, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    kind,
    refId,
  } as FilterQuery<CompanyOrderLink>)
}

export type LinkChildResult = {
  companyOrderId: string
  /** A new link row was inserted by this call (false when the attach already existed). */
  linked: boolean
  /** A fresh company order was auto-created by this call (sales kinds with no target). */
  created: boolean
}

/**
 * Attaches a resolved child to a company order — idempotently, and without ever double-attaching.
 *
 * A child belongs to **at most one** root, so an existing link for the same `(kind, refId)` always
 * wins: the call answers with the root that already holds it (`linked: false`), whether or not that
 * is the requested target. Callers rely on this — a form that just saved a child and named a target
 * root follows the returned id, and a second click on the same row cannot move or duplicate it.
 *
 * - With `companyOrderId`: the target must exist in scope and not be deleted (else 422); the link is
 *   inserted only when the child is attached nowhere (the unique key is the real guard).
 * - Without: a **sales** child with no link at all gets a fresh root (`CO-…`, 已下单 / 未收款, order
 *   date = today) so every app-created sales order has a root; a **purchase** child cannot invent one,
 *   so it is refused with 422 `company_order_required`.
 *
 * Persisted but not flushed: the caller owns the transaction. Writes are the owner's (and, for the
 * no-target case, the caller's own organization) — see `linkChildCommand`.
 */
export async function linkChild(
  em: EntityManager,
  scope: CompanyOrderScope,
  input: { kind: CompanyOrderLinkKind; refId: string; companyOrderId?: string },
): Promise<LinkChildResult> {
  const refs = await loadCompanyOrderRefs(em, scope, [{ kind: input.kind, refId: input.refId }])
  const ref = refs.get(linkKey(input.kind, input.refId))
  if (!ref) {
    throw new CrudHttpError(422, {
      error: `Child document not found in this organization: ${input.kind} ${input.refId}`,
    })
  }

  if (input.companyOrderId) {
    const companyOrder = await loadCompanyOrder(em, scope, input.companyOrderId)
    const existing = await findExistingLink(em, scope, input.kind, input.refId)
    if (existing) {
      return { companyOrderId: String(existing.companyOrder.id), linked: false, created: false }
    }
    persistCompanyOrderLink(em, scope, companyOrder, ref)
    return { companyOrderId: String(companyOrder.id), linked: true, created: false }
  }

  const existing = await findExistingLink(em, scope, input.kind, input.refId)
  if (existing) {
    return { companyOrderId: String(existing.companyOrder.id), linked: false, created: false }
  }

  if (input.kind === 'purchase_order') {
    throw new CrudHttpError(422, {
      error: 'A purchase order cannot create a company order; provide companyOrderId',
      code: 'company_order_required',
    })
  }

  const companyOrder = await createCompanyOrderFromRef(em, scope, ref)
  persistCompanyOrderLink(em, scope, companyOrder, ref)
  return { companyOrderId: String(companyOrder.id), linked: true, created: true }
}
