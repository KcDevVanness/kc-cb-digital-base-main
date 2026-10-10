import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'

const ORDERS_API_PATH = 'order_hub/orders'
const LINKS_API_PATH = 'order_hub/orders/links'

/**
 * What a legacy `/backend/orders/<id>` URL turns out to name.
 *
 * The old hub was keyed by a **sales order id**; the page is now keyed by a company order id. A
 * stored notification, bookmark or redirect therefore still arrives with a child document's id, and
 * the page has to answer two questions in order: is this already a company order (the common case),
 * and if not, which company order holds it as a linked child.
 */
export type CompanyOrderResolution =
  | { status: 'found'; companyOrderId: string }
  | { status: 'unlinked' }

/**
 * Resolves the id a legacy order URL carries to the company order that owns it.
 *
 * The root record is read first: an id that names a company order is the ordinary navigation and
 * costs one request. Only when it does not does the reverse link lookup run — `?refId=` is the link
 * route's own reverse filter, so a sales order a backfill or a link-child attached is found without
 * knowing its kind. A document that is linked nowhere answers `unlinked`; the page then offers the
 * two attach entries instead of a blank screen.
 *
 * A transport/authorization failure is not swallowed: it is the page's error state, not "unlinked".
 */
export async function resolveCompanyOrderForDocument(documentId: string): Promise<CompanyOrderResolution> {
  const scopedId = documentId.trim()
  if (!scopedId) return { status: 'unlinked' }

  const root = await fetchCrudList<Record<string, unknown>>(ORDERS_API_PATH, { id: scopedId, pageSize: 1 })
  const rootRow = root.items?.[0]
  if (rootRow) return { status: 'found', companyOrderId: String(rootRow.id) }

  const links = await fetchCrudList<Record<string, unknown>>(LINKS_API_PATH, { refId: scopedId, pageSize: 1 })
  const link = links.items?.[0]
  const companyOrderId = link ? String(link.companyOrderId ?? '') : ''
  return companyOrderId ? { status: 'found', companyOrderId } : { status: 'unlinked' }
}
