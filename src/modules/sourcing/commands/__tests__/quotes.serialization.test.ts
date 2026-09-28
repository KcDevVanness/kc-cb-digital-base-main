import { describe, expect, it } from '@jest/globals'
import type { SourcingQuote } from '../../data/entities'
import { serializeQuote } from '../quotes'

/**
 * `approve` committed the approval and then answered 500 because the serializer assumed every date
 * column comes back as a `Date`: the driver returns a `Date` for `timestamptz` but a plain string for
 * `date` (`quote_date`, `valid_until`), and `de.updateOrmEntity` hands back the row re-read from the
 * database. A successful write must never be reported as a failure.
 */
describe('sourcing quote serialization', () => {
  const base = {
    id: '1f6b2f18-4c4b-4a4d-9a5b-2c3d4e5f6a7b',
    number: 'SQ-2026-0014',
    supplierId: null,
    supplierNameSnapshot: '深圳市小佩科技有限公司',
    currencyCode: 'CNY',
    status: 'approved',
    sourceKind: 'manual',
    sourceAttachmentId: null,
    sourceFileName: null,
    sourceSheetName: null,
    sourceLayoutSignature: null,
    headerRowIndex: null,
    columnMap: null,
    sectionRules: null,
    sourceProfileId: null,
    lineCount: 3,
    promotedCount: 0,
    notes: null,
    tenantId: '212721cf-fbea-4fdd-b99a-95e4890a92f8',
    organizationId: 'bf4ccd1a-76e4-47b5-a2dd-6e6f45601fbc',
  }

  it('takes date-typed columns as the driver returns them and timestamps as Dates', () => {
    const serialized = serializeQuote({
      ...base,
      quoteDate: '2026-09-08',
      validUntil: '2026-10-08',
      approvedAt: new Date('2026-09-24T09:17:18.739Z'),
      createdAt: '2026-09-09T02:11:03.100Z',
      updatedAt: '2026-09-24T09:17:18.739Z',
    } as unknown as SourcingQuote)

    expect(serialized.quoteDate).toBe('2026-09-08')
    expect(serialized.validUntil).toBe('2026-10-08')
    expect(serialized.approvedAt).toBe('2026-09-24T09:17:18.739Z')
    expect(serialized.created_at).toBe('2026-09-09T02:11:03.100Z')
    expect(serialized.updatedAt).toBe('2026-09-24T09:17:18.739Z')
  })

  it('answers null for missing and unparseable values instead of throwing', () => {
    const serialized = serializeQuote({
      ...base,
      quoteDate: null,
      validUntil: undefined,
      approvedAt: null,
      createdAt: 'not-a-date',
      updatedAt: '',
    } as unknown as SourcingQuote)

    expect(serialized.quoteDate).toBeNull()
    expect(serialized.validUntil).toBeNull()
    expect(serialized.approvedAt).toBeNull()
    expect(serialized.created_at).toBeNull()
    expect(serialized.updatedAt).toBeNull()
  })
})
