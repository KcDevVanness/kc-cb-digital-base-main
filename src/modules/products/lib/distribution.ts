import type { ProductsPrice, ProductsProduct, ProductsVariant } from '../data/entities'

/**
 * Field mapping for product distribution (`.ai/specs/2026-09-28-product-distribution-to-branches.md`).
 *
 * A copy takes an **explicit whitelist** of the source row's fields, never a spread: the source's
 * cross-organization references (`typeId`/`categoryId` point at this organization's taxonomy rows,
 * `catalogProductId` at this organization's catalog row) would be dangling in the target and must
 * not leak, and a spread would silently start copying every column a future change adds here.
 *
 * Prices are copied only when the copy is first created — after that they belong to the target
 * organization (see the spec's decisions). Variants are upserted by `code` on re-runs, never
 * deleted, so a target-local variant survives.
 */

export type DistributedProductData = {
  sku: string
  name: string
  nameEn: string | null
  brand: string
  series: string | null
  manufacturerModel: string | null
  specSummary: string | null
  barcode: string | null
  unit: string
  hsCode: string | null
  cnCode: string | null
  countryOfOriginCode: string | null
  netWeight: string | null
  grossWeight: string | null
  volume: string | null
  dimensions: Record<string, unknown> | null
  cartonQuantity: number | null
  batteryCapacityMah: number | null
  batteryWh: string | null
  containsLithiumBattery: boolean
  certifications: string[] | null
  status: string
}

export function buildDistributedProductData(source: ProductsProduct): DistributedProductData {
  return {
    sku: source.sku,
    name: source.name,
    nameEn: source.nameEn ?? null,
    brand: source.brand,
    series: source.series ?? null,
    manufacturerModel: source.manufacturerModel ?? null,
    specSummary: source.specSummary ?? null,
    barcode: source.barcode ?? null,
    unit: source.unit,
    hsCode: source.hsCode ?? null,
    cnCode: source.cnCode ?? null,
    countryOfOriginCode: source.countryOfOriginCode ?? null,
    netWeight: source.netWeight ?? null,
    grossWeight: source.grossWeight ?? null,
    volume: source.volume ?? null,
    dimensions: source.dimensions ? { ...source.dimensions } : null,
    cartonQuantity: source.cartonQuantity ?? null,
    batteryCapacityMah: source.batteryCapacityMah ?? null,
    batteryWh: source.batteryWh ?? null,
    containsLithiumBattery: source.containsLithiumBattery === true,
    certifications: Array.isArray(source.certifications) ? [...source.certifications] : null,
    status: source.status,
  }
}

export type DistributedVariantData = {
  code: string
  name: string
  barcode: string | null
  status: string
  isDefault: boolean
  attributes: Record<string, unknown> | null
  sortOrder: number
}

export function buildDistributedVariantData(
  variant: ProductsVariant,
  sortOrder: number,
): DistributedVariantData {
  return {
    code: variant.code,
    name: variant.name,
    barcode: variant.barcode ?? null,
    status: variant.status,
    isDefault: variant.isDefault === true,
    attributes: variant.attributes ? { ...variant.attributes } : null,
    sortOrder,
  }
}

export type DistributedPriceData = {
  priceTier: string
  currencyCode: string
  minQuantity: number
  unitPrice: string
  startsAt: Date | null
  endsAt: Date | null
  isActive: boolean
}

export function buildDistributedPriceData(price: ProductsPrice): DistributedPriceData {
  return {
    priceTier: price.priceTier,
    currencyCode: price.currencyCode,
    minQuantity: price.minQuantity,
    unitPrice: price.unitPrice,
    startsAt: price.startsAt ?? null,
    endsAt: price.endsAt ?? null,
    isActive: price.isActive !== false,
  }
}

/** Why one source product was not distributed into one target organization. */
export type DistributeSkipReason = 'sku_taken'

export type DistributeSkippedProduct = {
  sku: string
  organizationId: string
  reason: DistributeSkipReason
}

export type DistributeProductsResult = {
  created: number
  updated: number
  skipped: DistributeSkippedProduct[]
}
