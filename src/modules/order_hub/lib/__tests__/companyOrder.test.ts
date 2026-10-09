import { describe, expect, it } from '@jest/globals'
import { freezeLinkSnapshot, linkKey, type CompanyOrderRef } from '../companyOrder'
import { formatCompanyOrderNumber } from '../companyOrderNumber'

/**
 * Pure pieces of the company-order lib: the link key the command derives duplicates through, the
 * frozen snapshot shape, and the number format. The scope-aware reads (`loadCompanyOrderRefs`,
 * `linkChild`) are exercised by the command unit test and the integration suite.
 */
describe('companyOrder lib', () => {
  it('builds a stable key per (kind, refId) so duplicates are visible before the unique index', () => {
    expect(linkKey('internal_sales_order', 'abc')).toBe('internal_sales_order:abc')
    expect(linkKey('internal_sales_order', 'abc')).toBe(linkKey('internal_sales_order', 'abc'))
    expect(linkKey('internal_sales_order', 'abc')).not.toBe(linkKey('external_sales_order', 'abc'))
    expect(linkKey('purchase_order', 'abc')).not.toBe(linkKey('internal_sales_order', 'abc'))
  })

  it('freezes status, date and the money header from a resolved child', () => {
    const ref: CompanyOrderRef = {
      kind: 'purchase_order',
      id: '11111111-1111-1111-1111-111111111111',
      number: 'PO-2026-0007',
      counterparty: 'Acme Supplies',
      status: 'placed',
      createdAt: '2026-10-01T02:03:04.000Z',
      currencyCode: 'CNY',
      totalGross: '1234.50',
    }
    expect(freezeLinkSnapshot(ref)).toEqual({
      status: 'placed',
      createdAt: '2026-10-01T02:03:04.000Z',
      currencyCode: 'CNY',
      totalGross: '1234.50',
    })
  })

  it('keeps missing money/counterparty as null rather than inventing a value', () => {
    const ref: CompanyOrderRef = {
      kind: 'internal_sales_order',
      id: '22222222-2222-2222-2222-222222222222',
      number: null,
      counterparty: null,
      status: null,
      createdAt: null,
      currencyCode: null,
      totalGross: null,
    }
    expect(freezeLinkSnapshot(ref)).toEqual({
      status: null,
      createdAt: null,
      currencyCode: null,
      totalGross: null,
    })
  })

  it('formats the number as CO-<year>-<4 digits>, zero-padding the sequence', () => {
    expect(formatCompanyOrderNumber(2026, 1)).toBe('CO-2026-0001')
    expect(formatCompanyOrderNumber(2026, 42)).toBe('CO-2026-0042')
    expect(formatCompanyOrderNumber(2026, 9999)).toBe('CO-2026-9999')
    expect(formatCompanyOrderNumber(2030, 10000)).toBe('CO-2030-10000')
  })
})
