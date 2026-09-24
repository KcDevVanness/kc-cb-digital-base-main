import { describe, expect, it } from '@jest/globals'
import {
  supplierProductCreateSchema,
  supplierProductImportSchema,
  supplierProductPriceRowSchema,
  supplierProductPricesReplaceSchema,
  supplierProductUpdateSchema,
} from '../validators'

/**
 * The supplier product library's write contracts.
 *
 * The library moved here from `sourcing` on 2026-09-23, and so did these cases: they are the
 * guarantees the form, the console import and the price editor rely on.
 */
describe('purchasing supplier product validators', () => {
  it('requires the supplier and the code, and defaults unit and status', () => {
    const parsed = supplierProductCreateSchema.parse({
      supplierId: '11111111-1111-4111-8111-111111111111',
      supplierSku: '  P4108  ',
      name: '  Eversweet 3 Pro  ',
    })
    expect(parsed.supplierSku).toBe('P4108')
    expect(parsed.name).toBe('Eversweet 3 Pro')
    expect(parsed.unit).toBe('PCS')
    expect(parsed.status).toBe('active')
    expect(supplierProductCreateSchema.safeParse({ supplierSku: 'P4108', name: 'x' }).success).toBe(false)
    expect(
      supplierProductCreateSchema.safeParse({
        supplierId: '11111111-1111-4111-8111-111111111111',
        supplierSku: '   ',
        name: 'x',
      }).success,
    ).toBe(false)
    expect(
      supplierProductCreateSchema.safeParse({
        supplierId: '11111111-1111-4111-8111-111111111111',
        supplierSku: 'P4108',
        name: 'x',
        status: 'deleted',
      }).success,
    ).toBe(false)
  })

  it('drops blank packaging and keeps a non-negative integer MOQ', () => {
    const parsed = supplierProductCreateSchema.parse({
      supplierId: '11111111-1111-4111-8111-111111111111',
      supplierSku: 'P4108',
      name: 'Eversweet 3 Pro',
      moqQuantity: '10',
      innerPacking: { length: '21.9', width: '', height: null, unit: 'cm' },
    })
    expect(parsed.moqQuantity).toBe(10)
    expect(parsed.innerPacking).toEqual({ length: '21.9', unit: 'cm' })
    expect(
      supplierProductCreateSchema.safeParse({
        supplierId: '11111111-1111-4111-8111-111111111111',
        supplierSku: 'P4108',
        name: 'x',
        moqQuantity: -1,
      }).success,
    ).toBe(false)
  })

  it('never lets the owning supplier travel in an update', () => {
    const parsed = supplierProductUpdateSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      supplierSku: 'P4108',
      name: 'Eversweet 3 Pro',
    })
    expect(parsed).not.toHaveProperty('supplierId')
    expect(
      supplierProductUpdateSchema.safeParse({
        id: '11111111-1111-4111-8111-111111111111',
        supplierId: '22222222-2222-4222-8222-222222222222',
        supplierSku: 'P4108',
        name: 'x',
      }).success,
    ).toBe(true)
    expect(
      supplierProductUpdateSchema.parse({
        id: '11111111-1111-4111-8111-111111111111',
        supplierId: '22222222-2222-4222-8222-222222222222',
        supplierSku: 'P4108',
        name: 'x',
      }),
    ).not.toHaveProperty('supplierId')
  })

  it('bounds the library import payload', () => {
    const quoteId = '11111111-1111-4111-8111-111111111111'
    expect(supplierProductImportSchema.safeParse({ quoteId, lineIds: [quoteId] }).success).toBe(true)
    expect(supplierProductImportSchema.safeParse({ quoteId, lineIds: [] }).success).toBe(false)
    expect(
      supplierProductImportSchema.safeParse({
        quoteId,
        lineIds: Array.from({ length: 201 }, () => quoteId),
      }).success,
    ).toBe(false)
  })

  it('bounds and shapes the price set', () => {
    const row = { priceKind: 'supplier_cost', currencyCode: 'cny', minQuantity: '1', unitPrice: '12.5' }
    const parsed = supplierProductPricesReplaceSchema.parse({
      supplierProductId: '11111111-1111-4111-8111-111111111111',
      rows: [row],
    })
    expect(parsed.rows[0]).toEqual({ priceKind: 'supplier_cost', currencyCode: 'CNY', minQuantity: 1, unitPrice: '12.5', isActive: true })
    expect(supplierProductPriceRowSchema.safeParse({ ...row, priceKind: 'retail' }).success).toBe(false)
    expect(supplierProductPriceRowSchema.safeParse({ ...row, currencyCode: 'CNYX' }).success).toBe(false)
    expect(supplierProductPriceRowSchema.safeParse({ ...row, unitPrice: '12.1234567' }).success).toBe(false)
    expect(
      supplierProductPricesReplaceSchema.safeParse({
        supplierProductId: '11111111-1111-4111-8111-111111111111',
        rows: Array.from({ length: 25 }, () => row),
      }).success,
    ).toBe(false)
  })
})
