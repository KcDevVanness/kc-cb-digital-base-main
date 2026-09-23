import { describe, expect, it } from '@jest/globals'
import {
  productCreateSchema,
  productPriceRowSchema,
  productPricesReplaceSchema,
  productTypeCreateSchema,
} from '../validators'

describe('product price row validation', () => {
  const baseRow = {
    priceTier: 'purchase',
    currencyCode: 'CNY',
    minQuantity: 1,
    unitPrice: '168',
  }

  it('accepts all three tiers and normalizes the price to the column scale', () => {
    for (const tier of ['purchase', 'internal', 'export'] as const) {
      const parsed = productPriceRowSchema.parse({ ...baseRow, priceTier: tier })
      expect(parsed.priceTier).toBe(tier)
      expect(parsed.unitPrice).toBe('168.000000')
    }
  })

  it('rejects an unknown tier', () => {
    const result = productPriceRowSchema.safeParse({ ...baseRow, priceTier: 'wholesale' })
    expect(result.success).toBe(false)
  })

  it('rejects a lowercase currency code so one currency cannot be quoted twice', () => {
    const result = productPriceRowSchema.safeParse({ ...baseRow, currencyCode: 'cny' })
    expect(result.success).toBe(false)
  })

  it('rejects a minimum quantity below one', () => {
    const result = productPriceRowSchema.safeParse({ ...baseRow, minQuantity: 0 })
    expect(result.success).toBe(false)
  })

  it('rejects a price with more decimals than the column holds', () => {
    const result = productPriceRowSchema.safeParse({ ...baseRow, unitPrice: '1.2345678' })
    expect(result.success).toBe(false)
  })

  it('rejects a negative price', () => {
    const result = productPriceRowSchema.safeParse({ ...baseRow, unitPrice: '-1' })
    expect(result.success).toBe(false)
  })

  it('rejects a validity window that ends before it starts', () => {
    const result = productPriceRowSchema.safeParse({
      ...baseRow,
      startsAt: '2026-05-01',
      endsAt: '2026-04-01',
    })
    expect(result.success).toBe(false)
  })

  it('accepts an empty payload so the last price row can be deactivated', () => {
    const parsed = productPricesReplaceSchema.parse({
      productId: '00000000-0000-4000-8000-000000000001',
      rows: [],
    })
    expect(parsed.rows).toEqual([])
  })
})

describe('product validation', () => {
  const baseProduct = { sku: 'PK-W5C', name: 'Petkit 无线饮水机 W5C' }

  it('applies defaults for the optional packaging fields', () => {
    const parsed = productCreateSchema.parse(baseProduct)
    expect(parsed.brand).toBe('Petkit')
    expect(parsed.unit).toBe('PCS')
    expect(parsed.status).toBe('active')
    expect(parsed.containsLithiumBattery).toBe(false)
    expect(parsed.netWeight).toBeNull()
  })

  it('normalizes weights to four decimals and keeps an empty value as null', () => {
    const parsed = productCreateSchema.parse({ ...baseProduct, netWeight: '1.5', grossWeight: null })
    expect(parsed.netWeight).toBe('1.5000')
    expect(parsed.grossWeight).toBeNull()
  })

  it('rejects a weight with more decimals than the column holds', () => {
    const result = productCreateSchema.safeParse({ ...baseProduct, netWeight: '1.00001' })
    expect(result.success).toBe(false)
  })

  it('rejects a SKU with characters an operator cannot search for later', () => {
    const result = productCreateSchema.safeParse({ sku: 'PK W5C#1', name: 'x' })
    expect(result.success).toBe(false)
  })

  it('drops empty certification entries instead of storing blank strings', () => {
    const parsed = productCreateSchema.parse({ ...baseProduct, certifications: ['CE'] })
    expect(parsed.certifications).toEqual(['CE'])
  })

  it('rejects an unknown status', () => {
    const result = productCreateSchema.safeParse({ ...baseProduct, status: 'archived' })
    expect(result.success).toBe(false)
  })
})

describe('product type validation', () => {
  it('requires a lowercase code', () => {
    expect(productTypeCreateSchema.safeParse({ code: 'Fountain', name: '智能饮水机' }).success).toBe(false)
    expect(productTypeCreateSchema.safeParse({ code: 'litter_box', name: '智能猫砂盆' }).success).toBe(true)
  })
})
