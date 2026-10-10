import { describe, expect, it } from '@jest/globals'
import { buildDraftPosLines } from '../draftPos'

/**
 * The line payload `ru_sync.plan.draft-pos` dispatches to `purchasing.purchase-orders.create`.
 *
 * The key matters more than it looks: purchasing's line schema takes the product as
 * `catalogProductId` (a product *is* the catalog product since the single-store cutover) and refuses
 * a line without one with `400 "each line needs a product reference (catalogProductId or
 * supplierProductId)"`. This builder was the last caller still sending the retired `productId` key,
 * and nothing covered it — so the cockpit's only write path ("缺口 → 采购单草稿") would have failed
 * for every mapped SKU. These tests pin the contract and the two documented refusals.
 */

const mapped = (productId: string | null, status = 'mapped') => ({
  ru_sku: 'PK44',
  status,
  product_id: productId,
})

const planRows = (rows: Record<string, unknown>[]) =>
  new Map(rows.map((row) => [String(row.sku), row]))

describe('buildDraftPosLines', () => {
  it('names the mapped product with the catalogProductId key the purchase-order line accepts', () => {
    const { lines, unmapped } = buildDraftPosLines({
      requested: [{ sku: 'PK44' }],
      decisions: new Map([['PK44', mapped('11111111-1111-1111-1111-111111111111')]]),
      planRows: planRows([{ sku: 'PK44', recommended_qty: '12', unit_cost: { amount: '9.50', currency: 'CNY' } }]),
      currencyCode: 'CNY',
    })

    expect(unmapped).toEqual([])
    expect(lines).toHaveLength(1)
    expect(Object.keys(lines[0])).toContain('catalogProductId')
    expect(lines[0].catalogProductId).toBe('11111111-1111-1111-1111-111111111111')
    // The retired key must not come back alongside it: purchasing rejects a line carrying both.
    expect(lines[0]).not.toHaveProperty('productId')
    expect(lines[0].quantity).toBe('12')
    expect(lines[0].unitPrice).toBe('9.50')
    expect(lines[0].priceIncludesTax).toBe(true)
    expect(lines[0].note).toBe('RU plan PK44')
  })

  it('falls back to a zero price and a visible note when the RU cost is in another currency', () => {
    const { lines } = buildDraftPosLines({
      requested: [{ sku: 'PK44', quantity: '4' }],
      decisions: new Map([['PK44', mapped('22222222-2222-2222-2222-222222222222')]]),
      planRows: planRows([{ sku: 'PK44', recommended_qty: '12', unit_cost: { amount: '800', currency: 'RUB' } }]),
      currencyCode: 'CNY',
    })

    expect(lines[0].quantity).toBe('4')
    expect(lines[0].unitPrice).toBe('0')
    expect(String(lines[0].note)).toContain('RU unit cost 800.00 RUB')
    expect(String(lines[0].note)).toContain('set the price before placing')
  })

  it('reports every code that cannot be ordered instead of dropping it silently', () => {
    const { lines, unmapped } = buildDraftPosLines({
      requested: [{ sku: 'PK44' }, { sku: 'PK45' }, { sku: 'PK46' }, { sku: 'PK47' }],
      decisions: new Map([
        ['PK44', mapped('33333333-3333-3333-3333-333333333333')],
        ['PK45', mapped(null)],
        ['PK46', mapped(null, 'ignored')],
      ]),
      planRows: planRows([{ sku: 'PK44', recommended_qty: '1' }, { sku: 'PK46', recommended_qty: '1' }]),
      currencyCode: 'CNY',
    })

    expect(lines).toHaveLength(1)
    expect(unmapped.map((entry) => entry.sku)).toEqual(['PK45', 'PK46', 'PK47'])
    expect(unmapped[0].reason).toContain('status is mapped')
    expect(unmapped[1].reason).toContain('status is ignored')
    expect(unmapped[2].reason).toContain('no mapping decision')
  })

  it('refuses a plan row that recommends nothing', () => {
    const { lines, unmapped } = buildDraftPosLines({
      requested: [{ sku: 'PK44' }],
      decisions: new Map([['PK44', mapped('44444444-4444-4444-4444-444444444444')]]),
      planRows: planRows([{ sku: 'PK44', recommended_qty: '0', unit_cost: { amount: '1.00', currency: 'CNY' } }]),
      currencyCode: 'CNY',
    })

    expect(lines).toEqual([])
    expect(unmapped[0].reason).toBe('the RU plan recommends no quantity')
  })
})
