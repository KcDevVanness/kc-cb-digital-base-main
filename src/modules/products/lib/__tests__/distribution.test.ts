import { describe, expect, it } from '@jest/globals'
import { ProductsPrice, ProductsProduct, ProductsVariant } from '../../data/entities'
import {
  buildDistributedPriceData,
  buildDistributedProductData,
  buildDistributedVariantData,
} from '../distribution'

/**
 * The field whitelist of a distributed copy
 * (`.ai/specs/2026-09-28-product-distribution-to-branches.md`): the copy takes exactly the selling
 * facts, never the source organization's own references. These cases pin the *exclusions*, because a
 * leak would point a branch's product at another organization's taxonomy or catalog row.
 */

function sourceProduct(overrides: Partial<ProductsProduct> = {}): ProductsProduct {
  return Object.assign(new ProductsProduct(), {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    organizationId: '33333333-3333-4333-8333-333333333333',
    sku: 'P4108',
    name: 'Eversweet 3 Pro',
    nameEn: 'Eversweet 3 Pro (EN)',
    brand: 'Petkit',
    series: 'Eversweet',
    manufacturerModel: 'W5C',
    typeId: '44444444-4444-4444-8444-444444444444',
    categoryId: '55555555-5555-4555-8555-555555555555',
    specSummary: '白色 / 1.5L',
    barcode: '6970000000001',
    unit: 'PCS',
    hsCode: '8509809000',
    cnCode: '8509809000',
    countryOfOriginCode: 'CN',
    netWeight: '1.2800',
    grossWeight: '1.9000',
    volume: '88642',
    dimensions: { length: 20, width: 20, height: 15, unit: 'cm' },
    cartonQuantity: 8,
    batteryCapacityMah: 5000,
    batteryWh: '18.50',
    containsLithiumBattery: true,
    certifications: ['CE', 'RoHS'],
    status: 'active',
    catalogProductId: '66666666-6666-4666-8666-666666666666',
    catalogSnapshot: { sku: 'P4108' },
    notes: 'internal note',
    sourceProduct: null,
    ...overrides,
  })
}

describe('buildDistributedProductData', () => {
  it('copies the selling fields', () => {
    const data = buildDistributedProductData(sourceProduct())
    expect(data).toEqual({
      sku: 'P4108',
      name: 'Eversweet 3 Pro',
      nameEn: 'Eversweet 3 Pro (EN)',
      brand: 'Petkit',
      series: 'Eversweet',
      manufacturerModel: 'W5C',
      specSummary: '白色 / 1.5L',
      barcode: '6970000000001',
      unit: 'PCS',
      hsCode: '8509809000',
      cnCode: '8509809000',
      countryOfOriginCode: 'CN',
      netWeight: '1.2800',
      grossWeight: '1.9000',
      volume: '88642',
      dimensions: { length: 20, width: 20, height: 15, unit: 'cm' },
      cartonQuantity: 8,
      batteryCapacityMah: 5000,
      batteryWh: '18.50',
      containsLithiumBattery: true,
      certifications: ['CE', 'RoHS'],
      status: 'active',
    })
  })

  it('never carries the source organization’s own references or provenance', () => {
    const data = buildDistributedProductData(sourceProduct()) as Record<string, unknown>
    const leakedKeys = ['id', 'tenantId', 'organizationId', 'typeId', 'categoryId', 'catalogProductId', 'catalogSnapshot', 'sourceProduct', 'notes'].filter(
      (key) => Object.prototype.hasOwnProperty.call(data, key),
    )
    expect(leakedKeys).toEqual([])
  })

  it('clones mutable values instead of sharing them with the source row', () => {
    const source = sourceProduct()
    const data = buildDistributedProductData(source)
    expect(data.dimensions).not.toBe(source.dimensions)
    expect(data.certifications).not.toBe(source.certifications)
  })

  it('normalizes absent optionals to null and keeps the boolean explicit', () => {
    const data = buildDistributedProductData(
      sourceProduct({
        nameEn: null,
        series: null,
        manufacturerModel: null,
        specSummary: null,
        barcode: null,
        hsCode: null,
        cnCode: null,
        countryOfOriginCode: null,
        netWeight: null,
        grossWeight: null,
        volume: null,
        dimensions: null,
        cartonQuantity: null,
        batteryCapacityMah: null,
        batteryWh: null,
        certifications: null,
      }),
    )
    expect(data.nameEn).toBeNull()
    expect(data.dimensions).toBeNull()
    expect(data.certifications).toBeNull()
    expect(data.containsLithiumBattery).toBe(true)
  })
})

describe('buildDistributedVariantData', () => {
  it('carries the SKU facts and the submitted order', () => {
    const variant = Object.assign(new ProductsVariant(), {
      id: '77777777-7777-4777-8777-777777777777',
      code: 'P4108-UVC',
      name: 'UVC accessory',
      barcode: '6970000000002',
      status: 'active',
      isDefault: false,
      attributes: { color: 'white' },
      sortOrder: 0,
    })
    const data = buildDistributedVariantData(variant, 3)
    expect(data).toEqual({
      code: 'P4108-UVC',
      name: 'UVC accessory',
      barcode: '6970000000002',
      status: 'active',
      isDefault: false,
      attributes: { color: 'white' },
      sortOrder: 3,
    })
    expect(data.attributes).not.toBe(variant.attributes)
  })
})

describe('buildDistributedPriceData', () => {
  it('copies the tier row with its dates and treats a missing flag as active', () => {
    const startsAt = new Date('2026-09-01T00:00:00.000Z')
    const price = Object.assign(new ProductsPrice(), {
      priceTier: 'export',
      currencyCode: 'USD',
      minQuantity: 10,
      unitPrice: '12.345600',
      startsAt,
      endsAt: null,
      isActive: true,
    })
    expect(buildDistributedPriceData(price)).toEqual({
      priceTier: 'export',
      currencyCode: 'USD',
      minQuantity: 10,
      unitPrice: '12.345600',
      startsAt,
      endsAt: null,
      isActive: true,
    })
  })
})
