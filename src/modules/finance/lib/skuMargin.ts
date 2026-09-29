import type { EntityManager } from '@mikro-orm/postgresql'
import { toAmountString, toScaledUnits } from '../../trade_docs/lib/money'
import { loadInventoryValue } from './costResolver'
import { invertRate, loadRateRows, resolveCnyRate } from '../../currency_policy/lib/rateLookup'

/**
 * SKU 毛利 — the RU per-SKU sales snapshot beside the CN landed cost.
 *
 * The comparison is deliberately staged rather than collapsed:
 *
 * 1. The RU row (`qty`, `revenue`, `platformCosts`, `adSpendLive`, `marginSales`) is reported as it
 *    arrived, in ₽.
 * 2. The CN landed unit cost is reported in ¥, with the source that answered.
 * 3. **A margin that mixes the two is only computed when an FX rate exists**, and then it is labelled
 *    with the rate used. Without a rate the row says so (`rateMissing`) instead of subtracting ¥ from
 *    ₽ — and a row whose difference from the RU page exceeds the tolerance is listed separately as a
 *    candidate for reconciliation, never silently corrected.
 */

const AMOUNT_SCALE = 2
const MARGIN_PERCENT_TOLERANCE = 0.2
const MARGIN_AMOUNT_TOLERANCE = 20
/** The ₽ tolerance as scaled integer units at {@link AMOUNT_SCALE}, so the comparison is exact. */
const MARGIN_AMOUNT_TOLERANCE_UNITS = BigInt(MARGIN_AMOUNT_TOLERANCE) * 10n ** BigInt(AMOUNT_SCALE)

export type SkuMarginRow = {
  sku: string
  quantity: string
  revenue: string | null
  currency: string
  platformCosts: string | null
  adSpend: string | null
  /** The margin the RU page reports, as a percentage and as an amount, untouched. */
  ruMarginPercent: string | null
  ruMarginAmount: string | null
  /** The CN landed unit cost of the SKU, in CNY; `null` = nothing could price it. */
  cnLandedUnitCostCny: string | null
  cnCostCny: string | null
  cnSource: 'landed' | 'price_tier' | 'missing'
  /** The CN margin in the RU currency, computed only when a rate exists. */
  cnMarginAmount: string | null
  cnMarginPercent: string | null
  /** The rate used (RU per 1 CNY), echoed so the number can be re-derived. */
  rateRuPerCny: string | null
  rateMissing: boolean
  /** `null` when the comparison could not be made (no RU margin or no rate). */
  discrepancy: { percentPoints: string | null; amount: string | null } | null
  outsideTolerance: boolean
}

export type SkuMarginResult = {
  periodStart: string
  periodEnd: string
  asOf: string | null
  rows: SkuMarginRow[]
  /** The rows a human must look at, in the order they were found. */
  reconciliation: Array<{ sku: string; reason: string }>
  notes: string[]
}

type SiteSalesSnapshotRow = {
  as_of?: string
  payload: {
    sku?: unknown
    qty?: unknown
    revenue?: { amount?: unknown; currency?: unknown } | null
    platform_costs?: { amount?: unknown } | null
    ad_spend_live?: { amount?: unknown } | null
    margin_sales?: { amount?: unknown } | null
    margin_sales_percent?: unknown
    period_start?: unknown
    period_end?: unknown
    is_partial?: unknown
  }
}

/**
 * RU per-CNY rate for the RU currency, read from the same rate table the rest of the app uses.
 * Returns `null` when no row is stored — the caller must then refuse to mix the currencies.
 */
export async function loadRuPerCnyRate(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  ruCurrency: string,
): Promise<string | null> {
  if (ruCurrency.toUpperCase() === 'CNY') return '1'
  const rows = await loadRateRows(em, scope, [ruCurrency])
  const rate = resolveCnyRate(ruCurrency, rows)
  // `resolveCnyRate` answers CNY per one unit of the currency; the comparison needs the inverse,
  // quantized to the stored 8-decimal rate scale by the engine — never `1 / Number(...)`.
  return rate ? invertRate(rate.rate) : null
}

export async function loadSkuMargin(
  em: EntityManager,
  scope: { tenantId: string; organizationIds: string[] },
  input: { periodStart: string; periodEnd: string },
): Promise<SkuMarginResult> {
  const organizationIds = scope.organizationIds.length > 0 ? scope.organizationIds : ['00000000-0000-0000-0000-000000000000']
  const placeholders = organizationIds.map(() => '?').join(', ')
  const snapshots = (await em.fork().getConnection().execute<SiteSalesSnapshotRow[]>(
    `select payload, to_char(as_of, 'YYYY-MM-DD') as as_of
       from ru_sync_snapshots
      where tenant_id = ?
        and organization_id in (${placeholders})
        and endpoint = 'ads_site_sales'
        and payload->>'period_start' >= ?
        and payload->>'period_end' <= ?`,
    [scope.tenantId, ...organizationIds, input.periodStart, input.periodEnd],
  )) as SiteSalesSnapshotRow[]

  const inventory = await loadInventoryValue(em, scope)
  const costBySku = new Map(
    inventory.rows.flatMap((row) => (row.sku ? [[row.sku, row] as const] : [])),
  )

  const notes: string[] = []
  const reconciliation: Array<{ sku: string; reason: string }> = []
  const rows: SkuMarginRow[] = []
  let asOf: string | null = null

  for (const snapshot of snapshots) {
    const sku = typeof snapshot.payload.sku === 'string' ? snapshot.payload.sku : null
    if (!sku) continue
    if (snapshot.as_of && (asOf === null || snapshot.as_of > asOf)) asOf = snapshot.as_of

    const revenue = readAmount(snapshot.payload.revenue)
    const platformCosts = readAmount(snapshot.payload.platform_costs)
    const adSpend = readAmount(snapshot.payload.ad_spend_live)
    const ruMarginAmount = readAmount(snapshot.payload.margin_sales)
    const currency = revenue?.currency ?? ruMarginAmount?.currency ?? 'RUB'
    const quantity = typeof snapshot.payload.qty === 'string' ? snapshot.payload.qty : String(snapshot.payload.qty ?? '0')

    const cost = costBySku.get(sku)
    const cnLandedUnitCostCny = cost?.landedUnitCostCny ?? null
    const cnUnitCostCny = cost?.unitCostCny ?? null
    const cnSource: SkuMarginRow['cnSource'] = cost?.source ?? 'missing'
    const quantityUnits = toScaledUnits(quantity, AMOUNT_SCALE)
    const cnCostCny =
      cnUnitCostCny === null
        ? null
        : toAmountString(
            {
              units: (toScaledUnits(cnUnitCostCny, AMOUNT_SCALE) * quantityUnits) / 10n ** BigInt(AMOUNT_SCALE),
              scale: AMOUNT_SCALE,
            },
            AMOUNT_SCALE,
          )

    const rateRuPerCny = cnCostCny === null ? null : await loadRuPerCnyRate(em, { tenantId: scope.tenantId, organizationId: scope.organizationIds[0] }, currency)
    const rateMissing = cnCostCny !== null && rateRuPerCny === null

    let cnMarginAmount: string | null = null
    let cnMarginPercent: string | null = null
    if (revenue && cnCostCny !== null && rateRuPerCny !== null) {
      const costInRu = (toScaledUnits(cnCostCny, AMOUNT_SCALE) * toScaledUnits(rateRuPerCny, 8)) / 10n ** 8n
      const costs = toScaledUnits(platformCosts?.amount ?? '0', AMOUNT_SCALE) + toScaledUnits(adSpend?.amount ?? '0', AMOUNT_SCALE)
      const marginUnits = toScaledUnits(revenue.amount, AMOUNT_SCALE) - costs - costInRu
      cnMarginAmount = toAmountString({ units: marginUnits, scale: AMOUNT_SCALE }, AMOUNT_SCALE)
      const revenueUnits = toScaledUnits(revenue.amount, AMOUNT_SCALE)
      cnMarginPercent =
        revenueUnits === 0n
          ? null
          : ((Number(marginUnits) / Number(revenueUnits)) * 100).toFixed(2)
    }

    const ruMarginPercent =
      typeof snapshot.payload.margin_sales_percent === 'number' && Number.isFinite(snapshot.payload.margin_sales_percent)
        ? snapshot.payload.margin_sales_percent.toFixed(2)
        : null

    let discrepancy: SkuMarginRow['discrepancy'] = null
    let outsideTolerance = false
    if (ruMarginPercent !== null && cnMarginPercent !== null) {
      const percentPoints = Math.abs(Number(ruMarginPercent) - Number(cnMarginPercent))
      const amount =
        ruMarginAmount && cnMarginAmount
          ? Math.abs(Number(ruMarginAmount.amount) - Number(cnMarginAmount))
          : null
      discrepancy = {
        percentPoints: percentPoints.toFixed(2),
        amount: amount === null ? null : amount.toFixed(2),
      }
      outsideTolerance =
        percentPoints > MARGIN_PERCENT_TOLERANCE || (amount !== null && amount > MARGIN_AMOUNT_TOLERANCE)
      if (outsideTolerance) {
        reconciliation.push({
          sku,
          reason: `margin differs by ${percentPoints.toFixed(2)} п.п.${amount === null ? '' : ` / ${amount.toFixed(2)} ${currency}`}`,
        })
      }
    }

    rows.push({
      sku,
      quantity,
      revenue: revenue?.amount ?? null,
      currency,
      platformCosts: platformCosts?.amount ?? null,
      adSpend: adSpend?.amount ?? null,
      ruMarginPercent,
      ruMarginAmount: ruMarginAmount?.amount ?? null,
      cnLandedUnitCostCny,
      cnCostCny,
      cnSource,
      cnMarginAmount,
      cnMarginPercent,
      rateRuPerCny,
      rateMissing,
      discrepancy,
      outsideTolerance,
    })
  }

  if (rows.some((row) => row.rateMissing)) {
    notes.push('缺少汇率：中方成本无法折算成卢布，因此没有计算混合口径的毛利（不按 1 折算）。')
  }
  const unpriced = rows.filter((row) => row.cnSource === 'missing').length
  if (unpriced > 0) {
    notes.push(`${unpriced} 个 SKU 没有可用的单位成本：到岸与采购价档都取不到，毛利列为空。`)
  }

  rows.sort((left, right) => left.sku.localeCompare(right.sku))
  return { periodStart: input.periodStart, periodEnd: input.periodEnd, asOf, rows, reconciliation, notes }
}

function readAmount(value: unknown): { amount: string; currency: string } | null {
  if (!value || typeof value !== 'object') return null
  const record = value as { amount?: unknown; currency?: unknown }
  if (typeof record.amount !== 'string') return null
  return { amount: record.amount, currency: typeof record.currency === 'string' ? record.currency : 'RUB' }
}
