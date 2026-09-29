import { describe, expect, it } from '@jest/globals'
import {
  buildItemTimeline,
  buildVersionChains,
  classifyChange,
  computeDelta,
  decimalToMinor,
  diffQuotes,
  minorToDecimal,
  normalizeItemKey,
  pickPreviousVersion,
  type QuoteLineFacts,
  type QuoteVersionFacts,
} from '../quoteChanges'

/**
 * The rules the archive's "what changed?" answer rests on.
 *
 * Two of these cases exist because the naive implementation was measured wrong: the item key must be
 * the derived SKU (keying on `item_no` paired variant rows with each other and turned two identical
 * imports into sixteen phantom price changes), and money must never round-trip through a float.
 */

const line = (overrides: Partial<QuoteLineFacts> & { lineId: string }): QuoteLineFacts => ({
  itemNo: null,
  derivedSku: null,
  name: null,
  unitCost: null,
  currencyCode: 'CNY',
  moqQuantity: null,
  promotedProductId: null,
  sourceRowNumber: null,
  ...overrides,
})

const version = (overrides: Partial<QuoteVersionFacts> & { quoteId: string }): QuoteVersionFacts => ({
  number: null,
  status: 'approved',
  signature: 'sig-a',
  supplierId: 'supplier-1',
  quoteDate: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  fileName: null,
  lineCount: 0,
  promotedCount: 0,
  ...overrides,
})

describe('normalizeItemKey', () => {
  it('prefers the derived SKU and falls back to the supplier item number', () => {
    expect(normalizeItemKey('P4108', 'p4108-uvc')).toBe('P4108-UVC')
    expect(normalizeItemKey(' p4108 ', null)).toBe('P4108')
    expect(normalizeItemKey(null, '')).toBeNull()
  })
})

describe('exact money arithmetic', () => {
  it('compares decimals without binary floating point', () => {
    expect(decimalToMinor('0.1')! + decimalToMinor('0.2')!).toBe(decimalToMinor('0.3'))
    expect(minorToDecimal(decimalToMinor('12.500000')!)).toBe('12.5')
    expect(minorToDecimal(decimalToMinor('0')!)).toBe('0')
  })

  it('refuses anything that is not a plain decimal', () => {
    expect(decimalToMinor('')).toBeNull()
    expect(decimalToMinor('1,20')).toBeNull()
    expect(decimalToMinor(null)).toBeNull()
  })

  it('rounds a fifth decimal half away from zero instead of truncating it', () => {
    expect(minorToDecimal(decimalToMinor('1.00005')!)).toBe('1.0001')
    expect(minorToDecimal(decimalToMinor('-1.00005')!)).toBe('-1.0001')
    expect(minorToDecimal(decimalToMinor('1.00004')!)).toBe('1')
    // `1.00004` and `1.000049` are the same price at the column scale, so no change is reported
    expect(decimalToMinor('10.00004')).toBe(decimalToMinor('10.000049'))
    expect(
      classifyChange(line({ lineId: 'b', unitCost: '10.00004' }), line({ lineId: 't', unitCost: '10.00005' })),
    ).toBe('up')
  })
})

describe('classifyChange', () => {
  it('separates the four decisions from the three honest states', () => {
    expect(classifyChange(null, line({ lineId: 't', unitCost: '10' }))).toBe('added')
    expect(classifyChange(line({ lineId: 'b', unitCost: '10' }), null)).toBe('removed')
    expect(classifyChange(line({ lineId: 'b', unitCost: '10' }), line({ lineId: 't', unitCost: '12' }))).toBe('up')
    expect(classifyChange(line({ lineId: 'b', unitCost: '10' }), line({ lineId: 't', unitCost: '9.5' }))).toBe('down')
    expect(classifyChange(line({ lineId: 'b', unitCost: '10' }), line({ lineId: 't', unitCost: '10.000000' }))).toBe('same')
    expect(classifyChange(line({ lineId: 'b', unitCost: null }), line({ lineId: 't', unitCost: '9' }))).toBe('no_price')
  })

  it('never subtracts across currencies — a yen price is not a yuan price', () => {
    const base = line({ lineId: 'b', unitCost: '1000', currencyCode: 'JPY' })
    const target = line({ lineId: 't', unitCost: '60', currencyCode: 'CNY' })
    expect(classifyChange(base, target)).toBe('currency_mismatch')
    expect(computeDelta(base.unitCost, target.unitCost)).toEqual({ amount: '-940', percent: -94 })
  })

  it('reports a zero base price as an amount with no percentage', () => {
    expect(computeDelta('0', '5')).toEqual({ amount: '5', percent: null })
    expect(computeDelta('4', '5')).toEqual({ amount: '1', percent: 25 })
  })
})

describe('diffQuotes', () => {
  it('keys variants by their derived SKU so rows of one Item No. never pair with each other', () => {
    const base = [
      line({ lineId: 'b1', itemNo: 'P4108', derivedSku: 'P4108', unitCost: '10' }),
      line({ lineId: 'b2', itemNo: 'P4108', derivedSku: 'P4108-UVC', unitCost: '12' }),
    ]
    const target = [
      line({ lineId: 't1', itemNo: 'P4108', derivedSku: 'P4108', unitCost: '10' }),
      line({ lineId: 't2', itemNo: 'P4108', derivedSku: 'P4108-UVC', unitCost: '13' }),
    ]

    const { rows, summary } = diffQuotes(base, target)

    expect([...rows].map((row) => row.kind)).toEqual(['up', 'same'])
    expect(summary.up).toBe(1)
    expect(summary.same).toBe(1)
    expect(summary.total).toBe(2)
  })

  it('counts a repeated key inside one quotation instead of fanning the comparison out', () => {
    const duplicated = [
      line({ lineId: 'a1', derivedSku: 'P1', unitCost: '10' }),
      line({ lineId: 'a2', derivedSku: 'P1', unitCost: '11' }),
    ]
    const { rows, summary } = diffQuotes(duplicated, duplicated)

    expect(summary.duplicateKeys).toBe(2)
    expect(rows).toHaveLength(1)
  })

  it('reports keyless lines as unmatched instead of inventing added rows', () => {
    const { rows, summary } = diffQuotes(
      [line({ lineId: 'b1', unitCost: '10' })],
      [line({ lineId: 't1', unitCost: '10' })],
    )

    expect(rows).toHaveLength(0)
    expect(summary.unmatched).toBe(2)
    expect(summary.added).toBe(0)
  })

  it('drops unchanged rows from the page while the summary still counts them', () => {
    const base = [line({ lineId: 'b1', derivedSku: 'P1', unitCost: '10' }), line({ lineId: 'b2', derivedSku: 'P2', unitCost: '3' })]
    const target = [line({ lineId: 't1', derivedSku: 'P1', unitCost: '10' }), line({ lineId: 't2', derivedSku: 'P2', unitCost: '4' })]

    const { rows, summary } = diffQuotes(base, target, { onlyChanged: true })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('up')
    expect(summary.same).toBe(1)
    expect(summary.total).toBe(1)
  })
})

describe('buildVersionChains', () => {
  it('folds repeated imports of one layout on one day into a single version', () => {
    const chain = buildVersionChains([
      version({ quoteId: 'q1', createdAt: '2026-09-22T07:42:00.000Z' }),
      version({ quoteId: 'q2', createdAt: '2026-09-22T07:44:00.000Z' }),
      version({ quoteId: 'q3', createdAt: '2026-09-23T06:05:00.000Z' }),
    ])

    expect(chain.map((entry) => entry.quoteId)).toEqual(['q2', 'q3'])
    expect(chain[0]?.collapsedCount).toBe(1)
  })

  it('keeps decided history and drops anything that is not a version', () => {
    const chain = buildVersionChains([
      version({ quoteId: 'draft', status: 'draft' }),
      version({ quoteId: 'cancelled', status: 'cancelled' }),
      version({ quoteId: 'manual', signature: null }),
      version({ quoteId: 'no-supplier', supplierId: null }),
      version({ quoteId: 'archived', status: 'archived', createdAt: '2026-08-01T00:00:00.000Z' }),
      version({ quoteId: 'live', createdAt: '2026-09-01T00:00:00.000Z' }),
    ])

    expect(chain.map((entry) => entry.quoteId)).toEqual(['archived', 'live'])
  })

  it('uses the business date when the operator filled one, ordering by it', () => {
    const chain = buildVersionChains([
      version({ quoteId: 'later-import-older-quote', quoteDate: '2026-05-02', createdAt: '2026-09-10T00:00:00.000Z' }),
      version({ quoteId: 'import-first', quoteDate: '2026-05-01', createdAt: '2026-09-01T00:00:00.000Z' }),
    ])

    expect(chain.map((entry) => entry.quoteId)).toEqual(['import-first', 'later-import-older-quote'])
  })

  it('picks the previous version of the same chain, and nothing for the first', () => {
    const chain = buildVersionChains([
      version({ quoteId: 'v1', createdAt: '2026-09-01T00:00:00.000Z' }),
      version({ quoteId: 'v2', createdAt: '2026-09-05T00:00:00.000Z' }),
      version({ quoteId: 'other-supplier', supplierId: 'supplier-2', createdAt: '2026-09-04T00:00:00.000Z' }),
    ])

    expect(pickPreviousVersion(chain, 'v2')?.quoteId).toBe('v1')
    expect(pickPreviousVersion(chain, 'v1')).toBeNull()
    expect(pickPreviousVersion(chain, 'unrelated')).toBeNull()
  })
})

describe('buildItemTimeline', () => {
  it('marks the first quote and the movement after it', () => {
    const points = buildItemTimeline([
      { quoteId: 'q2', number: 'SQ-2', day: '2026-09-05', signature: 'sig', itemNo: 'P1', name: 'Item', unitCost: '12', currencyCode: 'CNY', moqQuantity: null, promotedProductId: null },
      { quoteId: 'q1', number: 'SQ-1', day: '2026-09-01', signature: 'sig', itemNo: 'P1', name: 'Item', unitCost: '10', currencyCode: 'CNY', moqQuantity: null, promotedProductId: null },
      { quoteId: 'q3', number: 'SQ-3', day: '2026-09-09', signature: 'sig', itemNo: 'P1', name: 'Item', unitCost: '11', currencyCode: 'CNY', moqQuantity: null, promotedProductId: null },
    ])

    expect(points.map((point) => point.quoteId)).toEqual(['q1', 'q2', 'q3'])
    expect(points[0]?.first).toBe(true)
    expect(points[1]?.kind).toBe('up')
    expect(points[1]?.deltaPercent).toBe(20)
    expect(points[2]?.kind).toBe('down')
  })
})
