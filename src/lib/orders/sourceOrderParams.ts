/**
 * The `?orderKind=&orderId=` pair that every "create something for this order" entry carries.
 *
 * App-level and pure on purpose: the purchase-order form, the shipment form and the contract form all
 * read the same two parameters, and each of them has to make the same three decisions — is a pair
 * present at all, is the kind one of the two trade types, is the id a uuid. One implementation keeps
 * them from drifting; a form that accepted `vendor_order` while its neighbour refused it would be a
 * silent difference in what the same link does.
 *
 * The caller decides what to do with an unusable pair: every current caller reports it inline and
 * opens an empty form, because a mistyped link must not block the page.
 */

export const SOURCE_SALES_ORDER_KINDS = ['internal_sales_order', 'external_sales_order'] as const
export type SourceSalesOrderKind = (typeof SOURCE_SALES_ORDER_KINDS)[number]

export function isSourceSalesOrderKind(value: unknown): value is SourceSalesOrderKind {
  return typeof value === 'string' && (SOURCE_SALES_ORDER_KINDS as readonly string[]).includes(value)
}

export type SourceOrderParamResult =
  | { status: 'none' }
  | { status: 'ok'; kind: SourceSalesOrderKind; id: string }
  | { status: 'invalid'; reason: 'kind' | 'id' | 'incomplete' }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseSourceOrderParams(params: { get(name: string): string | null }): SourceOrderParamResult {
  const kind = params.get('orderKind')?.trim() ?? ''
  const id = params.get('orderId')?.trim() ?? ''
  if (kind.length === 0 && id.length === 0) return { status: 'none' }
  if (kind.length === 0 || id.length === 0) return { status: 'invalid', reason: 'incomplete' }
  if (!isSourceSalesOrderKind(kind)) return { status: 'invalid', reason: 'kind' }
  if (!UUID_PATTERN.test(id)) return { status: 'invalid', reason: 'id' }
  return { status: 'ok', kind, id }
}

/**
 * The pair as a create payload carries it, for the entries that **record** the link rather than
 * only prefill a form (a document or a tax invoice raised for an order writes
 * `trade_docs_order_documents` in the same transaction as the create). An invalid pair yields no
 * fields at all: the form has already reported it inline, and a half pair would be rejected by the
 * command's own schema.
 */
export function sourceOrderPayload(result: SourceOrderParamResult): {
  orderKind?: SourceSalesOrderKind
  orderId?: string
} {
  return result.status === 'ok' ? { orderKind: result.kind, orderId: result.id } : {}
}
