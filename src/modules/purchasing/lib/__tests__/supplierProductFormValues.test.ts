import { describe, expect, it } from '@jest/globals'
import {
  buildSupplierProductPayload,
  buildSupplierProductPriceRowsPayload,
  EMPTY_VALUES,
  toSupplierProductFormValues,
  type SupplierProductFormValues,
} from '../supplierProductFormValues'

/**
 * The form's value/payload round trip.
 *
 * `CrudForm`'s number field hands the form a **number** once the operator has typed in it and the
 * raw string while untouched — the mixed shapes are the interesting case here, because calling
 * `.trim()` on the number is exactly what broke the first save of a row whose Qty/Box had been
 * filled in.
 */
describe('supplierProductFormValues', () => {
  it('accepts a numeric field as a number and as a string', () => {
    const typed = buildSupplierProductPayload({
      ...EMPTY_VALUES,
      supplierSku: 'SPL-1',
      name: 'Eversweet',
      moqQuantity: 10,
      cartonQuantity: 8,
      unitNetWeight: 1.28,
      cartonGrossWeight: '15.5',
      cartonNetWeight: 14,
    })
    expect(typed.moqQuantity).toBe(10)
    expect(typed.cartonQuantity).toBe(8)
    expect(typed.unitNetWeight).toBe('1.28')
    expect(typed.cartonGrossWeight).toBe('15.5')
    expect(typed.cartonNetWeight).toBe('14')

    const untouched = buildSupplierProductPayload({ ...EMPTY_VALUES, supplierSku: 'SPL-1', name: 'Eversweet' })
    expect(untouched.moqQuantity).toBeNull()
    expect(untouched.cartonGrossWeight).toBeNull()
  })

  it('clears a cleared field instead of resurrecting the old value', () => {
    const cleared = buildSupplierProductPayload({
      ...EMPTY_VALUES,
      supplierSku: 'SPL-1',
      name: 'Eversweet',
      nameZh: '  ',
      declarationElements: '',
      imageAttachmentIds: [],
      outerPacking: { length: '', width: '', height: '' },
    })
    expect(cleared.nameZh).toBeNull()
    expect(cleared.declarationElements).toBeNull()
    expect(cleared.imageAttachmentIds).toEqual([])
    expect(cleared.outerPacking).toBeNull()
    // The API contract keeps `unit` non-empty, so a blank field falls back to the default code.
    expect(cleared.unit).toBe('PCS')
  })

  it('maps an API row back onto the form, including its price list and version', () => {
    const values: SupplierProductFormValues = toSupplierProductFormValues({
      id: '11111111-1111-4111-8111-111111111111',
      supplierSku: 'SPL-1',
      name: 'Eversweet',
      name_zh: '智能饮水机',
      declaration_elements: '品名:饮水机',
      image_attachment_ids: ['22222222-2222-4222-8222-222222222222'],
      carton_quantity: 8,
      updated_at: '2026-09-23T02:16:22.000Z',
      prices: [{ priceKind: 'company_offer', currency_code: 'usd', min_quantity: 2, unit_price: '3.200000', is_active: false }],
    })
    expect(values.nameZh).toBe('智能饮水机')
    expect(values.declarationElements).toBe('品名:饮水机')
    expect(values.imageAttachmentIds).toEqual(['22222222-2222-4222-8222-222222222222'])
    expect(values.cartonQuantity).toBe('8')
    expect(values.updatedAt).toBe('2026-09-23T02:16:22.000Z')
    expect(values.prices).toHaveLength(1)
    expect(values.prices[0]).toMatchObject({ priceKind: 'company_offer', currencyCode: 'USD', minQuantity: '2', isActive: false })
  })

  it('submits the price set with the row key as its identity, and drops an amount-less row', () => {
    const rows = buildSupplierProductPriceRowsPayload([
      { key: 'a', priceKind: 'supplier_cost', currencyCode: 'cny', minQuantity: '1', unitPrice: '12.5', isActive: true },
      { key: 'b', priceKind: 'company_offer', currencyCode: 'USD', minQuantity: '1', unitPrice: '', isActive: true },
      { key: 'c', priceKind: 'company_offer', currencyCode: 'USD', minQuantity: '10', unitPrice: '2.9', isActive: false },
    ])
    // The abandoned row is gone; the withdrawn one keeps its amount and its off state.
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ priceKind: 'supplier_cost', currencyCode: 'CNY', minQuantity: 1, unitPrice: '12.5', isActive: true })
    expect(rows[1]).toEqual({ priceKind: 'company_offer', currencyCode: 'USD', minQuantity: 10, unitPrice: '2.9', isActive: false })
  })
})
