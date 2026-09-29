import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { TradeDocsContractOrder } from '../data/entities'
import { contractOrdersReplaceSchema } from '../data/validators'
import { invalidateContractCaches } from '../lib/cacheInvalidation'
import { contractOrderKey, loadContractOrderRefs } from '../lib/contractOrderReads'
import { ensureScope, loadContract, type TradeDocsScope } from '../lib/scope'
import { eventsConfig } from '../events'

const RESOURCE_KIND = 'trade_docs.contract.order' as const

/**
 * Replaces the whole set of orders a contract covers.
 *
 * A dedicated command (rather than a field on the contract's own update) because the two have
 * different lifecycles: the contract's lines and amounts freeze at issue, while orders are placed
 * afterwards — so this set stays editable on an issued or signed contract, and only a cancelled
 * contract refuses it. The aggregate lock is still the contract's version, because a stale dialog
 * must not silently drop a link someone else added.
 */
const replaceContractOrdersCommand: CommandHandler<
  Record<string, unknown>,
  { contractId: string; count: number; tenantId: string; organizationId: string }
> = {
  id: 'trade_docs.contracts.orders.replace',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = contractOrdersReplaceSchema.parse(rawInput)
    const scope: TradeDocsScope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager

    const contract = await loadContract(em, scope, parsed.contractId)
    if (contract.status === 'cancelled') {
      throw new CrudHttpError(422, { error: 'A cancelled contract cannot link orders' })
    }
    enforceCommandOptimisticLock({
      resourceKind: RESOURCE_KIND,
      resourceId: String(contract.id),
      current: contract.updatedAt,
      // The dialog sends the version it rendered with; the platform header still works on top.
      expected: parsed.updatedAt ?? undefined,
      request: ctx.request ?? null,
    })

    const keys = parsed.orders.map((order) => contractOrderKey(order.orderKind, order.orderId))
    if (new Set(keys).size !== keys.length) {
      throw new CrudHttpError(422, { error: 'The same order is listed twice on this contract' })
    }

    const resolved = parsed.orders.length > 0
      ? await loadContractOrderRefs(em, scope, parsed.orders)
      : new Map()
    for (const order of parsed.orders) {
      if (!resolved.has(contractOrderKey(order.orderKind, order.orderId))) {
        // Fail closed: a link to an order this organization cannot see would be a dangling
        // reference the hub then shows as a bare number.
        throw new CrudHttpError(422, {
          error: `Order not found in this organization: ${order.orderKind} ${order.orderId}`,
        })
      }
    }

    await withAtomicFlush(em, [
      async () => {
        await em.nativeDelete(
          TradeDocsContractOrder,
          { contract: contract.id } as FilterQuery<TradeDocsContractOrder>,
        )
        for (const order of parsed.orders) {
          const ref = resolved.get(contractOrderKey(order.orderKind, order.orderId))
          if (!ref) continue
          em.persist(
            em.create(TradeDocsContractOrder, {
              tenantId: scope.tenantId,
              organizationId: scope.organizationId,
              contract,
              orderKind: order.orderKind,
              orderId: order.orderId,
              orderNumber: ref.number,
              orderSnapshot: {
                kind: ref.kind,
                number: ref.number,
                counterpartyName: ref.counterpartyName,
                orderedAt: ref.orderedAt,
                status: ref.status,
              },
            }),
          )
        }
      },
    ])

    await eventsConfig.emit('trade_docs.contract.orders.updated', {
      id: String(contract.id),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      number: contract.number ?? null,
      count: parsed.orders.length,
    })
    await invalidateContractCaches(
      { container: ctx.container, tenantId: scope.tenantId, organizationId: scope.organizationId },
      { id: String(contract.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      'orders-updated',
    )

    return {
      contractId: String(contract.id),
      count: parsed.orders.length,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
  captureAfter: (_input, result) => ({ id: result.contractId, count: result.count }),
  buildLog: async ({ result }) => ({
    actionLabel: 'Contract order links replaced',
    resourceKind: RESOURCE_KIND,
    resourceId: result.contractId,
    tenantId: result.tenantId,
    organizationId: result.organizationId,
    snapshotAfter: { contractId: result.contractId, count: result.count },
  }),
}

registerCommand(replaceContractOrdersCommand)

export { replaceContractOrdersCommand }
