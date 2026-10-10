import { describe, expect, it } from '@jest/globals'
import {
  primaryOrderAmount,
  resolveCodeListLabel,
  resolveHeaderSupplierName,
  snapshotDisplayName,
  toCompanyOrderHead,
  toOrderWorkbenchRow,
} from '../companyOrderDisplay'

/**
 * The workbench row's own-field read.
 *
 * The table answers the company order's header — the same fields the order page prints — so the row
 * parser must never borrow a child document's facts and must answer `null` (rendered as `—`) for a
 * field the root does not carry, instead of leaking `undefined` into a cell.
 */

describe('snapshotDisplayName', () => {
  it('prints the name frozen into a default-customer/supplier snapshot', () => {
    expect(snapshotDisplayName({ name: 'Acme Trading', code: 'BUY-1' })).toBe('Acme Trading')
  })

  it('answers null for a missing, blank or non-object snapshot', () => {
    expect(snapshotDisplayName(null)).toBeNull()
    expect(snapshotDisplayName(undefined)).toBeNull()
    expect(snapshotDisplayName({ name: '   ' })).toBeNull()
    expect(snapshotDisplayName({ name: 42 })).toBeNull()
    expect(snapshotDisplayName({ code: 'BUY-1' })).toBeNull()
    expect(snapshotDisplayName(['name'])).toBeNull()
    expect(snapshotDisplayName('name')).toBeNull()
  })
})

describe('toOrderWorkbenchRow', () => {
  it('reads the root’s own fields, including the frozen default counterparties', () => {
    const row = toOrderWorkbenchRow({
      id: '11111111-2222-3333-4444-555566667777',
      number: 'CO-2026-0007',
      title: '秋冬季订单',
      orderDate: '2026-10-09',
      etaDate: '2026-11-30',
      status: 'shipped',
      paymentStatus: 'paid_full',
      customerSnapshot: { name: '俄方客户', code: 'BUY-7' },
      supplierSnapshot: { name: '宁波供应商', code: 'SUP-3' },
      // Child facts the list read also returns: the row must not pick them up through the API
      // payload's shape — the stage projection decides what the workbench prints of them.
      childNumbers: ['PO-2026-0010'],
      counterparty: '宁波供应商',
    })

    expect(row).toEqual({
      id: '11111111-2222-3333-4444-555566667777',
      number: 'CO-2026-0007',
      title: '秋冬季订单',
      orderDate: '2026-10-09',
      etaDate: '2026-11-30',
      status: 'shipped',
      paymentStatus: 'paid_full',
      customerName: '俄方客户',
      supplierName: '宁波供应商',
      viewerIsCollaborator: false,
    })
  })

  it('answers null for absent fields and keeps an empty number over “undefined”', () => {
    const row = toOrderWorkbenchRow({ id: 'abc' })

    expect(row.number).toBe('')
    expect(row.title).toBeNull()
    expect(row.orderDate).toBeNull()
    expect(row.etaDate).toBeNull()
    expect(row.customerName).toBeNull()
    expect(row.supplierName).toBeNull()
    // A row written before the payment marker landed must answer `—`, not a story about its money.
    expect(row.paymentStatus).toBeNull()
    // A row whose status column is missing still has to render the fresh-order default.
    expect(row.status).toBe('placed')
  })

  it('never turns a non-string field into text', () => {
    const row = toOrderWorkbenchRow({ id: 'abc', number: 7, orderDate: 20261009, title: null, paymentStatus: 1 })

    expect(row.number).toBe('')
    expect(row.orderDate).toBeNull()
    expect(row.title).toBeNull()
    expect(row.paymentStatus).toBeNull()
  })

  it('marks a row as a collaborator only on an explicit list-read flag', () => {
    expect(toOrderWorkbenchRow({ id: 'abc', viewerIsCollaborator: true }).viewerIsCollaborator).toBe(true)
    expect(toOrderWorkbenchRow({ id: 'abc' }).viewerIsCollaborator).toBe(false)
    expect(toOrderWorkbenchRow({ id: 'abc', viewerIsCollaborator: 'true' }).viewerIsCollaborator).toBe(false)
  })
})

/**
 * The hub header's root-held fields and the tenth round's display rules (REQ-040 / REQ-042).
 *
 * 订单描述 resolves through the dictionary while an unknown code stays itself; 供应商 falls back to
 * the linked purchase rows only when the root carries none; the workbench 订单金额 leads with the
 * purchase total. All three are pure so the ten rules are pinned without a network or a render.
 */

describe('toCompanyOrderHead', () => {
  it('reads the root-held 订单描述 / 采购负责人 in all three states', () => {
    const head = toCompanyOrderHead({
      id: 'co-1',
      number: 'CO-2026-0001',
      status: 'shipped',
      productCategory: 'CL',
      ownerSnapshot: { name: '王工', email: 'wang@example.com' },
      customerSnapshot: { name: '俄方客户' },
      supplierSnapshot: { name: '宁波供应商' },
      viewerIsCollaborator: true,
    })

    expect(head.productCategory).toBe('CL')
    expect(head.ownerName).toBe('王工')
    expect(head.customerName).toBe('俄方客户')
    expect(head.supplierName).toBe('宁波供应商')
    expect(head.viewerIsCollaborator).toBe(true)
  })

  it('answers null for absent/blank/non-string fields and keeps the placed default', () => {
    const head = toCompanyOrderHead({ id: 'co-2' })

    expect(head.productCategory).toBeNull()
    expect(head.ownerName).toBeNull()
    expect(head.customerName).toBeNull()
    expect(head.supplierName).toBeNull()
    expect(head.paymentStatus).toBeNull()
    expect(head.notes).toBeNull()
    expect(head.status).toBe('placed')
    expect(head.viewerIsCollaborator).toBe(false)
  })

  it('never turns a non-string field into text', () => {
    const head = toCompanyOrderHead({
      id: 'co-3',
      productCategory: 7,
      ownerSnapshot: { name: 42 },
      number: null,
      status: null,
    })

    expect(head.productCategory).toBeNull()
    expect(head.ownerName).toBeNull()
    expect(head.number).toBe('')
    expect(head.status).toBe('placed')
  })
})

describe('resolveCodeListLabel', () => {
  const options = [
    { value: 'CL', label: 'CL — 猫砂' },
    { value: 'TP', label: 'TP — 尿片' },
  ]

  it('resolves a stored code to its option label', () => {
    expect(resolveCodeListLabel('CL', options)).toBe('CL — 猫砂')
  })

  it('falls back to the code itself when the dictionary no longer carries it', () => {
    expect(resolveCodeListLabel('ZZ', options)).toBe('ZZ')
  })

  it('answers null for an absent/blank code', () => {
    expect(resolveCodeListLabel(null, options)).toBeNull()
    expect(resolveCodeListLabel('   ', options)).toBeNull()
    expect(resolveCodeListLabel(undefined, options)).toBeNull()
  })
})

describe('resolveHeaderSupplierName', () => {
  it('prefers the root supplier when it carries one', () => {
    expect(resolveHeaderSupplierName('Root Supplier', ['Linked A', 'Linked B'])).toBe('Root Supplier')
  })

  it('falls back to the distinct linked purchase suppliers, joined with “ / ”', () => {
    expect(resolveHeaderSupplierName(null, ['宁波供应商', '宁波供应商', '深圳供应商'])).toBe('宁波供应商 / 深圳供应商')
    expect(resolveHeaderSupplierName('   ', [' 宁波供应商 ', null, ''])).toBe('宁波供应商')
  })

  it('answers null when neither the root nor the rows carry a supplier', () => {
    expect(resolveHeaderSupplierName(null, [])).toBeNull()
    expect(resolveHeaderSupplierName(undefined, [null, '   ', undefined])).toBeNull()
  })
})

describe('primaryOrderAmount', () => {
  it('leads with the purchase total while the order has one', () => {
    expect(primaryOrderAmount({ sales: '10.00', purchase: '20.00' })).toBe('20.00')
  })

  it('falls back to the sales total only when the purchase figure is 0.00', () => {
    expect(primaryOrderAmount({ sales: '10.00', purchase: '0.00' })).toBe('10.00')
    expect(primaryOrderAmount({ sales: '0.00', purchase: '0.00' })).toBe('0.00')
  })
})
