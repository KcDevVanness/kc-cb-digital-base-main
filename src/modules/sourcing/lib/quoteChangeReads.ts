import type { EntityManager } from '@mikro-orm/postgresql'
import type { Kysely } from 'kysely'
import { listStorePrices, listStoreProducts } from '../../products/lib/store'
import { SourcingQuote, SourcingQuoteLine } from '../data/entities'
import { normalizeItemKey, type QuoteLineFacts, type QuoteVersionFacts } from './quoteChanges'

/**
 * Scoped reads behind the change analysis.
 *
 * This module's own tables (`sourcing_quotes`, `sourcing_quote_lines`) are read through the entity
 * manager — the app-wide rule, and the reason `.ai/lessons/kysely-bare-handle-types-tables-away.md`
 * exists. The supplier library (`purchasing_supplier_products`) is read through raw Kysely with a
 * projection declared in this file, exactly like `purchasing/lib/quoteLineReads.ts` reads this
 * module's tables from the other side; the catalog product and its prices are read through the
 * product store (`products/lib/store.ts`). Every read carries the caller's tenant + organization.
 *
 * Nothing here writes, and nothing here knows what a "change" is — the rules live in
 * `lib/quoteChanges.ts` so they stay unit-testable.
 */

export type Scope = { tenantId: string; organizationId: string }

export type SupplierLibraryEntry = {
  supplierProductId: string
  supplierSku: string
  catalogProductId: string | null
}

export type PurchasePriceEntry = {
  catalogProductId: string
  productSku: string
  unitPrice: string
  currencyCode: string
}

const toIso = (value: Date | string | null | undefined): string | null => {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  return String(value)
}

const toDateOnly = (value: unknown): string | null => {
  const iso = value instanceof Date ? toIso(value) : value === null || value === undefined ? null : String(value)
  if (!iso) return null
  return iso.length >= 10 ? iso.slice(0, 10) : null
}

function toVersionFacts(quote: SourcingQuote): QuoteVersionFacts {
  return {
    quoteId: String(quote.id),
    number: quote.number ?? null,
    status: String(quote.status),
    signature: quote.sourceLayoutSignature ?? null,
    supplierId: quote.supplierId ?? null,
    quoteDate: toDateOnly(quote.quoteDate),
    createdAt: toIso(quote.createdAt) ?? new Date(0).toISOString(),
    fileName: quote.sourceFileName ?? null,
    lineCount: Number(quote.lineCount ?? 0),
    promotedCount: Number(quote.promotedCount ?? 0),
  }
}

function toLineFacts(line: SourcingQuoteLine): QuoteLineFacts {
  return {
    lineId: String(line.id),
    itemNo: line.itemNo ?? null,
    derivedSku: line.derivedSku ?? null,
    name: line.productName ?? null,
    unitCost: line.unitCost === null || line.unitCost === undefined ? null : String(line.unitCost),
    currencyCode: line.currencyCode ?? null,
    moqQuantity: line.moqQuantity === null || line.moqQuantity === undefined ? null : Number(line.moqQuantity),
    catalogProductId: line.catalogProductId ?? null,
    sourceRowNumber: line.sourceRowNumber === null || line.sourceRowNumber === undefined ? null : Number(line.sourceRowNumber),
  }
}

/** Every quotation of one supplier that could be a version: not deleted, decided, no status filter beyond that. */
export async function loadSupplierVersionFacts(
  em: EntityManager,
  scope: Scope,
  supplierId: string,
): Promise<QuoteVersionFacts[]> {
  const quotes = await em.fork().find(
    SourcingQuote,
    { supplierId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    { orderBy: { createdAt: 'asc' } },
  )
  return quotes.map(toVersionFacts)
}

export async function loadQuoteVersionFacts(
  em: EntityManager,
  scope: Scope,
  quoteId: string,
): Promise<QuoteVersionFacts | null> {
  const quote = await em.fork().findOne(SourcingQuote, {
    id: quoteId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  return quote ? toVersionFacts(quote) : null
}

export async function loadQuoteLineFacts(
  em: EntityManager,
  scope: Scope,
  quoteId: string,
): Promise<QuoteLineFacts[]> {
  const lines = await em.fork().find(
    SourcingQuoteLine,
    { quote: quoteId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    { orderBy: { lineNumber: 'asc' } },
  )
  return lines.map(toLineFacts)
}

export type TimelinePointFacts = {
  quoteId: string
  number: string | null
  day: string
  signature: string | null
  itemNo: string | null
  name: string | null
  unitCost: string | null
  currencyCode: string | null
  moqQuantity: number | null
  catalogProductId: string | null
}

/**
 * One item's line in every decided quotation of one supplier, oldest first.
 *
 * The item is identified by the normalized key, so the match is case/space-insensitive on the
 * supplier's own code. Lines of drafts and cancelled quotations are deliberately absent: a draft is
 * not a version the supplier ever stood behind.
 */
export async function loadSupplierItemPoints(
  em: EntityManager,
  scope: Scope,
  supplierId: string,
  key: string,
): Promise<{ points: TimelinePointFacts[]; lastDay: string | null }> {
  const scoped = em.fork()
  const quotes = await scoped.find(
    SourcingQuote,
    {
      supplierId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
      status: { $in: ['approved', 'archived'] },
    },
    { orderBy: { createdAt: 'asc' } },
  )
  if (quotes.length === 0) return { points: [], lastDay: null }

  const byId = new Map(quotes.map((quote) => [String(quote.id), quote]))
  const lines = await scoped.find(SourcingQuoteLine, {
    quote: { $in: [...byId.keys()] },
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })

  const points: TimelinePointFacts[] = []
  for (const line of lines) {
    if (normalizeItemKey(line.itemNo, line.derivedSku) !== key) continue
    const quoteId = String(line.quote.id)
    const quote = byId.get(quoteId)
    if (!quote) continue
    points.push({
      quoteId,
      number: quote.number ?? null,
      day: toDateOnly(quote.quoteDate) ?? toDateOnly(quote.createdAt) ?? '',
      signature: quote.sourceLayoutSignature ?? null,
      itemNo: line.itemNo ?? null,
      name: line.productName ?? null,
      unitCost: line.unitCost === null || line.unitCost === undefined ? null : String(line.unitCost),
      currencyCode: line.currencyCode ?? quote.currencyCode ?? null,
      moqQuantity: line.moqQuantity === null || line.moqQuantity === undefined ? null : Number(line.moqQuantity),
      catalogProductId: line.catalogProductId ?? null,
    })
  }

  const lastDay = quotes.reduce<string | null>((latest, quote) => {
    const day = toDateOnly(quote.quoteDate) ?? toDateOnly(quote.createdAt)
    if (!day) return latest
    return latest === null || day > latest ? day : latest
  }, null)
  return { points, lastDay }
}

type LibraryTables = {
  purchasing_supplier_products: {
    id: string
    tenant_id: string
    organization_id: string
    supplier_id: string
    supplier_sku: string
    catalog_product_id: string | null
    deleted_at: Date | null
  }
}

/** Library rows of one supplier, keyed by the normalized supplier code, for the "已进库 / 已建档" column. */
export async function loadSupplierLibraryIndex(
  em: EntityManager,
  scope: Scope,
  supplierId: string,
): Promise<Map<string, SupplierLibraryEntry>> {
  const db = em.fork().getKysely() as unknown as Kysely<LibraryTables>
  const rows = await db
    .selectFrom('purchasing_supplier_products')
    .select(['id', 'supplier_sku', 'catalog_product_id'])
    .where('supplier_id', '=', supplierId)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('deleted_at', 'is', null)
    .execute()
  const index = new Map<string, SupplierLibraryEntry>()
  for (const row of rows) {
    index.set(normalizeItemKey(row.supplier_sku, null) ?? String(row.supplier_sku), {
      supplierProductId: String(row.id),
      supplierSku: String(row.supplier_sku),
      catalogProductId: row.catalog_product_id ?? null,
    })
  }
  return index
}

/**
 * The callers' products, keyed by the normalized SKU, with their active `purchase`-tier price.
 *
 * Resolved through the store: one list for the page's SKUs, then one scoped price read per matched
 * product (bounded by the page). The key is normalized on this side too, so a quotation that writes
 * `p4108` and a product stored as `P4108` agree where the SKUs match exactly. The lowest minimum
 * quantity wins — that is the single-unit price the change table shows, and the same row the
 * promotion resolves.
 */
export async function loadPurchasePricesBySku(
  em: EntityManager,
  scope: Scope,
  skus: readonly string[],
): Promise<Map<string, PurchasePriceEntry>> {
  const index = new Map<string, PurchasePriceEntry>()
  const wanted = [...new Set(skus.map((sku) => sku.trim()).filter((sku) => sku.length > 0))]
  if (wanted.length === 0) return index

  const { items } = await listStoreProducts({
    em,
    scope,
    skus: wanted,
    status: 'all',
    pageSize: Math.min(200, wanted.length),
  })

  for (const product of items) {
    const key = normalizeItemKey(product.sku, null) ?? product.sku
    if (index.has(key)) continue
    const prices = await listStorePrices({ em, scope, productId: product.id })
    const candidate = prices.find((price) => price.tier === 'purchase' && price.isActive)
    if (!candidate) continue
    index.set(key, {
      catalogProductId: product.id,
      productSku: product.sku,
      unitPrice: candidate.unitPrice,
      currencyCode: candidate.currencyCode,
    })
  }
  return index
}
