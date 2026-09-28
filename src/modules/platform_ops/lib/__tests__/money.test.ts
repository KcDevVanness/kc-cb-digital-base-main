import { afterAll, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  amountsDiffer,
  amountsEqual,
  quantizePlatformAmount,
  resolvePlatformAmounts,
  shouldRaiseReconciliationItem,
} from '../money'

/**
 * The platform_ops money seam: exact (scaled-integer) amount comparison, the reconciliation dedup
 * rule, and the quantization of external amounts to the system's 2-decimal caliber.
 */
describe('platform_ops amount comparison', () => {
  it('treats decimal strings denoting the same amount as equal', () => {
    expect(amountsEqual('238866.74', '238866.74')).toBe(true)
    expect(amountsEqual('10', '10.00')).toBe(true)
    expect(amountsEqual('0', '0.00')).toBe(true)
    expect(amountsEqual(null, undefined)).toBe(true)
    expect(amountsDiffer('10.00', '10.00')).toBe(false)
  })

  it('sees a 0.01 difference that the old 1e-6 float tolerance hid', () => {
    expect(amountsEqual('10.00', '10.01')).toBe(false)
    expect(amountsDiffer('10.00', '10.01')).toBe(true)
    expect(amountsDiffer('10.01', '10.00')).toBe(true)
    expect(amountsDiffer('-0.01', '0.01')).toBe(true)
  })

  it('treats a missing row value as zero, not as an implicit match', () => {
    expect(amountsDiffer(undefined, '10.00')).toBe(true)
    expect(amountsDiffer('10.00', undefined)).toBe(true)
    expect(amountsEqual(undefined, '0.00')).toBe(true)
  })
})

describe('platform_ops reconciliation dedup', () => {
  const previous = { expectedAmount: '10.00', actualAmount: '9.00' }

  it('raises a fresh item when no previous item exists', () => {
    expect(shouldRaiseReconciliationItem(null, { expectedAmount: '10.00', actualAmount: '9.00' })).toBe(true)
    expect(shouldRaiseReconciliationItem(undefined, { actualAmount: null })).toBe(true)
  })

  it('stays silent when neither amount changed', () => {
    expect(shouldRaiseReconciliationItem(previous, { expectedAmount: '10.00', actualAmount: '9.00' })).toBe(false)
    expect(shouldRaiseReconciliationItem(previous, { expectedAmount: '10', actualAmount: '9.000' })).toBe(false)
  })

  it('raises again when either the expected or the actual amount changed', () => {
    expect(shouldRaiseReconciliationItem(previous, { expectedAmount: '10.01', actualAmount: '9.00' })).toBe(true)
    expect(shouldRaiseReconciliationItem(previous, { expectedAmount: '10.00', actualAmount: '9.01' })).toBe(true)
  })
})

describe('platform_ops amount quantization', () => {
  const logger = createLogger('platform_ops')
  const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {})

  beforeEach(() => {
    warn.mockClear()
  })
  afterAll(() => warn.mockRestore())

  it('quantizes finer amounts HALF_UP (away from zero) and warns with field and raw value', () => {
    expect(quantizePlatformAmount('10.005', 'orders.E1.grossAmount')).toBe('10.01')
    expect(quantizePlatformAmount('-0.005', 'lines.E2.feeAmount')).toBe('-0.01')
    expect(warn).toHaveBeenCalledWith('platform amount quantized to 2 decimals', {
      field: 'orders.E1.grossAmount',
      value: '10.005',
      scale: 3,
    })
  })

  it('accepts JSON numbers and leaves 2-decimal values untouched and unwarned', () => {
    expect(quantizePlatformAmount(10.005, 'orders.E1.netAmount')).toBe('10.01')
    expect(quantizePlatformAmount('10.01', 'orders.E1.netAmount')).toBe('10.01')
    expect(quantizePlatformAmount(10, 'orders.E1.netAmount')).toBe('10.00')
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('does not warn when the net is an exact gross − fee fallback', () => {
    const amounts = resolvePlatformAmounts({ grossAmount: '100.00', feeAmount: '0.05' }, 'orders.E7')
    expect(amounts).toEqual({ gross: '100.00', fee: '0.05', net: '99.95' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns when an explicit net has to be quantized', () => {
    expect(resolvePlatformAmounts({ netAmount: '1.234' }, 'lines.E3').net).toBe('1.23')
    expect(warn).toHaveBeenCalledWith('platform amount quantized to 2 decimals', {
      field: 'lines.E3.netAmount',
      value: '1.234',
      scale: 3,
    })
  })
})
