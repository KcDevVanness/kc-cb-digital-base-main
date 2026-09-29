import type { EntityManager } from '@mikro-orm/postgresql'
import { toAmountString, toScaledUnits } from '../../trade_docs/lib/money'
import { loadInventoryValue } from './costResolver'

/**
 * 月损益（ОПИУ 行项） — read-only, derived per request.
 *
 * Three rules the shape follows:
 *
 * - **Rows are named like the RU ОПИУ** (`Продажи`, `Расходы площадки`, …) in the same order, so the
 *   monthly close can be read side by side with the RU page instead of translated first.
 * - **A caliber never mixes.** `basis=fact` reads the ОПИУ view (Продажи = facts); `basis=forecast`
 *   reads the Заказы metrics. Every row carries the caliber it was read under, and the two are never
 *   added together — a forecast in the closing column is how a monthly close stops being one.
 * - **The CN cost line keeps its own currency.** The RU lines are ₽, the CN landed cost is ¥;
 *   combining them would need a rate and a date, so the cost row is reported beside them with its
 *   own currency and `source`, and a combined margin is not invented here.
 */

const AMOUNT_SCALE = 2

export type ProfitLossBasis = 'fact' | 'forecast'

export type ProfitLossLineKey =
  | 'sales'
  | 'coinvest'
  | 'platformFees'
  | 'adSpend'
  | 'cost'
  | 'marginalProfit'
  | 'roi'

export type ProfitLossLine = {
  line: ProfitLossLineKey
  /** The RU ОПИУ row name, so the two pages line up without a translation table. */
  label: string
  amount: string | null
  percent: string | null
  currency: string | null
  source: 'ru_snapshot' | 'cn_landed' | 'cn_price_tier' | 'cn_missing' | 'not_connected'
  caliber: ProfitLossBasis
  /** Months this line was summed over (the RU summary is monthly). */
  months: string[]
}

export type ProfitLossResult = {
  periodStart: string
  periodEnd: string
  channel: string
  basis: ProfitLossBasis
  asOf: string | null
  rows: ProfitLossLine[]
  /** Per-currency sums — three currencies are not one number. */
  totalsByCurrency: Array<{ currencyCode: string; amount: string }>
  /** Why a block is empty, when it is: the qualification for every absent row. */
  notes: string[]
}

const OPIOU_LINES: Array<{ metric: string; line: ProfitLossLineKey; label: string }> = [
  { metric: 'sales', line: 'sales', label: 'Продажи' },
  { metric: 'coinvest', line: 'coinvest', label: 'Соинвест площадки' },
  { metric: 'marketplace_costs', line: 'platformFees', label: 'Расходы площадки' },
  { metric: 'ads', line: 'adSpend', label: 'Реклама' },
  { metric: 'marginal_profit', line: 'marginalProfit', label: 'Маржинальная' },
  { metric: 'roi', line: 'roi', label: 'ROI' },
]

const METRICS_LINES: Array<{ metric: string; line: ProfitLossLineKey; label: string }> = [
  { metric: 'orders_revenue', line: 'sales', label: 'Заказы' },
  { metric: 'marketplace_fees', line: 'platformFees', label: 'Удержания' },
  { metric: 'ad_spend_drr', line: 'adSpend', label: 'Реклама' },
  { metric: 'margin_orders', line: 'marginalProfit', label: 'Маржа по заказам' },
]

type SummarySnapshotRow = {
  as_of?: string
  payload: {
    channel?: unknown
    month?: unknown
    metric?: unknown
    value_amount?: { amount?: unknown; currency?: unknown } | null
    value_percent?: unknown
    is_closed?: unknown
  }
}

function monthsInPeriod(periodStart: string, periodEnd: string): string[] {
  const start = new Date(`${periodStart}T00:00:00.000Z`)
  const end = new Date(`${periodEnd}T00:00:00.000Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return []
  const months: string[] = []
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1))
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1))
  while (cursor <= last) {
    months.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`)
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return months
}

/**
 * The CN cost of the period's sold quantity, read through the same resolver the inventory value uses
 * (latest landed cost, else the purchase tier). `source` says which one answered, so the profit
 * ledger never presents a tier price as a landed cost.
 */
async function loadCnCostOfPeriod(
  em: EntityManager,
  scope: { tenantId: string; organizationIds: string[] },
): Promise<{ amountCny: string; source: ProfitLossLine['source']; unpricedQuantity: string }> {
  const inventory = await loadInventoryValue(em, scope)
  let totalUnits = 0n
  let unpricedUnits = 0n
  let anyLanded = false
  let anyTier = false
  for (const row of inventory.rows) {
    const quantityUnits = toScaledUnits(row.quantity, AMOUNT_SCALE)
    if (row.unitCostCny === null) {
      unpricedUnits += quantityUnits
      continue
    }
    if (row.source === 'landed') anyLanded = true
    if (row.source === 'price_tier') anyTier = true
    const costUnits = toScaledUnits(row.unitCostCny, AMOUNT_SCALE)
    totalUnits += (quantityUnits * costUnits) / 10n ** BigInt(AMOUNT_SCALE)
  }
  // A landed cost wins per row and the tally says which sources were actually used: both present
  // means the ledger is part landed, part tier, and the row is labelled by the stronger source.
  const source: ProfitLossLine['source'] =
    totalUnits === 0n ? 'cn_missing' : anyLanded ? 'cn_landed' : anyTier ? 'cn_price_tier' : 'cn_missing'
  return {
    amountCny: toAmountString({ units: totalUnits, scale: AMOUNT_SCALE }, AMOUNT_SCALE),
    source,
    unpricedQuantity: toAmountString({ units: unpricedUnits, scale: AMOUNT_SCALE }, AMOUNT_SCALE),
  }
}

export async function loadProfitLoss(
  em: EntityManager,
  scope: { tenantId: string; organizationIds: string[] },
  input: { periodStart: string; periodEnd: string; channel?: string; basis: ProfitLossBasis },
): Promise<ProfitLossResult> {
  const months = monthsInPeriod(input.periodStart, input.periodEnd)
  const channel = input.channel ?? 'total'
  const view = input.basis === 'fact' ? 'opiu' : 'metrics'
  const lines = input.basis === 'fact' ? OPIOU_LINES : METRICS_LINES

  const organizationIds = scope.organizationIds.length > 0 ? scope.organizationIds : ['00000000-0000-0000-0000-000000000000']
  const placeholders = organizationIds.map(() => '?').join(', ')
  const rows = (await em.fork().getConnection().execute<SummarySnapshotRow[]>(
    `select payload, to_char(as_of, 'YYYY-MM-DD') as as_of
       from ru_sync_snapshots
      where tenant_id = ?
        and organization_id in (${placeholders})
        and endpoint = 'ads_summary'
        and payload->>'view' = ?
        and payload->>'channel' = ?
        and payload->>'month' in (${months.map(() => '?').join(', ') || "''"})`,
    [scope.tenantId, ...organizationIds, view, channel, ...(months.length > 0 ? months : [''])],
  )) as SummarySnapshotRow[]

  const byMetric = new Map<string, SummarySnapshotRow['payload'][]>()
  let asOf: string | null = null
  for (const row of rows) {
    const metric = typeof row.payload.metric === 'string' ? row.payload.metric : null
    if (!metric) continue
    const list = byMetric.get(metric) ?? []
    list.push(row.payload)
    byMetric.set(metric, list)
    // Every line carries the snapshot date it was read from: the newest across the rows used.
    if (row.as_of && (asOf === null || row.as_of > asOf)) asOf = row.as_of
  }

  const notes: string[] = []
  const result: ProfitLossLine[] = lines.map((definition) => {
    const entries = byMetric.get(definition.metric) ?? []
    if (entries.length === 0) {
      return {
        line: definition.line,
        label: definition.label,
        amount: null,
        percent: null,
        currency: null,
        source: 'not_connected',
        caliber: input.basis,
        months,
      }
    }
    let units = 0n
    let currency: string | null = null
    let percentUnits = 0n
    let percentCount = 0
    for (const entry of entries) {
      const amount = entry.value_amount?.amount
      const code = entry.value_amount?.currency
      if (typeof amount === 'string' && typeof code === 'string') {
        units += toScaledUnits(amount, AMOUNT_SCALE)
        currency = code
      }
      if (typeof entry.value_percent === 'number' && Number.isFinite(entry.value_percent)) {
        percentUnits += BigInt(Math.round(entry.value_percent * 100))
        percentCount += 1
      }
    }
    return {
      line: definition.line,
      label: definition.label,
      amount: units === 0n ? null : toAmountString({ units, scale: AMOUNT_SCALE }, AMOUNT_SCALE),
      percent: percentCount === 0 ? null : (Number(percentUnits) / 100 / percentCount).toFixed(2),
      currency,
      source: 'ru_snapshot' as const,
      caliber: input.basis,
      months,
    }
  })

  const cnCost = await loadCnCostOfPeriod(em, scope)
  result.push({
    line: 'cost',
    label: 'Себестоимость（中方到岸成本）',
    amount: cnCost.amountCny,
    percent: null,
    currency: 'CNY',
    source: cnCost.source,
    caliber: input.basis,
    months,
  })
  if (cnCost.unpricedQuantity !== '0.00') {
    notes.push(
      `库存中有 ${cnCost.unpricedQuantity} 件没有可用的单位成本，未计入成本行（未按 0 计）。`,
    )
  }
  if (result.every((row) => row.line === 'cost' || row.source === 'not_connected')) {
    notes.push('所选期间没有俄方汇总快照：请先跑 ads_summary 同步。')
  }
  notes.push('Косвенные расходы и налоги 口径未定，本行不建、不计入合计。')

  const totals = new Map<string, bigint>()
  for (const row of result) {
    if (row.amount === null || row.currency === null) continue
    if (row.line === 'marginalProfit' || row.line === 'roi') continue // derived lines, not addends
    totals.set(row.currency, (totals.get(row.currency) ?? 0n) + toScaledUnits(row.amount, AMOUNT_SCALE))
  }

  return {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    channel,
    basis: input.basis,
    asOf,
    rows: result,
    totalsByCurrency: [...totals.entries()]
      .map(([currencyCode, units]) => ({ currencyCode, amount: toAmountString({ units, scale: AMOUNT_SCALE }, AMOUNT_SCALE) }))
      .sort((left, right) => left.currencyCode.localeCompare(right.currencyCode)),
    notes,
  }
}
