import { describe, expect, it } from '@jest/globals'
import {
  mergeOrderRows,
  slicePage,
  sumTotals,
  toPurchaseOrderRow,
  toSalesOrderRow,
  type OrderRow,
  type OrderSourceWindow,
} from '../mergeOrders'

/**
 * The workbench's server-side merge, pinned directly instead of through the screen.
 *
 * Ordering, dedupe and truncation decide which rows land on which page, so each rule is asserted —
 * including the source-order tiebreak the pagination depends on.
 */

function row(overrides: Partial<OrderRow> & Pick<OrderRow, 'id' | 'source' | 'createdAt'>): OrderRow {
  return {
    number: null,
    counterparty: null,
    currencyCode: 'CNY',
    total: '0',
    status: null,
    lineCount: 0,
    stages: null,
    ...overrides,
  }
}

function window(source: OrderRow['source'], rows: OrderRow[], total = rows.length): OrderSourceWindow {
  return { source, rows, total }
}

describe('mergeOrderRows', () => {
  it('orders the union newest-first across sources', () => {
    const merged = mergeOrderRows(
      [
        window('internal_sales', [
          row({ id: 'b', source: 'internal_sales', createdAt: '2026-10-02T00:00:00.000Z' }),
          row({ id: 'e', source: 'internal_sales', createdAt: '2026-10-05T00:00:00.000Z' }),
        ]),
        window('external_sales', [
          row({ id: 'c', source: 'external_sales', createdAt: '2026-10-03T00:00:00.000Z' }),
        ]),
        window('purchase_order', [
          row({ id: 'a', source: 'purchase_order', createdAt: '2026-10-01T00:00:00.000Z' }),
          row({ id: 'd', source: 'purchase_order', createdAt: '2026-10-04T00:00:00.000Z' }),
        ]),
      ],
      Number.POSITIVE_INFINITY,
    )
    expect(merged.map((entry) => entry.id)).toEqual(['e', 'd', 'c', 'b', 'a'])
  })

  it('keeps a row without a timestamp last', () => {
    const merged = mergeOrderRows(
      [
        window('internal_sales', [
          row({ id: 'no-date', source: 'internal_sales', createdAt: null }),
          row({ id: 'dated', source: 'internal_sales', createdAt: '2026-10-01T00:00:00.000Z' }),
        ]),
      ],
      Number.POSITIVE_INFINITY,
    )
    expect(merged.map((entry) => entry.id)).toEqual(['dated', 'no-date'])
  })

  it('drops duplicate ids, keeping the occurrence from the earlier source', () => {
    const merged = mergeOrderRows(
      [
        window('internal_sales', [
          row({ id: 'shared', source: 'internal_sales', createdAt: '2026-10-02T00:00:00.000Z', counterparty: 'first' }),
        ]),
        window('purchase_order', [
          row({ id: 'shared', source: 'purchase_order', createdAt: '2026-10-03T00:00:00.000Z', counterparty: 'second' }),
        ]),
      ],
      Number.POSITIVE_INFINITY,
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]?.source).toBe('internal_sales')
    expect(merged[0]?.counterparty).toBe('first')
  })

  it('returns only the first `requested` rows of the merged order', () => {
    const sources = [
      window('internal_sales', [
        row({ id: 'a', source: 'internal_sales', createdAt: '2026-10-03T00:00:00.000Z' }),
        row({ id: 'b', source: 'internal_sales', createdAt: '2026-10-02T00:00:00.000Z' }),
      ]),
      window('purchase_order', [
        row({ id: 'c', source: 'purchase_order', createdAt: '2026-10-01T00:00:00.000Z' }),
      ]),
    ]
    const all = mergeOrderRows(sources, Number.POSITIVE_INFINITY).map((entry) => entry.id)
    const firstTwo = mergeOrderRows(sources, 2).map((entry) => entry.id)
    expect(firstTwo).toEqual(all.slice(0, 2))
  })

  it('returns nothing when asked for no rows', () => {
    const sources = [window('purchase_order', [row({ id: 'a', source: 'purchase_order', createdAt: '2026-10-01T00:00:00.000Z' })])]
    expect(mergeOrderRows(sources, 0)).toEqual([])
  })
})

describe('slicePage', () => {
  const rows = ['a', 'b', 'c', 'd', 'e']

  it('slices by page and pageSize', () => {
    expect(slicePage(rows, 1, 2)).toEqual(['a', 'b'])
    expect(slicePage(rows, 2, 2)).toEqual(['c', 'd'])
    expect(slicePage(rows, 3, 2)).toEqual(['e'])
  })

  it('returns an empty page past the end instead of clamping to the last page', () => {
    expect(slicePage(rows, 4, 2)).toEqual([])
    expect(slicePage([], 1, 20)).toEqual([])
  })
})

describe('sumTotals', () => {
  it('adds the sources’ own totals', () => {
    expect(sumTotals([{ total: 3 }, { total: 4 }, { total: 0 }])).toBe(7)
    expect(sumTotals([])).toBe(0)
  })

  it('treats a non-finite total as zero rather than poisoning the sum', () => {
    expect(sumTotals([{ total: 5 }, { total: Number.NaN }])).toBe(5)
  })
})

describe('toSalesOrderRow', () => {
  it('reads the installed sales projection, including the decrypted buyer name', () => {
    const mapped = toSalesOrderRow(
      {
        id: '11111111-1111-4111-8111-111111111111',
        orderNumber: 'SO-1',
        customerSnapshot: { name: 'Buyer One' },
        currencyCode: 'USD',
        grandTotalNetAmount: 1200.5,
        status: 'confirmed',
        createdAt: '2026-10-01T00:00:00.000Z',
        lineItemCount: 3,
      },
      'internal_sales',
    )
    expect(mapped).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      source: 'internal_sales',
      number: 'SO-1',
      counterparty: 'Buyer One',
      currencyCode: 'USD',
      total: '1200.5',
      status: 'confirmed',
      createdAt: '2026-10-01T00:00:00.000Z',
      lineCount: 3,
      stages: null,
    })
  })

  it('reads the snake_case projection and falls back to the gross amount', () => {
    const mapped = toSalesOrderRow(
      {
        id: '22222222-2222-4222-8222-222222222222',
        order_number: 'SO-2',
        customer_snapshot: { name: 'Buyer Two' },
        currency_code: 'EUR',
        grandTotalGrossAmount: 99,
        created_at: '2026-10-02T00:00:00.000Z',
        line_item_count: 1,
      },
      'external_sales',
    )
    expect(mapped.number).toBe('SO-2')
    expect(mapped.counterparty).toBe('Buyer Two')
    expect(mapped.currencyCode).toBe('EUR')
    expect(mapped.total).toBe('99')
    expect(mapped.createdAt).toBe('2026-10-02T00:00:00.000Z')
    expect(mapped.lineCount).toBe(1)
    expect(mapped.source).toBe('external_sales')
  })

  it('nulls a missing or null buyer snapshot and defaults the money columns', () => {
    const missing = toSalesOrderRow({ id: '33333333-3333-4333-8333-333333333333' }, 'internal_sales')
    expect(missing.counterparty).toBeNull()
    expect(missing.currencyCode).toBe('CNY')
    expect(missing.total).toBe('0')
    expect(missing.number).toBeNull()
    expect(missing.status).toBeNull()
    expect(missing.createdAt).toBeNull()

    const nulled = toSalesOrderRow(
      { id: '44444444-4444-4444-8444-444444444444', customerSnapshot: null },
      'external_sales',
    )
    expect(nulled.counterparty).toBeNull()
  })
})

describe('toPurchaseOrderRow', () => {
  it('reads the purchase list projection', () => {
    const mapped = toPurchaseOrderRow({
      id: '55555555-5555-4555-8555-555555555555',
      number: 'PO-1',
      supplierName: 'Supplier One',
      currencyCode: 'CNY',
      total: '800.00',
      status: 'placed',
      created_at: '2026-10-03T00:00:00.000Z',
    })
    expect(mapped).toEqual({
      id: '55555555-5555-4555-8555-555555555555',
      source: 'purchase_order',
      number: 'PO-1',
      counterparty: 'Supplier One',
      currencyCode: 'CNY',
      total: '800.00',
      status: 'placed',
      createdAt: '2026-10-03T00:00:00.000Z',
      lineCount: 0,
      stages: null,
    })
  })

  it('defaults the currency and the snake_case supplier name', () => {
    const mapped = toPurchaseOrderRow({
      id: '66666666-6666-4666-8666-666666666666',
      supplier_name: 'Supplier Two',
    })
    expect(mapped.counterparty).toBe('Supplier Two')
    expect(mapped.currencyCode).toBe('CNY')
    expect(mapped.total).toBe('0')
    expect(mapped.number).toBeNull()
  })
})
