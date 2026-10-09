import { describe, expect, it } from '@jest/globals'
import { snapshotDisplayName, toOrderWorkbenchRow } from '../companyOrderDisplay'

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
