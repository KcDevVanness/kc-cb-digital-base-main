import { describe, expect, it } from '@jest/globals'
import {
  applyLinePickerValue,
  linePickerValue,
  toProductPickerValue,
  toSupplierProductPickerValue,
} from '../orderLinePicker'

/**
 * The picker's value protocol.
 *
 * The editor shows one search box over two lists, and this mapping is what decides which column the
 * order line's reference lands on — a mix-up would silently attach the wrong id (or two ids, which
 * the command rejects with a 400) to a live purchase order.
 */
describe('orderLinePicker', () => {
  it('reads the reference a saved line carries', () => {
    expect(linePickerValue({ supplierProductId: 'sp-1', productId: '', catalogProductId: '' }))
      .toBe(toSupplierProductPickerValue('sp-1'))
    expect(linePickerValue({ supplierProductId: '', productId: 'p-1', catalogProductId: '' }))
      .toBe(toProductPickerValue('p-1'))
    // A legacy draft wrote the installed catalog id: it is still a master reference.
    expect(linePickerValue({ supplierProductId: '', productId: '', catalogProductId: 'cat-1' }))
      .toBe(toProductPickerValue('cat-1'))
    // The library reference wins when a row carries both (a line saved before the rule tightened).
    expect(linePickerValue({ supplierProductId: 'sp-1', productId: 'p-1', catalogProductId: 'cat-1' }))
      .toBe(toSupplierProductPickerValue('sp-1'))
    expect(linePickerValue({ supplierProductId: '', productId: '', catalogProductId: '' })).toBe('')
  })

  it('writes exactly one reference, clearing the other side', () => {
    // Picking from the library must drop a master reference picked earlier, label included.
    expect(applyLinePickerValue(toSupplierProductPickerValue('sp-9'))).toEqual({
      supplierProductId: 'sp-9',
      productId: '',
      catalogProductId: '',
      productLabel: '',
    })
    // ...and the other way round, including the legacy column.
    expect(applyLinePickerValue(toProductPickerValue('p-9'))).toEqual({
      productId: 'p-9',
      supplierProductId: '',
      catalogProductId: '',
      productLabel: '',
    })
  })

  it('treats any unrecognized value as a clear', () => {
    expect(applyLinePickerValue('')).toEqual({
      supplierProductId: '',
      productId: '',
      catalogProductId: '',
      productLabel: '',
    })
    expect(applyLinePickerValue('9f6e6f1e')).toEqual({
      supplierProductId: '',
      productId: '',
      catalogProductId: '',
      productLabel: '',
    })
  })
})
