import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { PlatformOpsChannel, PlatformOpsOrderMirror } from '../data/entities'
import { orderIngestSchema } from '../data/validators'
import { ensureScope, type Scope } from '../lib/scope'
import { eventsConfig } from '../events'

const ORDER_ENTITY_ID = 'platform_ops:platform_ops_order_mirror' as const

export const orderCrudEvents: CrudEventsConfig<PlatformOpsOrderMirror> = {
  module: 'platform_ops',
  entity: 'order_mirror',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    externalOrderId: ctx.entity?.externalOrderId ?? null,
  }),
}

export const orderCrudIndexer: CrudIndexerConfig<PlatformOpsOrderMirror> = {
  entityType: ORDER_ENTITY_ID,
}

export type OrderIngestResult = {
  channelId: string
  created: number
  updated: number
  unchanged: number
}

function amountsEqual(left: string | null | undefined, right: string): boolean {
  return Math.abs(Number.parseFloat(left ?? '0') - Number.parseFloat(right)) < 1e-6
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
 * Idempotent landing point for platform orders.
 *
 * The uniqueness of `(channel, external order id)` is what makes a retry safe: the command loads
 * the existing mirrors for the batch in one query, then creates, updates or leaves each row alone.
 * A re-posted batch therefore reports `unchanged` and writes nothing — the property the whole
 * reconciliation depends on.
 *
 * Platform-supplied numbers are stored verbatim. `netAmount` falls back to `gross − fee` only when
 * the payload omits it, because some marketplaces do not send a net figure at all.
 */
const ingestOrdersCommand: CommandHandler<Record<string, unknown>, OrderIngestResult> = {
  id: 'platform_ops.orders.ingest',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = orderIngestSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const channel = await loadChannel(em, scope, parsed.channelId)
    const externalIds = parsed.orders.map((order) => order.externalOrderId)
    if (new Set(externalIds).size !== externalIds.length) {
      throw new CrudHttpError(422, { error: 'The same external order id appears twice in this batch' })
    }

    const existing = await em.fork().find(PlatformOpsOrderMirror, {
      channel: channel.id,
      externalOrderId: { $in: externalIds },
    } as FilterQuery<PlatformOpsOrderMirror>)
    const byExternalId: Record<string, PlatformOpsOrderMirror> = {}
    for (const mirror of existing) byExternalId[mirror.externalOrderId] = mirror

    let created = 0
    let updated = 0
    let unchanged = 0

    for (const order of parsed.orders) {
      const currencyCode = order.currencyCode ?? channel.currencyCode
      const gross = (order.grossAmount ?? 0).toFixed(4)
      const fee = (order.feeAmount ?? 0).toFixed(4)
      const net = (order.netAmount ?? (order.grossAmount ?? 0) - (order.feeAmount ?? 0)).toFixed(4)
      const placedAt = order.placedAt ? new Date(order.placedAt) : null
      const current = byExternalId[order.externalOrderId]

      if (!current) {
        const mirror = em.create(PlatformOpsOrderMirror, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          channel,
          externalOrderId: order.externalOrderId,
          status: order.status ?? null,
          currencyCode,
          grossAmount: gross,
          feeAmount: fee,
          netAmount: net,
          placedAt,
          shipmentId: order.shipmentId ?? null,
          shipmentNumber: order.shipmentNumber ?? null,
          raw: order as unknown as Record<string, unknown>,
          syncedAt: new Date(),
        })
        em.persist(mirror)
        created += 1
        continue
      }

      const changed =
        (current.status ?? null) !== (order.status ?? null) ||
        current.currencyCode !== currencyCode ||
        !amountsEqual(current.grossAmount, gross) ||
        !amountsEqual(current.feeAmount, fee) ||
        !amountsEqual(current.netAmount, net) ||
        (order.shipmentId ?? null) !== (current.shipmentId ?? null)

      if (!changed) {
        unchanged += 1
        continue
      }

      current.status = order.status ?? null
      current.currencyCode = currencyCode
      current.grossAmount = gross
      current.feeAmount = fee
      current.netAmount = net
      current.placedAt = placedAt
      current.shipmentId = order.shipmentId ?? null
      current.shipmentNumber = order.shipmentNumber ?? null
      current.raw = order as unknown as Record<string, unknown>
      current.syncedAt = new Date()
      em.persist(current)
      updated += 1
    }

    await em.flush()

    await eventsConfig.emit('platform_ops.orders.ingested', {
      channelId: String(channel.id),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      created,
      updated,
      unchanged,
    })

    return { channelId: String(channel.id), created, updated, unchanged }
  },
  captureAfter: (_input, result) => result,
  buildLog: async ({ result }) => ({
    actionLabel: 'Ingest platform orders',
    resourceKind: 'platform_ops.order_mirror',
    resourceId: result.channelId,
    tenantId: null,
    organizationId: null,
    snapshotAfter: { created: result.created, updated: result.updated, unchanged: result.unchanged },
  }),
}

registerCommand(ingestOrdersCommand)

export { ingestOrdersCommand }
