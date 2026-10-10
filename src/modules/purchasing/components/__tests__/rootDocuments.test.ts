import { describe, expect, it } from '@jest/globals'
import { toRootDocumentSlots } from '../rootDocuments'

/**
 * The root order's document slots as the purchase-order detail mirrors them (REQ-056, TEST-038).
 *
 * The payload arrives over HTTP from `order_hub/orders/fields`, so the parse is the boundary: it has
 * to drop what it cannot read (a renamed column, a slot with nothing in it) without ever answering
 * "no documents" for a payload that simply changed shape in a *readable* way — and without rendering
 * half a row.
 */

describe('toRootDocumentSlots', () => {
  it('keeps only the slots that carry something, in the payload order', () => {
    const slots = toRootDocumentSlots([
      { slot: 'commercial_invoice', files: [], childSources: [] },
      {
        slot: 'packing_list',
        files: [{ attachmentId: 'a-1', fileName: 'PL-1.pdf', createdAt: '2026-10-10T05:12:18.737Z' }],
        childSources: [],
      },
      { slot: 'bill_of_lading', files: [], childSources: [{ source: 'shipment', label: 'BL-9', count: 1 }] },
    ])
    expect(slots.map((slot) => slot.slot)).toEqual(['packing_list', 'bill_of_lading'])
  })

  it('keeps every file of a slot and falls back to the attachment id for a missing name', () => {
    const [slot] = toRootDocumentSlots([
      {
        slot: 'customs_declaration',
        files: [
          { attachmentId: 'a-1', fileName: 'declaration.pdf', createdAt: '2026-10-01T00:00:00.000Z' },
          { attachmentId: 'a-2' },
          'not-an-object',
        ],
        childSources: [],
      },
    ])
    expect(slot.files).toEqual([
      { attachmentId: 'a-1', fileName: 'declaration.pdf', createdAt: '2026-10-01T00:00:00.000Z' },
      { attachmentId: 'a-2', fileName: 'a-2', createdAt: '' },
    ])
  })

  it('reads a source signal with its count and drops the entries that carry no kind', () => {
    const [slot] = toRootDocumentSlots([
      {
        slot: 'purchase_slip_invoice',
        files: [],
        childSources: [
          { source: 'purchasing', label: '', count: 2 },
          { source: 'purchasing', label: 'PO-2026-0008', count: 'two' },
          { label: 'no kind' },
        ],
      },
    ])
    expect(slot.childSources).toEqual([
      { source: 'purchasing', label: '', count: 2 },
      { source: 'purchasing', label: 'PO-2026-0008', count: null },
    ])
  })

  it('answers an empty list for a payload that is not a slot array, never a crash', () => {
    for (const payload of [undefined, null, {}, 'documents', 42]) {
      expect(toRootDocumentSlots(payload)).toEqual([])
    }
    expect(toRootDocumentSlots([null, {}, { slot: '' }])).toEqual([])
  })

  it('tolerates a slot whose file and source fields are missing entirely', () => {
    expect(toRootDocumentSlots([{ slot: 'telex_release' }])).toEqual([])
    expect(toRootDocumentSlots([{ slot: 'telex_release', files: 'nope', childSources: 'nope' }])).toEqual([])
  })
})
