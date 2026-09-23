import { describe, expect, it } from '@jest/globals'
import {
  columnMapSchema,
  quoteRemapSchema,
  quoteLinesBatchUpdateSchema,
  promoteSchema,
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
})
