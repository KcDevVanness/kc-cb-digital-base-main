import type { EntityManager } from '@mikro-orm/postgresql'
import type { Kysely } from 'kysely'

/**
 * Scoped reads of the `sourcing` module's quotation tables.
 *
 * Raw Kysely on purpose: this module must not import another module's entities, it only needs a
 * handful of columns to build a library row from a quotation line, and every query is filtered by
 * the same tenant + organization scope the caller is acting in. Nothing here writes — a quotation
 * is `sourcing`'s document, and the library is the only thing this module owns.
 *
 * The two table shapes are declared here because a cross-module read is a projection, not an
 * entity dependency; the handle is cast once because MikroORM types `getKysely()`'s DB generic as
 * `never` (a bare call can address no table at all).
 */
type SourcingReadTables = {
  sourcing_quotes: {
    id: string
    tenant_id: string
    organization_id: string
    supplier_id: string | null
    currency_code: string
    deleted_at: Date | null
  }
  sourcing_quote_lines: {
    id: string
    tenant_id: string
    organization_id: string
    quote_id: string
    line_number: number
    item_no: string | null
    product_name: string | null
    variant_label: string | null
    derived_sku: string | null
    hs_code: string | null
    description: string | null
    unit: string
    unit_cost: string | null
    currency_code: string | null
    moq_quantity: number | null
    carton_quantity: number | null
    unit_net_weight: string | null
    carton_gross_weight: string | null
    carton_net_weight: string | null
    inner_packing: Record<string, unknown> | null
    outer_packing: Record<string, unknown> | null
    row_status: string
    promoted_product_id: string | null
    updated_at: Date
  }
}

const readDb = (em: EntityManager): Kysely<SourcingReadTables> =>
  em.fork().getKysely() as unknown as Kysely<SourcingReadTables>

export type QuoteRef = {
  id: string
  supplierId: string | null
  currencyCode: string
}

/** One quotation line as the library import needs it. */
export type QuoteLineRef = {
  id: string
  quoteId: string
  lineNumber: number
  itemNo: string | null
  productName: string | null
  variantLabel: string | null
  derivedSku: string | null
  hsCode: string | null
  description: string | null
  unit: string
  unitCost: string | null
  currencyCode: string | null
  moqQuantity: number | null
  cartonQuantity: number | null
  unitNetWeight: string | null
  cartonGrossWeight: string | null
  cartonNetWeight: string | null
  innerPacking: Record<string, unknown> | null
  outerPacking: Record<string, unknown> | null
  /** Set once the line was promoted into the product master; the library row then links to it. */
  promotedProductId: string | null
}

export async function loadQuote(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  quoteId: string,
): Promise<QuoteRef | null> {
  const row = await readDb(em)
    .selectFrom('sourcing_quotes')
    .select(['id', 'supplier_id', 'currency_code'])
    .where('id', '=', quoteId)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .executeTakeFirst()
  if (!row) return null
  return {
    id: String(row.id),
    supplierId: row.supplier_id ?? null,
    currencyCode: String(row.currency_code ?? 'CNY'),
  }
}

/**
 * The requested lines of one quotation, in line order. A line that is not on this quotation (or
 * not in the caller's scope) is simply absent, which is what makes a stale console import fail
 * per line instead of writing somebody else's rows.
 */
export async function loadQuoteLines(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  quoteId: string,
  lineIds: readonly string[],
): Promise<QuoteLineRef[]> {
  if (lineIds.length === 0) return []
  const rows = await readDb(em)
    .selectFrom('sourcing_quote_lines')
    .select([
      'id',
      'quote_id',
      'line_number',
      'item_no',
      'product_name',
      'variant_label',
      'derived_sku',
      'hs_code',
      'description',
      'unit',
      'unit_cost',
      'currency_code',
      'moq_quantity',
      'carton_quantity',
      'unit_net_weight',
      'carton_gross_weight',
      'carton_net_weight',
      'inner_packing',
      'outer_packing',
      'row_status',
      'promoted_product_id',
    ])
    .where('quote_id', '=', quoteId)
    .where('id', 'in', [...lineIds])
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .orderBy('line_number', 'asc')
    .execute()
  return rows.map((row) => ({
    id: String(row.id),
    quoteId: String(row.quote_id),
    lineNumber: Number(row.line_number ?? 0),
    itemNo: row.item_no ?? null,
    productName: row.product_name ?? null,
    variantLabel: row.variant_label ?? null,
    derivedSku: row.derived_sku ?? null,
    hsCode: row.hs_code ?? null,
    description: row.description ?? null,
    unit: String(row.unit ?? 'PCS'),
    unitCost: row.unit_cost === null || row.unit_cost === undefined ? null : String(row.unit_cost),
    currencyCode: row.currency_code ?? null,
    moqQuantity: row.moq_quantity === null || row.moq_quantity === undefined ? null : Number(row.moq_quantity),
    cartonQuantity: row.carton_quantity === null || row.carton_quantity === undefined ? null : Number(row.carton_quantity),
    unitNetWeight: row.unit_net_weight === null || row.unit_net_weight === undefined ? null : String(row.unit_net_weight),
    cartonGrossWeight:
      row.carton_gross_weight === null || row.carton_gross_weight === undefined ? null : String(row.carton_gross_weight),
    cartonNetWeight: row.carton_net_weight === null || row.carton_net_weight === undefined ? null : String(row.carton_net_weight),
    innerPacking: row.inner_packing ?? null,
    outerPacking: row.outer_packing ?? null,
    promotedProductId: row.promoted_product_id ? String(row.promoted_product_id) : null,
  }))
}

/** The last quotation line that priced one supplier code, for the promotion's price fallback. */
export type LatestQuotedPrice = {
  currencyCode: string
  minQuantity: number
  unitPrice: string
}

/**
 * The newest line (by line update) that quoted `supplierSku` for this supplier, with the currency
 * it was quoted in. Null when the code was never quoted, which is what makes a row sync without a
 * price instead of with an invented one.
 */
export async function findLatestQuotedPrice(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  supplierId: string,
  supplierSku: string,
): Promise<LatestQuotedPrice | null> {
  const row = await readDb(em)
    .selectFrom('sourcing_quote_lines as line')
    .innerJoin('sourcing_quotes as quote', 'quote.id', 'line.quote_id')
    .select([
      'line.unit_cost',
      'line.currency_code',
      'line.moq_quantity',
      'quote.currency_code as quote_currency_code',
    ])
    .where('quote.supplier_id', '=', supplierId)
    .where('quote.deleted_at', 'is', null)
    .where('line.tenant_id', '=', scope.tenantId)
    .where('line.organization_id', '=', scope.organizationId)
    .where((eb) => eb.or([eb('line.derived_sku', '=', supplierSku), eb('line.item_no', '=', supplierSku)]))
    .orderBy('line.updated_at', 'desc')
    .limit(1)
    .executeTakeFirst()
  if (!row) return null
  const currency = (row.currency_code ?? row.quote_currency_code ?? 'CNY').toUpperCase()
  const minQuantity = row.moq_quantity === null || row.moq_quantity === undefined ? 1 : Math.max(1, Math.round(Number(row.moq_quantity)))
  return {
    currencyCode: currency,
    minQuantity,
    unitPrice: row.unit_cost === null || row.unit_cost === undefined ? '0' : String(row.unit_cost),
  }
}
