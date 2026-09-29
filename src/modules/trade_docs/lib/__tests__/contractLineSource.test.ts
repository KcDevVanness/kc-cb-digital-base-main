import { describe, expect, it } from '@jest/globals'
import {
  CONTRACT_LINE_SOURCE_ROUTES,
  appendContractLines,
  buildContractSourceAnchorPayload,
  buildSalesSourceListParams,
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
  })

  it('offers orders and quotes for a sales contract, never a purchase order', () => {
    expect(sourceKindsForDirection('sales')).toEqual(['sales_order', 'sales_quote'])
  })

  it('anchors a quote as a sales order, the only sales entry the contract schema knows', () => {
    expect(CONTRACT_LINE_SOURCE_ROUTES.sales_quote.headSourceKind).toBe('sales_order')
    expect(CONTRACT_LINE_SOURCE_ROUTES.sales_order.lineApiPath).toBe('sales/order-lines')
    expect(CONTRACT_LINE_SOURCE_ROUTES.sales_quote.lineParentParam).toBe('quoteId')
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

  it('lists both channels when the counterparty has no master link', () => {
    expect(buildSalesSourceListParams(null, channels, '')).toEqual({
      channelIds: 'channel-internal,channel-external',
      pageSize: 100,
      sortField: 'created_at',
      sortDir: 'desc',
    })
  })

  it('offers nothing when no trade-type channel exists at all', () => {
    expect(buildSalesSourceListParams(null, {}, '')).toBeNull()
    expect(buildSalesSourceListParams(null, { internal: null, external: null }, '')).toBeNull()
  })
})

describe('sourceLineToContractLine', () => {
  it('maps a purchase-order line, freezing its provenance', () => {
    const line = sourceLineToContractLine(
      {
        id: 'line-1',
        product_id: 'product-1',
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
      'sales_quote',
      'now',
    )
    expect(line).toMatchObject({
      productId: 'product-3',
      name: 'Widget',
      unit: 'PCS',
      quantity: '2',
      unitPrice: '9.75',
      note: 'gift wrap',
      sourceSnapshot: { kind: 'order_line', id: 'line-3', orderKind: 'sales_quote', copiedAt: 'now' },
    })

    const snapshotOnly = sourceLineToContractLine(
      { id: 'line-4', name: 'Legacy', catalog_snapshot: { sku: 'OLD-1', unit: 'SET' } },
      'sales_order',
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
