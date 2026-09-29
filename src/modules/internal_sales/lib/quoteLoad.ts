/**
 * Loading an existing quotation into the order form ("引用加载").
 *
 * The installed `sales` chain has no "copy this document" capability — its only quote→order
 * operation is `sales.quotes.convert_to_order`, which converts **in place** and deletes the quote
 * (`.ai/specs/2026-09-28-internal-sales-quote-to-order.md`). Operators often need the other shape:
 * the quote stays, one quote may back several orders (分批/多柜), and the order differs in a line
 * or two. That is deliberately a *read + prefill* here: the new order goes through the normal
 * `POST /api/sales/orders`, so numbering, totals and statuses stay the engine's, and nothing is
 * written until the operator saves.
 *
 * One-shot by design, like `trade_docs`' "从订单复制行": after loading, neither document follows
 * the other. The only thing the new order keeps is `metadata.internalSales.sourceQuote`
 * (`lib/documentValues.ts`), a display/reference value.
 */

import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import type { ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { readBuyerSnapshot } from './buyer'
import {
  EMPTY_LINE,
  readText,
  toInternalSalesFormValues,
  toInternalSalesLineValues,
  type InternalSalesFormValues,
  type InternalSalesLineValues,
  type SourceQuoteRef,
} from './documentValues'

const QUOTES_API_PATH = 'sales/quotes'
const QUOTE_LINES_API_PATH = 'sales/quote-lines'
/** The installed sales line collections answer a larger `pageSize` with a 400. */
export const QUOTE_LINES_PAGE_SIZE = 100
const OPTION_PAGE_SIZE = 50

/**
 * Picker label: the number first (that is what operators quote to each other) plus the buyer name
 * so two quotes in the same week are told apart without opening them.
 */
export function quoteOptionFromRecord(item: Record<string, unknown>): ComboboxOption | null {
  const value = readText(item, 'id')
  if (!value) return null
  const number = readText(item, 'quoteNumber', 'quote_number') || value.slice(0, 8)
  const buyer = readBuyerSnapshot(item.customerSnapshot ?? item.customer_snapshot).name
  return { value, label: buyer ? `${number} — ${buyer}` : number }
}

/** Options for the picker, newest first; the search term is applied server-side (quote number). */
export async function loadQuoteOptions(query?: string): Promise<ComboboxOption[]> {
  const term = query?.trim()
  const payload = await fetchCrudList<Record<string, unknown>>(QUOTES_API_PATH, {
    pageSize: OPTION_PAGE_SIZE,
    sortField: 'created_at',
    sortDir: 'desc',
    ...(term ? { search: term } : {}),
  })
  return (payload.items ?? [])
    .map(quoteOptionFromRecord)
    .filter((option): option is ComboboxOption => option !== null)
}

/**
 * Re-keys loaded lines with local keys.
 *
 * The mapping keeps the source line's id as the key (that is what makes the edit form update rows
 * instead of appending them). A freshly loaded order is a **new** document, so its lines must not
 * inherit the quote line ids: the create payload would carry an `id` the engine does not own.
 */
export function rekeyLines(lines: InternalSalesLineValues[]): InternalSalesLineValues[] {
  return lines.map((line, index) => ({ ...line, key: `line-${index + 1}` }))
}

/** Pure half of the draft: document records in, form values out. */
export function quoteDraftFromRecords(
  quote: Record<string, unknown>,
  lines: Record<string, unknown>[],
): { values: InternalSalesFormValues; sourceQuote: SourceQuoteRef; lineCount: number } {
  const mapped = rekeyLines(lines.map(toInternalSalesLineValues))
  const values = toInternalSalesFormValues(quote, mapped)
  const sourceQuote: SourceQuoteRef = {
    id: readText(quote, 'id'),
    number: readText(quote, 'quoteNumber', 'quote_number'),
  }
  return {
    values: { ...values, sourceQuote },
    sourceQuote,
    lineCount: lines.length,
  }
}

/**
 * Whether the operator has already put anything into the form.
 *
 * Empty means "only the untouched starter row": loading may proceed without a confirmation. Any
 * head field or any line with a product/name is treated as work that must not be discarded
 * silently.
 */
export function hasOperatorInput(values: InternalSalesFormValues): boolean {
  const head = [values.buyerRef, values.customerName, values.currencyCode, values.customerReference, values.comments]
  if (head.some((value) => value.trim().length > 0)) return true
  const lines = Array.isArray(values.lines) ? values.lines : []
  return lines.some((line) => line.productId.trim().length > 0 || line.name.trim().length > 0)
}

/** Reads the quote and its lines; the caller decides how to report a failure. */
export async function loadQuoteDraft(
  quoteId: string,
): Promise<{ values: InternalSalesFormValues; sourceQuote: SourceQuoteRef; lineCount: number }> {
  // `id` (singular) is the installed single-document read: same route, full projection — the
  // list projection drops `metadata`, which is where the source quote is read back from.
  const quotePayload = await fetchCrudList<Record<string, unknown>>(QUOTES_API_PATH, {
    id: quoteId,
    pageSize: 1,
  })
  const quote = quotePayload.items?.[0]
  if (!quote) {
    const notFound = new Error('Quote not found') as Error & { status?: number }
    notFound.status = 404
    throw notFound
  }
  // Lines live on their own collection and answer with snake_case columns; the shared mapper reads
  // both cases.
  const linePayload = await fetchCrudList<Record<string, unknown>>(QUOTE_LINES_API_PATH, {
    quoteId,
    pageSize: QUOTE_LINES_PAGE_SIZE,
  })
  return quoteDraftFromRecords(quote, linePayload.items ?? [])
}

/**
 * Applies a quote to the form through the form's own `setValue`, one field per call.
 *
 * Returns what the caller needs for its message; an empty quote still fills the head and leaves the
 * starter line, so the operator sees the load happened and can add the lines.
 */
export async function applyQuoteDraftToForm(
  quoteId: string,
  setValue: (field: string, value: unknown) => void,
): Promise<{ number: string; lineCount: number }> {
  const draft = await loadQuoteDraft(quoteId)
  setValue('buyerRef', draft.values.buyerRef)
  setValue('customerName', draft.values.customerName)
  setValue('currencyCode', draft.values.currencyCode)
  setValue('customerReference', draft.values.customerReference)
  setValue('comments', draft.values.comments)
  setValue('lines', draft.values.lines.length > 0 ? draft.values.lines : [{ ...EMPTY_LINE }])
  setValue('sourceQuote', draft.sourceQuote)
  return { number: draft.sourceQuote.number, lineCount: draft.lineCount }
}
