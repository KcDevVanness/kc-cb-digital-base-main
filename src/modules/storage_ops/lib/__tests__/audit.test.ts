import { describe, expect, it } from '@jest/globals'
import { ledgerKey, planLedgerRepair } from '../audit'

const PATH = 'org_bf4ccd1a-76e4-47b5-a2dd-6e6f45601fbc/tenant_212721cf-fbea-4fdd-b99a-95e4890a92f8/file.pdf'

function ledgerRow(overrides: Partial<{ id: string; status: string; storageDriver: string; storagePath: string }>) {
  return {
    id: overrides.id ?? 'ledger-1',
    status: overrides.status ?? 'committed',
    storageDriver: overrides.storageDriver ?? 'local',
    storagePath: overrides.storagePath ?? PATH,
  }
}

describe('quota-ledger repair plan (spec C-3, TEST-005)', () => {
  it('flags a committed row that duplicates an attachment row — the case the installed core never cleans up', () => {
    const plan = planLedgerRepair(new Set([ledgerKey('local', PATH)]), [ledgerRow({})])
    expect(plan.duplicateCommittedIds).toEqual(['ledger-1'])
    expect(plan.orphanCommittedIds).toEqual([])
    expect(plan.nonTerminalIds).toEqual([])
  })

  it('flags in-flight reservations, which block the migration window', () => {
    const plan = planLedgerRepair(
      new Set(),
      [
        ledgerRow({ id: 'reserved', status: 'reserved' }),
        ledgerRow({ id: 'storing', status: 'storing' }),
        ledgerRow({ id: 'stored', status: 'stored' }),
        ledgerRow({ id: 'recovering', status: 'recovering' }),
      ],
    )
    expect(plan.nonTerminalIds).toEqual(['reserved', 'storing', 'stored', 'recovering'])
    expect(plan.duplicateCommittedIds).toEqual([])
  })

  it('keeps committed rows that do not duplicate an attachment row as informational orphans', () => {
    const plan = planLedgerRepair(new Set([ledgerKey('local', PATH)]), [
      ledgerRow({ id: 'standalone', storagePath: `${PATH}.other` }),
    ])
    expect(plan.orphanCommittedIds).toEqual(['standalone'])
    expect(plan.duplicateCommittedIds).toEqual([])
  })

  it('matches on the (driver, path) pair, not the path alone', () => {
    const plan = planLedgerRepair(new Set([ledgerKey('s3', PATH)]), [ledgerRow({ storageDriver: 'local' })])
    expect(plan.duplicateCommittedIds).toEqual([])
    expect(plan.orphanCommittedIds).toEqual(['ledger-1'])
  })
})
