import type { EntityManager } from '@mikro-orm/postgresql'
import { parseExactDecimal } from '@open-mercato/core/modules/dashboards/lib/exactDecimal'
import { AMOUNT_SCALE, multiplyExactDecimal, PRICE_SCALE, quantizeExactDecimal, toAmountString, toScaledUnits } from '../../trade_docs/lib/money'
import { CNY_DISPLAY_CURRENCY, loadRateRows, resolveCnyRate } from '../../currency_policy/lib/rateLookup'
import { rateScope, type ReadScope } from './scope'
import { loadShipmentLandedCost } from './landedCost'
import {
  loadActivePriceRows,
  loadInventoryBalances,
  loadProductsByCatalogId,
  loadReceivedShipments,
  loadVariantRefs,
  type PurchaseTierPriceRow,
} from './peerReads'

/**
 * 库存资金占用 — what the stock on hand is worth, with the cost of every SKU resolved in a fixed
 * order:
 *
 * 1. `landed` — the landed unit cost of the SKU's most recently **received** container. The most
 *    accurate number because it already carries the freight, duty and clearance that were
 *    actually booked.
 * 2. `price_tier` — the product's `purchase` price row (CNY first; another currency only when a
 *    rate resolves). Anything else would be a guess.
 * 3. `missing` — nothing resolved: the quantity is reported as unpriced (value 0, counted in
 *    `missingQuantity`) instead of being valued at an invented number.
 *
 * The `wms` balances carry no cost layer and no history, so `asOf` is a display label: the
 * quantities are the current balances.
 */

export type InventoryCostSource = 'landed' | 'price_tier' | 'missing'

export type InventoryValueRow = {
  sku: string | null
  productId: string | null
  quantity: string
  /** The unit cost used for valuation (landed preferred), `null` when nothing resolved. 4 decimals. */
  unitCostCny: string | null
  /** Quantity × unit cost, at {@link AMOUNT_SCALE} (2 decimals), `null` when nothing resolved. */
  valueCny: string | null
  source: InventoryCostSource
  /** The two calibers in parallel — the user's decision is to show both, not to pick one. */
  /** Landed unit cost at {@link PRICE_SCALE} (4 decimals). */
  landedUnitCostCny: string | null
  /** Purchase-tier unit cost at {@link PRICE_SCALE} (4 decimals). */
  purchaseUnitCostCny: string | null
}

export type InventoryValueResult = {
  asOf: string
  rows: InventoryValueRow[]
  totals: {
    /** Σ of the valued rows in CNY. */
    value: string
    /** Quantity that could not be priced — never silently valued at 0 in the total. */
    missingQuantity: string
    /** Price rows whose currency had no resolvable rate, reported rather than converted at 1. */
    unconvertible: Array<{ sku: string | null; productId: string | null; currencyCode: string; unitPrice: string }>
  }
}

/** How many received containers are scanned for a landed cost before falling back to price rows. */
const LANDED_LOOKBACK_SHIPMENTS = 50

/**
 * Landed unit cost per SKU, newest container first. Scans received containers only until every
 * requested SKU has an answer, so the usual case (a handful of SKUs) costs a handful of reads.
 */
export async function loadLandedUnitCostsBySku(
  em: EntityManager,
  scope: ReadScope,
  wantedSkus: readonly string[],
): Promise<Map<string, string>> {
  const remaining = new Set(wantedSkus.filter((sku) => sku.length > 0))
  const result = new Map<string, string>()
  if (remaining.size === 0) return result

  const shipments = await loadReceivedShipments(em, scope, LANDED_LOOKBACK_SHIPMENTS)
  for (const shipment of shipments) {
    if (remaining.size === 0) break
    const landed = await loadShipmentLandedCost(em, scope, shipment.id)
    if (!landed) continue
    for (const row of landed.skuRows) {
      if (!row.sku || !remaining.has(row.sku) || row.landedUnitCostCny === null) continue
      result.set(row.sku, row.landedUnitCostCny)
      remaining.delete(row.sku)
    }
  }
  return result
}

/** One purchase-tier price per product: lowest `min_quantity`, CNY preferred. */
function pickPurchasePrice(
  rows: readonly PurchaseTierPriceRow[],
): { row: PurchaseTierPriceRow; currencyCode: string; unitPrice: string } | null {
  const purchaseRows = rows.filter((row) => row.priceTier === 'purchase')
  if (purchaseRows.length === 0) return null
  const ordered = [...purchaseRows].sort((left, right) => {
    if (left.minQuantity !== right.minQuantity) return left.minQuantity - right.minQuantity
    return left.currencyCode.localeCompare(right.currencyCode)
  })
  const cny = ordered.find((row) => row.currencyCode.toUpperCase() === CNY_DISPLAY_CURRENCY)
  const chosen = cny ?? ordered[0]
  return { row: chosen, currencyCode: chosen.currencyCode, unitPrice: chosen.unitPrice }
}

export async function loadInventoryValue(
  em: EntityManager,
  scope: ReadScope,
  options: { warehouseId?: string; asOf?: string } = {},
): Promise<InventoryValueResult> {
  const asOf = options.asOf ?? new Date().toISOString().slice(0, 10)
  const balances = await loadInventoryBalances(em, scope, { warehouseId: options.warehouseId })

  const variantRefs = await loadVariantRefs(
    em,
    scope,
    balances.map((balance) => balance.catalogVariantId),
  )
  const catalogProductIds = [...variantRefs.values()].map((ref) => ref.catalogProductId)
  const productsByCatalogId = await loadProductsByCatalogId(em, scope, catalogProductIds)

  // Aggregate the quantities per resolved product; a balance whose bridge is missing stays its own
  // row keyed by the variant, so nothing is silently merged into another SKU.
  type Bucket = { sku: string | null; productId: string | null; variantId: string | null; quantityUnits: bigint }
  const buckets = new Map<string, Bucket>()
  for (const balance of balances) {
    const variant = variantRefs.get(balance.catalogVariantId)
    const product = variant ? productsByCatalogId.get(variant.catalogProductId) : undefined
    const key = product ? `product:${product.id}` : `variant:${balance.catalogVariantId}`
    const bucket = buckets.get(key) ?? {
      sku: product?.sku ?? variant?.sku ?? null,
      productId: product?.id ?? null,
      variantId: product ? null : balance.catalogVariantId,
      quantityUnits: 0n,
    }
    bucket.quantityUnits += toScaledUnits(balance.quantityOnHand, AMOUNT_SCALE)
    buckets.set(key, bucket)
  }

  const skus = [...buckets.values()].flatMap((bucket) => (bucket.sku ? [bucket.sku] : []))
  const landedBySku = await loadLandedUnitCostsBySku(em, scope, skus)

  const productIds = [...buckets.values()].flatMap((bucket) => (bucket.productId ? [bucket.productId] : []))
  const priceRows = await loadActivePriceRows(em, scope, productIds)
  const currencies = [...new Set([...priceRows.values()].flatMap((rows) => rows.map((row) => row.currencyCode)))]
  const rateRows = await loadRateRows(em, rateScope(scope), currencies)

  const rows: InventoryValueRow[] = []
  const unconvertible: InventoryValueResult['totals']['unconvertible'] = []

  for (const bucket of buckets.values()) {
    const quantity = toAmountString({ units: bucket.quantityUnits, scale: AMOUNT_SCALE }, AMOUNT_SCALE)
    const landedUnitCostCny = bucket.sku ? landedBySku.get(bucket.sku) ?? null : null

    let purchaseUnitCostCny: string | null = null
    let purchaseUnconvertible: { currencyCode: string; unitPrice: string } | null = null
    if (bucket.productId) {
      const picked = pickPurchasePrice(priceRows.get(bucket.productId) ?? [])
      const price = picked ? parseExactDecimal(picked.unitPrice) : null
      if (picked && price) {
        if (picked.currencyCode.toUpperCase() === CNY_DISPLAY_CURRENCY) {
          purchaseUnitCostCny = toAmountString(quantizeExactDecimal(price, PRICE_SCALE), PRICE_SCALE)
        } else {
          const rate = resolveCnyRate(picked.currencyCode, rateRows)
          const parsedRate = rate ? parseExactDecimal(rate.rate) : null
          purchaseUnitCostCny =
            parsedRate === null
              ? null
              : toAmountString(quantizeExactDecimal(multiplyExactDecimal(price, parsedRate), PRICE_SCALE), PRICE_SCALE)
          if (purchaseUnitCostCny === null) {
            purchaseUnconvertible = { currencyCode: picked.currencyCode, unitPrice: picked.unitPrice }
          }
        }
      }
    }

    if (purchaseUnconvertible) {
      unconvertible.push({ sku: bucket.sku, productId: bucket.productId, ...purchaseUnconvertible })
    }

    const unitCostCny = landedUnitCostCny ?? purchaseUnitCostCny
    const source: InventoryCostSource = landedUnitCostCny !== null ? 'landed' : purchaseUnitCostCny !== null ? 'price_tier' : 'missing'
    const valueCny =
      unitCostCny === null
        ? null
        : toAmountString(
            quantizeExactDecimal(
              multiplyExactDecimal(
                { units: bucket.quantityUnits, scale: AMOUNT_SCALE },
                parseExactDecimal(unitCostCny) ?? { units: 0n, scale: 0 },
              ),
              AMOUNT_SCALE,
            ),
            AMOUNT_SCALE,
          )

    rows.push({
      sku: bucket.sku,
      productId: bucket.productId,
      quantity,
      unitCostCny,
      valueCny,
      source,
      landedUnitCostCny,
      purchaseUnitCostCny,
    })
  }

  rows.sort((left, right) => (left.sku ?? '').localeCompare(right.sku ?? ''))

  let valueUnits = 0n
  let missingUnits = 0n
  for (const row of rows) {
    if (row.source === 'missing') missingUnits += toScaledUnits(row.quantity, AMOUNT_SCALE)
    else valueUnits += toScaledUnits(row.valueCny ?? '0', AMOUNT_SCALE)
  }

  return {
    asOf,
    rows,
    totals: {
      value: toAmountString({ units: valueUnits, scale: AMOUNT_SCALE }, AMOUNT_SCALE),
      missingQuantity: toAmountString({ units: missingUnits, scale: AMOUNT_SCALE }, AMOUNT_SCALE),
      unconvertible,
    },
  }
}
