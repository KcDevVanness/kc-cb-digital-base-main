import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { PurchasingSupplierProductPrice } from '../data/entities'
import { comparePriceBaseRows } from './priceKinds'

/**
 * The base price of each kind, as a list column and the promotion read it.
 *
 * A scoped entity read rather than a projection query: both callers want the same three columns for
 * a set of items at once, the module owns the table, and the write path is a command — nothing here
 * mutates.
 */
export type SupplierProductPriceCell = {
  currencyCode: string
  unitPrice: string
  /**
   * 折后价, when the caller could compute it (the list route knows the row's `discount_percent`).
   * The read below stays discount-free on purpose: the discount lives on the library row, not on the
   * price row, so the cell cannot derive it and the caller attaches it (`lib/priceKinds.ts`
   * `netUnitPrice`).
   */
  netUnitPrice?: string | null
  minQuantity: number
}

export type SupplierProductBasePrices = {
  supplierCost: SupplierProductPriceCell | null
  companyOffer: SupplierProductPriceCell | null
}

const EMPTY_BASE_PRICES: SupplierProductBasePrices = { supplierCost: null, companyOffer: null }

/**
 * The active base prices of many library items in one query, keyed by item id.
 *
 * Only active rows count: a price the operator removed is kept for history, and a column must not
 * show a withdrawn number. Items without a price of a kind are simply missing that cell, which the
 * caller renders as "no price yet".
 */
export async function loadBasePricesByItem(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  itemIds: readonly string[],
): Promise<Map<string, SupplierProductBasePrices>> {
  const byItem = new Map<string, SupplierProductBasePrices>()
  if (itemIds.length === 0) return byItem

  const rows = await em.fork().find(
    PurchasingSupplierProductPrice,
    {
      supplierProduct: { $in: [...itemIds] },
      isActive: true,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    } as FilterQuery<PurchasingSupplierProductPrice>,
    { orderBy: { minQuantity: 'asc', currencyCode: 'asc' } },
  )

  for (const row of rows) {
    const itemId = String(row.supplierProduct.id)
    const entry = byItem.get(itemId) ?? { ...EMPTY_BASE_PRICES }
    const cell: SupplierProductPriceCell = {
      currencyCode: row.currencyCode,
      unitPrice: row.unitPrice,
      minQuantity: row.minQuantity,
    }
    if (row.priceKind === 'supplier_cost') {
      if (!entry.supplierCost || comparePriceBaseRows(cell, entry.supplierCost) < 0) entry.supplierCost = cell
    } else if (row.priceKind === 'company_offer') {
      if (!entry.companyOffer || comparePriceBaseRows(cell, entry.companyOffer) < 0) entry.companyOffer = cell
    }
    byItem.set(itemId, entry)
  }

  return byItem
}

/**
 * The single item's base price of one kind — what the promotion writes into the product master.
 * `min_quantity = 1` is the base row when the item quotes one; otherwise the lowest ladder step.
 */
export async function findBasePriceOfItem(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  itemId: string,
  priceKind: 'supplier_cost' | 'company_offer',
): Promise<SupplierProductPriceCell | null> {
  const byItem = await loadBasePricesByItem(em, scope, [itemId])
  const entry = byItem.get(itemId)
  if (!entry) return null
  return priceKind === 'supplier_cost' ? entry.supplierCost : entry.companyOffer
}
