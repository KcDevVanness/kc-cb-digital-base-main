import { describe, expect, it } from '@jest/globals'
import {
  COMPANY_ORDER_STATUSES,
  companyOrderCreateSchema,
  companyOrderStatusOptions,
  companyOrderUpdateSchema,
} from '../validators'

/**
 * The company-order vocabularies, which carry the 2026-10-09 owner change: the status set became the
 * deal's own seven stages (`placed` → … → `warehoused`) and 是否已收款 arrived as a two-value marker.
 * The status contract is *additive over the retired set* — old rows must stay readable, writable and
 * filterable — so the tests below pin exactly that boundary, and that the picker offers the current
 * vocabulary without rewriting a legacy row's own value behind the operator's back.
 */

const ORDER_ID = '11111111-1111-4111-8111-111111111111'

describe('order_hub company order status vocabulary', () => {
  it('offers the current stages in the deal’s own order, plus a legacy row’s own value', () => {
    expect(COMPANY_ORDER_STATUSES).toEqual([
      'placed',
      'in_production',
      'factory_pickup',
      'customs_declared',
      'shipped',
      'in_transit',
      'warehoused',
    ])
    expect(companyOrderStatusOptions()).toEqual([...COMPANY_ORDER_STATUSES])
    expect(companyOrderStatusOptions('placed')).toEqual([...COMPANY_ORDER_STATUSES])
    // A row written before the vocabulary landed keeps its value selectable — and only that one.
    expect(companyOrderStatusOptions('in_progress')).toEqual([...COMPANY_ORDER_STATUSES, 'in_progress'])
    expect(companyOrderStatusOptions('nonsense')).toEqual([...COMPANY_ORDER_STATUSES])
  })

  it('accepts the retired vocabulary and refuses unknown values', () => {
    for (const legacy of ['draft', 'in_progress', 'completed', 'cancelled'] as const) {
      expect(companyOrderUpdateSchema.parse({ id: ORDER_ID, status: legacy }).status).toBe(legacy)
    }
    expect(companyOrderUpdateSchema.parse({ id: ORDER_ID, status: 'warehoused' }).status).toBe('warehoused')
    expect(companyOrderUpdateSchema.safeParse({ id: ORDER_ID, status: 'drafting' }).success).toBe(false)
    expect(companyOrderCreateSchema.safeParse({ status: 'shipping' }).success).toBe(false)
  })
})

describe('order_hub company order payment marker', () => {
  it('keeps value, explicit null and absent apart on update', () => {
    expect(companyOrderUpdateSchema.parse({ id: ORDER_ID, paymentStatus: 'paid_full' }).paymentStatus)
      .toBe('paid_full')
    // An explicit `null` is the operator clearing the marker back to “—”.
    expect(companyOrderUpdateSchema.parse({ id: ORDER_ID, paymentStatus: null }).paymentStatus).toBeNull()
    // Absent must stay absent: the partial update leaves the stored value alone (no create default).
    expect('paymentStatus' in companyOrderUpdateSchema.parse({ id: ORDER_ID })).toBe(false)
    expect(companyOrderUpdateSchema.safeParse({ id: ORDER_ID, paymentStatus: 'paid' }).success).toBe(false)
  })

  it('leaves the fresh-order default to the command, not to the create schema', () => {
    // `unpaid` is what the create command stores when the field is omitted or null; a schema default
    // here would leak into every partial update through `.partial()`/shared-field reuse.
    expect(companyOrderCreateSchema.parse({}).paymentStatus).toBeUndefined()
    expect(companyOrderCreateSchema.parse({ paymentStatus: null }).paymentStatus).toBeNull()
  })
})
