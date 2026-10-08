/**
 * The document ⇄ form value codec shared by the internal-sales surfaces.
 *
 * Extracted from `InternalSalesForm` when order loading needed the same mapping: the edit form, the
 * quote loader and the tests must not drift on how a document's head, lines and the buyer snapshot
 * become form values (or the other way around). Pure functions only — no React, no fetches.
 */

import { readBuyerSnapshot } from './buyer'
import { resolveRowTradeType, type SalesTradeType } from './tradeType'

export type InternalSalesLineValues = {
  key: string
  productId: string
  /** Display label only; never submitted. */
  productLabel: string
  /** Resolved from the product's catalog link; the fulfilment half needs it. */
  productVariantId: string
  name: string
  spec: string
  sku: string
  quantity: string
  unitPriceNet: string
  note: string
}

/**
 * The order's source quotation, frozen onto `metadata.internalSales.sourceQuote`.
 *
 * The installed sales chain has no "derived from" column, so provenance rides in its free-form
 * document `metadata` jsonb (an update that does not carry `metadata` leaves the stored value
 * alone). Kept as a value, never as a link the code follows: the quote may be edited or deleted.
 */
export type SourceQuoteRef = {
  id: string
  number: string
}

export type InternalSalesFormValues = {
  id?: string
  /**
   * Trade type of the document — `internal` (总部 → 分公司) or `external` (分公司 → 当地客户).
   *
   * It decides which buyer sources the picker offers and which engine channel the document is
   * written to (`lib/tradeType.ts`); it is never chosen independently of the buyer.
   */
  tradeType: SalesTradeType
  /**
   * The buyer picker's value protocol: `''` | `org:<uuid>` | `party:<uuid>` (see `lib/buyer.ts`).
   *
   * An organization id means the buyer is a group company (internal trade); a party id means an
   * app-owned `parties` record (external customer). Optional on purpose: a buyer without master
   * data is still typed by name only, and the snapshot is what the document prints.
   */
  buyerRef: string
  customerName: string
  /**
   * The buyer's email address, frozen into the snapshot (`contact.email`) — the installed
   * `POST /api/sales/quotes/send` reads it first when sending a quote to the buyer.
   */
  buyerEmail: string
  currencyCode: string
  customerReference: string
  comments: string
  lines: InternalSalesLineValues[]
  /** Set when this order was loaded from an existing quote; `null`/absent when it was not. */
  sourceQuote?: SourceQuoteRef | null
  /** The document's status as the engine reports it (`sales.order_status` value, may be null). */
  status?: string | null
  /** Quote only: the deadline written by `quotes/send` (ISO string, `null` when never sent). */
  validUntil?: string | null
  updatedAt?: string | null
}

export const EMPTY_LINE: InternalSalesLineValues = {
  key: 'line-1',
  productId: '',
  productLabel: '',
  productVariantId: '',
  name: '',
  spec: '',
  sku: '',
  quantity: '1',
  unitPriceNet: '0',
  note: '',
}

export const EMPTY_VALUES: InternalSalesFormValues = {
  tradeType: 'internal',
  buyerRef: '',
  customerName: '',
  buyerEmail: '',
  currencyCode: '',
  customerReference: '',
  comments: '',
  lines: [{ ...EMPTY_LINE }],
}

export function readText(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string') return value
  }
  return ''
}

function snapshotValue(snapshot: unknown, key: string): string {
  if (!snapshot || typeof snapshot !== 'object') return ''
  const value = (snapshot as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : ''
}

function readNestedRecord(source: unknown, key: string): Record<string, unknown> | null {
  if (!source || typeof source !== 'object') return null
  const value = (source as Record<string, unknown>)[key]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/**
 * The source-quote half of the document's `metadata`, tolerating anything the column may hold.
 *
 * Document metadata is shared with the engine and with other editors, so a missing key, a foreign
 * shape or half a reference all degrade to `null` instead of throwing.
 */
export function readSourceQuote(metadata: unknown): SourceQuoteRef | null {
  const internalSales = readNestedRecord(metadata, 'internalSales')
  const sourceQuote = readNestedRecord(internalSales, 'sourceQuote')
  if (!sourceQuote) return null
  const id = typeof sourceQuote.id === 'string' ? sourceQuote.id : ''
  const number = typeof sourceQuote.number === 'string' ? sourceQuote.number : ''
  if (!id && !number) return null
  return { id, number }
}

/**
 * The metadata payload written when an order is created from a quote.
 *
 * `internalSales` is this module's namespace inside the shared column; nothing else writes it.
 */
export function buildDocumentMetadata(sourceQuote: SourceQuoteRef): Record<string, unknown> {
  return { internalSales: { sourceQuote: { id: sourceQuote.id, number: sourceQuote.number } } }
}

/**
 * `fallbackTradeType` is the entry's own type: it is what an unclassified document (one written
 * before the marker existed, whose snapshot has no link either) shows and gets stamped with. The
 * caller passes the entry it is rendering, so the entry — not a hard-coded default — decides how
 * such a document is classified when the operator saves it.
 */
export function toInternalSalesFormValues(
  item: Record<string, unknown>,
  lines: InternalSalesLineValues[] = [],
  channelIds: Partial<Record<SalesTradeType, string | null | undefined>> = {},
  fallbackTradeType: SalesTradeType = 'internal',
): InternalSalesFormValues {
  const updatedAt = item.updatedAt ?? item.updated_at
  // The buyer link and its printed name both live in the snapshot (`lib/buyer.ts`); the installed
  // `customerEntityId` column is deliberately not read — this module no longer writes it.
  const buyer = readBuyerSnapshot(item.customerSnapshot ?? item.customer_snapshot)
  return {
    id: readText(item, 'id'),
    // The channel marker is the truth; a document written before the marker existed falls back to
    // its frozen snapshot (the same rule the backfill uses), and only then to the entry's type.
    tradeType: resolveRowTradeType(item, channelIds) ?? fallbackTradeType,
    buyerRef: buyer.ref,
    customerName: buyer.name,
    buyerEmail: buyer.email,
    currencyCode: readText(item, 'currencyCode', 'currency_code'),
    customerReference: readText(item, 'customerReference', 'customer_reference'),
    // The document read answers with `comment` (singular — the sales factory's serializer), while
    // the write contract takes `comments`; reading both keeps the head comment round-tripping.
    comments: readText(item, 'comments', 'comment'),
    lines: lines.length > 0 ? lines : [{ ...EMPTY_LINE }],
    sourceQuote: readSourceQuote(item.metadata),
    status: typeof item.status === 'string' && item.status.length > 0 ? item.status : null,
    validUntil: typeof (item.validUntil ?? item.valid_until) === 'string'
      ? (item.validUntil ?? item.valid_until) as string
      : null,
    updatedAt: typeof updatedAt === 'string' ? updatedAt : null,
  }
}

export function toInternalSalesLineValues(item: Record<string, unknown>): InternalSalesLineValues {
  return {
    key: String(item.id ?? `line-${item.lineNumber ?? Math.random()}`),
    productId: readText(item, 'productId', 'product_id'),
    productLabel: readText(item, 'name'),
    productVariantId: readText(item, 'productVariantId', 'product_variant_id'),
    name: readText(item, 'name'),
    spec: snapshotValue(item.catalogSnapshot ?? item.catalog_snapshot, 'spec'),
    sku: snapshotValue(item.catalogSnapshot ?? item.catalog_snapshot, 'sku'),
    quantity: readText(item, 'quantity') || '0',
    unitPriceNet: readText(item, 'unitPriceNet', 'unit_price_net') || '0',
    note: readText(item, 'comment'),
  }
}
