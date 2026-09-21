import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import {
  PlatformOpsChannel,
  PlatformOpsOrderMirror,
  PlatformOpsReconciliationItem,
  PlatformOpsSettlement,
  PlatformOpsSettlementLine,
} from '../data/entities'
import { reconciliationIgnoreSchema, reconciliationResolveSchema, settlementImportSchema } from '../data/validators'
import { ensureScope, type Scope } from '../lib/scope'
import { eventsConfig } from '../events'

export type SettlementImportResult = {
  settlementId: string
  lines: number
  raised: number
  linked: number
}

function amountsDiffer(left: string | null | undefined, right: string): boolean {
  return Math.abs(Number.parseFloat(left ?? '0') - Number.parseFloat(right)) >= 1e-6
}

async function loadChannel(em: EntityManager, scope: Scope, channelId: string): Promise<PlatformOpsChannel> {
  const channel = await em.fork().findOne(PlatformOpsChannel, {
    id: channelId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  } as FilterQuery<PlatformOpsChannel>)
  if (!channel) throw notFound('Channel not found')
  return channel
}

/**
 * Raises one reconciliation item per problem, and never a duplicate of a problem already known.
 *
 * "Already known" spans every status, not just `open`: re-importing the same settlement after an
 * operator resolved (or ignored) a difference must not resurrect it as a new item, or a nightly
 * import would fill the queue with copies of decisions already taken. The comparison is on the
 * amounts, so a problem whose numbers *changed* is genuinely new and does raise a fresh item —
 * which is the only case where the operator has something new to look at.
 */
async function raiseItem(
  em: EntityManager,
  scope: Scope,
  channel: PlatformOpsChannel,
  input: {
    kind: string
    externalRef: string
    settlementId: string
    orderMirrorId?: string | null
    expectedAmount?: string | null
    actualAmount?: string | null
    currencyCode?: string | null
  },
): Promise<boolean> {
  const previous = await em.fork().findOne(
    PlatformOpsReconciliationItem,
    {
      channel: channel.id,
      externalRef: input.externalRef,
      kind: input.kind,
    } as FilterQuery<PlatformOpsReconciliationItem>,
    { orderBy: { createdAt: 'desc' } },
  )
  const sameAmount = (left: string | null | undefined, right: string | null | undefined): boolean =>
    (left ?? null) === (right ?? null)
  if (previous && sameAmount(previous.actualAmount, input.actualAmount ?? null)) return false

  em.persist(
    em.create(PlatformOpsReconciliationItem, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      channel,
      kind: input.kind,
      externalRef: input.externalRef,
      settlementId: input.settlementId,
      orderMirrorId: input.orderMirrorId ?? null,
      expectedAmount: input.expectedAmount ?? null,
      actualAmount: input.actualAmount ?? null,
      currencyCode: input.currencyCode ?? null,
      status: 'open',
    }),
  )
  await em.flush()

  await eventsConfig.emit('platform_ops.reconciliation.raised', {
    channelId: String(channel.id),
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    kind: input.kind,
    externalRef: input.externalRef,
  })
  return true
}

/**
 * Idempotent settlement import plus the comparison that makes it useful.
 *
 * The settlement is upserted by its own id and its lines are replaced wholesale — a payout
 * statement is a snapshot, so diffing lines would add complexity without adding truth. Each line
 * is then matched against the order mirrors and every disagreement becomes a reconciliation item:
 * an order we never received, a net amount that does not match, or the same order twice in one
 * statement. Matching also links the mirror to the line, which is how a later report can answer
 * "was this order actually paid".
 */
const importSettlementCommand: CommandHandler<Record<string, unknown>, SettlementImportResult> = {
  id: 'platform_ops.settlements.import',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = settlementImportSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager

    const channel = await loadChannel(em, scope, parsed.channelId)
    const currencyCode = parsed.settlement.currencyCode ?? channel.currencyCode

    const existing = await em.fork().findOne(PlatformOpsSettlement, {
      channel: channel.id,
      externalSettlementId: parsed.settlement.externalSettlementId,
    } as FilterQuery<PlatformOpsSettlement>)

    const settlement = existing ?? em.create(PlatformOpsSettlement, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      channel,
      externalSettlementId: parsed.settlement.externalSettlementId,
      currencyCode,
    })
    settlement.periodStart = parsed.settlement.periodStart ? new Date(parsed.settlement.periodStart) : null
    settlement.periodEnd = parsed.settlement.periodEnd ? new Date(parsed.settlement.periodEnd) : null
    settlement.currencyCode = currencyCode
    settlement.grossAmount = (parsed.settlement.grossAmount ?? 0).toFixed(4)
    settlement.feeAmount = (parsed.settlement.feeAmount ?? 0).toFixed(4)
    settlement.netAmount = (parsed.settlement.netAmount ?? 0).toFixed(4)
    settlement.receivedAt = parsed.settlement.receivedAt ? new Date(parsed.settlement.receivedAt) : null
    settlement.raw = parsed.settlement as unknown as Record<string, unknown>
    if (!existing) em.persist(settlement)
    await em.flush()

    await em.nativeDelete(PlatformOpsSettlementLine, {
      settlement: settlement.id,
    } as FilterQuery<PlatformOpsSettlementLine>)

    const mirrors = await em.fork().find(PlatformOpsOrderMirror, {
      channel: channel.id,
      externalOrderId: { $in: parsed.lines.map((line) => line.externalOrderId) },
    } as FilterQuery<PlatformOpsOrderMirror>)
    const mirrorByExternalId: Record<string, PlatformOpsOrderMirror> = {}
    for (const mirror of mirrors) mirrorByExternalId[mirror.externalOrderId] = mirror

    const seen: Record<string, number> = {}
    let raised = 0
    let linked = 0

    for (const line of parsed.lines) {
      const gross = (line.grossAmount ?? 0).toFixed(4)
      const fee = (line.feeAmount ?? 0).toFixed(4)
      const net = (line.netAmount ?? (line.grossAmount ?? 0) - (line.feeAmount ?? 0)).toFixed(4)
      const mirror = mirrorByExternalId[line.externalOrderId]

      seen[line.externalOrderId] = (seen[line.externalOrderId] ?? 0) + 1
      const isDuplicate = seen[line.externalOrderId] > 1

      const row = em.create(PlatformOpsSettlementLine, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        settlement,
        externalOrderId: line.externalOrderId,
        orderMirrorId: mirror ? String(mirror.id) : null,
        grossAmount: gross,
        feeAmount: fee,
        netAmount: net,
      })
      em.persist(row)

      if (isDuplicate) {
        if (await raiseItem(em, scope, channel, {
          kind: 'duplicate_line',
          externalRef: line.externalOrderId,
          settlementId: String(settlement.id),
          orderMirrorId: mirror ? String(mirror.id) : null,
          actualAmount: net,
          currencyCode,
        })) raised += 1
        continue
      }

      if (!mirror) {
        if (await raiseItem(em, scope, channel, {
          kind: 'missing_in_erp',
          externalRef: line.externalOrderId,
          settlementId: String(settlement.id),
          expectedAmount: net,
          currencyCode,
        })) raised += 1
        continue
      }

      if (amountsDiffer(mirror.netAmount, net)) {
        if (await raiseItem(em, scope, channel, {
          kind: 'amount_mismatch',
          externalRef: line.externalOrderId,
          settlementId: String(settlement.id),
          orderMirrorId: String(mirror.id),
          expectedAmount: mirror.netAmount,
          actualAmount: net,
          currencyCode,
        })) raised += 1
        continue
      }

      linked += 1
    }

    await em.flush()
    settlement.status = raised > 0 ? 'imported' : 'reconciled'
    await em.flush()

    await eventsConfig.emit('platform_ops.settlement.imported', {
      settlementId: String(settlement.id),
      channelId: String(channel.id),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      lines: parsed.lines.length,
      raised,
    })

    return {
      settlementId: String(settlement.id),
      lines: parsed.lines.length,
      raised,
      linked,
    }
  },
  captureAfter: (_input, result) => result,
  buildLog: async ({ result }) => ({
    actionLabel: 'Import platform settlement',
    resourceKind: 'platform_ops.settlement',
    resourceId: result.settlementId,
    tenantId: null,
    organizationId: null,
    snapshotAfter: { lines: result.lines, raised: result.raised, linked: result.linked },
  }),
}

/** Resolve or ignore an open item; both actions carry a note and are audited. */
function buildReconciliationDecisionCommand(
  commandId: string,
  status: 'resolved' | 'ignored',
  actionLabel: string,
): CommandHandler<Record<string, unknown>, PlatformOpsReconciliationItem> {
  return {
    id: commandId,
    isUndoable: false,
    async execute(rawInput, ctx) {
      const parsed = (status === 'resolved' ? reconciliationResolveSchema : reconciliationIgnoreSchema).parse(rawInput)
      const scope = ensureScope(ctx)
      const em = ctx.container.resolve('em') as EntityManager
      const de = ctx.container.resolve('dataEngine') as DataEngine

      const item = await em.fork().findOne(PlatformOpsReconciliationItem, {
        id: parsed.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      } as FilterQuery<PlatformOpsReconciliationItem>)
      if (!item) throw notFound('Reconciliation item not found')
      if (item.status !== 'open') {
        throw new CrudHttpError(422, { error: `This item is already ${item.status}` })
      }

      item.status = status
      item.note = parsed.note
      item.resolvedAt = new Date()
      item.resolvedBy = ctx.auth?.sub ?? null
      em.persist(item)
      await em.flush()

      await eventsConfig.emit('platform_ops.reconciliation.resolved', {
        id: String(item.id),
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        status,
        note: parsed.note,
      })

      await de.emitOrmEntityEvent({
        action: 'updated',
        entity: item,
        identifiers: { id: String(item.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
        syncOrigin: ctx.syncOrigin,
      })

      return item
    },
    captureAfter: (_input, result) => ({ id: String(result.id), status: result.status }),
    buildLog: async ({ result }) => ({
      actionLabel,
      resourceKind: 'platform_ops.reconciliation_item',
      resourceId: String(result.id),
      tenantId: String(result.tenantId),
      organizationId: String(result.organizationId),
      snapshotAfter: { id: String(result.id), status: result.status },
    }),
  }
}

const resolveReconciliationCommand = buildReconciliationDecisionCommand(
  'platform_ops.reconciliation.resolve',
  'resolved',
  'Resolve reconciliation item',
)
const ignoreReconciliationCommand = buildReconciliationDecisionCommand(
  'platform_ops.reconciliation.ignore',
  'ignored',
  'Ignore reconciliation item',
)

registerCommand(importSettlementCommand)
registerCommand(resolveReconciliationCommand)
registerCommand(ignoreReconciliationCommand)

export { importSettlementCommand, resolveReconciliationCommand, ignoreReconciliationCommand }
