import { describe, expect, it } from '@jest/globals'
import {
  productCreateSchema,
  productPriceRowSchema,
  productPricesReplaceSchema,
  productTypeCreateSchema,
  productUpdateSchema,
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
    // No brand is assumed: a self-made product must not inherit a supplier's brand.
    expect(parsed.brand).toBe('')
    expect(parsed.unit).toBe('PCS')
    expect(parsed.status).toBe('active')
    expect(parsed.containsLithiumBattery).toBe(false)
    // Absent stays absent rather than becoming `null`: the create command turns it into the column's
    // null either way, while a *partial* update must not erase a decimal column it never mentioned.
    expect(parsed.netWeight).toBeUndefined()
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

  it('keeps a decimal absent on a partial update so it is not erased', () => {
    // The supplier sync and `sync-fields` send **only the changed fields**; the update command writes
    // a field only when it is `!== undefined`. A helper that folded "not sent" into `null` therefore
    // wiped every decimal column the payload did not mention (measured on the dev database:
    // `net_weight`/`gross_weight` cleared by a volume-only sync and the reverse).
    const partial = productUpdateSchema.parse({ id: '00000000-0000-4000-8000-000000000001', volume: '88642' })
    expect(partial.volume).toBe('88642')
    expect(partial.netWeight).toBeUndefined()
    expect(partial.grossWeight).toBeUndefined()
    // An explicit `null` still means "clear it".
    expect(productUpdateSchema.parse({ id: '00000000-0000-4000-8000-000000000001', volume: null }).volume).toBeNull()
  })

  it('rejects a volume that is not a whole cm³', () => {
    // `volume` is numeric(16,0): a fractional cm³ is an input error, not a value to round away.
    expect(productCreateSchema.safeParse({ ...baseProduct, volume: '88642.5' }).success).toBe(false)
    expect(productCreateSchema.parse({ ...baseProduct, volume: '88642' }).volume).toBe('88642')
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
