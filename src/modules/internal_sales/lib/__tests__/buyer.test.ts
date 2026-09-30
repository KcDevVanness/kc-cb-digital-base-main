import { describe, expect, it } from '@jest/globals'
import {
  EXTERNAL_BUYER_ROLES,
  buildBuyerSnapshot,
  buildPartyOptionsUrl,
  decodeBuyerRef,
  encodeBuyerRef,
  isUuid,
  readBuyerSnapshot,
} from '../buyer'

/**
 * The buyer contract of the internal-sales documents
 * (`.ai/specs/2026-09-28-internal-sales-buyer-linkage.md`).
 *
 * These cases pin what a document keeps: the picker's value protocol, the snapshot written onto
 * the sales document (the only place the buyer's organization/party link exists), and the party
 * option URL the external half reads. The organization-tree rules this picker shares with the
 * other pickers are tested in `src/lib/orgs/__tests__/organizationOptions.test.ts`.
 */

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const BRANCH_ID = '22222222-2222-4222-8222-222222222222'
const SEA_BRANCH_ID = '33333333-3333-4333-8333-333333333333'
const PARTY_ID = '44444444-4444-4444-8444-444444444444'

describe('buyer ref protocol', () => {
  it('round-trips organizations and parties', () => {
    expect(encodeBuyerRef({ kind: 'organization', id: ORG_ID })).toBe(`org:${ORG_ID}`)
    expect(encodeBuyerRef({ kind: 'party', id: PARTY_ID })).toBe(`party:${PARTY_ID}`)
    expect(decodeBuyerRef(`org:${ORG_ID}`)).toEqual({ kind: 'organization', id: ORG_ID })
    expect(decodeBuyerRef(`party:${PARTY_ID}`)).toEqual({ kind: 'party', id: PARTY_ID })
  })

  it('reads empty, unknown and malformed values as none', () => {
    expect(decodeBuyerRef('')).toEqual({ kind: 'none', id: '' })
    expect(decodeBuyerRef('  ')).toEqual({ kind: 'none', id: '' })
    expect(decodeBuyerRef('Acme GmbH')).toEqual({ kind: 'none', id: '' })
    expect(decodeBuyerRef('org:not-a-uuid')).toEqual({ kind: 'none', id: '' })
  })

  it('recognizes ids the snapshot may legally carry', () => {
    expect(isUuid(ORG_ID)).toBe(true)
    expect(isUuid('Russia-AB')).toBe(false)
  })
})

describe('buyer snapshot', () => {
  it('writes the name, the installed display key and the organization link', () => {
    const snapshot = buildBuyerSnapshot({ name: ' 俄罗斯 AB 有限公司 ', ref: `org:${BRANCH_ID}` })
    expect(snapshot).toEqual({
      name: '俄罗斯 AB 有限公司',
      customer: { displayName: '俄罗斯 AB 有限公司' },
      internalSales: { organizationId: BRANCH_ID },
    })
  })

  it('writes the party link for an external customer', () => {
    const snapshot = buildBuyerSnapshot({ name: 'ABC GmbH', ref: `party:${PARTY_ID}` })
    expect(snapshot).toEqual({
      name: 'ABC GmbH',
      customer: { displayName: 'ABC GmbH' },
      internalSales: { partyId: PARTY_ID },
    })
  })

  it('writes a name-only snapshot for a buyer with no master record', () => {
    expect(buildBuyerSnapshot({ name: 'Typed buyer', ref: '' })).toEqual({
      name: 'Typed buyer',
      customer: { displayName: 'Typed buyer' },
    })
  })

  it('returns null when there is no buyer at all (the caller decides clear vs omit)', () => {
    expect(buildBuyerSnapshot({ name: '   ', ref: '' })).toBeNull()
  })

  it('round-trips through the form values reader', () => {
    const organization = buildBuyerSnapshot({ name: '俄罗斯 AB 有限公司', ref: `org:${BRANCH_ID}` })
    expect(readBuyerSnapshot(organization)).toEqual({
      ref: `org:${BRANCH_ID}`,
      name: '俄罗斯 AB 有限公司',
      email: '',
    })
    const party = buildBuyerSnapshot({ name: 'ABC GmbH', ref: `party:${PARTY_ID}` })
    expect(readBuyerSnapshot(party)).toEqual({ ref: `party:${PARTY_ID}`, name: 'ABC GmbH', email: '' })
  })

  it('carries the buyer email the quote send route reads, from either snapshot key', () => {
    const withContact = buildBuyerSnapshot({
      name: 'ABC GmbH',
      ref: `party:${PARTY_ID}`,
      email: ' buyer@abc.example ',
    })
    expect(withContact).toEqual({
      name: 'ABC GmbH',
      customer: { displayName: 'ABC GmbH' },
      contact: { email: 'buyer@abc.example' },
      internalSales: { partyId: PARTY_ID },
    })
    expect(readBuyerSnapshot(withContact).email).toBe('buyer@abc.example')
    // The installed surfaces freeze the address under `customer.primaryEmail`; read both.
    expect(readBuyerSnapshot({ name: 'X', customer: { primaryEmail: 'x@example.com' } }).email).toBe('x@example.com')
    // No email anywhere: `''`, never `undefined` — the form field is a controlled input.
    expect(readBuyerSnapshot({ name: 'No email' }).email).toBe('')
  })

  it('reads a legacy name-only snapshot without inventing a link', () => {
    expect(readBuyerSnapshot({ name: 'Legacy buyer' })).toEqual({ ref: '', name: 'Legacy buyer', email: '' })
  })

  it('falls back to the installed display key when this module own key is absent', () => {
    expect(readBuyerSnapshot({ customer: { displayName: 'From installed surface' } })).toEqual({
      ref: '',
      name: 'From installed surface',
      email: '',
    })
  })

  it('ignores malformed links instead of fabricating a buyer', () => {
    expect(readBuyerSnapshot({ name: 'Corrupt', internalSales: { organizationId: 'nope' } })).toEqual({
      ref: '',
      name: 'Corrupt',
      email: '',
    })
    expect(readBuyerSnapshot(null)).toEqual({ ref: '', name: '', email: '' })
    expect(readBuyerSnapshot('text')).toEqual({ ref: '', name: '', email: '' })
  })
})

describe('party option source url', () => {
  it('always asks for external buyer roles and narrows to the selected organization', () => {
    expect(buildPartyOptionsUrl({ organizationId: ORG_ID, roles: EXTERNAL_BUYER_ROLES })).toBe(
      `/api/parties/options?organizationId=${ORG_ID}&roles=buyer`,
    )
  })

  it('encodes the search term and omits absent filters', () => {
    expect(buildPartyOptionsUrl({ query: ' KC 001 ' })).toBe('/api/parties/options?search=KC+001')
    expect(buildPartyOptionsUrl({ query: '   ' })).toBe('/api/parties/options')
  })
})
