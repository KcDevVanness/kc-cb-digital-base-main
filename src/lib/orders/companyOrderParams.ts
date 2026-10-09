/**
 * The `?companyOrderId=` parameter a company order's "new child document" entry carries.
 *
 * App-level and pure on purpose: the internal/external sales form and the purchase-order form both
 * read this one parameter, and both have to make the same two decisions — is a root named at all,
 * and is the value a uuid. One implementation keeps them from drifting; a form that linked a
 * malformed id while its neighbour refused it would be a silent difference in what the same link
 * does.
 *
 * Unlike `?orderKind=&orderId=` there is no second half: the kind of the child being created is the
 * form's own (the sales form knows its trade type, the purchase form is always a purchase order),
 * so this parameter only ever names the root to attach to. The caller decides what to do with an
 * unusable value: the current callers report it inline and open a plain create, because a mistyped
 * link must not block the page.
 */

export type CompanyOrderParamResult =
  | { status: 'none' }
  | { status: 'ok'; companyOrderId: string }
  | { status: 'invalid' }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseCompanyOrderParam(params: { get(name: string): string | null }): CompanyOrderParamResult {
  const companyOrderId = params.get('companyOrderId')?.trim() ?? ''
  if (companyOrderId.length === 0) return { status: 'none' }
  if (!UUID_PATTERN.test(companyOrderId)) return { status: 'invalid' }
  return { status: 'ok', companyOrderId }
}
