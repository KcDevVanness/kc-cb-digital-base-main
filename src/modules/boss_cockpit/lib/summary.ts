import type { EntityManager } from '@mikro-orm/postgresql'
import { toAmountString } from '../../trade_docs/lib/money'
import { toScaledUnits } from '../../trade_docs/lib/money'
import { loadPayables, loadReceivables } from '../../finance/lib/ledger'
import { loadInventoryValue } from '../../finance/lib/costResolver'
import { loadRuHealth } from '../../ru_sync/lib/health'
import { loadSkuMap } from '../../ru_sync/lib/skuMap'
import { RU_PROVIDER_KEY } from '../../ru_sync/lib/adapter'

/**
 * 老板驾驶舱 summary — one read-only aggregation over the RU snapshot projections and the CN
 * ledgers, assembled per request.
 *
 * Three rules the shape of this result follows:
 *
 * - **Every number carries its currency, its `asOf` and its source.** A total without them is a
 *   number nobody can argue with; the cockpit's whole point is that the boss can ask "as of when,
 *   and from where".
 * - **Nothing is added across currencies.** The supply side is priced in ₽ and the shipment side in
 *   $, and neither is converted here — a converted total would need a rate and a date and would hide
 *   which figure moved.
 * - **A missing input is reported, never zeroed.** No snapshot yet → the group carries `null` and a
 *   `dataMissing` note; that is what makes the stale banner meaningful instead of decorative.
 */

const AMOUNT_SCALE = 4

export type MoneyByCurrency = { currencyCode: string; amount: string }

export type CockpitGroup<T> = {
  /** The snapshot date the numbers came from, `null` when nothing has been pulled yet. */
  asOf: string | null
  dataMissing: boolean
  values: T
}

export type CockpitSupply = {
  /** 缺口金额 — the value of the plan rows that need ordering (`overdue`, `deficit_in_transit`, `to_order_soon`). */
  gap: CockpitGroup<MoneyByCurrency[]>
  /** 在途金额 — the value of shipments the RU side reports as `in_transit`. */
  inTransitAmount: CockpitGroup<MoneyByCurrency[]>
  /** 在途件数 across `in_transit` and `production` shipments, per the same snapshot. */
  inTransitQuantity: CockpitGroup<string | null>
  /** 积压金额 — stock whose coverage exceeds the overstock threshold. */
  overstock: CockpitGroup<MoneyByCurrency[]>
  /** 未识别在途 — reported, and deliberately never deducted from demand. */
  unrecognizedInbound: CockpitGroup<{ rows: number; quantity: string }>
  /** How many SKUs the plan rows cover, for a sanity check against the RU page. */
  planSkus: CockpitGroup<number>
}

export type CockpitCash = {
  /** 应付未付, by currency (never summed across them). */
  payablesOutstanding: MoneyByCurrency[]
  /** 应收未收, by currency. */
  receivablesOutstanding: MoneyByCurrency[]
  inventoryValue: string
  inventoryValueAsOf: string
  /** Quantity nothing could price — reported, not valued at 0. */
  inventoryUnpriced: string
}

export type CockpitSkuCoverage = {
  mapped: number
  unmapped: number
  ignored: number
  total: number
  /** Percentage of decided codes that are mapped; `null` when there is nothing to decide yet. */
  coveragePercent: number | null
}

/** ДРР in both calibers, with the target line the alert uses. */
export type CockpitDrrValues = {
  accruedPercent: number | null
  livePercent: number | null
  targetPercent: number
  periodStart: string | null
  periodEnd: string | null
}
export type CockpitDrr = CockpitGroup<CockpitDrrValues>

/** 周复盘: the latest weekly site-sales rows, beside the ad efficiency they were bought with. */
export type CockpitWeeklyValues = {
  periodStart: string | null
  periodEnd: string | null
  sales: MoneyByCurrency[]
  quantity: string
  adSpend: MoneyByCurrency[]
  /** The margin percentage the RU page reports for the week; one number, not a recomputation. */
  marginPercent: number | null
}
export type CockpitWeekly = CockpitGroup<CockpitWeeklyValues>

export type CockpitSummary = {
  asOf: string | null
  suppliers: string[]
  stale: boolean
  staleAfterHours: number
  supply: CockpitSupply
  cash: CockpitCash | null
  sku: CockpitSkuCoverage
  drr: CockpitDrr
  weekly: CockpitWeekly
  /** The ОПИУ lives on the finance page; the cockpit links to it rather than duplicating its table. */
  profitLoss: { status: 'connected'; href: string; note: string }
  sources: Array<{ key: string; label: string; asOf: string | null; status: string }>
}

type SnapshotRow = { endpoint: string; payload: Record<string, unknown>; as_of: string }

async function loadLatestSnapshots(
  em: EntityManager,
  scope: { tenantId: string; organizationIds: string[] },
  endpoints: readonly string[],
): Promise<Map<string, { asOf: string; rows: Array<Record<string, unknown>> }>> {
  const organizationIds = scope.organizationIds.length > 0 ? scope.organizationIds : ['00000000-0000-0000-0000-000000000000']
  const placeholders = organizationIds.map(() => '?').join(', ')
  const rows = (await em.fork().getConnection().execute<SnapshotRow[]>(
    `select endpoint, payload, to_char(as_of, 'YYYY-MM-DD') as as_of
       from ru_sync_snapshots
      where tenant_id = ?
        and organization_id in (${placeholders})
        and endpoint in (${endpoints.map(() => '?').join(', ')})`,
    [scope.tenantId, ...organizationIds, ...endpoints],
  )) as SnapshotRow[]

  const byEndpoint = new Map<string, { asOf: string; rows: Array<Record<string, unknown>> }>()
  for (const row of rows) {
    const current = byEndpoint.get(row.endpoint)
    if (!current || row.as_of > current.asOf) {
      byEndpoint.set(row.endpoint, { asOf: row.as_of, rows: [row.payload] })
      continue
    }
    if (row.as_of === current.asOf) current.rows.push(row.payload)
  }
  return byEndpoint
}

function amountOf(payload: Record<string, unknown>, key: string): { amount: string; currencyCode: string } | null {
  const value = payload[key]
  if (!value || typeof value !== 'object') return null
  const record = value as { amount?: unknown; currency?: unknown }
  if (typeof record.amount !== 'string' || typeof record.currency !== 'string') return null
  return { amount: record.amount, currencyCode: record.currency }
}

function decimalOf(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key]
  return typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value) ? value : null
}

function sumByCurrency(entries: Array<{ amount: string; currencyCode: string }>): MoneyByCurrency[] {
  const totals = new Map<string, bigint>()
  for (const entry of entries) {
    totals.set(entry.currencyCode, (totals.get(entry.currencyCode) ?? 0n) + toScaledUnits(entry.amount, AMOUNT_SCALE))
  }
  return [...totals.entries()]
    .map(([currencyCode, units]) => ({
      currencyCode,
      amount: toAmountString({ units, scale: AMOUNT_SCALE }, AMOUNT_SCALE),
    }))
    .sort((left, right) => left.currencyCode.localeCompare(right.currencyCode))
}

/**
 * Builds one group from its snapshot, or the caller's empty shape when the endpoint has not been
 * pulled yet. The empty shape is explicit per group: a missing snapshot must never be silently
 * filled with a plausible default (an empty `{}` for ДРР would read as "0 %", which is a number).
 */
function groupOrMissing<T>(
  snapshot: { asOf: string; rows: Array<Record<string, unknown>> } | undefined,
  build: (rows: Array<Record<string, unknown>>) => T,
  fallback: T,
): CockpitGroup<T> {
  if (!snapshot) return { asOf: null, dataMissing: true, values: fallback }
  return { asOf: snapshot.asOf, dataMissing: false, values: build(snapshot.rows) }
}

export async function loadCockpitSummary(
  em: EntityManager,
  scope: { tenantId: string; organizationIds: string[] },
  options: { now?: Date } = {},
): Promise<CockpitSummary> {
  const [snapshots, health, skuMap, payables, receivables, inventory] = await Promise.all([
    loadLatestSnapshots(em, scope, [
      'plan',
      'shipments',
      'stock',
      'unrecognized_inbound',
      'params',
      'ads_overview',
      'ads_site_sales',
    ]),
    loadRuHealth(em, scope, RU_PROVIDER_KEY, options),
    loadSkuMap(em, scope, { status: 'all', pageSize: 1 }),
    loadPayables(em, scope),
    loadReceivables(em, scope),
    loadInventoryValue(em, scope),
  ])

  const plan = groupOrMissing(snapshots.get('plan'), (rows) => {
    const gapRows = rows.filter((row) => ['overdue', 'deficit_in_transit', 'to_order_soon'].includes(String(row.status)))
    const amounts = gapRows
      .map((row) => amountOf(row, 'order_amount'))
      .filter((value): value is { amount: string; currencyCode: string } => value !== null)
    return { byCurrency: sumByCurrency(amounts), skus: gapRows.length }
  }, { byCurrency: [], skus: 0 })

  const shipments = groupOrMissing(snapshots.get('shipments'), (rows) => {
    const inTransit = rows.filter((row) => String(row.status) === 'in_transit')
    const amounts = inTransit
      .map((row) => amountOf(row, 'total_amount'))
      .filter((value): value is { amount: string; currencyCode: string } => value !== null)
    const inProductionOrTransit = rows.filter((row) => ['in_transit', 'production'].includes(String(row.status)))
    const quantities = inProductionOrTransit
      .map((row) => decimalOf(row, 'total_qty'))
      .filter((value): value is string => value !== null)
    const quantityUnits = quantities.reduce((total, value) => total + toScaledUnits(value, AMOUNT_SCALE), 0n)
    return {
      byCurrency: sumByCurrency(amounts),
      quantity: quantities.length === 0 ? null : toAmountString({ units: quantityUnits, scale: AMOUNT_SCALE }, AMOUNT_SCALE),
      inTransitCount: inTransit.length,
    }
  }, { byCurrency: [], quantity: null, inTransitCount: 0 })

  const overstockThreshold = (() => {
    const params = snapshots.get('params')
    const raw = params?.rows[0]?.overstock_days
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : 240
  })()

  const stock = groupOrMissing(snapshots.get('stock'), (rows) => {
    const overstockRows = rows.filter((row) => {
      const coverage = row.coverage_days
      return typeof coverage === 'number' && coverage > overstockThreshold
    })
    const amounts = overstockRows
      .map((row) => amountOf(row, 'stock_value'))
      .filter((value): value is { amount: string; currencyCode: string } => value !== null)
    return { byCurrency: sumByCurrency(amounts), skus: overstockRows.length }
  }, { byCurrency: [], skus: 0 })

  const unrecognized = groupOrMissing(snapshots.get('unrecognized_inbound'), (rows) => {
    const quantities = rows
      .map((row) => decimalOf(row, 'qty'))
      .filter((value): value is string => value !== null)
    const units = quantities.reduce((total, value) => total + toScaledUnits(value, AMOUNT_SCALE), 0n)
    return { rows: rows.length, quantity: toAmountString({ units, scale: AMOUNT_SCALE }, AMOUNT_SCALE) }
  }, { rows: 0, quantity: '0.0000' })

  const overview = groupOrMissing(snapshots.get('ads_overview'), (rows) => {
    const row = rows[0] ?? {}
    return {
      accruedPercent: typeof row.drr_percent === 'number' ? row.drr_percent : null,
      livePercent: typeof row.drr_live_percent === 'number' ? row.drr_live_percent : null,
      targetPercent: typeof row.drr_target_percent === 'number' ? row.drr_target_percent : 20,
      periodStart: typeof row.period_start === 'string' ? row.period_start : null,
      periodEnd: typeof row.period_end === 'string' ? row.period_end : null,
    }
  }, { accruedPercent: null, livePercent: null, targetPercent: 20, periodStart: null, periodEnd: null })

  const weeklySales = groupOrMissing(snapshots.get('ads_site_sales'), (rows) => {
    // The latest week present in the snapshot, and only its rows: a weekly review must not mix two
    // weeks because both happened to be in the projection.
    const latest = rows
      .map((row) => (typeof row.period_start === 'string' ? row.period_start : ''))
      .filter((value) => value.length > 0)
      .sort()
      .at(-1)
    const weekRows = rows.filter((row) => row.period_start === latest)
    const revenues = weekRows
      .map((row) => amountOf(row, 'revenue'))
      .filter((value): value is { amount: string; currencyCode: string } => value !== null)
    const adSpends = weekRows
      .map((row) => amountOf(row, 'ad_spend_live'))
      .filter((value): value is { amount: string; currencyCode: string } => value !== null)
    const quantities = weekRows
      .map((row) => decimalOf(row, 'qty'))
      .filter((value): value is string => value !== null)
    const quantityUnits = quantities.reduce((total, value) => total + toScaledUnits(value, AMOUNT_SCALE), 0n)
    const margins = weekRows
      .map((row) => (typeof row.margin_sales_percent === 'number' ? row.margin_sales_percent : null))
      .filter((value): value is number => value !== null)
    return {
      periodStart: latest && latest.length > 0 ? latest : null,
      periodEnd: weekRows.find((row) => typeof row.period_end === 'string')?.period_end as string | undefined ?? null,
      sales: sumByCurrency(revenues),
      quantity: toAmountString({ units: quantityUnits, scale: AMOUNT_SCALE }, AMOUNT_SCALE),
      adSpend: sumByCurrency(adSpends),
      marginPercent: margins.length === 0 ? null : Math.round((margins.reduce((sum, value) => sum + value, 0) / margins.length) * 10) / 10,
    }
  }, { periodStart: null, periodEnd: null, sales: [], quantity: '0.0000', adSpend: [], marginPercent: null })

  const payablesOutstanding = sumByCurrency(
    payables.groups.map((group) => ({ amount: group.outstandingAmount, currencyCode: group.currencyCode })),
  )
  const receivablesOutstanding = sumByCurrency(
    receivables.totalsByCurrency.flatMap((total) =>
      total.outstandingAmount === null ? [] : [{ amount: total.outstandingAmount, currencyCode: total.currencyCode }],
    ),
  )

  const totalCodes = skuMap.counts.mapped + skuMap.counts.ignored + skuMap.counts.unmapped
  const decided = skuMap.counts.mapped + skuMap.counts.ignored

  return {
    asOf: plan.asOf ?? shipments.asOf ?? stock.asOf ?? null,
    suppliers: [...new Set(payables.rows.map((row) => row.supplierName ?? row.supplierId))].sort(),
    stale: health.stale,
    staleAfterHours: health.staleAfterHours,
    supply: {
      gap: { asOf: plan.asOf, dataMissing: plan.dataMissing, values: plan.values.byCurrency },
      inTransitAmount: { asOf: shipments.asOf, dataMissing: shipments.dataMissing, values: shipments.values.byCurrency },
      inTransitQuantity: { asOf: shipments.asOf, dataMissing: shipments.dataMissing, values: shipments.values.quantity },
      overstock: { asOf: stock.asOf, dataMissing: stock.dataMissing, values: stock.values.byCurrency },
      unrecognizedInbound: {
        asOf: unrecognized.asOf,
        dataMissing: unrecognized.dataMissing,
        values: unrecognized.values,
      },
      planSkus: { asOf: plan.asOf, dataMissing: plan.dataMissing, values: plan.values.skus },
    },
    cash: {
      payablesOutstanding,
      receivablesOutstanding,
      inventoryValue: inventory.totals.value,
      inventoryValueAsOf: inventory.asOf,
      inventoryUnpriced: inventory.totals.missingQuantity,
    },
    sku: {
      mapped: skuMap.counts.mapped,
      unmapped: skuMap.counts.unmapped,
      ignored: skuMap.counts.ignored,
      total: totalCodes,
      coveragePercent: decided === 0 ? null : Math.round((skuMap.counts.mapped / decided) * 1000) / 10,
    },
    drr: { asOf: overview.asOf, dataMissing: overview.dataMissing, values: overview.values },
    weekly: { asOf: weeklySales.asOf, dataMissing: weeklySales.dataMissing, values: weeklySales.values },
    profitLoss: {
      status: 'connected',
      href: '/backend/finance/profit-loss',
      note: 'The monthly ОПИУ lives on the profit-and-loss page, in the RU row order, with the CN cost line kept apart.',
    },
    sources: [
      ...health.endpoints.map((endpoint) => ({
        key: `ru.${endpoint.endpoint}`,
        label: endpoint.path,
        asOf: endpoint.lastAsOf,
        status: endpoint.status,
      })),
      { key: 'cn.payables', label: 'purchasing', asOf: null, status: 'ok' },
      { key: 'cn.inventory', label: 'wms + finance', asOf: inventory.asOf, status: 'ok' },
    ],
  }
}
