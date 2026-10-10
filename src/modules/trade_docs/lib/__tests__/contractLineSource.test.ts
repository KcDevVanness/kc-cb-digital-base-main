import { describe, expect, it } from '@jest/globals'
import {
  CONTRACT_LINE_SOURCE_ROUTES,
  appendContractLines,
  buildContractSourceAnchorPayload,
  buildSalesSourceListParams,
  readContractSourceHeadFacts,
  readOrderSourceHeadFacts,
  sourceKindsForDirection,
  sourceLineToContractLine,
  tradeTypeFromPartyRoles,
  type ContractLineDraft,
} from '../contractLineSource'

function draft(patch: Partial<ContractLineDraft> = {}): ContractLineDraft {
  return {
    productId: '',
    name: '',
    sku: '',
    model: '',
    spec: '',
    unit: 'PCS',
    quantity: '1',
    unitPrice: '0',
    note: '',
    sourceSnapshot: null,
    ...patch,
  }
}

describe('sourceKindsForDirection', () => {
  it('keeps a purchase contract on purchase orders only', () => {
    expect(sourceKindsForDirection('purchase')).toEqual(['purchase_order'])
    expect(sourceKindsForDirection('')).toEqual(['purchase_order'])
    expect(sourceKindsForDirection('purchase', 'internal')).toEqual(['purchase_order'])
  })

  it('offers both trade types, each named by its own kind, when the counterparty is unresolved', () => {
    expect(sourceKindsForDirection('sales')).toEqual([
      'internal_sales_order',
      'internal_sales_quote',
      'external_sales_order',
      'external_sales_quote',
    ])
  })

  it('offers only the resolved trade type, orders before quotes, never a purchase order', () => {
    expect(sourceKindsForDirection('sales', 'internal')).toEqual([
      'internal_sales_order',
      'internal_sales_quote',
    ])
    expect(sourceKindsForDirection('sales', 'external')).toEqual([
      'external_sales_order',
      'external_sales_quote',
    ])
  })

  it('anchors a quote as a sales order, the only sales entry the contract schema knows', () => {
    expect(CONTRACT_LINE_SOURCE_ROUTES.internal_sales_quote.headSourceKind).toBe('sales_order')
    expect(CONTRACT_LINE_SOURCE_ROUTES.internal_sales_order.lineApiPath).toBe('sales/order-lines')
    expect(CONTRACT_LINE_SOURCE_ROUTES.external_sales_quote.lineParentParam).toBe('quoteId')
    expect(CONTRACT_LINE_SOURCE_ROUTES.external_sales_quote.lineApiPath).toBe('sales/quote-lines')
  })

  it('carries each kind’s own trade type on the route table', () => {
    expect(CONTRACT_LINE_SOURCE_ROUTES.purchase_order.tradeType).toBeNull()
    expect(CONTRACT_LINE_SOURCE_ROUTES.internal_sales_order.tradeType).toBe('internal')
    expect(CONTRACT_LINE_SOURCE_ROUTES.external_sales_quote.tradeType).toBe('external')
  })
})

describe('tradeTypeFromPartyRoles', () => {
  it('reads a branch as internal and a buyer as external', () => {
    expect(tradeTypeFromPartyRoles(['branch'])).toBe('internal')
    expect(tradeTypeFromPartyRoles(['buyer'])).toBe('external')
  })

  it('prefers the branch link when a subsidiary is also a buyer', () => {
    expect(tradeTypeFromPartyRoles(['buyer', 'branch'])).toBe('internal')
  })

  it('reports no trade type for roles that are not a master link, or for no roles at all', () => {
    expect(tradeTypeFromPartyRoles(['consignee'])).toBeNull()
    expect(tradeTypeFromPartyRoles([])).toBeNull()
    expect(tradeTypeFromPartyRoles(null)).toBeNull()
    expect(tradeTypeFromPartyRoles(undefined)).toBeNull()
  })
})

describe('buildSalesSourceListParams', () => {
  const channels = { internal: 'channel-internal', external: 'channel-external' }

  it('filters a resolved trade type by its own channel', () => {
    expect(buildSalesSourceListParams('internal', channels, '')).toEqual({
      channelId: 'channel-internal',
      pageSize: 100,
      sortField: 'created_at',
      sortDir: 'desc',
    })
    expect(buildSalesSourceListParams('external', channels, '  AC-1 ')).toEqual({
      channelId: 'channel-external',
      pageSize: 100,
      sortField: 'created_at',
      sortDir: 'desc',
      search: 'AC-1',
    })
  })

  it('offers nothing for a resolved type whose channel is missing, never a widened list', () => {
    expect(buildSalesSourceListParams('internal', { internal: null, external: 'channel-external' }, '')).toBeNull()
    expect(buildSalesSourceListParams('external', {}, 'x')).toBeNull()
  })
})

describe('readOrderSourceHeadFacts', () => {
  it('reads a purchase order row, including the number fallback and the null-tolerant fields', () => {
    expect(
      readOrderSourceHeadFacts(
        {
          id: 'po-1',
          number: 'PO-2026-0010',
          supplierName: '宁波 XX',
          currencyCode: 'CNY',
          total: '2000.00',
          createdAt: '2026-09-29T10:01:39.667Z',
        },
        'purchase_order',
        'number',
      ),
    ).toEqual({
      number: 'PO-2026-0010',
      counterparty: '宁波 XX',
      currencyCode: 'CNY',
      amount: '2000.00',
      placedAt: '2026-09-29T10:01:39.667Z',
    })
  })

  it('reads a sales order row off the frozen customer snapshot, coercing the numeric total', () => {
    expect(
      readOrderSourceHeadFacts(
        {
          id: 'so-1',
          orderNumber: 'ORDER-20260929-00007',
          customerSnapshot: { name: '俄罗斯 AB 有限公司', internalSales: { organizationId: 'org-1' } },
          currencyCode: 'USD',
          grandTotalNetAmount: 125,
          createdAt: '2026-09-28 05:22:12.227+00',
        },
        'sales',
        'orderNumber',
      ),
    ).toEqual({
      number: 'ORDER-20260929-00007',
      counterparty: '俄罗斯 AB 有限公司',
      currencyCode: 'USD',
      amount: '125',
      placedAt: '2026-09-28 05:22:12.227+00',
    })
  })

  it('falls back to the id prefix and leaves absent fields empty instead of inventing them', () => {
    expect(readOrderSourceHeadFacts({ id: 'abcdef12-3456-7890' }, 'sales', 'quoteNumber')).toEqual({
      number: 'abcdef12',
      counterparty: '',
      currencyCode: '',
      amount: '',
      placedAt: '',
    })
  })
})

describe('readContractSourceHeadFacts', () => {
  it('reads the contract total, counterparty and signed date from its own list projection', () => {
    expect(
      readContractSourceHeadFacts({
        id: 'contract-1',
        number: 'PC-2026-0010',
        counterpartyName: '宁波 XX',
        currencyCode: 'CNY',
        contractTotal: '2000.00',
        signedAt: '2026-09-20',
      }),
    ).toEqual({
      number: 'PC-2026-0010',
      counterparty: '宁波 XX',
      currencyCode: 'CNY',
      amount: '2000.00',
      placedAt: '2026-09-20',
    })
  })

  it('falls back to the counterparty snapshot and the id when the projection has no name', () => {
    expect(
      readContractSourceHeadFacts({ id: 'abcdef12-3456-7890', counterpartySnapshot: { name: '俄罗斯 AB' } }),
    ).toEqual({
      number: 'abcdef12',
      counterparty: '俄罗斯 AB',
      currencyCode: '',
      amount: '',
      placedAt: '',
    })
  })
})

describe('sourceLineToContractLine', () => {
  it('maps a purchase-order line, freezing its provenance', () => {
    const line = sourceLineToContractLine(
      {
        id: 'line-1',
        // The projection's own key since the single-store cutover: a purchase-order line carries
        // `catalogProductId` (the `product_id` column was dropped), and reading the old key mapped
        // every line to an empty reference.
        catalogProductId: 'product-1',
        product_title: 'Steel bracket',
        product_sku: 'SKU-9',
        supplier_sku: 'SUP-1',
        product_unit: 'SET',
        quantity: '3',
        unit_price: '12.5000',
        note: 'pack separately',
      },
      'purchase_order',
      '2026-09-29T00:00:00.000Z',
    )
    expect(line).toEqual({
      productId: 'product-1',
      name: 'Steel bracket',
      sku: 'SKU-9',
      model: '',
      spec: '',
      unit: 'SET',
      quantity: '3',
      unitPrice: '12.5000',
      note: 'pack separately',
      sourceSnapshot: {
        kind: 'order_line',
        id: 'line-1',
        orderKind: 'purchase_order',
        copiedAt: '2026-09-29T00:00:00.000Z',
      },
    })
  })

  it('falls back to the supplier SKU on a purchase line with no product master row', () => {
    const line = sourceLineToContractLine(
      { id: 'line-2', product_title: 'Freight', supplier_sku: 'FR-8', quantity: '1', unit_price: '50' },
      'purchase_order',
      'now',
    )
    expect(line.sku).toBe('FR-8')
    expect(line.unit).toBe('')
    expect(line.unitPrice).toBe('50')
    // A line with no owned-master reference maps to an empty id rather than a stale one.
    expect(line.productId).toBe('')
  })

  it('maps a sales line, reading SKU and unit out of the catalog snapshot as a fallback', () => {
    const line = sourceLineToContractLine(
      {
        id: 'line-3',
        product_id: 'product-3',
        name: 'Widget',
        quantity: '2',
        quantity_unit: 'PCS',
        unit_price_net: '9.75',
        comment: 'gift wrap',
      },
      'internal_sales_quote',
      'now',
    )
    expect(line).toMatchObject({
      productId: 'product-3',
      name: 'Widget',
      unit: 'PCS',
      quantity: '2',
      unitPrice: '9.75',
      note: 'gift wrap',
      sourceSnapshot: { kind: 'order_line', id: 'line-3', orderKind: 'internal_sales_quote', copiedAt: 'now' },
    })

    const snapshotOnly = sourceLineToContractLine(
      { id: 'line-4', name: 'Legacy', catalog_snapshot: { sku: 'OLD-1', unit: 'SET' } },
      'external_sales_order',
      'now',
    )
    expect(snapshotOnly.sku).toBe('OLD-1')
    expect(snapshotOnly.unit).toBe('SET')
  })
})

describe('appendContractLines', () => {
  it('drops the blank placeholder row and keeps what the operator typed', () => {
    const result = appendContractLines(
      [draft(), draft({ name: 'typed row' })],
      [draft({ productId: 'p1', name: 'copied' })],
    )
    expect(result.map((line) => line.name)).toEqual(['typed row', 'copied'])
  })

  it('returns the batch alone when the editor only holds the placeholder', () => {
    const result = appendContractLines([draft()], [draft({ name: 'copied' })])
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('copied')
  })
})

describe('buildContractSourceAnchorPayload', () => {
  it("keeps today's absent state — nulls — when no source was picked", () => {
    expect(
      buildContractSourceAnchorPayload({
        sourceKind: 'manual',
        sourceId: '  ',
        sourceNumber: '',
        sourceCounterparty: '',
      }),
    ).toEqual({ sourceKind: null, sourceId: null, sourceSnapshot: null })
  })

  it('freezes the picked source head and its display fields', () => {
    expect(
      buildContractSourceAnchorPayload({
        sourceKind: 'purchase_order',
        sourceId: ' order-1 ',
        sourceNumber: 'PO-1',
        sourceCounterparty: 'Supplier Co',
      }),
    ).toEqual({
      sourceKind: 'purchase_order',
      sourceId: 'order-1',
      sourceSnapshot: { number: 'PO-1', counterparty: 'Supplier Co' },
    })
  })

  it('anchors a sales quote as a sales order and tolerates missing display fields', () => {
    expect(
      buildContractSourceAnchorPayload({
        sourceKind: 'sales_quote',
        sourceId: 'order-1',
        sourceNumber: '',
        sourceCounterparty: '',
      }),
    ).toEqual({ sourceKind: 'sales_order', sourceId: 'order-1', sourceSnapshot: null })
  })
})
