import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { toAmountString, toScaledUnits } from '../../trade_docs/lib/money'
import { eventsConfig } from '../events'
import type { RuEndpoint } from './endpoints/paths'

/**
 * 四预警 — the threshold crossing checks the pull runs after the endpoints whose data they read.
 *
 * Each check answers "does this condition hold now?" from the snapshots, and every holding condition
 * emits its typed event. Repeating the same alert is deliberately **not** suppressed here: the
 * notification layer refreshes a notification with the same `(type, groupKey)` instead of creating a
 * second one, so the dedupe window lives where the recipient sees it and not in a private table.
 *
 * Thresholds come from the RU data itself where the contract provides them (`overstock_days`,
 * `drr_target_percent`) and fall back to the contract's stated defaults, so a plan change on the RU
 * side moves the alert line instead of requiring a deployment.
 */

const logger = createLogger('ru_sync').child({ component: 'alerts' })

const AMOUNT_SCALE = 2
const DEFAULT_DRR_TARGET_PERCENT = 20
const DEFAULT_OVERSTOCK_DAYS = 240

/** Which endpoints each check depends on: the check runs when one of them finishes. */
export const ALERT_ENDPOINTS: Record<RuAlertKind, RuEndpoint[]> = {
  stockout: ['plan'],
  overstock: ['stock'],
  drr_threshold: ['ads_overview'],
  unrecognized_in_transit: ['unrecognized_inbound'],
}

export type RuAlertKind = 'stockout' | 'overstock' | 'drr_threshold' | 'unrecognized_in_transit'

export type RuAlert = {
  kind: RuAlertKind
  /** Stable identity of the condition, used as the notification's `groupKey`. */
  groupKey: string
  title: string
  body: string
  sourceEntityId: string
}

type SnapshotPayload = Record<string, unknown>

async function loadEndpointRows(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  endpoint: RuEndpoint,
): Promise<Array<{ asOf: string; payload: SnapshotPayload }>> {
  const rows = (await em.fork().getConnection().execute<Array<{ as_of: string; payload: SnapshotPayload }>>(
    `select to_char(as_of, 'YYYY-MM-DD') as as_of, payload
       from ru_sync_snapshots
      where tenant_id = ? and organization_id = ? and endpoint = ?
      order by as_of desc`,
    [scope.tenantId, scope.organizationId, endpoint],
  )) as Array<{ as_of: string; payload: SnapshotPayload }>
  if (rows.length === 0) return []
  const asOf = rows[0].as_of
  return rows.filter((row) => row.as_of === asOf).map((row) => ({ asOf, payload: row.payload }))
}

function readNumber(payload: SnapshotPayload, key: string): number | null {
  const value = payload[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readAmountText(payload: SnapshotPayload, key: string): string | null {
  const value = payload[key]
  if (!value || typeof value !== 'object') return null
  const record = value as { amount?: unknown; currency?: unknown }
  if (typeof record.amount !== 'string') return null
  const units = toScaledUnits(record.amount, AMOUNT_SCALE)
  return `${toAmountString({ units, scale: AMOUNT_SCALE }, AMOUNT_SCALE)} ${typeof record.currency === 'string' ? record.currency : ''}`.trim()
}

/**
 * The four checks. Each returns the conditions that currently hold; an empty list is the healthy
 * answer, not an error.
 */
export async function evaluateSupplyAlerts(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<RuAlert[]> {
  const alerts: RuAlert[] = []

  const [planRows, stockRows, overviewRows, unrecognizedRows, paramsRows] = await Promise.all([
    loadEndpointRows(em, scope, 'plan'),
    loadEndpointRows(em, scope, 'stock'),
    loadEndpointRows(em, scope, 'ads_overview'),
    loadEndpointRows(em, scope, 'unrecognized_inbound'),
    loadEndpointRows(em, scope, 'params'),
  ])

  const overstockDays =
    paramsRows.map((row) => readNumber(row.payload, 'overstock_days')).find((value) => value !== null) ?? DEFAULT_OVERSTOCK_DAYS

  // 1. 断货：a plan row that needs ordering now (overdue or deficit with stock on the way).
  for (const row of planRows) {
    const status = typeof row.payload.status === 'string' ? row.payload.status : ''
    if (status !== 'overdue' && status !== 'deficit_in_transit') continue
    const sku = typeof row.payload.sku === 'string' ? row.payload.sku : null
    if (!sku) continue
    const loss = readAmountText(row.payload, 'expected_loss')
    const recommended = typeof row.payload.recommended_qty === 'string' ? row.payload.recommended_qty : null
    alerts.push({
      kind: 'stockout',
      groupKey: `stockout:${sku}`,
      title: `断货预警 ${sku}`,
      body: `${status === 'overdue' ? '已过下单日' : '缺货但有在途'}${recommended ? `；建议订 ${recommended}` : ''}${
        loss ? `；不作为的损失 ${loss}` : ''
      }（快照 ${row.asOf}）`,
      sourceEntityId: sku,
    })
  }

  // 2. 超储：coverage beyond the threshold the RU side parameterized.
  for (const row of stockRows) {
    const coverage = readNumber(row.payload, 'coverage_days')
    if (coverage === null || coverage <= overstockDays) continue
    const sku = typeof row.payload.sku === 'string' ? row.payload.sku : null
    if (!sku) continue
    alerts.push({
      kind: 'overstock',
      groupKey: `overstock:${sku}`,
      title: `超储预警 ${sku}`,
      body: `覆盖 ${coverage} 天 > 阈值 ${overstockDays} 天${readAmountText(row.payload, 'stock_value') ? `；库存金额 ${readAmountText(row.payload, 'stock_value')}` : ''}（快照 ${row.asOf}）`,
      sourceEntityId: sku,
    })
  }

  // 3. ДРР 破线：both calibers are reported, and the alert fires on the accrued one (the honest
  //    numerator) with the live caliber named so nobody has to guess which number broke the line.
  for (const row of overviewRows) {
    const accrued = readNumber(row.payload, 'drr_percent')
    if (accrued === null) continue
    const target = readNumber(row.payload, 'drr_target_percent') ?? DEFAULT_DRR_TARGET_PERCENT
    if (accrued <= target) continue
    const live = readNumber(row.payload, 'drr_live_percent')
    const period = `${typeof row.payload.period_start === 'string' ? row.payload.period_start : '?'}~${
      typeof row.payload.period_end === 'string' ? row.payload.period_end : '?'
    }`
    alerts.push({
      kind: 'drr_threshold',
      groupKey: `drr:${period}`,
      title: `ДРР 破线 ${accrued}%`,
      body: `应计口径 ${accrued}% > 目标 ${target}%${live === null ? '' : `；实付口径 ${live}%`}（周期 ${period}）`,
      sourceEntityId: period,
    })
  }

  // 4. 未识别在途：reported, never deducted from demand.
  for (const row of unrecognizedRows) {
    const sku = typeof row.payload.sku === 'string' ? row.payload.sku : null
    if (!sku) continue
    const quantity = typeof row.payload.qty === 'string' ? row.payload.qty : null
    const reason = typeof row.payload.reason === 'string' ? row.payload.reason : 'unknown_code'
    alerts.push({
      kind: 'unrecognized_in_transit',
      groupKey: `unrecognized:${sku}`,
      title: `未识别在途 ${sku}`,
      body: `${quantity ?? '?'} 件（${reason}）不扣减需求，需人工跟进（快照 ${row.asOf}）`,
      sourceEntityId: sku,
    })
  }

  return alerts
}

/**
 * Evaluates the alerts one endpoint's data can decide, and emits one typed event per holding
 * condition. Called from the pull after the endpoint's walk has completed.
 */
export async function emitAlertsForEndpoint(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  endpoint: RuEndpoint,
  actor?: number,
): Promise<number> {
  const kinds = (Object.keys(ALERT_ENDPOINTS) as RuAlertKind[]).filter((kind) => ALERT_ENDPOINTS[kind].includes(endpoint))
  if (kinds.length === 0) return 0

  const alerts = (await evaluateSupplyAlerts(em, scope)).filter((alert) => kinds.includes(alert.kind))
  for (const alert of alerts) {
    await eventsConfig
      .emit(eventIdFor(alert.kind), {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        kind: alert.kind,
        groupKey: alert.groupKey,
        title: alert.title,
        body: alert.body,
        sourceEntityId: alert.sourceEntityId,
      })
      .catch((error) => {
        logger.warn('Failed to emit an alert event', { kind: alert.kind, err: error })
      })
  }
  if (alerts.length > 0) {
    logger.info('Threshold alerts emitted', { endpoint, count: alerts.length, actor: actor ?? null })
  }
  return alerts.length
}

function eventIdFor(kind: RuAlertKind) {
  switch (kind) {
    case 'stockout':
      return 'ru_sync.alert.stockout' as const
    case 'overstock':
      return 'ru_sync.alert.overstock' as const
    case 'drr_threshold':
      return 'ru_sync.alert.drr_threshold' as const
    case 'unrecognized_in_transit':
      return 'ru_sync.alert.unrecognized_in_transit' as const
  }
}
