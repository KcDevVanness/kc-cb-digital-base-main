import { describe, expect, it } from '@jest/globals'
import {
  allocateLandedCost,
  assembleLandedCost,
  type LandedCostFeeInput,
  type LandedCostInputLine,
  type LandedCostWeightLine,
} from '../landedCost'

function fee(overrides: Partial<LandedCostFeeInput> = {}): LandedCostFeeInput {
  return {
    id: 'fee-1',
    costType: 'ocean_freight',
    allocationBasis: 'amount',
    amountCny: '1000.0000',
    amount: '1000.0000',
    currencyCode: 'CNY',
    ...overrides,
  }
}

function weightLine(key: string, lineNumber: number, amount: string, quantity: string): LandedCostWeightLine {
  return { key, lineNumber, amountWeight: amount, quantityWeight: quantity }
}

function inputLine(overrides: Partial<LandedCostInputLine> = {}): LandedCostInputLine {
  return {
    purchaseOrderLineId: 'line-1',
    purchaseOrderId: 'order-1',
    purchaseOrderNumber: 'PO-2026-0001',
    businessNumber: null,
    lineNumber: 1,
    productId: 'product-1',
    productTitle: 'Product',
    sku: 'SKU-1',
    orderCurrencyCode: 'CNY',
    netTotal: '100.0000',
    allocatedQuantity: '10.0000',
    purchaseRateToCny: '1',
    ...overrides,
  }
}

describe('allocateLandedCost', () => {
  it('spreads a fee by net amount and keeps the sum equal to the fee', () => {
    const result = allocateLandedCost(
      [fee({ amountCny: '100.0000' })],
      [weightLine('a', 1, '30.0000', '0'), weightLine('b', 2, '70.0000', '0')],
    )
    expect(result.byLine.get('a')).toBe('30.00')
    expect(result.byLine.get('b')).toBe('70.00')
    expect(result.allocatedTotal).toBe('100.00')
  })

  it('puts the rounding remainder on the largest share', () => {
    // 100 / 3 = 33.33… on equal weights: the remainder must land on one line, and Σ stays 100.
    const result = allocateLandedCost(
      [fee({ amountCny: '100.0000' })],
      [
        weightLine('a', 1, '10.0000', '0'),
        weightLine('b', 2, '10.0000', '0'),
        weightLine('c', 3, '10.0000', '0'),
      ],
    )
    const values = ['a', 'b', 'c'].map((key) => result.byLine.get(key))
    expect(values).toEqual(['33.34', '33.33', '33.33'])
    expect(result.allocatedTotal).toBe('100.00')
  })

  it('breaks a share tie by the lowest line number', () => {
    // Three equal weights, target 0.01 (1 unit at scale 2), each share 0 units and a remainder of 1:
    // the extra cent goes to the lowest line number, whichever order the rows arrive in.
    const result = allocateLandedCost(
      [fee({ amountCny: '0.0100' })],
      [
        weightLine('zzz', 5, '1.0000', '0'),
        weightLine('aaa', 2, '1.0000', '0'),
        weightLine('mmm', 4, '1.0000', '0'),
      ],
    )
    expect(result.byLine.get('aaa')).toBe('0.01')
    expect(result.byLine.get('mmm')).toBe('0.00')
    expect(result.byLine.get('zzz')).toBe('0.00')
    expect(result.allocatedTotal).toBe('0.01')
  })

  it('keeps the sum exact when half-up rounding overshoots', () => {
    // Two equal weights, target 0.01 (1 unit): each share rounds up to 1, so the winner gives one
    // unit back — the total is still exactly the fee.
    const result = allocateLandedCost(
      [fee({ amountCny: '0.0100' })],
      [weightLine('zzz', 5, '1.0000', '0'), weightLine('aaa', 2, '1.0000', '0')],
    )
    expect(result.byLine.get('zzz')).toBe('0.01')
    expect(result.byLine.get('aaa')).toBe('0.00')
    expect(result.allocatedTotal).toBe('0.01')
  })

  it('allocates by quantity when the basis asks for it', () => {
    const result = allocateLandedCost(
      [fee({ amountCny: '60.0000', allocationBasis: 'quantity' })],
      [weightLine('a', 1, '900.0000', '1.0000'), weightLine('b', 2, '100.0000', '2.0000')],
    )
    expect(result.byLine.get('a')).toBe('20.00')
    expect(result.byLine.get('b')).toBe('40.00')
  })

  it('falls back to the other dimension when the chosen weights are all zero', () => {
    const result = allocateLandedCost(
      [fee({ amountCny: '100.0000', allocationBasis: 'quantity' })],
      [weightLine('a', 1, '40.0000', '0'), weightLine('b', 2, '60.0000', '0')],
    )
    expect(result.byLine.get('a')).toBe('40.00')
    expect(result.byLine.get('b')).toBe('60.00')
    expect(result.unallocated).toHaveLength(0)
  })

  it('reports a fee with no weights at all instead of forcing it onto one line', () => {
    const result = allocateLandedCost([fee()], [weightLine('a', 1, '0', '0'), weightLine('b', 2, '0', '0')])
    expect(result.unallocated).toHaveLength(1)
    expect(result.allocatedTotal).toBe('0.00')
    expect(result.byLine.get('a')).toBe('0.00')
  })

  it('excludes a fee without a rate and reports it as unconvertible', () => {
    const result = allocateLandedCost(
      [fee({ id: 'usd', amountCny: null, currencyCode: 'USD', amount: '500.0000' })],
      [weightLine('a', 1, '1.0000', '1.0000')],
    )
    expect(result.unconvertible.map((entry) => entry.id)).toEqual(['usd'])
    expect(result.allocatedTotal).toBe('0.00')
    expect(result.byLine.get('a')).toBe('0.00')
  })

  it('has no allocation for a container without lines', () => {
    const result = allocateLandedCost([fee()], [])
    expect(result.unallocated).toHaveLength(1)
    expect(result.byLine.size).toBe(0)
  })
})

describe('assembleLandedCost', () => {
  it('converts a USD fee at the resolved rate and keeps Σ shares equal to the fee', () => {
    const lines = [
      inputLine({ purchaseOrderLineId: 'a', lineNumber: 1, netTotal: '3000.0000', allocatedQuantity: '3.0000', purchaseRateToCny: '6.80000000' }),
      inputLine({ purchaseOrderLineId: 'b', lineNumber: 2, sku: 'SKU-2', netTotal: '1000.0000', allocatedQuantity: '1.0000', purchaseRateToCny: '6.80000000' }),
    ]
    const fees = [fee({ amountCny: '6800.0000', amount: '1000.0000', currencyCode: 'USD' })]
    const allocation = allocateLandedCost(
      fees,
      lines.map((line) => ({
        key: line.purchaseOrderLineId,
        lineNumber: line.lineNumber,
        amountWeight: line.netTotal,
        quantityWeight: line.allocatedQuantity,
      })),
    )
    const result = assembleLandedCost({ shipmentId: 'shipment-1', shipmentNumber: 'SHP-1', lines, fees, allocation })

    // Purchase value: 3000 × 6.8 and 1000 × 6.8.
    expect(result.lines[0].purchaseAmountCny).toBe('20400.00')
    expect(result.lines[1].purchaseAmountCny).toBe('6800.00')
    // Fee: 1000 USD × 6.8 = 6800 CNY, split 3:1.
    expect(result.lines[0].allocatedCostCny).toBe('5100.00')
    expect(result.lines[1].allocatedCostCny).toBe('1700.00')
    expect(result.totals.allocatedCny).toBe(result.totals.feesCny)
    expect(result.totals.feesCny).toBe('6800.00')
    expect(result.totals.landedCny).toBe('34000.00')

    // Landed unit = (purchase + allocated) / quantity, at the 4-decimal unit-price caliber.
    expect(result.lines[0].landedUnitCostCny).toBe('8500.0000')
    expect(result.lines[1].landedUnitCostCny).toBe('8500.0000')
  })

  it('keeps the original amount and leaves CNY null when the order currency has no rate', () => {
    const lines = [inputLine({ netTotal: '1000.0000', allocatedQuantity: '5.0000', orderCurrencyCode: 'USD', purchaseRateToCny: null })]
    const fees = [fee({ amountCny: '250.0000' })]
    const allocation = allocateLandedCost(
      fees,
      lines.map((line) => ({ key: line.purchaseOrderLineId, lineNumber: line.lineNumber, amountWeight: line.netTotal, quantityWeight: line.allocatedQuantity })),
    )
    const result = assembleLandedCost({ shipmentId: 'shipment-1', shipmentNumber: null, lines, fees, allocation })

    expect(result.lines[0].rateMissing).toBe(true)
    expect(result.lines[0].purchaseAmountOriginal).toBe('1000.0000')
    expect(result.lines[0].currencyCode).toBe('USD')
    expect(result.lines[0].purchaseAmountCny).toBeNull()
    expect(result.lines[0].landedTotalCny).toBeNull()
    expect(result.lines[0].landedUnitCostCny).toBeNull()
    // The fee is still allocated — the missing rate is a purchase-side gap, not a fee-side one.
    expect(result.lines[0].allocatedCostCny).toBe('250.00')
    expect(result.totals.linesMissingRate).toBe(1)
  })

  it('aggregates the lines into SKU rows and keeps the per-SKU sum equal to the line sum', () => {
    const lines = [
      inputLine({ purchaseOrderLineId: 'a', lineNumber: 1, sku: 'SKU-1', netTotal: '100.0000', allocatedQuantity: '2.0000' }),
      inputLine({ purchaseOrderLineId: 'b', lineNumber: 2, sku: 'SKU-1', netTotal: '50.0000', allocatedQuantity: '1.0000' }),
      inputLine({ purchaseOrderLineId: 'c', lineNumber: 3, sku: 'SKU-2', netTotal: '30.0000', allocatedQuantity: '3.0000' }),
    ]
    const fees = [fee({ amountCny: '18.0000' })]
    const allocation = allocateLandedCost(
      fees,
      lines.map((line) => ({ key: line.purchaseOrderLineId, lineNumber: line.lineNumber, amountWeight: line.netTotal, quantityWeight: line.allocatedQuantity })),
    )
    const result = assembleLandedCost({ shipmentId: 'shipment-1', shipmentNumber: null, lines, fees, allocation })

    const sku1 = result.skuRows.find((row) => row.sku === 'SKU-1')
    const sku2 = result.skuRows.find((row) => row.sku === 'SKU-2')
    expect(sku1?.quantity).toBe('3.00')
    expect(sku1?.purchaseAmountCny).toBe('150.00')
    expect(sku1?.lineCount).toBe(2)
    expect(sku2?.purchaseAmountCny).toBe('30.00')
    // SKU-1: 150 purchase + 15 allocated over 3 units, at the 4-decimal unit-price caliber.
    expect(sku1?.landedUnitCostCny).toBe('55.0000')

    const allocatedTotal = result.lines.reduce((sum, line) => sum + Number(line.allocatedCostCny), 0)
    expect(allocatedTotal).toBeCloseTo(Number(result.totals.allocatedCny), 10)
  })

  it('reports a zero-quantity line without a unit cost instead of dividing by zero', () => {
    const lines = [inputLine({ netTotal: '0.0000', allocatedQuantity: '0.0000' })]
    const allocation = allocateLandedCost([fee()], [
      { key: 'line-1', lineNumber: 1, amountWeight: '0.0000', quantityWeight: '0.0000' },
    ])
    const result = assembleLandedCost({
      shipmentId: 'shipment-1',
      shipmentNumber: null,
      lines,
      fees: [fee()],
      allocation,
    })
    expect(result.lines[0].landedUnitCostCny).toBeNull()
    expect(result.unallocatedFees).toHaveLength(1)
  })
})
