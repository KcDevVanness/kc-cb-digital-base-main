import { describe, expect, it } from '@jest/globals'
import { buildCompanyOrderLinks, parseSalesLinkRef } from '../companyOrderLinkPayload'

const SALES_ID = '11111111-1111-4111-8111-111111111111'
const SALES_ID_2 = '22222222-2222-4222-8222-222222222222'
const PURCHASE_ID = '33333333-3333-4333-8333-333333333333'

describe('companyOrder link payload', () => {
  it('decodes a sales picker value into its kind and id', () => {
    expect(parseSalesLinkRef(`internal_sales_order:${SALES_ID}`)).toEqual({
      kind: 'internal_sales_order',
      refId: SALES_ID,
    })
    expect(parseSalesLinkRef(`external_sales_order:${SALES_ID}`)).toEqual({
      kind: 'external_sales_order',
      refId: SALES_ID,
    })
  })

  it('drops malformed or non-sales values rather than sending them', () => {
    expect(parseSalesLinkRef(SALES_ID)).toBeNull()
    expect(parseSalesLinkRef(`purchase_order:${SALES_ID}`)).toBeNull()
    expect(parseSalesLinkRef('internal_sales_order:')).toBeNull()
    expect(parseSalesLinkRef(':')).toBeNull()
  })

  it('builds the links payload from both pickers, in picker order', () => {
    const links = buildCompanyOrderLinks({
      salesLinkRefs: [`internal_sales_order:${SALES_ID}`, `external_sales_order:${SALES_ID_2}`],
      purchaseLinkRefs: [PURCHASE_ID],
    })
    expect(links).toEqual([
      { kind: 'internal_sales_order', refId: SALES_ID },
      { kind: 'external_sales_order', refId: SALES_ID_2 },
      { kind: 'purchase_order', refId: PURCHASE_ID },
    ])
  })

  it('omits empty selections entirely', () => {
    expect(buildCompanyOrderLinks({})).toEqual([])
    expect(buildCompanyOrderLinks({ salesLinkRefs: [], purchaseLinkRefs: ['', '  '] })).toEqual([])
  })
})
