/**
 * Coherence rules for the two money-status pairs `export_finance` owns.
 *
 * Both records carry a **status enum** and the **facts** that status claims (`amount`, `receivedAt`
 * for a collection; `taxRefundAmount` for a refund). Nothing used to tie them together, so a record
 * could say 已收款 with no amount and no date, or 未收款 with a receipt date — and every reader of
 * the receivables ledger or the refund checklist then had to guess which half to believe.
 *
 * The rules are pure and return *all* the problems instead of the first one, so the operator fixes a
 * payload in one pass. Writes are the only place this runs: existing rows stay as they are (the
 * columns are all nullable by design — "no answer" is a legitimate state for records written before
 * anybody filled them in).
 */

/** The facts a collection record claims, in the shape the command has already normalized. */
export type CollectionStatusFacts = {
  collectionStatus: string
  /** `null` means "no amount recorded"; a string is a positive 2-dp decimal. */
  amount: string | null
  /** `null` means "no receipt recorded". */
  receivedAt: Date | null
}

/** The facts a tax-refund record claims. */
export type TaxRefundStatusFacts = {
  taxRefundStatus: string
  taxRefundAmount: string | null
}

/**
 * Everything wrong with a collection record's status/facts pair.
 *
 * - `received` (已收款) must carry **both** the amount and the date: the ledger's receivables side
 *   reads exactly those two, and a "received" row without them is an assertion with no evidence.
 * - `not_received` (未收款) must not carry a receipt date — that is the state where nothing arrived.
 * - `unknown` is the absence of an answer, so it carries neither.
 */
export function collectionStatusIssues(facts: CollectionStatusFacts): string[] {
  const issues: string[] = []
  const { collectionStatus, amount, receivedAt } = facts
  if (collectionStatus === 'received') {
    if (!amount) issues.push('a received collection needs the collected amount (collectedAmount)')
    if (!receivedAt) issues.push('a received collection needs the receipt date (collectedAt)')
    return issues
  }
  if (collectionStatus === 'not_received') {
    if (receivedAt) issues.push('a not-received collection cannot carry a receipt date (collectedAt)')
    if (amount) issues.push('a not-received collection cannot carry a collected amount (collectedAmount)')
    return issues
  }
  if (collectionStatus === 'unknown') {
    if (amount) issues.push('an unknown collection cannot carry a collected amount (collectedAmount)')
    if (receivedAt) issues.push('an unknown collection cannot carry a receipt date (collectedAt)')
  }
  return issues
}

/**
 * Everything wrong with a tax-refund record's status/facts pair.
 *
 * - `completed` (已到账) must carry the amount: that is the whole point of the state.
 * - `not_started` / `unknown` carry no amount — there is nothing filed yet to amount to.
 * - `applied` (已申报) may carry one (the filed amount is often known before it arrives), so it is
 *   the one state where the amount is optional.
 */
export function taxRefundStatusIssues(facts: TaxRefundStatusFacts): string[] {
  const { taxRefundStatus, taxRefundAmount } = facts
  if (taxRefundStatus === 'completed' && !taxRefundAmount) {
    return ['a completed tax refund needs the refunded amount (taxRefundAmount)']
  }
  if ((taxRefundStatus === 'not_started' || taxRefundStatus === 'unknown') && taxRefundAmount) {
    return [`a ${taxRefundStatus.replace('_', ' ')} tax refund cannot carry a refunded amount (taxRefundAmount)`]
  }
  return []
}
