import { describe, expect, it } from '@jest/globals'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { linkedRecordPreviewSource, type LinkedRecordPreviewKind } from '../linkedRecordPreviewSources'

/**
 * The preview drawer's field mapping, one fixture per kind.
 *
 * This catches a wrong field name: each fixture speaks the same wire shape the owning module's list
 * route emits (camelCase projection first), and the test pins which of those fields reach which
 * labelled row. It never touches the reads, so a route rename is not exercised here — only the
 * mapper that the drawer renders through.
 */

/** The drawer's translate function; the key comes back unchanged so labels and status keys are visible. */
const t: TranslateFn = (key) => key

type ExpectedValue = string | null | { amount: string; currencyCode: string }

type KindCase = {
  kind: LinkedRecordPreviewKind
  record: Record<string, unknown>
  labels: string[]
  values: Record<string, ExpectedValue>
}

const KIND_CASES: KindCase[] = [
  {
    kind: 'purchase_order',
    record: {
      number: 'PO-2026-0001',
      businessNumber: 'BO-2026-0001',
      supplierName: 'Acme Supplies',
      ownerName: 'Li Wei',
      customerName: 'Overseas Buyer',
      productCategory: 'home_goods',
      status: 'placed',
      placedAt: '2026-02-03T10:00:00.000Z',
      expectedShipAt: '2026-03-15',
      currencyCode: 'USD',
      total: '1000.0000',
      paidTotal: '300.0000',
      outstanding: '700.0000',
      notes: 'ship together',
    },
    labels: [
      'order_hub.preview.field.number',
      'order_hub.preview.field.businessNumber',
      'order_hub.preview.field.supplier',
      'order_hub.preview.field.owner',
      'order_hub.preview.field.customer',
      'order_hub.preview.field.orderDescription',
      'order_hub.preview.field.status',
      'order_hub.preview.field.placedAt',
      'order_hub.preview.field.expectedDelivery',
      'order_hub.preview.field.currency',
      'order_hub.preview.field.orderAmount',
      'order_hub.preview.field.deposit',
      'order_hub.preview.field.paid',
      'order_hub.preview.field.outstanding',
      'order_hub.preview.field.notes',
    ],
    values: {
      'order_hub.preview.field.number': 'PO-2026-0001',
      'order_hub.preview.field.businessNumber': 'BO-2026-0001',
      'order_hub.preview.field.supplier': 'Acme Supplies',
      'order_hub.preview.field.owner': 'Li Wei',
      'order_hub.preview.field.customer': 'Overseas Buyer',
      'order_hub.preview.field.orderDescription': 'home_goods',
      'order_hub.preview.field.status': 'purchasing.orders.status.placed',
      'order_hub.preview.field.placedAt': '2026-02-03',
      'order_hub.preview.field.expectedDelivery': '2026-03-15',
      'order_hub.preview.field.currency': 'USD',
      'order_hub.preview.field.orderAmount': { amount: '1000.0000', currencyCode: 'USD' },
      // No deposit on this order: the drawer prints its shared 「—」 fallback.
      'order_hub.preview.field.deposit': null,
      'order_hub.preview.field.paid': { amount: '300.0000', currencyCode: 'USD' },
      'order_hub.preview.field.outstanding': { amount: '700.0000', currencyCode: 'USD' },
      'order_hub.preview.field.notes': 'ship together',
    },
  },
  {
    kind: 'internal_sales_order',
    record: {
      orderNumber: 'SO-2026-0007',
      customerSnapshot: { name: 'Acme Buyer' },
      status: 'confirmed',
      currencyCode: 'USD',
      grandTotalNetAmount: 2500,
      placedAt: '2026-02-05T00:00:00.000Z',
      comment: 'urgent',
    },
    labels: [
      'order_hub.preview.field.number',
      'order_hub.preview.field.buyer',
      'order_hub.preview.field.status',
      'order_hub.preview.field.currency',
      'order_hub.preview.field.total',
      'order_hub.preview.field.placedAt',
      'order_hub.preview.field.notes',
    ],
    values: {
      'order_hub.preview.field.number': 'SO-2026-0007',
      'order_hub.preview.field.buyer': 'Acme Buyer',
      'order_hub.preview.field.status': 'confirmed',
      'order_hub.preview.field.currency': 'USD',
      'order_hub.preview.field.total': { amount: '2500', currencyCode: 'USD' },
      'order_hub.preview.field.placedAt': '2026-02-05',
      'order_hub.preview.field.notes': 'urgent',
    },
  },
  {
    kind: 'external_sales_order',
    record: {
      orderNumber: 'SO-2026-0008',
      customerSnapshot: { name: 'Export Buyer' },
      status: 'draft',
      currencyCode: 'CNY',
      grandTotalNetAmount: 900,
      placedAt: '2026-02-06T00:00:00.000Z',
      comment: null,
    },
    labels: [
      'order_hub.preview.field.number',
      'order_hub.preview.field.buyer',
      'order_hub.preview.field.status',
      'order_hub.preview.field.currency',
      'order_hub.preview.field.total',
      'order_hub.preview.field.placedAt',
      'order_hub.preview.field.notes',
    ],
    values: {
      'order_hub.preview.field.number': 'SO-2026-0008',
      'order_hub.preview.field.buyer': 'Export Buyer',
      'order_hub.preview.field.status': 'draft',
      'order_hub.preview.field.currency': 'CNY',
      'order_hub.preview.field.total': { amount: '900', currencyCode: 'CNY' },
      'order_hub.preview.field.placedAt': '2026-02-06',
      'order_hub.preview.field.notes': null,
    },
  },
  {
    kind: 'contract',
    record: {
      number: 'CT-2026-0001',
      counterpartyKind: 'supplier',
      counterpartyName: 'Acme Supplies',
      status: 'signed',
      currencyCode: 'CNY',
      contractTotal: '5000.0000',
      signedAt: '2026-01-20',
      notes: 'signed copy filed',
    },
    labels: [
      'order_hub.preview.field.number',
      'order_hub.preview.field.counterpartyKind',
      'order_hub.preview.field.counterparty',
      'order_hub.preview.field.status',
      'order_hub.preview.field.currency',
      'order_hub.preview.field.total',
      'order_hub.preview.field.date',
      'order_hub.preview.field.notes',
    ],
    values: {
      'order_hub.preview.field.number': 'CT-2026-0001',
      'order_hub.preview.field.counterpartyKind': 'trade_docs.contracts.form.counterpartyKind.supplier',
      'order_hub.preview.field.counterparty': 'Acme Supplies',
      'order_hub.preview.field.status': 'trade_docs.contracts.status.signed',
      'order_hub.preview.field.currency': 'CNY',
      'order_hub.preview.field.total': { amount: '5000.0000', currencyCode: 'CNY' },
      'order_hub.preview.field.date': '2026-01-20',
      'order_hub.preview.field.notes': 'signed copy filed',
    },
  },
  {
    kind: 'document',
    record: {
      kind: 'commercial',
      number: 'CI-2026-0002',
      status: 'issued',
      currencyCode: 'USD',
      total: '1200.0000',
      issuedAt: '2026-02-10',
      notes: 'three copies',
    },
    labels: [
      'order_hub.preview.field.kind',
      'order_hub.preview.field.number',
      'order_hub.preview.field.status',
      'order_hub.preview.field.currency',
      'order_hub.preview.field.total',
      'order_hub.preview.field.date',
      'order_hub.preview.field.notes',
    ],
    values: {
      'order_hub.preview.field.kind': 'trade_docs.documents.kind.commercial',
      'order_hub.preview.field.number': 'CI-2026-0002',
      'order_hub.preview.field.status': 'trade_docs.documents.status.issued',
      'order_hub.preview.field.currency': 'USD',
      'order_hub.preview.field.total': { amount: '1200.0000', currencyCode: 'USD' },
      'order_hub.preview.field.date': '2026-02-10',
      'order_hub.preview.field.notes': 'three copies',
    },
  },
  {
    kind: 'tax_invoice',
    record: {
      number: 'INV-2026-0003',
      status: 'confirmed',
      currencyCode: 'CNY',
      total: '880.0000',
      issuedAt: '2026-02-12',
    },
    labels: [
      'order_hub.preview.field.number',
      'order_hub.preview.field.status',
      'order_hub.preview.field.currency',
      'order_hub.preview.field.amount',
      'order_hub.preview.field.invoicedAt',
    ],
    values: {
      'order_hub.preview.field.number': 'INV-2026-0003',
      'order_hub.preview.field.status': 'trade_docs.invoices.status.confirmed',
      'order_hub.preview.field.currency': 'CNY',
      'order_hub.preview.field.amount': { amount: '880.0000', currencyCode: 'CNY' },
      'order_hub.preview.field.invoicedAt': '2026-02-12',
    },
  },
  {
    kind: 'shipment',
    record: {
      number: 'SH-2026-0001',
      status: 'in_transit',
      containerNumber: 'MSCU1234567',
      sealNumber: 'SL-9',
      bookingNumber: 'BK-77',
      carrierName: 'Maersk',
      etd: '2026-03-01T00:00:00.000Z',
      eta: '2026-03-20T00:00:00.000Z',
    },
    labels: [
      'order_hub.preview.field.number',
      'order_hub.preview.field.status',
      'order_hub.preview.field.containerNumber',
      'order_hub.preview.field.sealNumber',
      'order_hub.preview.field.bookingNumber',
      'order_hub.preview.field.carrier',
      'order_hub.preview.field.etd',
      'order_hub.preview.field.eta',
    ],
    values: {
      'order_hub.preview.field.number': 'SH-2026-0001',
      'order_hub.preview.field.status': 'cross_border.shipments.status.in_transit',
      'order_hub.preview.field.containerNumber': 'MSCU1234567',
      'order_hub.preview.field.sealNumber': 'SL-9',
      'order_hub.preview.field.bookingNumber': 'BK-77',
      'order_hub.preview.field.carrier': 'Maersk',
      'order_hub.preview.field.etd': '2026-03-01',
      'order_hub.preview.field.eta': '2026-03-20',
    },
  },
  {
    kind: 'packing_list',
    record: {
      documentNumber: 'PL-2026-0001',
      // The route's row names its shipment by id; no second read spends on the number.
      shipmentId: 'ship-2026-0001',
      issuedAt: '2026-03-02T00:00:00.000Z',
    },
    labels: [
      'order_hub.preview.field.number',
      'order_hub.preview.field.shipment',
      'order_hub.preview.field.issuedAt',
    ],
    values: {
      'order_hub.preview.field.number': 'PL-2026-0001',
      'order_hub.preview.field.shipment': 'ship-2026-0001',
      'order_hub.preview.field.issuedAt': '2026-03-02',
    },
  },
  {
    kind: 'collection',
    record: {
      purchaseOrderNumber: 'PO-2026-0001',
      collectionStatus: 'received',
      amount: '1000.0000',
      currencyCode: 'USD',
      // The mapper understands the fact; the archive route the preview reads does not carry it (see
      // the 「—」 test below). Kept here so the 是 / 否 branch stays pinned.
      foreignIncomeCertificate: true,
      receivedAt: '2026-04-01',
    },
    labels: [
      'order_hub.preview.field.purchaseOrderNumber',
      'order_hub.preview.field.status',
      'order_hub.preview.field.amount',
      'order_hub.preview.field.currency',
      'order_hub.preview.field.foreignIncomeCertificate',
      'order_hub.preview.field.time',
    ],
    values: {
      'order_hub.preview.field.purchaseOrderNumber': 'PO-2026-0001',
      'order_hub.preview.field.status': 'export_finance.collection.status.received',
      'order_hub.preview.field.amount': { amount: '1000.0000', currencyCode: 'USD' },
      'order_hub.preview.field.currency': 'USD',
      'order_hub.preview.field.foreignIncomeCertificate': 'order_hub.preview.value.yes',
      'order_hub.preview.field.time': '2026-04-01',
    },
  },
  {
    kind: 'refund',
    record: {
      shipmentNumber: 'SH-2026-0001',
      taxRefundStatus: 'applied',
      taxRefundAmount: '300.0000',
      currencyCode: 'CNY',
    },
    labels: [
      'order_hub.preview.field.shipmentNumber',
      'order_hub.preview.field.status',
      'order_hub.preview.field.taxRefundAmount',
      'order_hub.preview.field.currency',
    ],
    values: {
      'order_hub.preview.field.shipmentNumber': 'SH-2026-0001',
      'order_hub.preview.field.status': 'export_finance.refund.status.applied',
      'order_hub.preview.field.taxRefundAmount': { amount: '300.0000', currencyCode: 'CNY' },
      'order_hub.preview.field.currency': 'CNY',
    },
  },
]

describe('linkedRecordPreviewSource', () => {
  for (const testCase of KIND_CASES) {
    it(`maps the ${testCase.kind} head onto its labelled fields`, () => {
      const fields = linkedRecordPreviewSource(testCase.kind).fields(testCase.record, t)
      expect(fields.map((entry) => entry.label)).toEqual(testCase.labels)
      const mapped = new Map(fields.map((entry) => [entry.label, entry.value]))
      for (const [label, expected] of Object.entries(testCase.values)) {
        const actual = mapped.get(label)
        if (expected !== null && typeof expected === 'object') {
          // A money value is a `MoneyAmount` element; its props carry the figure and currency.
          expect(actual).toMatchObject({ props: expected })
        } else {
          expect(actual).toEqual(expected)
        }
      }
    })
  }

  it('reports a missing value as null so the drawer prints its 「—」 fallback', () => {
    const fields = linkedRecordPreviewSource('shipment').fields({ number: 'SH-1' }, t)
    const empty = fields.filter((entry) => entry.value === null)
    expect(empty.map((entry) => entry.label)).toEqual([
      'order_hub.preview.field.status',
      'order_hub.preview.field.containerNumber',
      'order_hub.preview.field.sealNumber',
      'order_hub.preview.field.bookingNumber',
      'order_hub.preview.field.carrier',
      'order_hub.preview.field.etd',
      'order_hub.preview.field.eta',
    ])
  })

  it('leaves 涉外收入证明 at 「—」 when the archive row carries no certificate fact', () => {
    const fields = linkedRecordPreviewSource('collection').fields(
      { purchaseOrderNumber: 'PO-1', collectionStatus: 'not_received' },
      t,
    )
    const certificate = fields.find((entry) => entry.label === 'order_hub.preview.field.foreignIncomeCertificate')
    expect(certificate?.value).toBeNull()
  })

  it('answers every declared kind with a readable source', () => {
    const kinds: LinkedRecordPreviewKind[] = [
      'purchase_order',
      'internal_sales_order',
      'external_sales_order',
      'contract',
      'document',
      'tax_invoice',
      'shipment',
      'packing_list',
      'collection',
      'refund',
    ]
    for (const kind of kinds) {
      const source = linkedRecordPreviewSource(kind)
      expect(typeof source.read).toBe('function')
      expect(typeof source.title).toBe('function')
      expect(typeof source.fields).toBe('function')
      expect(typeof source.openHref).toBe('function')
    }
  })

  it('falls back to the label and the order hub for an unknown kind instead of throwing', () => {
    const unknown = 'unknown_kind' as LinkedRecordPreviewKind
    const source = linkedRecordPreviewSource(unknown)
    expect(source.title({}, { kind: unknown, refId: 'x', label: 'FROZEN-1' }, t)).toBe('FROZEN-1')
    expect(source.subtitle?.({}, { kind: unknown, refId: 'x' }, t)).toBeNull()
    expect(source.fields({}, t)).toEqual([])
    expect(source.openHref({ kind: unknown, refId: 'x' })).toBe('/backend/orders')
  })

  it('sends a commercial document to the CI editor and a proforma to the PI editor', () => {
    const source = linkedRecordPreviewSource('document')
    expect(source.openHref({ kind: 'document', refId: 'd1', variant: 'commercial' }))
      .toBe('/backend/trade-docs/commercial-invoices/d1/edit')
    expect(source.openHref({ kind: 'document', refId: 'd2', variant: 'proforma' }))
      .toBe('/backend/trade-docs/proformas/d2/edit')
    expect(source.openHref({ kind: 'document', refId: 'd3' }))
      .toBe('/backend/trade-docs/proformas/d3/edit')
  })

  it('falls back to the frozen label for the title when the record carries no number', () => {
    const source = linkedRecordPreviewSource('contract')
    expect(source.title({}, { kind: 'contract', refId: 'x', label: 'CT-FROZEN' }, t)).toBe('CT-FROZEN')
  })
})
