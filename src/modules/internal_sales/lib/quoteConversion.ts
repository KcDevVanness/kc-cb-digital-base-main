/**
 * 报价转化 (quote → order conversion) — pure aggregation over facts, no invented KPI.
 *
 * The link between a quote and the order it became is already in the database: an order created
 * from a quote freezes `metadata.internalSales.sourceQuote = { id, number }` (see
 * `documentValues.ts`), so conversion needs no new column and no audit dependency.
 *
 * Two denominators are legitimate and they disagree, so this module returns **both** rates plus the
 * counts behind them instead of choosing one: 全部报价 (every quote in the period) answers "how much
 * of our quoting turns into orders", 已发出报价 answers "how good are we at closing what we sent".
 * Which one a manager quotes is a business statement — the numbers are facts.
 *
 * 「已发出」 is read from `sent_at`, not from a status word: the timestamp is a fact, while statuses
 * were only written from Phase 1 on (older rows are NULL and would silently disappear from the
 * stricter denominator).
 */

export type QuoteConversionQuoteRow = {
  id: string
  number: string | null
  status: string | null
  sentAt: string | null
  validUntil: string | null
  channelId: string | null
}

export type QuoteConversionOrderRow = {
  id: string
  number: string | null
  status: string | null
  /** The quote this order was created from, as frozen on its `metadata`. */
  sourceQuoteId: string
}

export type QuoteConversionQuoteFact = QuoteConversionQuoteRow & {
  /** True when at least one order references this quote. */
  converted: boolean
  orderCount: number
  orderNumbers: string[]
}

export type QuoteConversionSummary = {
  quotes: number
  sent: number
  converted: number
  /** converted ÷ quotes, or null when there are no quotes (null, never NaN or 0). */
  rateOverQuotes: number | null
  /** converted ÷ sent, or null when nothing was sent. */
  rateOverSent: number | null
}

export type QuoteConversionReport = {
  quotes: QuoteConversionQuoteFact[]
  summary: QuoteConversionSummary
  /** Orders whose source quote is outside the period — counted as facts, never as conversions. */
  ordersWithoutQuoteInPeriod: number
}

/** Rounds a 0..1 ratio to whole percent for display; `null` stays `null`. */
export function ratePercent(value: number | null): number | null {
  if (value === null) return null
  return Math.round(value * 100)
}

export function buildQuoteConversionReport(
  quotes: QuoteConversionQuoteRow[],
  orders: QuoteConversionOrderRow[],
): QuoteConversionReport {
  const ordersByQuote = new Map<string, QuoteConversionOrderRow[]>()
  for (const order of orders) {
    const list = ordersByQuote.get(order.sourceQuoteId)
    if (list) list.push(order)
    else ordersByQuote.set(order.sourceQuoteId, [order])
  }

  const quoteIds = new Set(quotes.map((quote) => quote.id))
  const facts: QuoteConversionQuoteFact[] = quotes.map((quote) => {
    const linked = ordersByQuote.get(quote.id) ?? []
    return {
      ...quote,
      converted: linked.length > 0,
      orderCount: linked.length,
      orderNumbers: linked
        .map((order) => order.number)
        .filter((number): number is string => typeof number === 'string' && number.length > 0),
    }
  })

  const sent = quotes.filter((quote) => quote.sentAt !== null && quote.sentAt !== '').length
  const converted = facts.filter((fact) => fact.converted).length
  const ordersWithoutQuoteInPeriod = orders.filter((order) => !quoteIds.has(order.sourceQuoteId)).length

  return {
    quotes: facts,
    summary: {
      quotes: quotes.length,
      sent,
      converted,
      rateOverQuotes: quotes.length === 0 ? null : converted / quotes.length,
      rateOverSent: sent === 0 ? null : converted / sent,
    },
    ordersWithoutQuoteInPeriod,
  }
}
