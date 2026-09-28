import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { toAmountString, toScaledUnits } from '../../trade_docs/lib/money'
import type { ImportItem } from '@open-mercato/core/modules/data_sync/lib/adapter'
import type { AdsEndpoint } from './endpoints/ads'

/**
 * The two ads endpoints that do **not** stop at the snapshot table: platform orders go into
 * `platform_ops`' order mirror and platform settlements into its settlement import, so the existing
 * idempotent entry points (and their reconciliation kinds) are reused instead of duplicated.
 *
 * Both need a `platform_ops` channel, and the RU payload carries a channel *code* (`ozon`,
 * `yandex_market`, `kit`). The mapping is explicit: the channel whose `code` matches, in the
 * caller's organization. When no such channel exists the rows are still snapshotted and the item is
 * reported as `failed` with `channel_not_configured` — a configuration gap must be visible and must
 * not silently drop data.
 */

const logger = createLogger('ru_sync').child({ component: 'ads-ingest' })

const AMOUNT_SCALE = 2

/** A peer command the sync worker dispatches: same bus contract the rest of the app uses. */
export type PeerCommandRunner = (
  commandId: string,
  input: Record<string, unknown>,
) => Promise<Record<string, unknown>>

type ChannelRow = { id: string; code: string }

export async function loadChannelIdByCode(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  code: string,
): Promise<string | null> {
  const rows = (await em.fork().getConnection().execute<ChannelRow[]>(
    `select id, code from platform_ops_channels
      where tenant_id = ? and organization_id = ? and lower(code) = lower(?) and deleted_at is null
      limit 1`,
    [scope.tenantId, scope.organizationId, code],
  )) as ChannelRow[]
  return rows[0]?.id ?? null
}

type OrderMirrorInput = {
  externalOrderId: string
  status: string | null
  currencyCode: string | null
  netAmount: string | null
  grossAmount: string | null
  placedAt: string | null
}

/**
 * Groups the order-**line** rows of §11 into the one-mirror-row-per-order shape the contract
 * prescribes: the discount-adjusted line totals are summed per order, the header fields come from
 * the first line, and the line detail itself stays in the snapshot payload.
 */
export function groupOrderLines(rows: Array<Record<string, unknown>>): Map<string, { channel: string; order: OrderMirrorInput }> {
  const orders = new Map<string, { channel: string; order: OrderMirrorInput & { netUnits: bigint; grossUnits: bigint } }>()
  for (const row of rows) {
    const channel = typeof row.channel === 'string' ? row.channel : ''
    const externalOrderId = typeof row.external_order_id === 'string' ? row.external_order_id : ''
    if (!channel || !externalOrderId) continue
    const key = `${channel}|${externalOrderId}`
    const net = readMoney(row.line_total_discounted)
    const gross = readMoney(row.order_total) ?? readMoney(row.line_total)
    const existing = orders.get(key)
    if (existing) {
      if (net) existing.order.netUnits += toScaledUnits(net.amount, AMOUNT_SCALE)
      if (gross && existing.order.grossUnits === 0n) existing.order.grossUnits += toScaledUnits(gross.amount, AMOUNT_SCALE)
      continue
    }
    orders.set(key, {
      channel,
      order: {
        externalOrderId,
        status: typeof row.status === 'string' ? row.status : null,
        currencyCode: net?.currency ?? gross?.currency ?? null,
        netAmount: null,
        grossAmount: null,
        placedAt: typeof row.created_at === 'string' ? row.created_at : null,
        netUnits: net ? toScaledUnits(net.amount, AMOUNT_SCALE) : 0n,
        grossUnits: gross ? toScaledUnits(gross.amount, AMOUNT_SCALE) : 0n,
      },
    })
  }

  const result = new Map<string, { channel: string; order: OrderMirrorInput }>()
  for (const [key, entry] of orders) {
    result.set(key, {
      channel: entry.channel,
      order: {
        externalOrderId: entry.order.externalOrderId,
        status: entry.order.status,
        currencyCode: entry.order.currencyCode,
        netAmount:
          entry.order.netUnits === 0n
            ? null
            : toAmountString({ units: entry.order.netUnits, scale: AMOUNT_SCALE }, AMOUNT_SCALE),
        grossAmount:
          entry.order.grossUnits === 0n
            ? null
            : toAmountString({ units: entry.order.grossUnits, scale: AMOUNT_SCALE }, AMOUNT_SCALE),
        placedAt: entry.order.placedAt,
      },
    })
  }
  return result
}

function readMoney(value: unknown): { amount: string; currency: string } | null {
  if (!value || typeof value !== 'object') return null
  const record = value as { amount?: unknown; currency?: unknown }
  if (typeof record.amount !== 'string' || typeof record.currency !== 'string') return null
  return { amount: record.amount, currency: record.currency }
}

/** §11 → `platform_ops.orders.ingest`, in batches of at most 500 orders. */
export async function ingestOrderLines(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  rows: Array<Record<string, unknown>>,
  runCommand: PeerCommandRunner,
): Promise<ImportItem[]> {
  const grouped = groupOrderLines(rows)
  const byChannel = new Map<string, OrderMirrorInput[]>()
  for (const entry of grouped.values()) {
    const list = byChannel.get(entry.channel) ?? []
    list.push(entry.order)
    byChannel.set(entry.channel, list)
  }

  const items: ImportItem[] = []
  for (const [channelCode, orders] of byChannel) {
    const channelId = await loadChannelIdByCode(em, scope, channelCode)
    if (!channelId) {
      logger.warn('RU channel has no platform_ops channel; rows were snapshotted but not ingested', {
        channel: channelCode,
      })
      for (const order of orders) {
        items.push({
          externalId: order.externalOrderId,
          action: 'failed',
          data: { code: 'channel_not_configured', channel: channelCode },
        })
      }
      continue
    }

    for (let offset = 0; offset < orders.length; offset += 500) {
      const batch = orders.slice(offset, offset + 500)
      try {
        const result = await runCommand('platform_ops.orders.ingest', {
          channelId,
          orders: batch.map((order) => ({
            externalOrderId: order.externalOrderId,
            status: order.status ?? undefined,
            currencyCode: order.currencyCode ?? undefined,
            grossAmount: order.grossAmount ?? undefined,
            netAmount: order.netAmount ?? undefined,
            placedAt: order.placedAt ?? undefined,
          })),
        })
        const created = typeof result.created === 'number' ? result.created : 0
        const unchanged = typeof result.unchanged === 'number' ? result.unchanged : 0
        for (const order of batch) {
          items.push({
            externalId: order.externalOrderId,
            action: created > 0 ? 'create' : unchanged > 0 ? 'skip' : 'update',
            data: { channel: channelCode },
          })
        }
      } catch (error) {
        // A duplicate `externalId` inside one batch is a 422 by contract: the batch is retried order
        // by order so one bad pair cannot drop the other 499.
        logger.warn('Order ingest batch rejected; retrying per order', {
          channel: channelCode,
          batchSize: batch.length,
          err: error,
        })
        for (const order of batch) {
          try {
            await runCommand('platform_ops.orders.ingest', {
              channelId,
              orders: [
                {
                  externalOrderId: order.externalOrderId,
                  status: order.status ?? undefined,
                  currencyCode: order.currencyCode ?? undefined,
                  grossAmount: order.grossAmount ?? undefined,
                  netAmount: order.netAmount ?? undefined,
                  placedAt: order.placedAt ?? undefined,
                },
              ],
            })
            items.push({ externalId: order.externalOrderId, action: 'create', data: { channel: channelCode } })
          } catch (singleError) {
            items.push({
              externalId: order.externalOrderId,
              action: 'failed',
              data: {
                code: 'ingest_rejected',
                channel: channelCode,
                message: singleError instanceof Error ? singleError.message : 'ingest failed',
              },
            })
          }
        }
      }
    }
  }
  return items
}

/** §15 → `platform_ops.settlements.import`, one settlement per call (the contract caps lines at 2000). */
export async function importSettlements(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  rows: Array<Record<string, unknown>>,
  runCommand: PeerCommandRunner,
): Promise<ImportItem[]> {
  const items: ImportItem[] = []
  for (const row of rows) {
    const channelCode = typeof row.channel === 'string' ? row.channel : ''
    const externalSettlementId = typeof row.external_settlement_id === 'string' ? row.external_settlement_id : ''
    if (!channelCode || !externalSettlementId) {
      items.push({ externalId: externalSettlementId || 'unknown', action: 'failed', data: { code: 'malformed_row' } })
      continue
    }
    const channelId = await loadChannelIdByCode(em, scope, channelCode)
    if (!channelId) {
      items.push({
        externalId: externalSettlementId,
        action: 'failed',
        data: { code: 'channel_not_configured', channel: channelCode },
      })
      continue
    }
    const lines = Array.isArray(row.lines) ? (row.lines as Array<Record<string, unknown>>) : []
    try {
      const result = await runCommand('platform_ops.settlements.import', {
        channelId,
        settlement: {
          externalSettlementId,
          periodStart: typeof row.period_start === 'string' ? row.period_start : undefined,
          periodEnd: typeof row.period_end === 'string' ? row.period_end : undefined,
          currencyCode: typeof row.currency === 'string' ? row.currency : undefined,
          grossAmount: readMoney(row.gross_amount)?.amount,
          feeAmount: readMoney(row.fee_amount)?.amount,
          netAmount: readMoney(row.net_amount)?.amount,
          receivedAt: typeof row.received_at === 'string' ? row.received_at : undefined,
        },
        lines: lines.map((line) => ({
          externalOrderId: typeof line.external_order_id === 'string' ? line.external_order_id : '',
          grossAmount: readMoney(line.gross_amount)?.amount,
          feeAmount: readMoney(line.fee_amount)?.amount,
          netAmount: readMoney(line.net_amount)?.amount,
        })),
      })
      items.push({
        externalId: externalSettlementId,
        action: 'create',
        data: { channel: channelCode, raised: typeof result.raised === 'number' ? result.raised : 0 },
      })
    } catch (error) {
      items.push({
        externalId: externalSettlementId,
        action: 'failed',
        data: { code: 'import_rejected', message: error instanceof Error ? error.message : 'import failed' },
      })
    }
  }
  return items
}

/** Which ads endpoints write through to a peer command, and which only project. */
export const ADS_WRITE_THROUGH: Record<AdsEndpoint, 'orders' | 'settlements' | 'snapshot'> = {
  ads_overview: 'snapshot',
  ads_orders: 'orders',
  ads_site_sales: 'snapshot',
  ads_mp_sales: 'snapshot',
  ads_summary: 'snapshot',
  ads_settlements: 'settlements',
  ads_ad_types: 'snapshot',
  ads_prices: 'snapshot',
  ads_costs: 'snapshot',
}
