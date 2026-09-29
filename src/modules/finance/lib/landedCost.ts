import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/postgresql'
import { parseExactDecimal } from '@open-mercato/core/modules/dashboards/lib/exactDecimal'
import { AMOUNT_SCALE, divideHalfUp, multiplyExactDecimal, PRICE_SCALE, quantizeExactDecimal, toAmountString, toScaledUnits } from '../../trade_docs/lib/money'
import { CNY_DISPLAY_CURRENCY, loadRateRows, resolveCnyRate } from '../../currency_policy/lib/rateLookup'
import { FinanceShipmentCost } from '../data/entities'
import { rateScope, type ReadScope } from './scope'
import {
  findShipmentIdsBySku,
  loadProductRefs,
  loadShipmentPurchaseLines,
  loadShipmentRef,
  type ShipmentPurchaseLineRow,
} from './peerReads'

/**
 * The landed cost of one container: purchase value plus the container's fees, spread over the
 * purchase lines that are physically on board.
 *
 * Two rules are deliberate and load-bearing:
 *
 * 1. **One allocation rule, shared with the tax-refund allocation.** Shares are
 *    `HALF_UP(fee × wᵢ / Σw, 2)`, the rounding remainder lands on the largest share, and ties go to
 *    the lowest `lineNumber`. `divideHalfUp` is imported from the money engine so the two
 *    allocations cannot drift apart; the same remainder rule as `allocateTaxRefund` keeps
 *    Σ shares equal to the fee.
 * 2. **A missing rate never becomes a number.** A fee whose rate cannot be resolved is reported as
 *    `unconvertible` and removed from the allocation; a purchase line whose order currency cannot
 *    be resolved keeps its original amount and reports `rateMissing` with a `null` CNY unit cost.
 *    Never ×1, never 0.
 *
 * Everything here is derived per request — no allocation table exists, so editing a fee can never
 * leave a stale split behind.
 */

export type LandedCostFeeInput = {
  id: string
  costType: string
  allocationBasis: string
  /** Fee amount converted to CNY at {@link AMOUNT_SCALE}; `null` when no rate is available. */
  amountCny: string | null
  /** Raw values, echoed back so the screen can render the unconvertible row itself. */
  amount: string
  currencyCode: string
}

export type LandedCostWeightLine = {
  /** Stable key of the weight row (the purchase order line id). */
  key: string
  lineNumber: number
  /** `net_total` of the purchase line — the default basis. */
  amountWeight: string
  /** Quantity allocated to this container — the alternative basis. */
  quantityWeight: string
}

export type LandedCostAllocation = {
  /** Line key → allocated CNY at {@link AMOUNT_SCALE}. Every input line is present. */
  byLine: Map<string, string>
  allocatedTotal: string
  /** Fees with no resolvable rate: excluded from the allocation, reported, never spread at 1:1. */
  unconvertible: LandedCostFeeInput[]
  /** Fees whose chosen and fallback weights are both zero: nothing to spread them over. */
  unallocated: LandedCostFeeInput[]
}

/**
 * Spreads every convertible fee over the given weight lines.
 *
 * `allocationBasis = 'quantity'` allocates by allocated quantity, anything else by net amount; a
 * basis whose weights are all zero falls back to the other dimension, and when both are zero the
 * fee is reported as unallocated instead of being forced onto one line.
 */
export function allocateLandedCost(
  fees: readonly LandedCostFeeInput[],
  lines: readonly LandedCostWeightLine[],
): LandedCostAllocation {
  const byLine = new Map<string, bigint>()
  for (const line of lines) byLine.set(line.key, 0n)

  const unconvertible: LandedCostFeeInput[] = []
  const unallocated: LandedCostFeeInput[] = []
  const amountWeights = lines.map((line) => toScaledUnits(line.amountWeight, AMOUNT_SCALE))
  const quantityWeights = lines.map((line) => toScaledUnits(line.quantityWeight, AMOUNT_SCALE))

  for (const fee of fees) {
    const parsedTarget = fee.amountCny === null ? null : parseExactDecimal(fee.amountCny)
    if (!parsedTarget) {
      unconvertible.push(fee)
      continue
    }
    const target = quantizeExactDecimal(parsedTarget, AMOUNT_SCALE)

    const primary = fee.allocationBasis === 'quantity' ? quantityWeights : amountWeights
    const fallback = fee.allocationBasis === 'quantity' ? amountWeights : quantityWeights
    const primaryTotal = primary.reduce((sum, units) => sum + units, 0n)
    const weights = primaryTotal !== 0n ? primary : fallback
    const denominator = weights.reduce((sum, units) => sum + units, 0n)

    if (denominator === 0n) {
      unallocated.push(fee)
      continue
    }

    const shares = weights.map((units) => divideHalfUp(target.units * units, denominator))
    const allocated = shares.reduce((sum, units) => sum + units, 0n)
    const remainder = target.units - allocated

    if (remainder !== 0n) {
      // The remainder lands on the largest share; ties go to the lowest line number, then the
      // lowest key, so the winner is identical no matter which request ran the allocation.
      let winner = 0
      for (let index = 1; index < shares.length; index += 1) {
        const current = shares[index]
        const best = shares[winner]
        if (current > best) {
          winner = index
          continue
        }
        if (current !== best) continue
        const currentLine = lines[index]
        const bestLine = lines[winner]
        if (currentLine.lineNumber < bestLine.lineNumber) winner = index
        else if (currentLine.lineNumber === bestLine.lineNumber && currentLine.key < bestLine.key) winner = index
      }
      shares[winner] += remainder
    }

    lines.forEach((line, index) => {
      byLine.set(line.key, (byLine.get(line.key) ?? 0n) + shares[index])
    })
  }

  let allocatedUnits = 0n
  for (const units of byLine.values()) allocatedUnits += units

  const rendered = new Map<string, string>()
  for (const [key, units] of byLine) rendered.set(key, toAmountString({ units, scale: AMOUNT_SCALE }, AMOUNT_SCALE))

  return {
    byLine: rendered,
    allocatedTotal: toAmountString({ units: allocatedUnits, scale: AMOUNT_SCALE }, AMOUNT_SCALE),
    unconvertible,
    unallocated,
  }
}

export type LandedCostInputLine = {
  purchaseOrderLineId: string
  purchaseOrderId: string
  purchaseOrderNumber: string | null
  businessNumber: string | null
  lineNumber: number
  productId: string | null
  productTitle: string | null
  sku: string | null
  orderCurrencyCode: string
  netTotal: string
  allocatedQuantity: string
  /** CNY per one unit of `orderCurrencyCode`; `'1'` for CNY, `null` when unresolvable. */
  purchaseRateToCny: string | null
}

export type LandedCostLine = {
  purchaseOrderLineId: string
  purchaseOrderId: string
  purchaseOrderNumber: string | null
  businessNumber: string | null
  lineNumber: number
  productId: string | null
  productTitle: string | null
  sku: string | null
  currencyCode: string
  quantity: string
  purchaseAmountOriginal: string
  purchaseAmountCny: string | null
  allocatedCostCny: string
  landedTotalCny: string | null
  /** The CNY unit cost at {@link PRICE_SCALE} (4 decimals); `null` when the rate is missing. */
  landedUnitCostCny: string | null
  rateMissing: boolean
}

export type LandedCostSkuRow = {
  sku: string | null
  quantity: string
  purchaseAmountCny: string | null
  allocatedCostCny: string
  landedTotalCny: string | null
  /** The CNY unit cost at {@link PRICE_SCALE} (4 decimals); `null` when the rate is missing. */
  landedUnitCostCny: string | null
  rateMissing: boolean
  lineCount: number
}

export type LandedCostResult = {
  shipmentId: string
  shipmentNumber: string | null
  lines: LandedCostLine[]
  skuRows: LandedCostSkuRow[]
  unconvertibleFees: Array<{ id: string; costType: string; amount: string; currencyCode: string }>
  unallocatedFees: Array<{ id: string; costType: string; amount: string; currencyCode: string }>
  totals: {
    /** Σ of the convertible fee amounts in CNY. */
    feesCny: string
    /** Σ of the allocated shares in CNY — equals `feesCny` whenever no fee was unallocated. */
    allocatedCny: string
    purchaseCny: string
    landedCny: string
    /** Purchase lines whose order currency had no rate; their CNY columns stay empty. */
    linesMissingRate: number
  }
}

function sumUnits(values: readonly string[]): bigint {
  let total = 0n
  for (const value of values) total += toScaledUnits(value, AMOUNT_SCALE)
  return total
}

const PRICE_FACTOR = 10n ** BigInt(PRICE_SCALE)

/**
 * The unit cost of a batch: its CNY total divided by its quantity, **at {@link PRICE_SCALE}** — a
 * unit price keeps 4 decimals, unlike a line/total amount.
 */
function perUnitAmount(totalCny: string, quantity: string): string | null {
  const quantityUnits = toScaledUnits(quantity, AMOUNT_SCALE)
  if (quantityUnits === 0n) return null
  const totalUnits = toScaledUnits(totalCny, AMOUNT_SCALE)
  // Scale-corrected half-up division: (units × 10^PRICE_SCALE) / quantityUnits keeps the result at
  // the unit-price scale instead of collapsing it to a whole number.
  return toAmountString(
    { units: divideHalfUp(totalUnits * PRICE_FACTOR, quantityUnits), scale: PRICE_SCALE },
    PRICE_SCALE,
  )
}

/**
 * Assembles the per-line and per-SKU view from the already-resolved rates and the allocation.
 * Pure: the loader below does the I/O, this function does the arithmetic.
 */
export function assembleLandedCost(input: {
  shipmentId: string
  shipmentNumber: string | null
  lines: readonly LandedCostInputLine[]
  /** Fee rows with their CNY value already resolved (`null` = no rate). */
  fees: readonly LandedCostFeeInput[]
  allocation: LandedCostAllocation
}): LandedCostResult {
  const lines: LandedCostLine[] = input.lines.map((line) => {
    const allocatedCostCny = input.allocation.byLine.get(line.purchaseOrderLineId) ?? '0.00'
    const rateMissing = line.purchaseRateToCny === null
    const purchase = rateMissing ? null : parseExactDecimal(line.netTotal)
    const rate = rateMissing ? null : parseExactDecimal(line.purchaseRateToCny)
    const purchaseAmountCny =
      purchase && rate
        ? toAmountString(quantizeExactDecimal(multiplyExactDecimal(purchase, rate), AMOUNT_SCALE), AMOUNT_SCALE)
        : null
    const landedTotalCny =
      purchaseAmountCny === null
        ? null
        : toAmountString(
            { units: sumUnits([purchaseAmountCny, allocatedCostCny]), scale: AMOUNT_SCALE },
            AMOUNT_SCALE,
          )

    return {
      purchaseOrderLineId: line.purchaseOrderLineId,
      purchaseOrderId: line.purchaseOrderId,
      purchaseOrderNumber: line.purchaseOrderNumber,
      businessNumber: line.businessNumber,
      lineNumber: line.lineNumber,
      productId: line.productId,
      productTitle: line.productTitle,
      sku: line.sku,
      currencyCode: line.orderCurrencyCode,
      quantity: line.allocatedQuantity,
      purchaseAmountOriginal: line.netTotal,
      purchaseAmountCny,
      allocatedCostCny,
      landedTotalCny,
      landedUnitCostCny: landedTotalCny === null ? null : perUnitAmount(landedTotalCny, line.allocatedQuantity),
      rateMissing,
    }
  })

  const skuBuckets = new Map<string, LandedCostLine[]>()
  for (const line of lines) {
    const key = line.sku ?? ''
    const bucket = skuBuckets.get(key) ?? []
    bucket.push(line)
    skuBuckets.set(key, bucket)
  }

  const skuRows: LandedCostSkuRow[] = [...skuBuckets.entries()].map(([key, bucket]) => {
    const rateMissing = bucket.some((line) => line.rateMissing)
    const purchaseAmountCny = bucket.some((line) => line.purchaseAmountCny === null)
      ? null
      : toAmountString(
          { units: sumUnits(bucket.map((line) => line.purchaseAmountCny as string)), scale: AMOUNT_SCALE },
          AMOUNT_SCALE,
        )
    const allocatedCostCny = toAmountString(
      { units: sumUnits(bucket.map((line) => line.allocatedCostCny)), scale: AMOUNT_SCALE },
      AMOUNT_SCALE,
    )
    const landedTotalCny =
      purchaseAmountCny === null
        ? null
        : toAmountString(
            { units: sumUnits([purchaseAmountCny, allocatedCostCny]), scale: AMOUNT_SCALE },
            AMOUNT_SCALE,
          )
    return {
      sku: key.length > 0 ? key : null,
      quantity: toAmountString({ units: sumUnits(bucket.map((line) => line.quantity)), scale: AMOUNT_SCALE }, AMOUNT_SCALE),
      purchaseAmountCny,
      allocatedCostCny,
      landedTotalCny,
      landedUnitCostCny:
        landedTotalCny === null
          ? null
          : perUnitAmount(
              landedTotalCny,
              toAmountString({ units: sumUnits(bucket.map((line) => line.quantity)), scale: AMOUNT_SCALE }, AMOUNT_SCALE),
            ),
      rateMissing,
      lineCount: bucket.length,
    }
  })
  skuRows.sort((left, right) => (left.sku ?? '').localeCompare(right.sku ?? ''))

  const feesCny = toAmountString(
    {
      units: sumUnits(input.fees.flatMap((fee) => (fee.amountCny === null ? [] : [fee.amountCny]))),
      scale: AMOUNT_SCALE,
    },
    AMOUNT_SCALE,
  )
  const purchaseCny = toAmountString(
    { units: sumUnits(lines.flatMap((line) => (line.purchaseAmountCny === null ? [] : [line.purchaseAmountCny]))), scale: AMOUNT_SCALE },
    AMOUNT_SCALE,
  )
  const landedCny = toAmountString(
    { units: sumUnits(lines.flatMap((line) => (line.landedTotalCny === null ? [] : [line.landedTotalCny]))), scale: AMOUNT_SCALE },
    AMOUNT_SCALE,
  )

  return {
    shipmentId: input.shipmentId,
    shipmentNumber: input.shipmentNumber,
    lines,
    skuRows,
    unconvertibleFees: input.allocation.unconvertible.map((fee) => ({
      id: fee.id,
      costType: fee.costType,
      amount: fee.amount,
      currencyCode: fee.currencyCode,
    })),
    unallocatedFees: input.allocation.unallocated.map((fee) => ({
      id: fee.id,
      costType: fee.costType,
      amount: fee.amount,
      currencyCode: fee.currencyCode,
    })),
    totals: {
      feesCny,
      allocatedCny: input.allocation.allocatedTotal,
      purchaseCny,
      landedCny,
      linesMissingRate: lines.filter((line) => line.rateMissing).length,
    },
  }
}

export type LandedCostSkuContainerRow = {
  shipmentId: string
  shipmentNumber: string | null
  quantity: string
  allocatedCostCny: string
  purchaseAmountCny: string | null
  landedTotalCny: string | null
  /** The CNY unit cost at {@link PRICE_SCALE} (4 decimals); `null` when the rate is missing. */
  landedUnitCostCny: string | null
  rateMissing: boolean
}

export type LandedCostSkuReport = {
  sku: string
  containers: LandedCostSkuContainerRow[]
  totals: {
    quantity: string
    purchaseCny: string
    allocatedCny: string
    landedCny: string
    /** Quantity-weighted landed unit cost at {@link PRICE_SCALE} across the containers that could be priced. */
    landedUnitCostCny: string | null
    linesMissingRate: number
  }
  unconvertibleFees: Array<{
    id: string
    costType: string
    amount: string
    currencyCode: string
    shipmentId: string
    shipmentNumber: string | null
  }>
}

/**
 * 一个 SKU 的到岸成本… — the same derivation as one container, read across every container that
 * carries the SKU. The per-container rows stay visible, so the aggregate can be audited instead of
 * taken on faith.
 */
export async function loadLandedCostBySku(
  em: EntityManager,
  scope: ReadScope,
  sku: string,
): Promise<LandedCostSkuReport | null> {
  const shipmentIds = await findShipmentIdsBySku(em, scope, sku)

  const containers: LandedCostSkuContainerRow[] = []
  const unconvertibleFees: LandedCostSkuReport['unconvertibleFees'] = []
  let quantityUnits = 0n
  let purchaseUnits = 0n
  let allocatedUnits = 0n
  let landedUnits = 0n
  let linesMissingRate = 0

  for (const shipmentId of shipmentIds) {
    const result = await loadShipmentLandedCost(em, scope, shipmentId)
    if (!result) continue
    const row = result.skuRows.find((candidate) => candidate.sku === sku)
    if (!row) continue

    containers.push({
      shipmentId: result.shipmentId,
      shipmentNumber: result.shipmentNumber,
      quantity: row.quantity,
      allocatedCostCny: row.allocatedCostCny,
      purchaseAmountCny: row.purchaseAmountCny,
      landedTotalCny: row.landedTotalCny,
      landedUnitCostCny: row.landedUnitCostCny,
      rateMissing: row.rateMissing,
    })
    quantityUnits += toScaledUnits(row.quantity, AMOUNT_SCALE)
    allocatedUnits += toScaledUnits(row.allocatedCostCny, AMOUNT_SCALE)
    if (row.purchaseAmountCny !== null) purchaseUnits += toScaledUnits(row.purchaseAmountCny, AMOUNT_SCALE)
    if (row.landedTotalCny !== null) landedUnits += toScaledUnits(row.landedTotalCny, AMOUNT_SCALE)
    linesMissingRate += result.lines.filter((line) => line.sku === sku && line.rateMissing).length
    for (const fee of result.unconvertibleFees) {
      unconvertibleFees.push({ ...fee, shipmentId: result.shipmentId, shipmentNumber: result.shipmentNumber })
    }
  }

  if (containers.length === 0) return null

  const quantity = toAmountString({ units: quantityUnits, scale: AMOUNT_SCALE }, AMOUNT_SCALE)
  const landedCny = toAmountString({ units: landedUnits, scale: AMOUNT_SCALE }, AMOUNT_SCALE)
  return {
    sku,
    containers,
    totals: {
      quantity,
      purchaseCny: toAmountString({ units: purchaseUnits, scale: AMOUNT_SCALE }, AMOUNT_SCALE),
      allocatedCny: toAmountString({ units: allocatedUnits, scale: AMOUNT_SCALE }, AMOUNT_SCALE),
      landedCny,
      landedUnitCostCny: linesMissingRate > 0 ? null : perUnitAmount(landedCny, quantity),
      linesMissingRate,
    },
    unconvertibleFees,
  }
}

export type ShipmentCostRow = {
  id: string
  costType: string
  allocationBasis: string
  amount: string
  currencyCode: string
  exchangeRate: string | null
  shipmentId: string
}

/** The cost rows of one container that are still alive. */
export async function loadShipmentCostRows(
  em: EntityManager,
  scope: ReadScope,
  shipmentId: string,
): Promise<ShipmentCostRow[]> {
  const rows = await em.fork().find(
    FinanceShipmentCost,
    {
      tenantId: scope.tenantId,
      organizationId: { $in: scope.organizationIds },
      shipmentId,
      deletedAt: null,
    } as FilterQuery<FinanceShipmentCost>,
  )
  return rows.map((row) => ({
    id: String(row.id),
    costType: row.costType,
    allocationBasis: row.allocationBasis,
    amount: String(row.amount),
    currencyCode: row.currencyCode,
    exchangeRate: row.exchangeRate === null || row.exchangeRate === undefined ? null : String(row.exchangeRate),
    shipmentId: String(row.shipmentId),
  }))
}

/**
 * Resolves the CNY rate of a currency: `1` for CNY itself, the stored (or inverted) rate
 * otherwise, and `null` when neither direction is stored — the callers must then report the value
 * as unconvertible instead of inventing a rate.
 */
export async function resolveRateToCny(
  em: EntityManager,
  scope: ReadScope,
  currencyCode: string,
  explicitRate: string | null,
): Promise<string | null> {
  if (explicitRate !== null && explicitRate.trim().length > 0) return explicitRate
  if (currencyCode.toUpperCase() === CNY_DISPLAY_CURRENCY) return '1'
  const rows = await loadRateRows(em, rateScope(scope), [currencyCode])
  const resolved = resolveCnyRate(currencyCode, rows)
  return resolved ? resolved.rate : null
}

/** A fee's CNY value at the amount scale, or `null` when no rate could be resolved. */
export function feeAmountCny(row: ShipmentCostRow, rateToCny: string | null): string | null {
  if (rateToCny === null) return null
  const amount = parseExactDecimal(row.amount)
  const rate = parseExactDecimal(rateToCny)
  if (!amount || !rate) return null
  return toAmountString(quantizeExactDecimal(multiplyExactDecimal(amount, rate), AMOUNT_SCALE), AMOUNT_SCALE)
}

function toInputLine(row: ShipmentPurchaseLineRow, rateToCny: string | null): LandedCostInputLine {
  return {
    purchaseOrderLineId: row.purchaseOrderLineId,
    purchaseOrderId: row.purchaseOrderId,
    purchaseOrderNumber: row.purchaseOrderNumber,
    businessNumber: row.businessNumber,
    lineNumber: row.lineNumber,
    productId: row.productId,
    productTitle: row.productTitle,
    sku: row.sku,
    orderCurrencyCode: row.orderCurrencyCode,
    netTotal: row.netTotal,
    allocatedQuantity: row.allocatedQuantity,
    purchaseRateToCny: rateToCny,
  }
}

/**
 * The landed cost of one container, assembled from peer reads plus the module's own cost rows.
 * Returns `null` when the container does not exist in the caller's scope.
 */
export async function loadShipmentLandedCost(
  em: EntityManager,
  scope: ReadScope,
  shipmentId: string,
): Promise<LandedCostResult | null> {
  const shipment = await loadShipmentRef(em, scope, shipmentId)
  if (!shipment) return null

  const [peerLines, costRows] = await Promise.all([
    loadShipmentPurchaseLines(em, scope, shipmentId),
    loadShipmentCostRows(em, scope, shipmentId),
  ])

  const productRefs = await loadProductRefs(
    em,
    scope,
    peerLines.flatMap((line) => (line.productId ? [line.productId] : [])),
  )

  const currencies = [...new Set([
    ...peerLines.map((line) => line.orderCurrencyCode),
    ...costRows.map((row) => row.currencyCode),
  ])]
  const rateRows = await loadRateRows(em, rateScope(scope), currencies)
  const rateFor = (code: string, explicit: string | null): string | null => {
    if (explicit !== null && explicit.trim().length > 0) return explicit
    if (code.toUpperCase() === CNY_DISPLAY_CURRENCY) return '1'
    const resolved = resolveCnyRate(code, rateRows)
    return resolved ? resolved.rate : null
  }

  const inputLines = peerLines.map((line) => {
    const product = line.productId ? productRefs.get(line.productId) : undefined
    return toInputLine(
      { ...line, productTitle: product?.title ?? line.productTitle, sku: product?.sku ?? line.sku },
      rateFor(line.orderCurrencyCode, null),
    )
  })

  const fees: LandedCostFeeInput[] = costRows.map((row) => ({
    id: row.id,
    costType: row.costType,
    allocationBasis: row.allocationBasis,
    amountCny: feeAmountCny(row, rateFor(row.currencyCode, row.exchangeRate)),
    amount: row.amount,
    currencyCode: row.currencyCode,
  }))

  const allocation = allocateLandedCost(
    fees,
    inputLines.map((line) => ({
      key: line.purchaseOrderLineId,
      lineNumber: line.lineNumber,
      amountWeight: line.netTotal,
      quantityWeight: line.allocatedQuantity,
    })),
  )

  return assembleLandedCost({
    shipmentId: shipment.id,
    shipmentNumber: shipment.number,
    lines: inputLines,
    fees,
    allocation,
  })
}
