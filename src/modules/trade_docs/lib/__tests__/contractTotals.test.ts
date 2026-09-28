import { describe, expect, it } from '@jest/globals'
import { resolveContractTotals } from '../contractTotals'

describe('resolveContractTotals', () => {
  it('computes both calibers from quantity and price when nothing is invoiced', () => {
    const result = resolveContractTotals({
      lines: [{ id: 'line-1', quantity: '3.000000', unitPrice: '1200.400000' }],
      invoiceLines: [],
    })
    expect(result.lines).toEqual([
      { id: 'line-1', financeAmount: '3601.20', contractAmount: '3601.20', financeSource: 'computed' },
    ])
    expect(result.totals).toEqual({
      contractTotal: '3601.20',
      financeTotal: '3601.20',
      differenceTotal: '0.00',
    })
    expect(result.invoiceCoveredTotal).toBe('0.00')
  })

  it('lets a confirmed invoice amount take over one line and keeps the contract figure', () => {
    const result = resolveContractTotals({
      lines: [
        { id: 'line-1', quantity: '3.000000', unitPrice: '1200.400000' },
        { id: 'line-2', quantity: '1.000000', unitPrice: '50.000000' },
      ],
      invoiceLines: [{ contractLineId: 'line-1', amount: '3600.0000' }],
    })
    expect(result.lines[0]).toEqual({
      id: 'line-1',
      financeAmount: '3600.00',
      contractAmount: '3601.20',
      financeSource: 'invoice',
    })
    // The untouched line keeps its computed financial amount.
    expect(result.lines[1]).toEqual({
      id: 'line-2',
      financeAmount: '50.00',
      contractAmount: '50.00',
      financeSource: 'computed',
    })
    expect(result.totals).toEqual({
      contractTotal: '3651.20',
      financeTotal: '3650.00',
      differenceTotal: '1.20',
    })
    expect(result.invoiceCoveredTotal).toBe('3600.00')
  })

  it('sums several confirmed invoices bound to the same contract line', () => {
    const result = resolveContractTotals({
      lines: [{ id: 'line-1', quantity: '10.000000', unitPrice: '100.000000' }],
      invoiceLines: [
        { contractLineId: 'line-1', amount: '400.0000' },
        { contractLineId: 'line-1', amount: '605.0000' },
      ],
    })
    expect(result.lines[0]!.financeAmount).toBe('1005.00')
    expect(result.lines[0]!.financeSource).toBe('invoice')
    expect(result.totals.financeTotal).toBe('1005.00')
    expect(result.totals.differenceTotal).toBe('-5.00')
  })

  it('ignores an invoice line that is not bound to any contract line', () => {
    const result = resolveContractTotals({
      lines: [{ id: 'line-1', quantity: '2.000000', unitPrice: '10.000000' }],
      invoiceLines: [{ contractLineId: null, amount: '999.0000' }],
    })
    expect(result.lines[0]!.financeSource).toBe('computed')
    expect(result.totals.financeTotal).toBe('20.00')
  })

  it('keeps both calibers at the amount scale whatever the currency', () => {
    const result = resolveContractTotals({
      lines: [{ id: 'line-1', quantity: '3.000000', unitPrice: '1200.400000' }],
      invoiceLines: [],
    })
    expect(result.lines[0]!.financeAmount).toBe('3601.20')
    expect(result.lines[0]!.contractAmount).toBe('3601.20')
    expect(result.totals.differenceTotal).toBe('0.00')
  })
})
