import { parseExactDecimal } from '@open-mercato/core/modules/dashboards/lib/exactDecimal'
import { PRICE_SCALE, quantizeExactDecimal } from '../../trade_docs/lib/money'

/**
 * Quotation change analysis — the pure half.
 *
 * The archive keeps every quotation a supplier ever sent; this module answers the two questions the
 * buyer asks of that archive: "what changed between two versions?" and "how has one item's price
 * moved over time?". Everything here is a pure function over already-loaded rows, so the rules are
 * unit-testable without a database; the scoped reads live in `lib/quoteChangeReads.ts`.
 *
 * Two rules are load-bearing and are the reason this is not a five-line diff:
 *
 * 1. **The join key must be unique within one quotation.** `item_no` is not — a supplier quotes
 *    several variants under one Item No., and the derived SKU is what separates them. Keying on
 *    `item_no` pairs those variants with each other and inflates the diff with phantom rows
 *    (measured: `changed` went 0 → 16 on two identical imports).
 * 2. **Prices are compared exactly.** Money is a decimal string; the comparison runs on a scaled
 *    BigInt so no price ever passes through binary floating point. Only the displayed percentage
 *    is a float, and it is rounded at the boundary.
 */

export const CHANGE_KINDS = ['added', 'removed', 'up', 'down', 'currency_mismatch', 'no_price', 'same'] as const
export type ChangeKind = (typeof CHANGE_KINDS)[number]

/** Order rows are grouped in: the decisions first, the noise last. */
const KIND_ORDER: Record<ChangeKind, number> = {
  added: 0,
  removed: 1,
  up: 2,
  down: 3,
  currency_mismatch: 4,
  no_price: 5,
  same: 6,
}

export const VERSION_STATUSES = ['approved', 'archived'] as const

export type QuoteVersionFacts = {
  quoteId: string
  number: string | null
  status: string
  signature: string | null
  supplierId: string | null
  /** Business date when the operator filled it, else the import date. */
  quoteDate: string | null
  createdAt: string
  fileName: string | null
  lineCount: number
  promotedCount: number
}

export type ChainedVersion = QuoteVersionFacts & {
  /** Calendar day the version is grouped under (`quote_date` when set, else the import date). */
  day: string
  /** How many further imports of the same layout were folded into this version. */
  collapsedCount: number
}

export type QuoteLineFacts = {
  lineId: string
  itemNo: string | null
  derivedSku: string | null
  name: string | null
  unitCost: string | null
  currencyCode: string | null
  moqQuantity: number | null
  promotedProductId: string | null
  sourceRowNumber: number | null
}

export type ChangeRow = {
  key: string | null
  itemNo: string | null
  name: string | null
  kind: ChangeKind
  baseLineId: string | null
  targetLineId: string | null
  baseUnitCost: string | null
  targetUnitCost: string | null
  baseCurrencyCode: string | null
  targetCurrencyCode: string | null
  /** `target − base` as an exact decimal string; null when the two are not comparable. */
  deltaAmount: string | null
  /** Percentage change vs the base price; null when the base price is zero or incomparable. */
  deltaPercent: number | null
}

export type ChangeSummary = {
  added: number
  removed: number
  up: number
  down: number
  same: number
  currencyMismatch: number
  noPrice: number
  /** Rows in the comparison (after `onlyChanged` filtering). */
  total: number
  /** Lines with no usable key on either side — they cannot be matched and are never silently dropped. */
  unmatched: number
  /** Extra lines that repeated a key inside one quotation; the first occurrence won. */
  duplicateKeys: number
}

/** Prices live on a `numeric(18,4)` column; both sides of a comparison are scaled to it. */
const SCALE = PRICE_SCALE
const SCALE_FACTOR = BigInt(10) ** BigInt(SCALE)

/**
 * Case- and space-insensitive item key: the derived SKU when the workbook produced one, else the
 * supplier's own Item No. Null when a line carries neither (it cannot be matched across versions).
 */
export function normalizeItemKey(
  itemNo: string | null | undefined,
  derivedSku: string | null | undefined,
): string | null {
  const sku = (derivedSku ?? '').trim()
  if (sku) return sku.toUpperCase()
  const fallback = (itemNo ?? '').trim()
  return fallback ? fallback.toUpperCase() : null
}

/**
 * Exact decimal → scaled BigInt at the price scale. Null for anything that is not a finite decimal.
 *
 * A value finer than the column (a legacy 5–6-decimal price) is quantized **half away from zero**,
 * never truncated: `1.00005` is `1.0001`, so the diff table and the stored price agree on what the
 * price is. The digits go through the exact-decimal parser, so no price ever meets a float.
 */
export function decimalToMinor(value: string | number | null | undefined): bigint | null {
  const parsed = parseExactDecimal(value)
  if (!parsed) return null
  return quantizeExactDecimal(parsed, SCALE).units
}

/** Scaled BigInt → the shortest exact decimal string (trailing zeros trimmed). */
export function minorToDecimal(minor: bigint): string {
  const negative = minor < BigInt(0)
  const abs = negative ? -minor : minor
  const intPart = abs / SCALE_FACTOR
  const fracPart = (abs % SCALE_FACTOR).toString().padStart(SCALE, '0').replace(/0+$/, '')
  const text = fracPart ? `${intPart}.${fracPart}` : `${intPart}`
  return negative ? `-${text}` : text
}

const normalizeCurrency = (value: string | null | undefined): string => (value ?? '').trim().toUpperCase()

/** The two fields every price comparison reads — `classifyChange` and the timeline share it. */
export type PriceFacts = { unitCost: string | null; currencyCode: string | null }

/**
 * The four decisions plus the three honest "cannot tell" states. `currency_mismatch` exists so a
 * yen quotation is never silently subtracted from a yuan one, and `no_price` so a blank cell is
 * never read as zero.
 */
export function classifyChange(
  base: PriceFacts | null,
  target: PriceFacts | null,
): ChangeKind {
  if (!base) return 'added'
  if (!target) return 'removed'
  const baseMinor = decimalToMinor(base.unitCost)
  const targetMinor = decimalToMinor(target.unitCost)
  if (baseMinor === null || targetMinor === null) return 'no_price'
  if (normalizeCurrency(base.currencyCode) !== normalizeCurrency(target.currencyCode)) return 'currency_mismatch'
  if (baseMinor === targetMinor) return 'same'
  return targetMinor > baseMinor ? 'up' : 'down'
}

export type ChangeDelta = { amount: string; percent: number | null }

/** Exact amount plus a display-only percentage (null when the base price is zero). */
export function computeDelta(
  baseUnitCost: string | null | undefined,
  targetUnitCost: string | null | undefined,
): ChangeDelta | null {
  const baseMinor = decimalToMinor(baseUnitCost)
  const targetMinor = decimalToMinor(targetUnitCost)
  if (baseMinor === null || targetMinor === null) return null
  const diff = targetMinor - baseMinor
  const percent =
    baseMinor === BigInt(0) ? null : Math.round(Number((diff * BigInt(10000)) / baseMinor)) / 100
  return { amount: minorToDecimal(diff), percent }
}

/**
 * Index one quotation's lines by key, keeping the first line per key.
 *
 * Duplicates inside one quotation are a data error (the SKU derivation suffixes collisions), so the
 * extra lines are counted rather than fanned out — a duplicate key must never multiply the diff.
 */
function indexLines(lines: readonly QuoteLineFacts[]): {
  byKey: Map<string, QuoteLineFacts>
  unmatched: number
  duplicateKeys: number
} {
  const byKey = new Map<string, QuoteLineFacts>()
  let unmatched = 0
  let duplicateKeys = 0
  for (const line of lines) {
    const key = normalizeItemKey(line.itemNo, line.derivedSku)
    if (!key) {
      unmatched += 1
      continue
    }
    if (byKey.has(key)) {
      duplicateKeys += 1
      continue
    }
    byKey.set(key, line)
  }
  return { byKey, unmatched, duplicateKeys }
}

export type QuoteDiff = { rows: ChangeRow[]; summary: ChangeSummary }

/**
 * Compare two quotations line by line. `onlyChanged` drops the `same` rows from `rows` while the
 * summary still counts them, so a filtered table and an unfiltered summary never disagree.
 */
export function diffQuotes(
  baseLines: readonly QuoteLineFacts[],
  targetLines: readonly QuoteLineFacts[],
  options: { onlyChanged?: boolean } = {},
): QuoteDiff {
  const base = indexLines(baseLines)
  const target = indexLines(targetLines)

  const keys = new Set<string>([...base.byKey.keys(), ...target.byKey.keys()])
  const rows: ChangeRow[] = []
  const summary: ChangeSummary = {
    added: 0,
    removed: 0,
    up: 0,
    down: 0,
    same: 0,
    currencyMismatch: 0,
    noPrice: 0,
    total: 0,
    unmatched: base.unmatched + target.unmatched,
    duplicateKeys: base.duplicateKeys + target.duplicateKeys,
  }

  for (const key of keys) {
    const baseLine = base.byKey.get(key) ?? null
    const targetLine = target.byKey.get(key) ?? null
    const kind = classifyChange(baseLine, targetLine)
    const delta =
      kind === 'up' || kind === 'down' || kind === 'same'
        ? computeDelta(baseLine?.unitCost, targetLine?.unitCost)
        : null
    const row: ChangeRow = {
      key,
      itemNo: targetLine?.itemNo ?? baseLine?.itemNo ?? null,
      name: targetLine?.name ?? baseLine?.name ?? null,
      kind,
      baseLineId: baseLine?.lineId ?? null,
      targetLineId: targetLine?.lineId ?? null,
      baseUnitCost: baseLine?.unitCost ?? null,
      targetUnitCost: targetLine?.unitCost ?? null,
      baseCurrencyCode: baseLine?.currencyCode ?? null,
      targetCurrencyCode: targetLine?.currencyCode ?? null,
      deltaAmount: delta?.amount ?? null,
      deltaPercent: delta?.percent ?? null,
    }
    if (kind === 'added') summary.added += 1
    else if (kind === 'removed') summary.removed += 1
    else if (kind === 'up') summary.up += 1
    else if (kind === 'down') summary.down += 1
    else if (kind === 'same') summary.same += 1
    else if (kind === 'currency_mismatch') summary.currencyMismatch += 1
    else summary.noPrice += 1
    if (!options.onlyChanged || kind !== 'same') {
      rows.push(row)
      summary.total += 1
    }
  }

  rows.sort((left, right) => {
    const byKind = KIND_ORDER[left.kind] - KIND_ORDER[right.kind]
    if (byKind !== 0) return byKind
    return (left.key ?? '').localeCompare(right.key ?? '')
  })
  return { rows, summary }
}

/** `quote_date` when the operator filled it, else the import date. */
export function versionDay(version: Pick<QuoteVersionFacts, 'quoteDate' | 'createdAt'>): string {
  const explicit = (version.quoteDate ?? '').trim()
  if (explicit.length >= 10) return explicit.slice(0, 10)
  return (version.createdAt ?? '').slice(0, 10)
}

/**
 * Build the version chain of every supplier + layout: only approved/archived quotations that carry
 * a layout signature, one entry per calendar day (the newest import of that day wins), ordered
 * oldest → newest. Repeated imports of the same file are the normal case in this archive — they are
 * one version, not four — and a retired (archived) version stays in the chain because a chain that
 * forgets history answers nothing.
 */
export function buildVersionChains(versions: readonly QuoteVersionFacts[]): ChainedVersion[] {
  const groups = new Map<string, QuoteVersionFacts[]>()
  for (const version of versions) {
    const signature = (version.signature ?? '').trim()
    const supplierId = (version.supplierId ?? '').trim()
    if (!signature || !supplierId) continue
    if (!(VERSION_STATUSES as readonly string[]).includes(version.status)) continue
    const groupKey = `${supplierId}::${signature}`
    const bucket = groups.get(groupKey)
    if (bucket) bucket.push(version)
    else groups.set(groupKey, [version])
  }

  const chain: ChainedVersion[] = []
  for (const bucket of groups.values()) {
    const byDay = new Map<string, QuoteVersionFacts[]>()
    for (const version of bucket) {
      const day = versionDay(version)
      const dayBucket = byDay.get(day)
      if (dayBucket) dayBucket.push(version)
      else byDay.set(day, [version])
    }
    for (const [day, dayVersions] of byDay) {
      const sorted = [...dayVersions].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      const winner = sorted[sorted.length - 1]
      chain.push({ ...winner, day, collapsedCount: sorted.length - 1 })
    }
  }

  chain.sort((left, right) => {
    const bySignature = `${left.supplierId}::${left.signature}`.localeCompare(`${right.supplierId}::${right.signature}`)
    if (bySignature !== 0) return bySignature
    if (left.day !== right.day) return left.day.localeCompare(right.day)
    return left.createdAt.localeCompare(right.createdAt)
  })
  return chain
}

/** The version before `quoteId` in its own chain — the default comparison base. */
export function pickPreviousVersion(
  chain: readonly ChainedVersion[],
  quoteId: string,
): ChainedVersion | null {
  const target = chain.find((version) => version.quoteId === quoteId)
  if (!target) return null
  const sameChain = chain.filter(
    (version) => version.supplierId === target.supplierId && version.signature === target.signature,
  )
  const index = sameChain.findIndex((version) => version.quoteId === quoteId)
  if (index <= 0) return null
  return sameChain[index - 1]
}

export type ItemTimelinePoint = {
  quoteId: string
  number: string | null
  day: string
  signature: string | null
  itemNo: string | null
  name: string | null
  unitCost: string | null
  currencyCode: string | null
  moqQuantity: number | null
  promotedProductId: string | null
  /** Movement against the previous point of the same item. */
  kind: ChangeKind
  deltaAmount: string | null
  deltaPercent: number | null
  first: boolean
}

/**
 * One item's price over every version of one supplier, oldest → newest. Whether the most recent
 * version still quotes the item is the caller's question — it needs the version list for that, not
 * the points — so this stays a pure fold over the points it is given.
 */
export function buildItemTimeline(
  points: readonly (Omit<ItemTimelinePoint, 'kind' | 'deltaAmount' | 'deltaPercent' | 'first'>)[],
): ItemTimelinePoint[] {
  const ordered = [...points].sort((left, right) => {
    if (left.day !== right.day) return left.day.localeCompare(right.day)
    return left.quoteId.localeCompare(right.quoteId)
  })
  const timeline: ItemTimelinePoint[] = []
  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index]
    const previous = index > 0 ? ordered[index - 1] : null
    const kind = previous ? classifyChange(previous, current) : 'added'
    const delta =
      previous && (kind === 'up' || kind === 'down' || kind === 'same')
        ? computeDelta(previous.unitCost, current.unitCost)
        : null
    timeline.push({
      ...current,
      kind,
      deltaAmount: delta?.amount ?? null,
      deltaPercent: delta?.percent ?? null,
      first: index === 0,
    })
  }
  return timeline
}
