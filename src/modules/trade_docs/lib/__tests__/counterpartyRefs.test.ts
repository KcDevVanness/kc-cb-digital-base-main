import { describe, expect, it } from '@jest/globals'
import { COUNTERPARTY_KIND_BY_DIRECTION, COUNTERPARTY_KIND_BY_INVOICE_DIRECTION } from '../../data/validators'
import { resolveCounterpartyKind } from '../counterpartyRefs'

describe('resolveCounterpartyKind', () => {
  it('derives the kind from the direction', () => {
    expect(resolveCounterpartyKind('purchase', undefined, COUNTERPARTY_KIND_BY_DIRECTION)).toBe('supplier')
    expect(resolveCounterpartyKind('sales', undefined, COUNTERPARTY_KIND_BY_DIRECTION)).toBe('customer')
    expect(resolveCounterpartyKind('inbound', undefined, COUNTERPARTY_KIND_BY_INVOICE_DIRECTION)).toBe('supplier')
    expect(resolveCounterpartyKind('outbound', undefined, COUNTERPARTY_KIND_BY_INVOICE_DIRECTION)).toBe('customer')
  })

  it('accepts an explicit kind that agrees and rejects one that contradicts', () => {
    expect(resolveCounterpartyKind('sales', 'customer', COUNTERPARTY_KIND_BY_DIRECTION)).toBe('customer')
    expect(() => resolveCounterpartyKind('sales', 'supplier', COUNTERPARTY_KIND_BY_DIRECTION)).toThrow(
      /counterpartyKind must be "customer"/,
    )
    expect(() => resolveCounterpartyKind('outbound', 'supplier', COUNTERPARTY_KIND_BY_INVOICE_DIRECTION)).toThrow()
  })

  it('rejects an unknown direction instead of guessing', () => {
    expect(() => resolveCounterpartyKind('sideways', undefined, COUNTERPARTY_KIND_BY_DIRECTION)).toThrow(
      /Unknown direction/,
    )
  })
})
