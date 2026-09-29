import { z } from 'zod'
import {
  amountObject,
  decimalString,
  isoDate,
  isoDateTime,
  nullableAmountObject,
  nullableDate,
  nullableInteger,
  nullableNumber,
  nullablePriceObject,
  priceObject,
  ruEnvelopeSchema,
} from './envelope'

/**
 * The ads-side contracts of `docs/ru-petkit/supply-sync-tech.md` (§10–§18) — one zod schema per
 * endpoint, written from the frozen document. Same §0 conventions as the supply side (envelope with
 * `as_of`, decimal strings, no `_label`), which is why the atoms come from `./envelope`.
 *
 * Two shapes the ads pages introduce and the repricer/cost contracts use:
 * `{ price, currency }` with **four** decimals for unit prices, and `{ amount, currency }` with two
 * for money. A value the contract allows to be absent stays optional here and is reported as
 * missing by the readers, never coerced to zero.
 */

export const ADS_ENDPOINTS = [
  'ads_overview',
  'ads_orders',
  'ads_site_sales',
  'ads_mp_sales',
  'ads_summary',
  'ads_settlements',
  'ads_ad_types',
  'ads_prices',
  'ads_costs',
] as const

export type AdsEndpoint = (typeof ADS_ENDPOINTS)[number]

/** §0.1: every endpoint lives under the versioned prefix of the RU base URL. */
export const ADS_ENDPOINT_PATHS: Record<AdsEndpoint, string> = {
  ads_overview: '/api/v1/ads/overview',
  ads_orders: '/api/v1/ads/orders',
  ads_site_sales: '/api/v1/ads/site-sales',
  ads_mp_sales: '/api/v1/ads/mp-sales',
  ads_summary: '/api/v1/ads/summary',
  ads_settlements: '/api/v1/ads/settlements',
  ads_ad_types: '/api/v1/ads/ad-types',
  ads_prices: '/api/v1/ads/prices',
  ads_costs: '/api/v1/ads/costs',
}

const CHANNELS = ['ozon', 'yandex_market', 'kit'] as const
const CHANNELS_WITH_TOTAL = [...CHANNELS, 'total'] as const
const GRANULARITIES = ['day', 'week', 'month'] as const

const ORDER_STATUSES = [
  'NEW',
  'PENDING_PAYMENT',
  'ORDER_PLACED',
  'WAIT_FOR_CONFIRMATION',
  'CREATING_INITIAL_RECEIPT',
  'SETUP_DELIVERY',
  'WAIT_FOR_DELIVERY',
  'CANCELLATION_IN_PROGRESS',
  'DELIVERY_CANCELLED',
  'FULL_REFUND',
  'PARTIAL_REFUND',
  'CREATING_FINAL_RECEIPTS',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
] as const

/** §10 — 总览头 (ДРР + structure). */
const overviewRowSchema = z
  .object({
    period_start: isoDate,
    period_end: isoDate,
    net_revenue: amountObject,
    ad_spend: amountObject,
    ad_spend_live: amountObject,
    drr_percent: z.number(),
    drr_live_percent: z.number(),
    orders_paid: z.number().int().optional(),
    orders_total: z.number().int().optional(),
    avg_check: nullableAmountObject,
    spend_by_type: z
      .array(
        z
          .object({
            type: z.string().min(1),
            amount: amountObject,
            share_percent: z.number(),
          })
          .strict(),
      )
      .optional(),
    revenue_by_category: z
      .array(
        z
          .object({
            category: z.string().min(1),
            amount: amountObject,
            share_percent: z.number(),
          })
          .strict(),
      )
      .optional(),
    top_products: z
      .array(
        z
          .object({
            sku: z.string().min(1),
            revenue: amountObject,
            revenue_share_percent: z.number(),
          })
          .strict(),
      )
      .optional(),
    drr_target_percent: z.number().optional(),
    updated_at: isoDateTime,
  })
  .strict()

/** §11 — 订单行明细; one row is one order **line**. */
const orderLineRowSchema = z
  .object({
    external_order_id: z.string().min(1).max(200),
    channel: z.string().min(1),
    // §0.5: the order status is a closed English vocabulary (the 15 codes the contract lists);
    // `payment_status` stays free text because the contract's own example value is Russian.
    status: z.enum(ORDER_STATUSES),
    payment_status: z.string().nullable().optional(),
    delivery_method: z.string().nullable().optional(),
    delivery_cost: nullableAmountObject,
    order_goods_total: nullableAmountObject,
    order_total: nullableAmountObject,
    sku: z.string().min(1),
    name: z.string().nullable().optional(),
    qty: decimalString,
    price: nullablePriceObject,
    line_total: nullableAmountObject,
    price_discounted: priceObject,
    line_total_discounted: amountObject,
    unit_cost: nullablePriceObject,
    created_at: isoDateTime,
    updated_at: isoDateTime,
  })
  .strict()

/** §12 — 站内销售矩阵 (SKU × period). */
const siteSalesRowSchema = z
  .object({
    sku: z.string().min(1),
    period_start: isoDate,
    period_end: isoDate,
    granularity: z.enum(GRANULARITIES),
    is_partial: z.boolean(),
    qty: decimalString,
    revenue: amountObject,
    platform_costs: nullableAmountObject,
    acquiring_cost: nullableAmountObject,
    logistics_cost: nullableAmountObject,
    ad_spend_live: nullableAmountObject,
    drr_live_percent: nullableNumber,
    margin_sales_percent: nullableNumber,
    margin_sales: nullableAmountObject,
    margin_orders_percent: nullableNumber,
    avg_check: nullableAmountObject,
    carts: nullableInteger,
    transitions: nullableInteger,
    stock_qty: decimalString.nullable().optional(),
    days_until_oos: nullableInteger,
    updated_at: isoDateTime,
  })
  .strict()

/** §13 — 平台销售矩阵 (three-source comparison). */
const mpSalesRowSchema = z
  .object({
    channel: z.string().min(1),
    sku: z.string().min(1),
    period_start: isoDate,
    period_end: isoDate,
    orders_qty: z.number().int(),
    orders_revenue: amountObject,
    sales_qty: z.number().int(),
    sales_revenue: amountObject,
    marketplace_fees: nullableAmountObject,
    cogs: nullableAmountObject,
    ad_spend: nullableAmountObject,
    drr_percent: nullableNumber,
    drr_accrued_percent: nullableNumber,
    margin_percent: nullableNumber,
    margin_amount: nullableAmountObject,
    updated_at: isoDateTime,
  })
  .strict()

/** §14 — 月度汇总: one row per metric code per channel per month per view. */
const summaryRowSchema = z
  .object({
    channel: z.enum(CHANNELS_WITH_TOTAL),
    month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
    view: z.enum(['metrics', 'opiu']),
    is_closed: z.boolean(),
    metric: z.string().min(1),
    value_amount: nullableAmountObject,
    value_percent: nullableNumber,
    value_qty: nullableInteger,
    drr_accrued: nullableAmountObject,
    drr_accrued_percent: nullableNumber,
    updated_at: isoDateTime,
  })
  .strict()

/** §15 — 平台结算单 with its lines. */
const settlementLineRowSchema = z
  .object({
    external_order_id: z.string().min(1),
    fee_type: z.enum(['marketplace_fee', 'ads', 'logistics']),
    gross_amount: nullableAmountObject,
    fee_amount: nullableAmountObject,
    net_amount: nullableAmountObject,
    updated_at: isoDateTime,
  })
  .strict()

const settlementRowSchema = z
  .object({
    external_settlement_id: z.string().min(1).max(200),
    channel: z.enum(CHANNELS),
    period_start: nullableDate,
    period_end: nullableDate,
    currency: z.string().regex(/^[A-Z]{3}$/),
    gross_amount: nullableAmountObject,
    fee_amount: nullableAmountObject,
    net_amount: nullableAmountObject,
    received_at: nullableDate,
    lines: z.array(settlementLineRowSchema),
    updated_at: isoDateTime,
  })
  .strict()

/** §16 — 广告类型 (archive only: Direct spend carries no SKU). */
const adTypeRowSchema = z
  .object({
    ad_type: z.enum(['rsa', 'retargeting', 'search', 'smart_banners', 'brand', 'display']),
    sub_count: z.number().int().optional(),
    period_start: isoDate,
    period_end: isoDate,
    spend: amountObject,
    purchases_revenue: nullableAmountObject,
    purchases_qty: nullableInteger,
    drr_percent: nullableNumber,
    cpo: nullableAmountObject,
    carts: nullableInteger,
    shows: nullableInteger,
    ctr_percent: nullableNumber,
    clicks: nullableInteger,
    cpc: nullableAmountObject,
    cpm: nullableAmountObject,
    updated_at: isoDateTime,
  })
  .strict()

/** §17 — four-platform prices vs cost (the repricer). `~` approximations are flagged, never booked. */
const priceRowSchema = z
  .object({
    sku: z.string().min(1),
    platform: z.enum(['kit', 'ozon', 'yandex_market', 'wb']),
    cost: priceObject,
    buyer_price: nullablePriceObject,
    coinvest_percent: nullableNumber,
    payout_price: nullablePriceObject,
    drr_percent: nullableNumber,
    fee_percent: nullableNumber,
    fee_amount: nullableAmountObject,
    margin_percent: nullableNumber,
    margin_amount: nullableAmountObject,
    is_approx: z.boolean(),
    is_loss: z.boolean(),
    price_at: isoDateTime,
    updated_at: isoDateTime,
  })
  .strict()

/** §18 — the manual cost page: one row per SKU plus a single global `fee_rates` row. */
const costRowSchema = z
  .object({
    sku: z.string().min(1).nullable().optional(),
    cost: nullablePriceObject,
    purchase_price: nullablePriceObject,
    fee_rates: z
      .object({
        acquiring_percent: z.number(),
        logistics_percent: z.number(),
        effective_from: nullableDate,
      })
      .strict()
      .nullable()
      .optional(),
    note: z.string().nullable().optional(),
    updated_at: isoDateTime,
  })
  .strict()

const ITEM_SCHEMAS = {
  ads_overview: overviewRowSchema,
  ads_orders: orderLineRowSchema,
  ads_site_sales: siteSalesRowSchema,
  ads_mp_sales: mpSalesRowSchema,
  ads_summary: summaryRowSchema,
  ads_settlements: settlementRowSchema,
  ads_ad_types: adTypeRowSchema,
  ads_prices: priceRowSchema,
  ads_costs: costRowSchema,
} satisfies Record<AdsEndpoint, z.ZodTypeAny>

export function adsPageSchema(endpoint: AdsEndpoint) {
  return ruEnvelopeSchema(ITEM_SCHEMAS[endpoint])
}

export type AdsOverviewRow = z.infer<typeof overviewRowSchema>
export type AdsOrderLineRow = z.infer<typeof orderLineRowSchema>
export type AdsSiteSalesRow = z.infer<typeof siteSalesRowSchema>
export type AdsMpSalesRow = z.infer<typeof mpSalesRowSchema>
export type AdsSummaryRow = z.infer<typeof summaryRowSchema>
export type AdsSettlementRow = z.infer<typeof settlementRowSchema>
export type AdsAdTypeRow = z.infer<typeof adTypeRowSchema>
export type AdsPriceRow = z.infer<typeof priceRowSchema>
export type AdsCostRow = z.infer<typeof costRowSchema>

/**
 * The natural key of one row, per the contract: §10 `(period_start, period_end)`, §11
 * `(channel, external_order_id, sku)`, §12 `(sku, period_start, granularity)`, §13
 * `(channel, sku, period_start)`, §14 `(channel, month, view)`, §15 `(channel,
 * external_settlement_id)`, §16 `(ad_type, period_start)`, §17 `(sku, platform)`, §18 `(sku)`.
 *
 * §18 also carries one global `fee_rates` row without a SKU; it gets the fixed key
 * `__fee_rates__` so it is not lost and cannot collide with a real code.
 */
export function adsNaturalKey(endpoint: AdsEndpoint, row: Record<string, unknown>): string {
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  switch (endpoint) {
    case 'ads_overview':
      return `${text(row.period_start)}|${text(row.period_end)}`
    case 'ads_orders':
      return `${text(row.channel)}|${text(row.external_order_id)}|${text(row.sku)}`
    case 'ads_site_sales':
      return `${text(row.sku)}|${text(row.period_start)}|${text(row.granularity)}`
    case 'ads_mp_sales':
      return `${text(row.channel)}|${text(row.sku)}|${text(row.period_start)}`
    case 'ads_summary':
      return `${text(row.channel)}|${text(row.month)}|${text(row.view)}|${text(row.metric)}`
    case 'ads_settlements':
      return `${text(row.channel)}|${text(row.external_settlement_id)}`
    case 'ads_ad_types':
      return `${text(row.ad_type)}|${text(row.period_start)}`
    case 'ads_prices':
      return `${text(row.sku)}|${text(row.platform)}`
    case 'ads_costs':
      return row.sku === null || row.sku === undefined || text(row.sku).length === 0 ? '__fee_rates__' : text(row.sku)
    default:
      return text(row.sku)
  }
}
