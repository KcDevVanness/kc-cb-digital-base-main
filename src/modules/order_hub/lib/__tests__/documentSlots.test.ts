import { describe, expect, it } from '@jest/globals'
import { COMPANY_ORDER_DOCUMENT_SLOTS } from '../../data/validators'
import zhJson from '../../i18n/zh.json'
import enJson from '../../i18n/en.json'

const zh = zhJson as Record<string, string>
const en = enJson as Record<string, string>

/**
 * The named document slots (REQ-020) and their labels (REQ-023/REQ-024).
 *
 * The enum order is the hub's row order and the codes are the frozen API vocabulary, so both are
 * pinned here. Every slot and every child-source badge must carry a label in *both* dictionaries:
 * a missing label would render a raw code to an operator, which the flat dotted-key scheme is
 * supposed to make impossible.
 */

const SOURCE_KINDS = ['contract', 'shipment', 'collection', 'purchasing'] as const

const EXPECTED_SLOTS = [
  'commercial_invoice',
  'packing_list',
  'bill_of_lading',
  'telex_release',
  'customs_declaration',
  'domestic_freight_receipt',
  'booking_charges_receipt',
  'purchase_slip_invoice',
  'foreign_income_certificate',
  'kc_invoice_stamp',
]

const SECTION_KEYS = [
  'order_hub.documents.title',
  'order_hub.documents.empty',
  'order_hub.documents.loadFailed',
  'order_hub.documents.upload',
  'order_hub.documents.uploading',
  'order_hub.documents.uploadFailed',
  'order_hub.documents.uploaded',
  'order_hub.documents.preview',
  'order_hub.documents.download',
  'order_hub.documents.delete',
  'order_hub.documents.deleteNamed',
  'order_hub.documents.deleted',
  'order_hub.documents.deleteFailed',
  'order_hub.documents.missing',
  'order_hub.documents.noFiles',
  'order_hub.documents.sourceSelf',
  'order_hub.documents.sourceCount',
]

const keysStartingWith = (dictionary: Record<string, string>, prefix: string): string[] =>
  Object.keys(dictionary).filter((key) => key.startsWith(prefix)).sort()

describe('company-order document slots', () => {
  it('publishes the ten named slots in their frozen order', () => {
    expect([...COMPANY_ORDER_DOCUMENT_SLOTS]).toEqual(EXPECTED_SLOTS)
  })

  it('labels every slot in both locales, and no slot that does not exist', () => {
    const expectedKeys = EXPECTED_SLOTS.map((slot) => `order_hub.documents.slots.${slot}`).sort()
    expect(expectedKeys.filter((key) => !zh[key])).toEqual([])
    expect(expectedKeys.filter((key) => !en[key])).toEqual([])
    expect(keysStartingWith(zh, 'order_hub.documents.slots.')).toEqual(expectedKeys)
    expect(keysStartingWith(en, 'order_hub.documents.slots.')).toEqual(expectedKeys)
  })

  it('labels every child source and every piece of the section copy in both locales', () => {
    const keys = [...SECTION_KEYS, ...SOURCE_KINDS.map((kind) => `order_hub.documents.sources.${kind}`)]
    expect(keys.filter((key) => !zh[key])).toEqual([])
    expect(keys.filter((key) => !en[key])).toEqual([])
  })

  it('keeps the two dictionaries key-for-key aligned', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })
})
