import { describe, expect, it } from '@jest/globals'
import { computeInvoiceLineTax, computeInvoiceTotals } from '../invoiceTax'

/**
 * The tax calibers of a printed invoice (`.ai/specs/2026-09-24-pi-ci-tax-invoice-documents.md`,
 * F-301 / REQ-006): `价税合计 = 不含税合计 + 税额合计`, and an export invoice's 0% rate is a real
 * caliber that must produce zero tax without losing the gross amount.
 *
 * Every figure is at the system-wide amount scale (2 decimals, HALF_UP). These are the exact
 * figures a finance reader checks by hand, so they are pinned rather than asserted loosely: a
 * rounding change here moves money on a contract's financial column.
 */
describe('invoice tax', () => {
  it('extracts the contained tax from a tax-inclusive amount', () => {
    const line = computeInvoiceLineTax({ amount: '113.0000', taxRate: '13', priceIncludesTax: true })
    expect(line.taxAmount).toBe('13.00')
    expect(line.grossAmount).toBe('113.00')
  })

  it('adds the tax to a tax-exclusive amount', () => {
    const line = computeInvoiceLineTax({ amount: '100.0000', taxRate: '13', priceIncludesTax: false })
    expect(line.taxAmount).toBe('13.00')
    expect(line.grossAmount).toBe('113.00')
  })

  it('keeps a zero rate as a real caliber (an export invoice, 0% for the refund)', () => {
    const line = computeInvoiceLineTax({ amount: '250.5000', taxRate: '0', priceIncludesTax: false })
    expect(line.taxAmount).toBe('0.00')
    expect(line.grossAmount).toBe('250.50')
  })

  it('rounds the inclusive caliber away from zero at the amount scale, never twice', () => {
    const line = computeInvoiceLineTax({ amount: '1234.5600', taxRate: '9', priceIncludesTax: true })
    expect(line.taxAmount).toBe('101.94')
    expect(line.grossAmount).toBe('1234.56')
  })

  it('sums the head from the printed amounts, mixing both inclusive and exclusive lines', () => {
    const inclusive = computeInvoiceLineTax({ amount: '113.0000', taxRate: '13', priceIncludesTax: true })
    const exclusive = computeInvoiceLineTax({ amount: '100.0000', taxRate: '13', priceIncludesTax: false })
    const totals = computeInvoiceTotals([
      { amount: '113.0000', taxAmount: inclusive.taxAmount, priceIncludesTax: true },
      { amount: '100.0000', taxAmount: exclusive.taxAmount, priceIncludesTax: false },
    ])
    // The face amounts keep their old meaning…
    expect(totals.subtotal).toBe('213.00')
    expect(totals.total).toBe('213.00')
    // …and the tax calibers are additive on top of them.
    expect(totals.taxTotal).toBe('26.00')
    expect(totals.grossTotal).toBe('226.00')
  })

  it('refuses a value that is not a finite decimal instead of silently skipping it', () => {
    expect(() => computeInvoiceLineTax({ amount: 'not-a-number', taxRate: '13', priceIncludesTax: true })).toThrow()
    expect(() => computeInvoiceLineTax({ amount: '10.00', taxRate: 'x', priceIncludesTax: true })).toThrow()
  })
})
