import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { TradeDocsDocument, TradeDocsInvoice } from '../data/entities'
import type { TradeDocsScope } from './scope'

/**
 * Scoped reads behind the order ↔ document links.
 *
 * The order side is raw Kysely exactly like `contractOrderReads.ts`: the order lives in the
 * installed `sales` engine, which exposes no "give me this id" contract this module should import,
 * and nothing here writes. The document side is this module's own data, so it reads through the
 * ORM entities with the caller's tenant and organization pinned — a document of another
 * organization simply resolves to nothing and the caller turns that into a 422 rather than
 * recording a dangling link.
 *
 * Only the fields a link freezes are read: the number, the status and the money/date head facts the
 * hub shows. No encrypted column and no line set is touched.
 */

export type OrderDocumentKind = 'proforma' | 'commercial' | 'tax_invoice'
export type SalesOrderLinkKind = 'internal_sales_order' | 'external_sales_order'

const SALES_ORDER_TABLE = 'sales_orders'

/** The order a link set hangs on: its frozen number and the version the aggregate lock compares. */
export type SalesOrderRef = {
  id: string
  number: string | null
  updatedAt: string | null
}

/** What one link freezes about its document, plus the kind the link recorded. */
export type OrderDocumentRef = {
  kind: OrderDocumentKind
  id: string
  number: string | null
  snapshot: Record<string, unknown>
}

export const orderDocumentKey = (kind: string, id: string) => `${kind}:${id}`

function toIso(value: unknown): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * The sales order, when the caller may see it.
 *
 * `updated_at` is the aggregate lock of the link set: the dialog renders with it and the command
 * refuses a set built on a stale order (someone else changed the order since the dialog opened).
 */
export async function loadSalesOrderRef(
  em: EntityManager,
  scope: TradeDocsScope,
  orderId: string,
): Promise<SalesOrderRef | null> {
  const db = em.fork().getKysely<any>()
  const row = (await db
    .selectFrom(`${SALES_ORDER_TABLE} as o`)
    .select(['o.id as id', 'o.order_number as number', 'o.updated_at as updated_at'])
    .where('o.id', '=', orderId)
    .where('o.tenant_id', '=', scope.tenantId)
    .where('o.organization_id', '=', scope.organizationId)
    .where('o.deleted_at', 'is', null)
    .executeTakeFirst()) as { id: string; number: string | null; updated_at: unknown } | undefined
  if (!row) return null
  return { id: String(row.id), number: row.number ?? null, updatedAt: toIso(row.updated_at) }
}

/**
 * Resolves each `(documentKind, documentId)` to its number and display snapshot; ids outside the
 * caller's scope — or a document whose own kind contradicts the link's `documentKind` — are left
 * out, and the caller turns a missing one into a 422.
 */
export async function loadOrderDocumentRefs(
  em: EntityManager,
  scope: TradeDocsScope,
  entries: Array<{ documentKind: OrderDocumentKind; documentId: string }>,
): Promise<Map<string, OrderDocumentRef>> {
  const resolved = new Map<string, OrderDocumentRef>()

  const documentEntries = entries.filter((entry) => entry.documentKind !== 'tax_invoice')
  if (documentEntries.length > 0) {
    const rows = await em.find(TradeDocsDocument, {
      id: { $in: documentEntries.map((entry) => entry.documentId) },
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    } as FilterQuery<TradeDocsDocument>)
    for (const row of rows) {
      for (const entry of documentEntries) {
        if (entry.documentId !== String(row.id)) continue
        // The stored `kind` is the authority: a link that calls a proforma "commercial" would label
        // it wrongly everywhere the link is shown, so the mismatch resolves to nothing.
        if (row.kind !== entry.documentKind) continue
        resolved.set(orderDocumentKey(entry.documentKind, entry.documentId), {
          kind: entry.documentKind,
          id: String(row.id),
          number: row.number ?? null,
          snapshot: {
            kind: entry.documentKind,
            number: row.number ?? null,
            status: row.status ?? null,
            total: row.total ?? null,
            currencyCode: row.currencyCode ?? null,
            issuedAt: toIso(row.issuedAt),
          },
        })
      }
    }
  }

  const invoiceEntries = entries.filter((entry) => entry.documentKind === 'tax_invoice')
  if (invoiceEntries.length > 0) {
    const rows = await em.find(TradeDocsInvoice, {
      id: { $in: invoiceEntries.map((entry) => entry.documentId) },
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    } as FilterQuery<TradeDocsInvoice>)
    for (const row of rows) {
      resolved.set(orderDocumentKey('tax_invoice', String(row.id)), {
        kind: 'tax_invoice',
        id: String(row.id),
        number: row.number ?? null,
        snapshot: {
          kind: 'tax_invoice',
          number: row.number ?? null,
          status: row.status ?? null,
          total: row.total ?? null,
          currencyCode: row.currencyCode ?? null,
          issuedAt: toIso(row.issuedAt),
        },
      })
    }
  }

  return resolved
}
