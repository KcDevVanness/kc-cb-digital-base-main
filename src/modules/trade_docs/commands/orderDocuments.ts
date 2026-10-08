import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { TradeDocsOrderDocument } from '../data/entities'
import { orderDocumentsReplaceSchema } from '../data/validators'
import { loadOrderDocumentRefs, loadSalesOrderRef, orderDocumentKey } from '../lib/orderDocumentReads'
import { ensureScope, type TradeDocsScope } from '../lib/scope'

const RESOURCE_KIND = 'trade_docs.order.document' as const

/**
 * Replaces the whole set of documents a sales order carries.
 *
 * A dedicated command (rather than a field on the document's own update) because the link belongs
 * to the order: the same document can be raised for one order while the contract it may also hang on
 * is decided elsewhere, and the hub's Documents block edits the set as a whole. The aggregate lock
 * is the **order's** version, because a stale dialog must not silently drop a link someone else
 * added since it opened.
 *
 * Two rules keep the polymorphic link honest (there is no foreign key to enforce them):
 * - the order is resolved inside the caller's scope, and a missing one is a 422 rather than a link
 *   to somebody else's order;
 * - every document is resolved the same way — and a `documentKind` that contradicts the row's own
 *   `kind` resolves to nothing, so a mislabelled link cannot be stored.
 */
const replaceOrderDocumentsCommand: CommandHandler<
  Record<string, unknown>,
  { orderId: string; orderKind: string; count: number; tenantId: string; organizationId: string }
> = {
  id: 'trade_docs.orders.documents.replace',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = orderDocumentsReplaceSchema.parse(rawInput)
    const scope: TradeDocsScope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager

    const order = await loadSalesOrderRef(em, scope, parsed.orderId)
    if (!order) {
      throw new CrudHttpError(422, {
        error: 'order_document_link_order_not_found',
        orderId: parsed.orderId,
      })
    }
    enforceCommandOptimisticLock({
      resourceKind: RESOURCE_KIND,
      resourceId: order.id,
      current: order.updatedAt,
      // The dialog sends the version it rendered with; the platform header still works on top.
      expected: parsed.orderUpdatedAt ?? undefined,
      request: ctx.request ?? null,
    })

    const keys = parsed.rows.map((row) => orderDocumentKey(row.documentKind, row.documentId))
    if (new Set(keys).size !== keys.length) {
      throw new CrudHttpError(422, { error: 'The same document is listed twice on this order' })
    }

    const resolved = parsed.rows.length > 0
      ? await loadOrderDocumentRefs(em, scope, parsed.rows)
      : new Map()
    for (const row of parsed.rows) {
      if (!resolved.has(orderDocumentKey(row.documentKind, row.documentId))) {
        throw new CrudHttpError(422, {
          error: 'order_document_link_document_not_found',
          documentKind: row.documentKind,
          documentId: row.documentId,
        })
      }
    }

    await withAtomicFlush(
      em,
      [
        async () => {
          await em.nativeDelete(TradeDocsOrderDocument, {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            orderKind: parsed.orderKind,
            orderId: parsed.orderId,
          } as FilterQuery<TradeDocsOrderDocument>)
          for (const row of parsed.rows) {
            const ref = resolved.get(orderDocumentKey(row.documentKind, row.documentId))
            if (!ref) continue
            em.persist(
              em.create(TradeDocsOrderDocument, {
                tenantId: scope.tenantId,
                organizationId: scope.organizationId,
                orderKind: parsed.orderKind,
                orderId: parsed.orderId,
                orderNumber: order.number,
                documentKind: row.documentKind,
                documentId: row.documentId,
                documentNumber: ref.number,
                documentSnapshot: ref.snapshot,
              }),
            )
          }
        },
      ],
      { transaction: true, label: 'trade_docs.orders.documents.replace' },
    )

    return {
      orderId: parsed.orderId,
      orderKind: parsed.orderKind,
      count: parsed.rows.length,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
  captureAfter: (_input, result) => ({ id: result.orderId, count: result.count }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Order document links replaced',
    resourceKind: RESOURCE_KIND,
    resourceId: result.orderId,
    tenantId: result.tenantId,
    organizationId: result.organizationId,
    snapshotAfter: {
      orderId: result.orderId,
      orderKind: result.orderKind,
      count: result.count,
    },
  }),
}

registerCommand(replaceOrderDocumentsCommand)

export { replaceOrderDocumentsCommand }
