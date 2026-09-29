import { describe, expect, it } from '@jest/globals'
import {
  channelIdForTradeType,
  readChannelId,
  resolveRowTradeType,
  salesEntryFromPathname,
  tradeTypeFromBuyerKind,
  tradeTypeFromChannelId,
  tradeTypeFromSnapshot,
} from '../tradeType'
import { classifyDocument, toDocumentRow } from '../../cli'

const CHANNELS = { internal: 'channel-internal', external: 'channel-external' }

describe('trade type classification', () => {
  it('derives the type from the buyer source', () => {
    expect(tradeTypeFromBuyerKind('organization')).toBe('internal')
    expect(tradeTypeFromBuyerKind('party')).toBe('external')
    expect(tradeTypeFromBuyerKind('none')).toBeNull()
  })

  it('reads the type off the frozen snapshot', () => {
    expect(tradeTypeFromSnapshot({ internalSales: { organizationId: 'org-1' } })).toBe('internal')
    expect(tradeTypeFromSnapshot({ internalSales: { partyId: 'party-1' } })).toBe('external')
    expect(tradeTypeFromSnapshot({ name: 'hand-typed' })).toBeNull()
    expect(tradeTypeFromSnapshot(null)).toBeNull()
  })

  it('prefers the channel marker over the snapshot and maps both ways', () => {
    expect(tradeTypeFromChannelId('channel-external', CHANNELS)).toBe('external')
    expect(tradeTypeFromChannelId(null, CHANNELS)).toBeNull()
    expect(channelIdForTradeType('internal', CHANNELS)).toBe('channel-internal')
    expect(channelIdForTradeType('external', {})).toBeNull()
    expect(readChannelId({ channelId: 'c1' })).toBe('c1')
    expect(readChannelId({ channel_id: 'c2' })).toBe('c2')

    // A row whose channel is unknown falls back to its snapshot; a marked row never does.
    expect(resolveRowTradeType({ channelId: 'channel-internal', customerSnapshot: { internalSales: { partyId: 'x' } } }, CHANNELS)).toBe('internal')
    expect(resolveRowTradeType({ customerSnapshot: { internalSales: { partyId: 'x' } } }, CHANNELS)).toBe('external')
  })

  it('reads the entry from the route prefix', () => {
    expect(salesEntryFromPathname('/backend/external-sales/orders')).toBe('external')
    expect(salesEntryFromPathname('/backend/internal-sales/orders')).toBe('sales')
    expect(salesEntryFromPathname(null)).toBe('sales')
  })
})

describe('backfill classification', () => {
  const row = (patch: Record<string, unknown> = {}) => ({
    kind: 'order' as const,
    id: 'doc-1',
    number: 'ORDER-1',
    tenant_id: 't1',
    organization_id: 'org-1',
    channel_id: null as string | null,
    customer_snapshot: null as unknown,
    ...patch,
  })

  it('classifies by the snapshot link and never guesses', () => {
    expect(classifyDocument(row({ customer_snapshot: { internalSales: { organizationId: 'org-9' } } }))).toMatchObject({
      reason: 'classified',
      tradeType: 'internal',
    })
    expect(classifyDocument(row({ customer_snapshot: { internalSales: { partyId: 'p-1' } } }))).toMatchObject({
      reason: 'classified',
      tradeType: 'external',
    })
    expect(classifyDocument(row())).toMatchObject({ reason: 'no-snapshot-link', tradeType: null })
    expect(classifyDocument(row({ customer_snapshot: { name: 'hand-typed buyer' } }))).toMatchObject({
      reason: 'no-snapshot-link',
    })
  })

  it('skips a document that already carries a channel', () => {
    expect(
      classifyDocument(row({ channel_id: 'channel-external', customer_snapshot: { internalSales: { organizationId: 'org-9' } } })),
    ).toMatchObject({ reason: 'already-marked', tradeType: null })
  })
})

describe('backfill row mapping', () => {
  it('reads the scalar channel column, so a marked document is never re-listed', () => {
    const row = toDocumentRow({
      kind: 'order',
      id: 'doc-9',
      number: 'ORDER-9',
      tenantId: 't1',
      organizationId: 'org-1',
      channelId: 'channel-internal',
      customerSnapshot: { internalSales: { organizationId: 'org-9' } },
    })
    expect(row.channel_id).toBe('channel-internal')
    expect(classifyDocument(row)).toMatchObject({ reason: 'already-marked' })
  })

  it('treats a missing channel as unmarked and keeps the snapshot', () => {
    const row = toDocumentRow({
      kind: 'quote',
      id: 'doc-10',
      number: undefined,
      tenantId: 't1',
      organizationId: 'org-1',
      channelId: undefined,
      customerSnapshot: undefined,
    })
    expect(row.channel_id).toBeNull()
    expect(row.number).toBeNull()
    expect(row.customer_snapshot).toBeNull()
  })
})
