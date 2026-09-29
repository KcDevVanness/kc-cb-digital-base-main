import { z } from 'zod'
import {
  decimalString,
  isoDate,
  isoDateTime,
  moneyAmount,
  nullableAmountObject,
  nullableDate,
  nullableInteger,
  ruEnvelopeSchema,
  rowUpdatedAt,
} from './envelope'

/**
 * The supply-side contracts of `docs/ru-petkit/supply-sync-tech.md` (§1–§7 plus §1.1) — one zod
 * schema per endpoint, written from the frozen document and nothing else. The §0 conventions the
 * shapes follow (envelope, decimal strings, no `_label`) live in `./envelope`.
 */

const amountObject = z.object({ amount: moneyAmount, currency: z.string().regex(/^[A-Z]{3}$/) }).strict()

const VARIANT_SUFFIXES_EN = ['sklad', 'fabrika'] as const

export const SUPPLY_ENDPOINTS = [
  'skus',
  'sku_mappings',
  'stock',
  'in_transit',
  'unrecognized_inbound',
  'plan',
  'shipments',
  'params',
] as const

export type SupplyEndpoint = (typeof SUPPLY_ENDPOINTS)[number]

/** §0.1: every endpoint lives under the versioned prefix of the RU base URL. */
export const SUPPLY_ENDPOINT_PATHS: Record<SupplyEndpoint, string> = {
  skus: '/api/v1/supply/skus',
  sku_mappings: '/api/v1/supply/sku-mappings',
  stock: '/api/v1/supply/stock',
  in_transit: '/api/v1/supply/in-transit',
  unrecognized_inbound: '/api/v1/supply/unrecognized-inbound',
  plan: '/api/v1/supply/plan',
  shipments: '/api/v1/supply/shipments',
  params: '/api/v1/supply/params',
}

/** §1 — SKU 主数据. */
const skuRowSchema = z
  .object({
    sku: z.string().min(1),
    variant_suffix: z.enum(VARIANT_SUFFIXES_EN).nullable().optional(),
    name: z.string(),
    category: z.string().nullable().optional(),
    planning_enabled: z.boolean(),
    active: z.boolean(),
    updated_at: isoDateTime,
  })
  .strict()

/** §1.1 — RU 原始码 → canonical. */
const skuMappingRowSchema = z
  .object({
    ru_code: z.string().min(1),
    canonical_sku: z.string().nullable().optional(),
    variant_suffix: z.enum(VARIANT_SUFFIXES_EN).nullable().optional(),
    map_status: z.enum(['mapped', 'pending', 'rejected']),
    note: z.string().nullable().optional(),
    updated_at: isoDateTime,
  })
  .strict()

/** §2 — 库存. */
const stockRowSchema = z
  .object({
    sku: z.string().min(1),
    own_warehouse_qty: decimalString,
    fbo_qty: decimalString,
    total_qty: decimalString,
    days_until_oos: z.number().int().nullable().optional(),
    coverage_days: z.number().int().nullable().optional(),
    stock_value: nullableAmountObject,
    updated_at: isoDateTime,
  })
  .strict()

/** §3 — 在途. */
const inTransitRowSchema = z
  .object({
    sku: z.string().min(1),
    in_transit_qty: decimalString,
    eta: nullableDate,
    shipment_numbers: z.array(z.string()).optional(),
    updated_at: isoDateTime,
  })
  .strict()

/** §4 — 未识别在途. Deliberately its own endpoint: these rows must never be deducted from demand. */
const unrecognizedInboundRowSchema = z
  .object({
    sku: z.string().min(1),
    reason: z.enum(['no_catalog_card', 'planning_disabled', 'unknown_code']),
    qty: decimalString,
    eta: nullableDate,
    has_catalog_card: z.boolean(),
    updated_at: isoDateTime,
  })
  .strict()

/** §5 — 采购计划. */
const planRowSchema = z
  .object({
    sku: z.string().min(1),
    status: z.enum(['overdue', 'deficit_in_transit', 'to_order_soon', 'ok', 'overstock', 'no_sales']),
    is_critical: z.boolean(),
    own_qty: decimalString,
    fbo_qty: decimalString,
    total_qty: decimalString,
    in_transit_qty: decimalString,
    days_until_oos: z.number().int().nullable().optional(),
    demand_per_day: decimalString,
    demand_30d: decimalString,
    demand_60d: decimalString,
    demand_90d: decimalString,
    demand_120d: decimalString,
    demand_in_horizon_qty: decimalString,
    order_by: nullableDate,
    overdue_days: z.number().int(),
    recommended_qty: decimalString,
    unit_cost: nullableAmountObject,
    order_amount: nullableAmountObject,
    expected_loss: nullableAmountObject,
    horizon_days: z.number().int(),
    updated_at: isoDateTime,
  })
  .strict()

/** §6 — 供应单登记（行内嵌）. */
const shipmentLineSchema = z
  .object({
    model: z.string().min(1),
    sku: z.string().nullable().optional(),
    qty: decimalString,
    unit_price: nullableAmountObject,
  })
  .strict()

const shipmentRowSchema = z
  .object({
    number: z.string().min(1),
    po_number: z.string().nullable().optional(),
    status: z.enum(['production', 'in_transit', 'arrived_ru']),
    total_qty: decimalString,
    total_amount: nullableAmountObject,
    eta: nullableDate,
    docs_complete: z.boolean(),
    missing_docs: z.array(z.string()).optional(),
    lines: z.array(shipmentLineSchema).optional(),
    updated_at: isoDateTime,
  })
  .strict()

/** §7 — 计划参数（实际 1 条）. */
const paramsRowSchema = z
  .object({
    version: z.string().min(1),
    production_days: z.number().int(),
    transit_days: z.number().int(),
    receiving_days: z.number().int(),
    order_cycle_days: z.number().int(),
    coverage_window_days: z.number().int(),
    safety_days: z.number().int(),
    horizon_days: z.number().int(),
    demand_weights: z
      .object({
        d30: z.number(),
        d60: z.number(),
        d90: z.number(),
        d120: z.number(),
      })
      .strict(),
    exclude_oos_days: z.boolean(),
    eta_aware: z.boolean(),
    overstock_days: z.number().int(),
    seasonality: z
      .object({
        profile: z.string(),
        monthly: z.record(z.string(), decimalString),
      })
      .strict()
      .nullable()
      .optional(),
    updated_at: isoDateTime,
  })
  .strict()

const ITEM_SCHEMAS = {
  skus: skuRowSchema,
  sku_mappings: skuMappingRowSchema,
  stock: stockRowSchema,
  in_transit: inTransitRowSchema,
  unrecognized_inbound: unrecognizedInboundRowSchema,
  plan: planRowSchema,
  shipments: shipmentRowSchema,
  params: paramsRowSchema,
} satisfies Record<SupplyEndpoint, z.ZodTypeAny>

export type SupplySkusRow = z.infer<typeof skuRowSchema>
export type SupplySkuMappingRow = z.infer<typeof skuMappingRowSchema>
export type SupplyStockRow = z.infer<typeof stockRowSchema>
export type SupplyInTransitRow = z.infer<typeof inTransitRowSchema>
export type SupplyUnrecognizedInboundRow = z.infer<typeof unrecognizedInboundRowSchema>
export type SupplyPlanRow = z.infer<typeof planRowSchema>
export type SupplyShipmentRow = z.infer<typeof shipmentRowSchema>
export type SupplyParamsRow = z.infer<typeof paramsRowSchema>

/** §0.3 — the envelope every endpoint wraps its page in (shared with the ads domain). */
export const supplyEnvelopeSchema = ruEnvelopeSchema

export function supplyPageSchema(endpoint: SupplyEndpoint) {
  return ruEnvelopeSchema(ITEM_SCHEMAS[endpoint])
}

export type SupplyPage<T> = {
  as_of: string
  page: number
  page_size: number
  total: number
  items: T[]
}

/**
 * The natural key of one row, per the contract: §1/§2/§3/§5 key on `sku`, §1.1 on `ru_code`, §6 on
 * `number` (the lines live inside the shipment payload), §7 on `version`.
 *
 * §4 declares **no** natural key — the document describes its purpose and rows but never names the
 * key — so the row's own `sku`, returned verbatim (it may be an unparseable factory code such as
 * `РК56`), is used and marked as such.
 */
export function supplyNaturalKey(endpoint: SupplyEndpoint, row: Record<string, unknown>): string {
  switch (endpoint) {
    case 'sku_mappings':
      return String(row.ru_code ?? '')
    case 'shipments':
      return String(row.number ?? '')
    case 'params':
      return String(row.version ?? '')
    case 'skus':
    case 'stock':
    case 'in_transit':
    case 'unrecognized_inbound':
    case 'plan':
    default:
      return String(row.sku ?? '')
  }
}

/** The row's own `updated_at`, the watermark candidate for the endpoint cursor. */
export const supplyRowUpdatedAt = rowUpdatedAt
