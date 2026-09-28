import { describe, expect, it } from '@jest/globals'
import { AMOUNT_SCALE, toScaledUnits } from '../../../trade_docs/lib/money'
import {
  applyReceiptQuantity,
  computeDepositAmount,
  computeLineTotals,
  computeOrderTotals,
  derivePaymentState,
} from '../orderTotals'

/**
 * The purchasing money caliber: amounts 2 decimals HALF_UP, unit prices 4 decimals, the line amount
 * `HALF_UP(quantity × unit_price, 2)` as the one rounding point. The contract-samples below are the
 * owner's own contract rows (`.ai/specs/2026-09-28-money-scale-2dp-unification.md`).
 */
describe('computeLineTotals', () => {
  it('keeps `netTotal + taxAmount === lineTotal` on the tax-exclusive side', () => {
    const line = computeLineTotals({ quantity: '700', unitPrice: '341.2382', taxRate: '13', priceIncludesTax: false })
    // 700 × 341.2382 = 238 866.74 exactly.
    expect(line.netTotal).toBe('238866.74')
    expect(line.taxAmount).toBe('31052.68')
    expect(line.lineTotal).toBe('269919.42')
    expect(toScaledUnits(line.netTotal, AMOUNT_SCALE) + toScaledUnits(line.taxAmount, AMOUNT_SCALE)).toBe(
      toScaledUnits(line.lineTotal, AMOUNT_SCALE),
    )
  })

  it('keeps the invariant on the tax-inclusive side, deriving tax as the exact remainder', () => {
    const line = computeLineTotals({ quantity: '180', unitPrice: '65.5916', taxRate: '13', priceIncludesTax: true })
    // 180 × 65.5916 = 11 806.488 → gross 11 806.49; net = gross ÷ 1.13, tax = gross − net.
    expect(line.lineTotal).toBe('11806.49')
    expect(line.netTotal).toBe('10448.22')
    expect(line.taxAmount).toBe('1358.27')
    expect(toScaledUnits(line.netTotal, AMOUNT_SCALE) + toScaledUnits(line.taxAmount, AMOUNT_SCALE)).toBe(
      toScaledUnits(line.lineTotal, AMOUNT_SCALE),
    )
  })

  it('rounds the line amount half-up, never to the nearest even', () => {
    const line = computeLineTotals({ quantity: '290', unitPrice: '1345.5907', taxRate: '0', priceIncludesTax: false })
    // 290 × 1345.5907 = 390 221.303 → 390 221.30; a tax rate of 0 keeps net = line, tax = 0.
    expect(line.netTotal).toBe('390221.30')
    expect(line.taxAmount).toBe('0.00')
    expect(line.lineTotal).toBe('390221.30')
  })
})

describe('computeOrderTotals', () => {
  it('sums the already-rounded line values exactly, without a second rounding', () => {
    const lines = [
      computeLineTotals({ quantity: '700', unitPrice: '341.2382', taxRate: '13', priceIncludesTax: false }),
      computeLineTotals({ quantity: '180', unitPrice: '65.5916', taxRate: '13', priceIncludesTax: true }),
      computeLineTotals({ quantity: '290', unitPrice: '1345.5907', taxRate: '0', priceIncludesTax: false }),
    ]
    const totals = computeOrderTotals(lines)
    expect(totals.subtotal).toBe('639536.26')
    expect(totals.taxTotal).toBe('32410.95')
    expect(totals.total).toBe('671947.21')
    expect(toScaledUnits(totals.total, AMOUNT_SCALE)).toBe(
      lines.reduce((acc, line) => acc + toScaledUnits(line.lineTotal, AMOUNT_SCALE), 0n),
    )
  })
})

describe('computeDepositAmount', () => {
  it('is HALF_UP(total × percent ÷ 100, 2), rounded once in the engine', () => {
    expect(computeDepositAmount('6000.005', '30')).toBe('1800.00')
    expect(computeDepositAmount('100', '33.333')).toBe('33.33')
    expect(computeDepositAmount('1200', '20')).toBe('240.00')
  })

  it('carries the one-cent remainder half-up and stays a scaled integer', () => {
    // 0.5 % of 0.01 = 0.00005 → HALF_UP at 2 decimals → 0.00; 50 % of 0.01 = 0.005 → 0.01.
    expect(computeDepositAmount('0.01', '50')).toBe('0.01')
    expect(computeDepositAmount('0.01', '0.5')).toBe('0.00')
    // A third of 100 is 33.333… → 33.33 (never 33.34 by float noise).
    expect(computeDepositAmount('100', '33.333')).toBe('33.33')
    expect(computeDepositAmount('10', '1.005')).toBe('0.10')
  })

  it('reads a null/zero percentage as no deposit and a zero total as 0.00', () => {
    expect(computeDepositAmount('1000', null)).toBe('0.00')
    expect(computeDepositAmount('1000', undefined)).toBe('0.00')
    expect(computeDepositAmount('1000', '0')).toBe('0.00')
    expect(computeDepositAmount('0', '30')).toBe('0.00')
  })
})

describe('derivePaymentState', () => {
  it('derives paid/outstanding as scaled integers and keeps the stage vocabulary', () => {
    expect(derivePaymentState('1000.00', [{ stage: 'deposit', amount: '300.00' }])).toEqual({
      paidTotal: '300.00',
      outstanding: '700.00',
      paymentStatus: 'deposit_paid',
    })
    expect(
      derivePaymentState('1000.00', [
        { stage: 'deposit', amount: '300.00' },
        { stage: 'balance', amount: '700.00' },
      ]),
    ).toEqual({ paidTotal: '1000.00', outstanding: '0.00', paymentStatus: 'paid' })
    expect(
      derivePaymentState('1000.00', [
        { stage: 'deposit', amount: '300.00' },
        { stage: 'deposit', amount: '200.00' },
      ]),
    ).toEqual({ paidTotal: '500.00', outstanding: '500.00', paymentStatus: 'partially_paid' })
  })

  it('carries cents exactly, so a cent-level outstanding never disappears', () => {
    expect(derivePaymentState('0.03', [{ stage: 'other', amount: '0.01' }])).toEqual({
      paidTotal: '0.01',
      outstanding: '0.02',
      paymentStatus: 'partially_paid',
    })
  })
})

describe('applyReceiptQuantity', () => {
  it('compares the accumulated quantity to the order exactly, at the fourth decimal', () => {
    expect(applyReceiptQuantity('10.0000', '9.9999', '0.0001')).toEqual({
      receivedQuantity: '10.0000',
      exceedsOrdered: false,
    })
    expect(applyReceiptQuantity('10.0000', '9.9999', '0.0002')).toEqual({
      receivedQuantity: '10.0001',
      exceedsOrdered: true,
    })
    // 0.1 + 0.2 is 0.3 exactly here, where a float would read 0.30000000000000004.
    expect(applyReceiptQuantity('0.3', '0.1', '0.2')).toEqual({ receivedQuantity: '0.3000', exceedsOrdered: false })
  })
})
