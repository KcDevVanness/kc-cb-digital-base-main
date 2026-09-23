import { computeContractTotals, computeLineAmounts, sumAmounts, type ContractTotals } from './money'

/**
 * Turns contract lines plus the confirmed invoice lines bound to them into the three head
 * columns, and resolves each line's own two amounts.
 *
 * The financial caliber is **invoice-authoritative per line**: a contract line that a *confirmed*
 * invoice line points at takes the invoice's printed amount instead of `quantity × unit_price`,
 * because finance reconciles against the invoice. Every other line keeps the computed value. The
 * contract caliber is never affected — the paper the customer signed stays what it was, and the
 * gap between the two shows up in `difference_total` for a human to explain.
 *
 * Several confirmed invoice lines may bind to one contract line (partial invoices); their amounts
 * are summed. A draft or voided invoice has no effect at all.
 */

export type ContractLineForTotals = {
  id: string
  quantity: string
  unitPrice: string
}

export type ConfirmedInvoiceLineRef = {
  contractLineId: string | null
  amount: string
}

export type ResolvedContractLineTotals = {
  id: string
  financeAmount: string
  contractAmount: string
  /** Which caliber the financial amount came from — surfaced on the detail page. */
  financeSource: 'invoice' | 'computed'
}

export type ResolvedContractTotals = {
  lines: ResolvedContractLineTotals[]
  totals: ContractTotals
  /** Sum of the invoice amounts that took over a line, at the stored amount scale. */
  invoiceCoveredTotal: string
}

export function resolveContractTotals(input: {
  lines: ContractLineForTotals[]
  invoiceLines: ConfirmedInvoiceLineRef[]
  currencyScale: number
}): ResolvedContractTotals {
  const amountsByContractLine = new Map<string, string[]>()
  for (const invoiceLine of input.invoiceLines) {
    if (!invoiceLine.contractLineId) continue
    const bucket = amountsByContractLine.get(invoiceLine.contractLineId)
    if (bucket) bucket.push(invoiceLine.amount)
    else amountsByContractLine.set(invoiceLine.contractLineId, [invoiceLine.amount])
  }

  const resolved: ResolvedContractLineTotals[] = input.lines.map((line) => {
    const computed = computeLineAmounts({
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      currencyScale: input.currencyScale,
    })
    const invoiced = amountsByContractLine.get(line.id)
    if (!invoiced || invoiced.length === 0) {
      return {
        id: line.id,
        financeAmount: computed.financeAmount,
        contractAmount: computed.contractAmount,
        financeSource: 'computed',
      }
    }
    return {
      id: line.id,
      financeAmount: sumAmounts(invoiced),
      contractAmount: computed.contractAmount,
      financeSource: 'invoice',
    }
  })

  const totals = computeContractTotals(
    resolved.map((line) => ({ contractAmount: line.contractAmount, financeAmount: line.financeAmount })),
  )

  const invoiceCoveredTotal = sumAmounts(
    resolved.filter((line) => line.financeSource === 'invoice').map((line) => line.financeAmount),
  )

  return { lines: resolved, totals, invoiceCoveredTotal }
}
