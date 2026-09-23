/**
 * The three price tiers the business quotes for the same product.
 *
 * `purchase` — what the Guangzhou company pays Petkit/its agent.
 * `internal` — the internal settlement price charged to the overseas subsidiary.
 * `export`   — the price the subsidiary charges its own customers.
 *
 * The codes are constants, not a table: exactly three exist, contracts store them, and a
 * code list keeps a printed contract readable without joining a lookup table.
 */
export const PRODUCT_PRICE_TIERS = ['purchase', 'internal', 'export'] as const

export type ProductPriceTier = (typeof PRODUCT_PRICE_TIERS)[number]

/**
 * Fallback labels for contexts where no i18n translator is available (logs, server
 * errors). Every rendered label goes through `products.i18n` keys instead.
 */
export const PRODUCT_PRICE_TIER_LABELS: Record<ProductPriceTier, string> = {
  purchase: '采购价',
  internal: '内部结算价',
  export: '对外销售价',
}

export function isProductPriceTier(value: unknown): value is ProductPriceTier {
  return typeof value === 'string' && (PRODUCT_PRICE_TIERS as readonly string[]).includes(value)
}
