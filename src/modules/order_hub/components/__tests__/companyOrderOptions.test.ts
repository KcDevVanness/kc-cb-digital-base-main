import { describe, expect, it } from '@jest/globals'
import {
  mergePurchaseOrderCandidates,
  purchaseOrderCandidateLabel,
  type PurchaseOrderCandidate,
} from '../companyOrderOptions'

/**
 * The purchase-picker fallback (REQ-019, TEST-013).
 *
 * A draft purchase order has no number, so a server search by number cannot find it. The loader
 * merges the unsearched first page with the searched one (deduped by id) and filters by number,
 * supplier name, or the printed label (which carries the id's head for a numberless draft). The pure
 * merge/filter is exercised here without any network.
 */

const candidate = (overrides: Partial<PurchaseOrderCandidate> & { refId: string }): PurchaseOrderCandidate => ({
  number: null,
  supplierName: null,
  status: null,
  ...overrides,
})

describe('mergePurchaseOrderCandidates', () => {
  const draftId = 'aaaa1111-2222-3333-4444-555566667777'
  const namedOrder = candidate({ refId: 'b'.repeat(36), number: 'PO-2026-0001', supplierName: 'Acme Trading' })
  const draft = candidate({ refId: draftId, number: null, supplierName: 'Beta Supplies' })
  const shared = candidate({ refId: 'c'.repeat(36), number: 'PO-2026-0002', supplierName: 'Gamma' })

  it('dedupes by id, keeping the first occurrence', () => {
    const merged = mergePurchaseOrderCandidates([namedOrder, shared], [shared, draft], '')
    expect(merged.map((row) => row.refId)).toEqual([namedOrder.refId, shared.refId, draft.refId])
  })

  it('returns the merged set unfiltered for empty input, without throwing', () => {
    expect(mergePurchaseOrderCandidates([namedOrder], [draft], '   ').map((row) => row.refId)).toEqual([
      namedOrder.refId,
      draft.refId,
    ])
    expect(mergePurchaseOrderCandidates([], [], '')).toEqual([])
  })

  it('finds a numberless draft by supplier name', () => {
    const merged = mergePurchaseOrderCandidates([namedOrder], [draft], 'beta')
    expect(merged.map((row) => row.refId)).toEqual([draft.refId])
  })

  it('finds a numberless draft by the id prefix in its label', () => {
    const merged = mergePurchaseOrderCandidates([namedOrder], [draft], draftId.slice(0, 8))
    expect(merged.map((row) => row.refId)).toEqual([draft.refId])
  })

  it('keeps number search working and ranks an exact match first', () => {
    const prefixMatch = candidate({ refId: 'd'.repeat(36), number: 'PO-2026-00100', supplierName: 'Delta' })
    const exact = candidate({ refId: 'e'.repeat(36), number: 'PO-2026-0010', supplierName: 'Echo' })
    const merged = mergePurchaseOrderCandidates([prefixMatch], [exact], 'PO-2026-0010')
    expect(merged.map((row) => row.refId)).toEqual([exact.refId, prefixMatch.refId])
  })

  it('drops candidates that match nothing', () => {
    expect(mergePurchaseOrderCandidates([namedOrder], [draft], 'zzz-nothing')).toEqual([])
  })
})

describe('purchaseOrderCandidateLabel', () => {
  it('prints number — supplier, and the id head for a numberless draft', () => {
    expect(purchaseOrderCandidateLabel(namedOrder())).toBe('PO-2026-0001 — Acme Trading')
    expect(purchaseOrderCandidateLabel(candidate({ refId: 'f'.repeat(36), number: null, supplierName: 'Solo' }))).toBe(
      'ffffffff — Solo',
    )
  })
})

function namedOrder(): PurchaseOrderCandidate {
  return candidate({ refId: 'b'.repeat(36), number: 'PO-2026-0001', supplierName: 'Acme Trading' })
}
