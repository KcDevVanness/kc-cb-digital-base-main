import { describe, expect, it } from '@jest/globals'
import {
  aggregateRefundStatus,
  allocateTaxRefund,
  buildContainerChecklist,
  buildOrderChecklist,
  computeFinanceView,
  deriveBusinessStatus,
  selectKcContract,
  selectSubsidiaryInvoice,
  sumAllocationShares,
  type AllocationOrder,
  type ContractRow,
  type InvoiceRow,
} from '../fileRules'

function contract(overrides: Partial<ContractRow>): ContractRow {
  return {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    direction: 'sales',
    status: 'issued',
    sourceKind: 'purchase_order',
    sourceId: 'order-1',
    financeTotal: '70000.0000',
    currencyCode: 'CNY',
    exchangeRate: null,
    attachmentId: null,
    generatedAttachmentId: null,
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

function invoice(overrides: Partial<InvoiceRow>): InvoiceRow {
  return {
    id: 'bbbbbbbb-0000-0000-0000-000000000001',
    contractId: 'aaaaaaaa-0000-0000-0000-000000000001',
    direction: 'outbound',
    status: 'confirmed',
    total: '9800.0000',
    currencyCode: 'USD',
    attachmentId: null,
    issuedAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
    ...overrides,
  }
}

function order(purchaseOrderId: string, number: string, total: string): AllocationOrder {
  return { purchaseOrderId, number, total }
}

describe('deriveBusinessStatus', () => {
  it('walks the order status when nothing has shipped', () => {
    expect(deriveBusinessStatus({ poStatus: 'draft', pickedUp: false, departed: false })).toBe('draft')
    expect(deriveBusinessStatus({ poStatus: 'placed', pickedUp: false, departed: false })).toBe('placed')
  })

  it('reports factory pickup as soon as a container is picked up', () => {
    expect(deriveBusinessStatus({ poStatus: 'placed', pickedUp: true, departed: false })).toBe('factory_pickup')
  })

  it('lets the milestone win only while the order is still placed', () => {
    // A closed order with a late milestone row must not fall back to factory_pickup.
    expect(deriveBusinessStatus({ poStatus: 'closed', pickedUp: true, departed: true })).toBe('closed')
  })

  it('reports shipped from either the order status or an actual departure', () => {
    expect(deriveBusinessStatus({ poStatus: 'placed', pickedUp: true, departed: true })).toBe('shipped')
    expect(deriveBusinessStatus({ poStatus: 'shipped', pickedUp: false, departed: false })).toBe('shipped')
  })

  it('keeps cancelled and received above the shipment signals', () => {
    expect(deriveBusinessStatus({ poStatus: 'cancelled', pickedUp: true, departed: true })).toBe('cancelled')
    expect(deriveBusinessStatus({ poStatus: 'received', pickedUp: true, departed: true })).toBe('received')
  })

  it('falls back to draft for an unknown order status', () => {
    expect(deriveBusinessStatus({ poStatus: 'mystery', pickedUp: false, departed: false })).toBe('draft')
  })
})

describe('computeFinanceView', () => {
  const base = {
    total: '6000.0000',
    depositAmount: null,
    depositPercent: null,
    currencyScale: 2,
    paymentAmounts: [] as string[],
    kcPriceAmount: null,
    kcPriceCurrency: null,
    subsidiaryInvoiceAmount: null,
    subsidiaryInvoiceCurrency: null,
    exchangeRate: null,
  }

  it('derives the planned deposit from the percentage and the balance from the total', () => {
    const view = computeFinanceView({ ...base, depositPercent: '20.000' })
    expect(view.orderAmount).toBe('6000.00')
    expect(view.depositPlanned).toBe('1200.00')
    expect(view.balancePlanned).toBe('4800.00')
  })

  it('prefers an explicit deposit amount over the percentage', () => {
    const view = computeFinanceView({ ...base, depositAmount: '1500.0000', depositPercent: '20.000' })
    expect(view.depositPlanned).toBe('1500.00')
    expect(view.balancePlanned).toBe('4500.00')
  })

  it('leaves the deposit plan null when neither form is set', () => {
    const view = computeFinanceView(base)
    expect(view.depositPlanned).toBeNull()
    expect(view.balancePlanned).toBeNull()
  })

  it('computes paid and outstanding from the payment rows only', () => {
    const view = computeFinanceView({ ...base, paymentAmounts: ['1200.0000', '800.0000'] })
    expect(view.paidAmount).toBe('2000.00')
    expect(view.outstandingAmount).toBe('4000.00')
  })

  it('shows an overpayment as a negative outstanding amount instead of hiding it', () => {
    const view = computeFinanceView({ ...base, paymentAmounts: ['6500.0000'] })
    expect(view.outstandingAmount).toBe('-500.00')
  })

  it('rounds the deposit percentage half-up at the currency scale', () => {
    const view = computeFinanceView({ ...base, total: '6000.0050', depositPercent: '30.000', currencyScale: 2 })
    expect(view.depositPlanned).toBe('1800.00')
    const odd = computeFinanceView({ ...base, total: '100.0000', depositPercent: '33.333', currencyScale: 2 })
    expect(odd.depositPlanned).toBe('33.33')
  })

  it('keeps the KC price and the subsidiary invoice null when no document exists', () => {
    const view = computeFinanceView(base)
    expect(view.kcPriceAmount).toBeNull()
    expect(view.kcPriceCurrency).toBeNull()
    expect(view.subsidiaryInvoiceAmount).toBeNull()
    expect(view.subsidiaryInvoiceCurrency).toBeNull()
    expect(view.exchangeRate).toBeNull()
  })

  it('carries the currency of each amount it reports', () => {
    const view = computeFinanceView({
      ...base,
      kcPriceAmount: '70000.0000',
      kcPriceCurrency: 'CNY',
      subsidiaryInvoiceAmount: '9800.0000',
      subsidiaryInvoiceCurrency: 'USD',
      exchangeRate: '7.10000000',
    })
    expect(view.kcPriceAmount).toBe('70000.00')
    expect(view.kcPriceCurrency).toBe('CNY')
    expect(view.subsidiaryInvoiceAmount).toBe('9800.00')
    expect(view.subsidiaryInvoiceCurrency).toBe('USD')
    expect(view.exchangeRate).toBe('7.10000000')
  })
})

describe('allocateTaxRefund', () => {
  it('splits the container amount by purchase share', () => {
    const shares = allocateTaxRefund({
      refundAmount: '1000.0000',
      orders: [order('o1', 'PO-1', '6000.0000'), order('o2', 'PO-2', '4000.0000')],
    })
    expect(shares.get('o1')).toBe('600.00')
    expect(shares.get('o2')).toBe('400.00')
  })

  it('puts a one-cent remainder on the largest share', () => {
    const shares = allocateTaxRefund({
      refundAmount: '1000.0100',
      orders: [order('o1', 'PO-1', '6000.0000'), order('o2', 'PO-2', '4000.0000')],
    })
    expect(shares.get('o1')).toBe('600.01')
    expect(shares.get('o2')).toBe('400.00')
  })

  it('breaks a tie on the lowest order number', () => {
    const shares = allocateTaxRefund({
      refundAmount: '1000.0000',
      orders: [order('o2', 'PO-2', '1000.0000'), order('o1', 'PO-1', '1000.0000'), order('o3', 'PO-3', '1000.0000')],
    })
    // Each exact share is 333.333…, so the HALF_UP shares are 333.33 and the remaining cent lands
    // on the tie winner — the lowest order number, whatever order the rows arrived in.
    expect(shares.get('o1')).toBe('333.34')
    expect(shares.get('o2')).toBe('333.33')
    expect(shares.get('o3')).toBe('333.33')
    const totalCents = Array.from(shares.values()).reduce((sum, value) => sum + Math.round(Number(value) * 100), 0)
    expect(totalCents).toBe(100000)
  })

  it('keeps the allocations summing to the container amount', () => {
    const shares = allocateTaxRefund({
      refundAmount: '1234.5600',
      orders: [order('o1', 'PO-1', '3333.3300'), order('o2', 'PO-2', '1111.1100'), order('o3', 'PO-3', '7777.7700')],
    })
    const totalCents = Array.from(shares.values()).reduce((sum, value) => sum + Math.round(Number(value) * 100), 0)
    expect(totalCents).toBe(123456)
  })

  it('allocates nothing when every order total is zero', () => {
    const shares = allocateTaxRefund({
      refundAmount: '1000.0000',
      orders: [order('o1', 'PO-1', '0.0000'), order('o2', 'PO-2', '0.0000')],
    })
    expect(shares.get('o1')).toBeNull()
    expect(shares.get('o2')).toBeNull()
  })

  it('allocates nothing when the container has no refund amount or no orders', () => {
    expect(allocateTaxRefund({ refundAmount: null, orders: [order('o1', 'PO-1', '100.0000')] }).get('o1')).toBeNull()
    expect(allocateTaxRefund({ refundAmount: '1000.0000', orders: [] }).size).toBe(0)
  })
})

describe('sumAllocationShares', () => {
  it('sums the per-container shares of one order', () => {
    expect(sumAllocationShares(['600.00', '400.00'])).toBe('1000.00')
    expect(sumAllocationShares(['0.01'])).toBe('0.01')
  })

  it('stays null when no container could be allocated', () => {
    expect(sumAllocationShares([])).toBeNull()
    expect(sumAllocationShares([null, null])).toBeNull()
  })

  it('ignores the containers without an amount but keeps the ones with one', () => {
    expect(sumAllocationShares([null, '250.50'])).toBe('250.50')
  })
})

describe('aggregateRefundStatus', () => {
  it('answers unknown when the order has no container record', () => {
    expect(aggregateRefundStatus([])).toBe('unknown')
  })

  it('reports the least advanced status', () => {
    expect(aggregateRefundStatus(['completed', 'applied'])).toBe('applied')
    expect(aggregateRefundStatus(['completed', 'completed'])).toBe('completed')
    expect(aggregateRefundStatus(['not_started', 'applied'])).toBe('not_started')
    expect(aggregateRefundStatus(['unknown', 'completed'])).toBe('unknown')
  })

  it('treats an unrankable stored value as unknown rather than as progress', () => {
    expect(aggregateRefundStatus(['completed', 'mystery'])).toBe('unknown')
  })
})

describe('selectKcContract', () => {
  it('takes the most recently updated matching sales contract', () => {
    const older = contract({ id: 'c1', updatedAt: '2026-09-01T00:00:00.000Z' })
    const newer = contract({ id: 'c2', updatedAt: '2026-09-05T00:00:00.000Z' })
    expect(selectKcContract([older, newer], 'order-1')?.id).toBe('c2')
  })

  it('excludes cancelled contracts, other orders, and purchase direction', () => {
    const cancelled = contract({ id: 'c1', status: 'cancelled', updatedAt: '2026-09-09T00:00:00.000Z' })
    const otherOrder = contract({ id: 'c2', sourceId: 'order-2', updatedAt: '2026-09-08T00:00:00.000Z' })
    const purchase = contract({ id: 'c3', direction: 'purchase', updatedAt: '2026-09-07T00:00:00.000Z' })
    expect(selectKcContract([cancelled, otherOrder, purchase], 'order-1')).toBeNull()
  })
})

describe('selectSubsidiaryInvoice', () => {
  it('takes the newest issued outbound invoice of the contract', () => {
    const older = invoice({ id: 'i1', issuedAt: '2026-09-01T00:00:00.000Z' })
    const newer = invoice({ id: 'i2', issuedAt: '2026-09-20T00:00:00.000Z' })
    expect(selectSubsidiaryInvoice([older, newer], older.contractId)?.id).toBe('i2')
  })

  it('falls back to the update time when no issue date is recorded', () => {
    const undated = invoice({ id: 'i1', issuedAt: null, updatedAt: '2026-09-01T00:00:00.000Z' })
    const newer = invoice({ id: 'i2', issuedAt: null, updatedAt: '2026-09-02T00:00:00.000Z' })
    expect(selectSubsidiaryInvoice([undated, newer], undated.contractId)?.id).toBe('i2')
  })

  it('excludes void invoices, inbound invoices and other contracts', () => {
    const voided = invoice({ id: 'i1', status: 'void', issuedAt: '2026-09-30T00:00:00.000Z' })
    const inbound = invoice({ id: 'i2', direction: 'inbound', issuedAt: '2026-09-29T00:00:00.000Z' })
    const otherContract = invoice({ id: 'i3', contractId: 'cccccccc-0000-0000-0000-000000000009' })
    expect(selectSubsidiaryInvoice([voided, inbound, otherContract], voided.contractId)).toBeNull()
    expect(selectSubsidiaryInvoice([voided], null)).toBeNull()
  })
})

describe('buildOrderChecklist', () => {
  const empty = {
    purchaseDocuments: [],
    purchaseContract: null,
    salesContract: null,
    kcInvoices: [],
    exportDocuments: [],
    collectionDocuments: [],
  }

  it('marks every item missing for an undocumented order', () => {
    const { checklist, checklistMissing } = buildOrderChecklist(empty)
    expect(checklistMissing).toHaveLength(12)
    expect(checklist.supplierInvoice).toBe(false)
    expect(checklist.bookingCharges).toBe(false)
  })

  it('counts a document type once even when several files of it exist', () => {
    const { checklist } = buildOrderChecklist({
      ...empty,
      purchaseDocuments: [
        { docType: 'purchase_payment_receipt', attachmentId: 'file-1' },
        { docType: 'purchase_payment_receipt', attachmentId: 'file-2' },
      ],
    })
    expect(checklist.purchasePaymentReceipt).toBe(true)
    expect(checklist.supplierInvoice).toBe(false)
  })

  it('does not count a document row that has no file', () => {
    const { checklist, checklistMissing } = buildOrderChecklist({
      ...empty,
      purchaseDocuments: [{ docType: 'supplier_invoice', attachmentId: null }],
    })
    expect(checklist.supplierInvoice).toBe(false)
    expect(checklistMissing).toContain('supplierInvoice')
  })

  it('counts a contract from its stamp scan or its generated file', () => {
    const withScan = buildOrderChecklist({ ...empty, purchaseContract: contract({ attachmentId: 'file-1' }) })
    expect(withScan.checklist.purchaseContract).toBe(true)
    const withGenerated = buildOrderChecklist({ ...empty, salesContract: contract({ generatedAttachmentId: 'file-2' }) })
    expect(withGenerated.checklist.salesContract).toBe(true)
    const withNeither = buildOrderChecklist({ ...empty, salesContract: contract({}) })
    expect(withNeither.checklist.salesContract).toBe(false)
  })

  it('counts the KC invoice only when a non-void invoice carries a scan', () => {
    const withScan = buildOrderChecklist({ ...empty, kcInvoices: [invoice({ attachmentId: 'file-1' })] })
    expect(withScan.checklist.kcInvoiceStamped).toBe(true)
    const withoutScan = buildOrderChecklist({ ...empty, kcInvoices: [invoice({})] })
    expect(withoutScan.checklist.kcInvoiceStamped).toBe(false)
  })

  it('keeps the purchase keys and the export keys separate', () => {
    const { checklist } = buildOrderChecklist({
      ...empty,
      exportDocuments: [{ docType: 'so', attachmentId: 'file-1' }],
    })
    expect(checklist.so).toBe(true)
    expect(checklist.supplierInvoice).toBe(false)
    // Exactly the twelve order-level keys: no refund-application key leaks into the order set.
    expect(Object.keys(checklist)).toHaveLength(12)
  })

  it('lists only the still-missing keys', () => {
    const { checklistMissing } = buildOrderChecklist({
      ...empty,
      collectionDocuments: [{ docType: 'foreign_income_certificate', attachmentId: 'file-1' }],
      exportDocuments: [{ docType: 'so', attachmentId: 'file-2' }],
    })
    expect(checklistMissing).not.toContain('foreignIncomeCertificate')
    expect(checklistMissing).not.toContain('so')
    expect(checklistMissing).toContain('customsDeclaration')
    expect(checklistMissing).toHaveLength(10)
  })
})

describe('buildContainerChecklist', () => {
  it('marks the seven items and keeps the refund keys out of the order set', () => {
    const { checklist, checklistMissing } = buildContainerChecklist({
      exportDocuments: [{ docType: 'customs_declaration', attachmentId: 'file-1' }],
      refundDocuments: [{ docType: 'report_draft', attachmentId: 'file-2' }],
    })
    expect(checklist.customsDeclaration).toBe(true)
    expect(checklist.reportDraft).toBe(true)
    expect(checklist.taxRefundPackage).toBe(false)
    expect(checklist.so).toBe(false)
    expect(checklistMissing).toEqual(['so', 'telexRelease', 'domesticFreight', 'bookingCharges', 'taxRefundPackage'])
  })

  it('does not count a refund document without a file', () => {
    const { checklist } = buildContainerChecklist({
      exportDocuments: [],
      refundDocuments: [{ docType: 'tax_refund_package', attachmentId: null }],
    })
    expect(checklist.taxRefundPackage).toBe(false)
  })
})
