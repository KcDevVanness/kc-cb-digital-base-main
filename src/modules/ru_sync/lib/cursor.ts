import type { SupplyEndpoint } from './endpoints/supply'

/**
 * The resume position of one endpoint walk, encoded as the string the `DataSyncAdapter` contract
 * carries.
 *
 * It holds three things:
 * - `page` — the next page to request with the **same** `updated_since` (§0.2: the watermark stays
 *   fixed while paging, the page number moves);
 * - `updatedSince` — the watermark this walk started from, or `null` on a full pull;
 * - `asOf` — the snapshot date seen so far, so a resumed walk keeps writing one snapshot day.
 *
 * The watermark itself is only advanced by {@link advanceCursorAfterSuccess}, i.e. after every page
 * of the walk has been committed.
 */
export type RuCursorState = {
  page: number
  updatedSince: string | null
  asOf: string | null
}

export const INITIAL_CURSOR: RuCursorState = { page: 1, updatedSince: null, asOf: null }

export function encodeCursor(state: RuCursorState): string {
  return JSON.stringify(state)
}

export function parseCursor(raw: string | null | undefined): RuCursorState {
  if (!raw) return { ...INITIAL_CURSOR }
  try {
    const parsed = JSON.parse(raw) as Partial<RuCursorState>
    return {
      page: typeof parsed.page === 'number' && parsed.page >= 1 ? Math.floor(parsed.page) : 1,
      updatedSince: typeof parsed.updatedSince === 'string' && parsed.updatedSince.length > 0 ? parsed.updatedSince : null,
      asOf: typeof parsed.asOf === 'string' && parsed.asOf.length > 0 ? parsed.asOf : null,
    }
  } catch {
    // A cursor this module did not write is treated as "start over" rather than as a crash: the
    // next full walk rewrites it, and snapshots are idempotent per (endpoint, key, as_of).
    return { ...INITIAL_CURSOR }
  }
}

/**
 * The largest `updated_at` seen in a walk, computed as a **string** comparison.
 *
 * All RU timestamps are RFC 3339 with an offset (§0.4) and the same offset in practice, so the
 * lexicographic maximum is the chronological maximum; comparing the parsed instants is the fallback
 * when two rows carry different offsets.
 */
export function maxUpdatedAt(values: readonly (string | null | undefined)[]): string | null {
  let best: string | null = null
  let bestTime = Number.NEGATIVE_INFINITY
  for (const value of values) {
    if (typeof value !== 'string' || value.length === 0) continue
    const time = Date.parse(value)
    if (Number.isNaN(time)) continue
    if (time > bestTime || (time === bestTime && best !== null && value > best)) {
      best = value
      bestTime = time
    }
  }
  return best
}

/**
 * The watermark the next walk starts from.
 *
 * `updated_since` is **strictly greater** (§0.2), so the maximum seen may be reused as the next
 * watermark without skipping the row that carried it — that row was already written this walk.
 * Rows without `updated_at` are treated as full-pull rows by the contract, and a walk that saw one
 * keeps the previous watermark only if it advanced less: taking the max of both is what makes the
 * missing-timestamp warning safe instead of lossy.
 */
export function advanceCursorAfterSuccess(previous: string | null, seen: readonly (string | null | undefined)[]): string | null {
  const candidate = maxUpdatedAt(seen)
  if (candidate === null) return previous
  if (previous === null) return candidate
  const previousTime = Date.parse(previous)
  const candidateTime = Date.parse(candidate)
  if (Number.isNaN(previousTime)) return candidate
  return candidateTime >= previousTime ? candidate : previous
}

/** Natural keys the pull should watch, per endpoint — used by the health/coverage reporting. */
export function cursorKeyFor(endpoint: SupplyEndpoint): string {
  return endpoint
}
