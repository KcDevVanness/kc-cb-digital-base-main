import type { OrderStageItem } from './orderStages'

/**
 * The merge behind the order workbench, as a pure function.
 *
 * The workbench lists three kinds of company order on one screen, each kind owned by a different
 * module. The aggregate route reads every source through that module's own list route (which is what
 * keeps the encrypted buyer name inside the module that decrypts it) and hands the results here: the
 * rows are flattened in source order, deduped by id and ordered newest-first by `createdAt`, and the
 * first `requested` rows are the page the caller asked for.
 *
 * Pure on purpose — no IO, no `'use client'` — so the ordering, dedupe and truncation rules can be
 * tested directly and both the route and any future reader share one definition.
 */

export type OrderRowSource = 'internal_sales' | 'external_sales' | 'purchase_order'

export type OrderRow = {
  id: string
  source: OrderRowSource
  number: string | null
  counterparty: string | null
  currencyCode: string
  total: string
  status: string | null
  createdAt: string | null
  lineCount: number
  /** Attached by the aggregate route, which batches the stage projection once per request. */
  stages: OrderStageItem | null
}

/** One source's scan window: the rows read so far, the source's own total and whether it was cut short. */
export type OrderSourceWindow = {
  source: OrderRowSource
  rows: OrderRow[]
  total: number
  totalIsCapped?: boolean
}

function readText(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return ''
}

/** A money column may arrive as a string or a number depending on the route; both read the same. */
function readAmount(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.length > 0) return value
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return '0'
}

function readNumber(source: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return 0
}

function snapshotName(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null
  const name = (snapshot as Record<string, unknown>).name
  return typeof name === 'string' && name.length > 0 ? name : null
}

/** One row of the installed sales order list, in the workbench's shape. */
export function toSalesOrderRow(
  item: Record<string, unknown>,
  source: 'internal_sales' | 'external_sales',
): OrderRow {
  return {
    id: String(item.id),
    source,
    number: readText(item, 'orderNumber', 'order_number') || null,
    counterparty: snapshotName(item.customerSnapshot ?? item.customer_snapshot),
    currencyCode: readText(item, 'currencyCode', 'currency_code') || 'CNY',
    total: readAmount(item, 'grandTotalNetAmount', 'grand_total_net_amount', 'grandTotalGrossAmount'),
    status: readText(item, 'status') || null,
    createdAt: readText(item, 'createdAt', 'created_at') || null,
    lineCount: readNumber(item, 'lineItemCount', 'line_item_count'),
    stages: null,
  }
}

/** One row of the purchase order list, in the workbench's shape. */
export function toPurchaseOrderRow(item: Record<string, unknown>): OrderRow {
  return {
    id: String(item.id),
    source: 'purchase_order',
    number: readText(item, 'number') || null,
    counterparty: readText(item, 'supplierName', 'supplier_name') || null,
    currencyCode: readText(item, 'currencyCode', 'currency_code') || 'CNY',
    total: readAmount(item, 'total'),
    status: readText(item, 'status') || null,
    createdAt: readText(item, 'createdAt', 'created_at') || null,
    lineCount: 0,
    stages: null,
  }
}

/** Newest first, by the timestamp the list projections carry; a row without one sorts last. */
export function compareByCreatedAtDesc(
  a: Pick<OrderRow, 'createdAt'>,
  b: Pick<OrderRow, 'createdAt'>,
): number {
  const left = a.createdAt ? Date.parse(a.createdAt) : Number.NaN
  const right = b.createdAt ? Date.parse(b.createdAt) : Number.NaN
  if (Number.isNaN(left) && Number.isNaN(right)) return 0
  if (Number.isNaN(left)) return 1
  if (Number.isNaN(right)) return -1
  return right - left
}

/**
 * Flatten the sources in the order given, keep the first row for each id, order newest-first and
 * return the first `requested` rows.
 *
 * The source order is the dedupe tiebreak, so a caller must pass its sources in a stable order for
 * the merge to be deterministic across requests (pagination depends on it).
 */
export function mergeOrderRows(sources: OrderSourceWindow[], requested: number): OrderRow[] {
  const byId = new Map<string, OrderRow>()
  for (const window of sources) {
    for (const row of window.rows) {
      if (!byId.has(row.id)) byId.set(row.id, row)
    }
  }
  const merged = [...byId.values()].sort(compareByCreatedAtDesc)
  const limit = Number.isFinite(requested) ? Math.max(0, Math.floor(requested)) : merged.length
  return merged.slice(0, limit)
}

/** The page-th slice of `pageSize` rows; a page past the end is empty rather than clamped. */
export function slicePage<T>(rows: T[], page: number, pageSize: number): T[] {
  const start = (Math.max(1, Math.floor(page)) - 1) * Math.max(1, Math.floor(pageSize))
  if (start >= rows.length) return []
  return rows.slice(start, start + Math.max(1, Math.floor(pageSize)))
}

/** The sum of the sources' own totals — exact when every source reported an uncapped count. */
export function sumTotals(sources: Pick<OrderSourceWindow, 'total'>[]): number {
  return sources.reduce((sum, source) => sum + (Number.isFinite(source.total) ? source.total : 0), 0)
}
