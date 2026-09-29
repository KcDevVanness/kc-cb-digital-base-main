import { describe, expect, it } from '@jest/globals'
import { advanceCursorAfterSuccess, encodeCursor, maxUpdatedAt, parseCursor } from '../cursor'

describe('cursor codec', () => {
  it('round-trips a walk position', () => {
    const state = { page: 3, updatedSince: '2026-09-27T10:00:00+03:00', asOf: '2026-09-27' }
    expect(parseCursor(encodeCursor(state))).toEqual(state)
  })

  it('starts from page 1 with no watermark when there is no cursor', () => {
    expect(parseCursor(null)).toEqual({ page: 1, updatedSince: null, asOf: null })
  })

  it('treats a cursor it did not write as a full pull instead of crashing', () => {
    expect(parseCursor('not-json')).toEqual({ page: 1, updatedSince: null, asOf: null })
  })
})

describe('maxUpdatedAt', () => {
  it('takes the chronological maximum, not the lexicographic one, when offsets differ', () => {
    expect(maxUpdatedAt(['2026-09-27T10:00:00+03:00', '2026-09-27T08:30:00+00:00'])).toBe('2026-09-27T08:30:00+00:00')
  })

  it('ignores missing and unparseable values', () => {
    expect(maxUpdatedAt([null, undefined, 'nonsense', '2026-09-27T10:00:00+03:00'])).toBe('2026-09-27T10:00:00+03:00')
    expect(maxUpdatedAt([null, undefined])).toBeNull()
  })
})

describe('advanceCursorAfterSuccess', () => {
  it('advances to the maximum seen', () => {
    expect(advanceCursorAfterSuccess('2026-09-26T10:00:00+03:00', ['2026-09-27T10:00:00+03:00'])).toBe(
      '2026-09-27T10:00:00+03:00',
    )
  })

  it('never moves backwards', () => {
    // A row without `updated_at` is a full-pull row per the contract: the walk must not lose the
    // watermark it already had because such a row came back older than the cursor.
    expect(advanceCursorAfterSuccess('2026-09-27T10:00:00+03:00', ['2026-09-20T10:00:00+03:00'])).toBe(
      '2026-09-27T10:00:00+03:00',
    )
  })

  it('keeps the previous watermark when the walk saw no timestamp at all', () => {
    expect(advanceCursorAfterSuccess('2026-09-27T10:00:00+03:00', [])).toBe('2026-09-27T10:00:00+03:00')
    expect(advanceCursorAfterSuccess(null, [])).toBeNull()
  })
})
