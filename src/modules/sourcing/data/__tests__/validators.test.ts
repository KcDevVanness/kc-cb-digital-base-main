import { describe, expect, it } from '@jest/globals'
import {
  columnMapSchema,
  quoteRemapSchema,
  quoteLinesBatchUpdateSchema,
  promoteSchema,
  supplierProductCreateSchema,
  supplierProductImportSchema,
  supplierProductUpdateSchema,
} from '../validators'

describe('sourcing validators', () => {
  it('accepts a partial column map (the wizard sends only the fields the operator kept)', () => {
    const parsed = columnMapSchema.parse({
      item_no: { sourceIndex: 2, sourceHeader: 'Item No.' },
      unit_cost: { sourceIndex: 10, sourceHeader: 'Unit Cost\nCNY' },
    })
    expect(Object.keys(parsed)).toEqual(['item_no', 'unit_cost'])
    expect(columnMapSchema.safeParse({}).success).toBe(false)
  })

  it('rejects a target field that is not in the catalog', () => {
    const result = columnMapSchema.safeParse({ not_a_field: { sourceIndex: 0, sourceHeader: 'x' } })
    expect(result.success).toBe(false)
  })

  it('parses a remap payload with a subset of the target fields', () => {
    const parsed = quoteRemapSchema.parse({
      quoteId: '11111111-1111-4111-8111-111111111111',
      sheetName: 'quotation sheet',
      headerRowIndex: 3,
      columnMap: { product_name: { sourceIndex: 1, sourceHeader: 'Item No.& Name' } },
      saveProfile: true,
      profileName: 'Petkit 2026 quotation',
    })
    expect(parsed.saveProfile).toBe(true)
    expect(parsed.sectionRules).toEqual({ useSections: true, categoryFromSection: true })
  })

  it('caps the review batch at 200 rows and requires the rendered version of each row', () => {
    const row = { id: '11111111-1111-4111-8111-111111111111', updatedAt: '2026-09-22T07:00:00.000Z' }
    expect(quoteLinesBatchUpdateSchema.safeParse({ quoteId: row.id, rows: [row] }).success).toBe(true)
    expect(quoteLinesBatchUpdateSchema.safeParse({ quoteId: row.id, rows: [{ id: row.id }] }).success).toBe(false)
    expect(
      quoteLinesBatchUpdateSchema.safeParse({ quoteId: row.id, rows: Array.from({ length: 201 }, () => row) }).success,
    ).toBe(false)
  })

  it('bounds the promotion payload', () => {
    expect(promoteSchema.parse({ quoteId: '11111111-1111-4111-8111-111111111111' }).force).toBe(false)
    expect(
      promoteSchema.safeParse({
        quoteId: '11111111-1111-4111-8111-111111111111',
        lineIds: Array.from({ length: 501 }, () => '11111111-1111-4111-8111-111111111111'),
      }).success,
    ).toBe(false)
  })

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
})
