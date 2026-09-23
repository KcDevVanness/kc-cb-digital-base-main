import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { PurchasingSupplierProductPrice } from '../data/entities'

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
  minQuantity: number
}

export type SupplierProductBasePrices = {
  supplierCost: SupplierProductPriceCell | null
  companyOffer: SupplierProductPriceCell | null
}

const EMPTY_BASE_PRICES: SupplierProductBasePrices = { supplierCost: null, companyOffer: null }

/**
 * The "base" row of a kind is its lowest ladder step, and ties (two currencies at the same step)
 * are broken by currency code so a column can never flip between renders on equal data.
 */
function isBaseCandidate(current: SupplierProductPriceCell | null, candidate: SupplierProductPriceCell): boolean {
  if (!current) return true
  if (candidate.minQuantity !== current.minQuantity) return candidate.minQuantity < current.minQuantity
  return candidate.currencyCode.localeCompare(current.currencyCode) < 0
}

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
      if (isBaseCandidate(entry.supplierCost, cell)) entry.supplierCost = cell
    } else if (row.priceKind === 'company_offer') {
      if (isBaseCandidate(entry.companyOffer, cell)) entry.companyOffer = cell
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
