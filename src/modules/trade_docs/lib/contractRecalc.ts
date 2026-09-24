import type { EntityManager } from '@mikro-orm/postgresql'
import { notFound } from '@open-mercato/shared/lib/crud/errors'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { TradeDocsContract, TradeDocsContractLine } from '../data/entities'
import { resolveContractTotals, type ConfirmedInvoiceLineRef } from './contractTotals'
import { readCurrencyScale } from './currencyScale'
import { contractFilter, type TradeDocsScope } from './scope'

/**
 * Recomputes one contract's derived columns from its lines and the confirmed invoice lines bound
 * to them.
 *
 * This is the **only** writer of `contractAmount` / `financeAmount` on lines and of the three head
 * totals: every command that touches a line, an invoice status or a line's `amount` calls it
 * inside its own transaction, so a contract can never carry a stale total.
 *
 * The rows are read through the **caller's** `EntityManager` (not a fork) on purpose — a fork owns
 * a separate unit of work, and mutating entities loaded from one would be flushed by nobody.
 * `withAtomicFlush` runs the line writes and the head write as two flush boundaries inside one
 * transaction, so the head can never be committed ahead of the lines it summarizes.
 */
export async function recomputeContractHead(
  em: EntityManager,
  scope: TradeDocsScope,
  contractId: string,
): Promise<void> {
  const contract = await em.findOne(TradeDocsContract, contractFilter(scope, contractId))
  if (!contract) throw notFound('Contract not found')

  const lines = await em.find(
    TradeDocsContractLine,
    { contract: contractId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    { orderBy: { lineNumber: 'ASC' } },
  )

  const lineIds = lines.map((line) => String(line.id))
  const invoiceLines: ConfirmedInvoiceLineRef[] = []
  if (lineIds.length > 0) {
    // Only a *confirmed* invoice moves money; drafts and voided documents are invisible here.
    const rows = (await (em.getKysely<any>())
      .selectFrom('trade_docs_invoice_lines as l')
      .innerJoin('trade_docs_invoices as i', 'i.id', 'l.invoice_id')
      .select(['l.contract_line_id as contract_line_id', 'l.amount as amount'])
      .where('l.contract_line_id', 'in', lineIds)
      .where('l.tenant_id', '=', scope.tenantId)
      .where('l.organization_id', '=', scope.organizationId)
      .where('i.status', '=', 'confirmed')
      .where('i.deleted_at', 'is', null)
      .execute()) as Array<{ contract_line_id: string; amount: string }>
    for (const row of rows) {
      invoiceLines.push({ contractLineId: String(row.contract_line_id), amount: String(row.amount) })
    }
  }

  const currencyScale = await readCurrencyScale(em, scope, contract.currencyCode)
  const resolved = resolveContractTotals({
    lines: lines.map((line) => ({
      id: String(line.id),
      quantity: line.quantity,
      unitPrice: line.unitPrice,
    })),
    invoiceLines,
    currencyScale,
  })

  const byId = new Map(resolved.lines.map((line) => [line.id, line]))

  await withAtomicFlush(
    em,
    [
      () => {
        for (const line of lines) {
          const computed = byId.get(String(line.id))
          if (!computed) continue
          line.contractAmount = computed.contractAmount
          line.financeAmount = computed.financeAmount
          line.updatedAt = new Date()
        }
      },
      () => {
        contract.contractTotal = resolved.totals.contractTotal
        contract.financeTotal = resolved.totals.financeTotal
        contract.differenceTotal = resolved.totals.differenceTotal
        contract.updatedAt = new Date()
      },
    ],
    { transaction: true, label: 'trade_docs.recompute-contract-head' },
  )
}
