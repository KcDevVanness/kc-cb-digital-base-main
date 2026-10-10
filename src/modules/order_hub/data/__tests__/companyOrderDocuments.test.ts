import { describe, expect, it } from '@jest/globals'
import {
  COMPANY_ORDER_DOCUMENT_SLOTS,
  companyOrderDocumentAttachSchema,
  companyOrderDocumentDeleteSchema,
  companyOrderDocumentsListSchema,
} from '../validators'

/**
 * TEST-017 — the document-slot request schemas (REQ-020, REQ-021).
 *
 * The schemas are the boundary between the routes and the commands: an unknown slot, a missing id or
 * a non-uuid value must be refused before any write reaches the database.
 */

const uuid = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`

describe('COMPANY_ORDER_DOCUMENT_SLOTS', () => {
  it('lists exactly the ten named document fields of the root', () => {
    expect(COMPANY_ORDER_DOCUMENT_SLOTS).toEqual([
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
    ])
  })
})

describe('companyOrderDocumentAttachSchema', () => {
  it('accepts a well-formed registration', () => {
    const parsed = companyOrderDocumentAttachSchema.parse({
      id: uuid('1'),
      companyOrderId: uuid('2'),
      slot: 'kc_invoice_stamp',
      attachmentId: uuid('3'),
    })
    expect(parsed.slot).toBe('kc_invoice_stamp')
    expect(parsed.id).toBe(uuid('1'))
  })

  it('rejects an unknown slot', () => {
    const result = companyOrderDocumentAttachSchema.safeParse({
      id: uuid('1'),
      companyOrderId: uuid('2'),
      slot: 'not_a_slot',
      attachmentId: uuid('3'),
    })
    expect(result.success).toBe(false)
  })

  it('rejects a missing or malformed id', () => {
    const base = { companyOrderId: uuid('2'), slot: 'packing_list', attachmentId: uuid('3') }
    expect(companyOrderDocumentAttachSchema.safeParse(base).success).toBe(false)
    expect(companyOrderDocumentAttachSchema.safeParse({ ...base, id: 'not-a-uuid' }).success).toBe(false)
  })

  it('rejects a missing attachmentId', () => {
    const result = companyOrderDocumentAttachSchema.safeParse({
      id: uuid('1'),
      companyOrderId: uuid('2'),
      slot: 'packing_list',
    })
    expect(result.success).toBe(false)
  })
})

describe('companyOrderDocumentsListSchema', () => {
  it('accepts a company order id and rejects a missing one', () => {
    expect(companyOrderDocumentsListSchema.safeParse({ companyOrderId: uuid('4') }).success).toBe(true)
    expect(companyOrderDocumentsListSchema.safeParse({}).success).toBe(false)
    expect(companyOrderDocumentsListSchema.safeParse({ companyOrderId: 'nope' }).success).toBe(false)
  })
})

describe('companyOrderDocumentDeleteSchema', () => {
  it('accepts a uuid id and rejects anything else', () => {
    expect(companyOrderDocumentDeleteSchema.safeParse({ id: uuid('5') }).success).toBe(true)
    expect(companyOrderDocumentDeleteSchema.safeParse({ id: '' }).success).toBe(false)
  })
})
