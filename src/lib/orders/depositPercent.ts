/**
 * 定金比例 — the deposit percentage as an operator reads it.
 *
 * The column is `numeric(6,3)`, so the stored string carries the full scale (`50.000`); the rule is
 * «show the term the operator typed, never a trailing-zero wall», and a value that is not a finite
 * number is shown as stored (a cell never blanks a fact the record holds). Shared by the purchase
 * order's own page and the order hub's 采购 rows, which both display the same term.
 */
export function formatDepositPercent(value: string | null): string | null {
  if (!value) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return value
  return `${Number(parsed.toFixed(3))}%`
}
