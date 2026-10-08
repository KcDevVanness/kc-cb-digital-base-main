import { describe, expect, it } from '@jest/globals'
import { compareByCreatedAtDesc, isOrderPending, type OrderPendingInput } from '../orderPending'

/**
 * The workbench's "只看待补" rule, one case per order kind and terminal status.
 *
 * The rule is the whole point of the screen — it is what turns a list of orders into "what do I have
 * to do today" — so each branch is pinned rather than left to the component.
 */

const stages = (overrides: Partial<NonNullable<OrderPendingInput['stages']>> = {}) => ({
  procurementCount: 1,
  shipmentCount: 1,
  documentCount: 1,
  collected: true,
  refunded: true,
  ...overrides,
})

const row = (
  kind: OrderPendingInput['kind'],
  status: string | null,
  stageOverrides: Partial<NonNullable<OrderPendingInput['stages']>> = {},
): OrderPendingInput => ({ kind, status, createdAt: '2026-10-01T00:00:00.000Z', stages: stages(stageOverrides) })

describe('isOrderPending', () => {
  it('is false for a fully filled internal sale', () => {
    expect(isOrderPending(row('internal_sales', 'confirmed'))).toBe(false)
  })

  it('is true for an internal sale missing any of its four branches', () => {
    expect(isOrderPending(row('internal_sales', 'confirmed', { procurementCount: 0 }))).toBe(true)
    expect(isOrderPending(row('internal_sales', 'confirmed', { shipmentCount: 0 }))).toBe(true)
    expect(isOrderPending(row('internal_sales', 'confirmed', { documentCount: 0 }))).toBe(true)
    expect(isOrderPending(row('internal_sales', 'confirmed', { collected: false }))).toBe(true)
  })

  it('never asks an external sale for a purchase order', () => {
    // External sales ship from stock that is already bought: a zero procurement count is normal.
    expect(isOrderPending(row('external_sales', 'confirmed', { procurementCount: 0 }))).toBe(false)
    expect(isOrderPending(row('external_sales', 'confirmed', { shipmentCount: 0 }))).toBe(true)
    expect(isOrderPending(row('external_sales', 'confirmed', { documentCount: 0 }))).toBe(true)
    expect(isOrderPending(row('external_sales', 'confirmed', { collected: false }))).toBe(false)
  })

  it('ignores a cancelled sales order whatever its branches say', () => {
    expect(isOrderPending(row('internal_sales', 'canceled', { procurementCount: 0 }))).toBe(false)
    expect(isOrderPending(row('external_sales', 'canceled', { shipmentCount: 0 }))).toBe(false)
  })

  it('asks a purchase order for shipping, documents, collection and refund', () => {
    expect(isOrderPending(row('purchase', 'placed'))).toBe(false)
    expect(isOrderPending(row('purchase', 'placed', { shipmentCount: 0 }))).toBe(true)
    expect(isOrderPending(row('purchase', 'placed', { documentCount: 0 }))).toBe(true)
    expect(isOrderPending(row('purchase', 'placed', { collected: false }))).toBe(true)
    expect(isOrderPending(row('purchase', 'placed', { refunded: false }))).toBe(true)
  })

  it('ignores a closed or cancelled purchase order', () => {
    expect(isOrderPending(row('purchase', 'closed', { shipmentCount: 0 }))).toBe(false)
    expect(isOrderPending(row('purchase', 'cancelled', { shipmentCount: 0 }))).toBe(false)
  })

  it('is false while the stages have not arrived', () => {
    // A row whose projection failed is not evidence of a gap: claiming "待补" without the counts would
    // put every order on the screen the moment the stage read broke.
    expect(isOrderPending({ kind: 'internal_sales', status: 'confirmed', createdAt: null, stages: null })).toBe(false)
  })
})

describe('compareByCreatedAtDesc', () => {
  it('orders newest first', () => {
    const rows = [
      { createdAt: '2026-10-01T00:00:00.000Z' },
      { createdAt: '2026-10-03T00:00:00.000Z' },
      { createdAt: '2026-10-02T00:00:00.000Z' },
    ]
    expect([...rows].sort(compareByCreatedAtDesc).map((row) => row.createdAt)).toEqual([
      '2026-10-03T00:00:00.000Z',
      '2026-10-02T00:00:00.000Z',
      '2026-10-01T00:00:00.000Z',
    ])
  })

  it('sorts a row without a timestamp last instead of guessing', () => {
    const rows = [{ createdAt: null }, { createdAt: '2026-10-01T00:00:00.000Z' }]
    expect([...rows].sort(compareByCreatedAtDesc).map((row) => row.createdAt)).toEqual([
      '2026-10-01T00:00:00.000Z',
      null,
    ])
  })
})
