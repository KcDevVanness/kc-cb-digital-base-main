/**
 * Buyer selection for the internal-sales documents (quote / order).
 *
 * The buyer of an internal sale is a **related organization** — a company in the group's
 * organization tree (the Guangzhou entity sells to the Russia entity, later the Southeast Asia
 * entity). A branch selling externally addresses an **external customer**, an app-owned `parties`
 * record. This module keeps both in one picker and freezes the choice onto the document as a
 * snapshot, because the installed sales chain has no organization link and its `customerEntityId`
 * column means `customer_entities.id` — putting an organization id there would be a lie any future
 * customer-namespace consumer would resolve wrongly.
 *
 * Snapshot shape written through `POST/PUT /api/sales/{quotes,orders}` (`customerSnapshot` is a
 * passthrough jsonb column):
 *
 * ```jsonc
 * {
 *   "name": "俄罗斯 AB 有限公司",                  // this module's own display key (kept)
 *   "customer": { "displayName": "俄罗斯 AB 有限公司" }, // installed lists/detail derive the name here
 *   "internalSales": { "organizationId": "<uuid>" }    // or { "partyId": "<uuid>" }
 * }
 * ```
 *
 * Everything here is pure so the encoding, the snapshot contract and the option assembly stay
 * unit-testable without a DOM.
 */

export const ORGANIZATION_REF_PREFIX = 'org:'
export const PARTY_REF_PREFIX = 'party:'
/**
 * Roles that make a party an **external** buyer of a sales document.
 *
 * A group branch is deliberately not in this set: on an internal sale the branch is addressed as
 * the organization it is (关联组织 from the switcher payload), while its `parties` record — with the
 * `branch` role — exists for the printable counterparty block on contracts/invoices. Including
 * `branch` here would offer the same legal entity twice.
 */
export const EXTERNAL_BUYER_ROLES = ['buyer'] as const
export const PARTIES_OPTIONS_PATH = '/api/parties/options'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}

export type BuyerRefKind = 'organization' | 'party' | 'none'
export type BuyerRef = { kind: BuyerRefKind; id: string }

/**
 * The write half of the value protocol, kept next to its parser (`decodeBuyerRef`) so the picker,
 * the snapshot writer and the tests cannot drift on the separator or the prefixes.
 */
export function encodeBuyerRef(ref: { kind: 'organization' | 'party'; id: string }): string {
  return ref.kind === 'organization'
    ? `${ORGANIZATION_REF_PREFIX}${ref.id}`
    : `${PARTY_REF_PREFIX}${ref.id}`
}

/** The picker value protocol: `''` | `org:<uuid>` | `party:<uuid>`. Unknown shapes read as none. */
export function decodeBuyerRef(value: string): BuyerRef {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (trimmed.startsWith(ORGANIZATION_REF_PREFIX)) {
    const id = trimmed.slice(ORGANIZATION_REF_PREFIX.length)
    return isUuid(id) ? { kind: 'organization', id } : { kind: 'none', id: '' }
  }
  if (trimmed.startsWith(PARTY_REF_PREFIX)) {
    const id = trimmed.slice(PARTY_REF_PREFIX.length)
    return isUuid(id) ? { kind: 'party', id } : { kind: 'none', id: '' }
  }
  return { kind: 'none', id: '' }
}

/**
 * The snapshot frozen onto the document. `null` means "no buyer at all" — the caller decides
 * whether that clears the stored value (update) or omits the key (create).
 */
export function buildBuyerSnapshot(input: {
  name: string
  ref: string
}): Record<string, unknown> | null {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const ref = decodeBuyerRef(input.ref)
  if (!name && ref.kind === 'none') return null
  const snapshot: Record<string, unknown> = {}
  if (name) {
    snapshot.name = name
    // The installed document detail page and the update response read the buyer's display name
    // from `snapshot.customer.displayName` (`sales/api/documents/factory.ts` → `resolveCustomerName`
    // and `sales/backend/sales/documents/[id]/page.tsx`), so the same name is frozen there too —
    // a document created here shows its buyer on the platform's own surfaces.
    snapshot.customer = { displayName: name }
  }
  if (ref.kind === 'organization') {
    snapshot.internalSales = { organizationId: ref.id }
  } else if (ref.kind === 'party') {
    snapshot.internalSales = { partyId: ref.id }
  }
  return snapshot
}

/** Read the buyer back for the edit form; tolerates snapshots written by the installed surfaces. */
export function readBuyerSnapshot(snapshot: unknown): { ref: string; name: string } {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return { ref: '', name: '' }
  }
  const record = snapshot as Record<string, unknown>
  const ownName = typeof record.name === 'string' ? record.name.trim() : ''
  const name = ownName || readCustomerDisplayName(record.customer)
  const link = record.internalSales
  const organizationId = readLinkId(link, 'organizationId')
  if (organizationId) return { ref: encodeBuyerRef({ kind: 'organization', id: organizationId }), name }
  const partyId = readLinkId(link, 'partyId')
  if (partyId) return { ref: encodeBuyerRef({ kind: 'party', id: partyId }), name }
  return { ref: '', name }
}

function readCustomerDisplayName(customer: unknown): string {
  if (!customer || typeof customer !== 'object' || Array.isArray(customer)) return ''
  const displayName = (customer as Record<string, unknown>).displayName
  return typeof displayName === 'string' ? displayName.trim() : ''
}

function readLinkId(link: unknown, key: string): string {
  if (!link || typeof link !== 'object' || Array.isArray(link)) return ''
  const value = (link as Record<string, unknown>)[key]
  return typeof value === 'string' && isUuid(value) ? value : ''
}

/**
 * URL of the party option source for the buyer picker's external half.
 *
 * `roles` is the buyer-eligible vocabulary; the route answers 400 for an unknown role name, so the
 * filter is server-side and the label stays the route's own `CODE — name`.
 */
export function buildPartyOptionsUrl(params: {
  query?: string
  organizationId?: string | null
  roles?: readonly string[]
}): string {
  const search = new URLSearchParams()
  const query = typeof params.query === 'string' ? params.query.trim() : ''
  if (query.length > 0) search.set('search', query)
  if (params.organizationId) search.set('organizationId', params.organizationId)
  const roles = (params.roles ?? []).filter((role) => typeof role === 'string' && role.trim().length > 0)
  if (roles.length > 0) search.set('roles', roles.join(','))
  const queryString = search.toString()
  return queryString.length > 0 ? `${PARTIES_OPTIONS_PATH}?${queryString}` : PARTIES_OPTIONS_PATH
}
