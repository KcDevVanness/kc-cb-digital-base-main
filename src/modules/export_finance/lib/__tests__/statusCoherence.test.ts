import { describe, expect, it } from '@jest/globals'
import { collectionStatusIssues, taxRefundStatusIssues } from '../statusCoherence'

/**
 * Both records carry a status and the facts that status claims; these rules are what keeps the two
 * halves honest (the receivables ledger reads `amount`/`received_at`, the refund checklist the
 * amount). The matrix is pinned here because the commands only run it on writes.
 */
describe('collection status coherence', () => {
  it('requires the amount and the date once the money is marked received', () => {
    expect(collectionStatusIssues({ collectionStatus: 'received', amount: '1200.00', receivedAt: new Date('2026-09-01') })).toEqual([])
    expect(collectionStatusIssues({ collectionStatus: 'received', amount: null, receivedAt: new Date('2026-09-01') }))
      .toEqual(['a received collection needs the collected amount (collectedAmount)'])
    expect(collectionStatusIssues({ collectionStatus: 'received', amount: '1200.00', receivedAt: null }))
      .toEqual(['a received collection needs the receipt date (collectedAt)'])
    expect(collectionStatusIssues({ collectionStatus: 'received', amount: null, receivedAt: null })).toHaveLength(2)
  })

  it('keeps a not-received record free of receipt facts', () => {
    expect(collectionStatusIssues({ collectionStatus: 'not_received', amount: null, receivedAt: null })).toEqual([])
    expect(collectionStatusIssues({ collectionStatus: 'not_received', amount: null, receivedAt: new Date('2026-09-01') }))
      .toEqual(['a not-received collection cannot carry a receipt date (collectedAt)'])
    expect(collectionStatusIssues({ collectionStatus: 'not_received', amount: '10.00', receivedAt: null }))
      .toEqual(['a not-received collection cannot carry a collected amount (collectedAmount)'])
  })

  it('treats unknown as the absence of an answer', () => {
    expect(collectionStatusIssues({ collectionStatus: 'unknown', amount: null, receivedAt: null })).toEqual([])
    expect(collectionStatusIssues({ collectionStatus: 'unknown', amount: '10.00', receivedAt: null })).toHaveLength(1)
    expect(collectionStatusIssues({ collectionStatus: 'unknown', amount: null, receivedAt: new Date('2026-09-01') })).toHaveLength(1)
  })
})

describe('tax refund status coherence', () => {
  it('requires the amount once the refund is completed', () => {
    expect(taxRefundStatusIssues({ taxRefundStatus: 'completed', taxRefundAmount: '830.25' })).toEqual([])
    expect(taxRefundStatusIssues({ taxRefundStatus: 'completed', taxRefundAmount: null }))
      .toEqual(['a completed tax refund needs the refunded amount (taxRefundAmount)'])
  })

  it('keeps not-started and unknown free of an amount, and lets applied carry one', () => {
    expect(taxRefundStatusIssues({ taxRefundStatus: 'not_started', taxRefundAmount: null })).toEqual([])
    expect(taxRefundStatusIssues({ taxRefundStatus: 'not_started', taxRefundAmount: '1.00' })).toHaveLength(1)
    expect(taxRefundStatusIssues({ taxRefundStatus: 'unknown', taxRefundAmount: '1.00' })).toHaveLength(1)
    expect(taxRefundStatusIssues({ taxRefundStatus: 'applied', taxRefundAmount: null })).toEqual([])
    expect(taxRefundStatusIssues({ taxRefundStatus: 'applied', taxRefundAmount: '500.00' })).toEqual([])
  })
})
