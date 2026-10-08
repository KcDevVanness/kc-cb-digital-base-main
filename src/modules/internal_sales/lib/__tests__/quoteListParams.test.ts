import { describe, expect, it } from '@jest/globals'
import { isQuoteListType, quoteListRequest } from '../quoteListParams'

/**
 * The merged quote workbench's request rule.
 *
 * Which channel filter expresses a type selection decides what the operator sees, so the mapping is
 * pinned here instead of through the screen: `all` must reach for both channels, one type must use
 * the engine's single-channel filter, and a missing channel must block the list rather than widen it.
 */

const channels = { internal: 'chan-internal', external: 'chan-external' }

describe('quoteListRequest', () => {
  it('asks for both channels as the comma-joined multi-value filter', () => {
    const request = quoteListRequest({ type: 'all', channels, page: 2, pageSize: 50 })

    expect(request.params.channelIds).toBe('chan-internal,chan-external')
    expect(request.params.page).toBe('2')
    expect(request.params.pageSize).toBe('50')
    expect(request.params.sortField).toBe('created_at')
    expect(request.params.sortDir).toBe('desc')
    expect(request.missingChannel).toBe(false)
    expect(request.channelIdsEmptyProbe).toBe(true)
  })

  it('narrows the same filter to one channel for a one-type selection', () => {
    const internal = quoteListRequest({ type: 'internal', channels, page: 1, pageSize: 20 })
    expect(internal.params.channelIds).toBe('chan-internal')

    const external = quoteListRequest({ type: 'external', channels, page: 1, pageSize: 20 })
    expect(external.params.channelIds).toBe('chan-external')
  })

  it('reports a missing channel instead of listing with the other one', () => {
    const request = quoteListRequest({
      type: 'all',
      channels: { internal: 'chan-internal', external: null },
      page: 1,
      pageSize: 20,
    })

    expect(request.missingChannel).toBe(true)
    expect(request.params.channelIds).toBeUndefined()
    expect(request.channelIdsEmptyProbe).toBe(false)

    const unseeded = quoteListRequest({ type: 'external', channels: {}, page: 1, pageSize: 20 })
    expect(unseeded.missingChannel).toBe(true)
    expect(unseeded.channelIdsEmptyProbe).toBe(false)
  })

  it('carries the trimmed search term and leaves it out when blank', () => {
    expect(quoteListRequest({ type: 'all', channels, page: 1, pageSize: 20, search: '  QT-1  ' }).params.search)
      .toBe('QT-1')
    expect(quoteListRequest({ type: 'all', channels, page: 1, pageSize: 20, search: '   ' }).params.search)
      .toBeUndefined()
    expect(quoteListRequest({ type: 'all', channels, page: 1, pageSize: 20 }).params.search).toBeUndefined()
  })
})

describe('isQuoteListType', () => {
  it('accepts the three tokens the page understands and rejects anything else', () => {
    expect(isQuoteListType('all')).toBe(true)
    expect(isQuoteListType('internal')).toBe(true)
    expect(isQuoteListType('external')).toBe(true)
    expect(isQuoteListType('purchase')).toBe(false)
    expect(isQuoteListType('')).toBe(false)
    expect(isQuoteListType(undefined)).toBe(false)
  })
})
