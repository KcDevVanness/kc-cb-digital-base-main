import { describe, expect, it } from '@jest/globals'
import { buildQuoteConversionReport, ratePercent, type QuoteConversionOrderRow, type QuoteConversionQuoteRow } from '../quoteConversion'

const quote = (overrides: Partial<QuoteConversionQuoteRow> & { id: string }): QuoteConversionQuoteRow => ({
  number: `QUOTE-${overrides.id}`,
  status: null,
  sentAt: null,
  validUntil: null,
  channelId: null,
  ...overrides,
})

const order = (id: string, sourceQuoteId: string, number: string | null = `ORDER-${id}`): QuoteConversionOrderRow => ({
  id,
  number,
  status: 'draft',
  sourceQuoteId,
})

describe('buildQuoteConversionReport', () => {
  it('counts a quote as converted only when an order references it', () => {
    const report = buildQuoteConversionReport(
      [quote({ id: 'q1', sentAt: '2026-09-01T00:00:00.000Z' }), quote({ id: 'q2', sentAt: '2026-09-02T00:00:00.000Z' }), quote({ id: 'q3' })],
      [order('o1', 'q2', 'PO-1'), order('o2', 'q2', 'PO-2')],
    )
    expect(report.quotes.map((fact) => [fact.id, fact.converted, fact.orderCount])).toEqual([
      ['q1', false, 0],
      ['q2', true, 2],
      ['q3', false, 0],
    ])
    expect(report.quotes[1].orderNumbers).toEqual(['PO-1', 'PO-2'])
    expect(report.summary).toEqual({ quotes: 3, sent: 2, converted: 1, rateOverQuotes: 1 / 3, rateOverSent: 0.5 })
  })

  it('reads 已发出 from the sent timestamp, not from a status word', () => {
    const report = buildQuoteConversionReport(
      // A sent quote whose status was never written (pre-Phase-1 rows) still belongs to the stricter
      // denominator; a draft that merely carries a status word does not.
      [quote({ id: 'q1', sentAt: '2026-09-01T00:00:00.000Z', status: null }), quote({ id: 'q2', status: 'sent' })],
      [],
    )
    expect(report.summary.sent).toBe(1)
  })

  it('answers null rather than NaN or a fake zero when a denominator is empty', () => {
    const empty = buildQuoteConversionReport([], [])
    expect(empty.summary).toEqual({ quotes: 0, sent: 0, converted: 0, rateOverQuotes: null, rateOverSent: null })

    const unsent = buildQuoteConversionReport([quote({ id: 'q1' })], [])
    expect(unsent.summary.rateOverQuotes).toBe(0)
    expect(unsent.summary.rateOverSent).toBeNull()
  })

  it('keeps orders whose source quote is outside the period out of every rate', () => {
    const report = buildQuoteConversionReport([quote({ id: 'q1', sentAt: '2026-09-01T00:00:00.000Z' })], [order('o1', 'older-quote')])
    expect(report.summary.converted).toBe(0)
    expect(report.summary.rateOverQuotes).toBe(0)
    expect(report.ordersWithoutQuoteInPeriod).toBe(1)
  })

  it('renders a ratio as whole percent and passes null through', () => {
    expect(ratePercent(1 / 3)).toBe(33)
    expect(ratePercent(0.5)).toBe(50)
    expect(ratePercent(null)).toBeNull()
  })
})
