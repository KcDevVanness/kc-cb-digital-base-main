import { SALES_TRADE_TYPES, type SalesTradeType } from './tradeType'

/**
 * The sales-quote list request, as a pure function.
 *
 * Three entries read the same installed list route: the two legacy single-type lists (one trade
 * type each, pinned by the route prefix) and the merged workbench `/backend/quotes`, whose type
 * filter selects one or both. Building the parameters here — instead of inline in the component —
 * keeps the "which channel filter expresses this selection" rule in one testable place. One or two
 * channels both travel as the comma-joined `channelIds`: the engine matches any of them
 * (`sales/api/documents/factory.ts`), and a single entry is just the one-id case, so there is one
 * request shape to reason about rather than two.
 */

/** The merged workbench's type filter; a single-type entry is always one of the two concrete types. */
export type QuoteListType = 'all' | SalesTradeType

export type QuoteListRequest = {
  /** `/api/sales/quotes` query parameters, ready for `fetchCrudList`. */
  params: Record<string, string>
  /** The selection asks for a trade type whose channel the organization does not have. */
  missingChannel: boolean
  /**
   * Whether the caller should also ask for the "no trade-type marker" count
   * (`channelIdsEmpty=true&pageSize=1`). Pointless without a listable selection — with no channel
   * there is no list for the hint to complement.
   */
  channelIdsEmptyProbe: boolean
}

export function isQuoteListType(value: unknown): value is QuoteListType {
  return value === 'all' || (SALES_TRADE_TYPES as readonly string[]).includes(value as string)
}

/**
 * The request for one selection, the newest first.
 *
 * A missing channel is reported rather than worked around: filtering on the channels that do exist
 * would show one type under a filter that says "both", and dropping the filter would mix the two
 * types (and every unmarked legacy document) into a screen that cannot tell them apart. The caller
 * blocks the list and shows the seed command instead — the same rule the create form applies.
 */
export function quoteListRequest(input: {
  type: QuoteListType
  channels: Partial<Record<SalesTradeType, string | null | undefined>>
  page: number
  pageSize: number
  search?: string
}): QuoteListRequest {
  const requested: SalesTradeType[] = input.type === 'all' ? [...SALES_TRADE_TYPES] : [input.type]
  const channelIds = requested
    .map((type) => input.channels[type])
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  const missingChannel = channelIds.length !== requested.length

  const params: Record<string, string> = {
    page: String(input.page),
    pageSize: String(input.pageSize),
    sortField: 'created_at',
    sortDir: 'desc',
  }
  const term = input.search?.trim()
  if (term) params.search = term
  if (!missingChannel) params.channelIds = channelIds.join(',')

  return { params, missingChannel, channelIdsEmptyProbe: !missingChannel }
}
