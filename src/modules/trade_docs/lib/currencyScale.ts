import type { EntityManager } from '@mikro-orm/postgresql'
import { badRequest } from '@open-mercato/shared/lib/crud/errors'
import { resolveCurrencyScale } from './money'

/**
 * Scoped reads this module needs from its neighbours.
 *
 * Raw Kysely reads on purpose: the app-wide rule forbids cross-module ORM relations, and each
 * query is filtered by the same tenant + organization the caller is acting in. Nothing here
 * writes — peer state changes go through their commands.
 */

export type CurrencyScaleInfo = {
  /** Rounding scale used for the financial caliber. */
  scale: number
  /** False when no `currencies` row exists for the code, so the fallback of 2 was used. */
  configured: boolean
}

/** Rounding scale for a currency, read from the FX master's `decimal_places`. */
export async function readCurrencyScale(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  currencyCode: string,
): Promise<number> {
  const info = await readCurrencyScaleInfo(em, scope, currencyCode)
  return info.scale
}

/**
 * Same read, but it also reports **why** the scale is what it is.
 *
 * The contract surfaces show the fallback as a hint: an organization whose currency rows have not
 * been seeded yet silently rounds to two decimals, and finance must know that the financial
 * amount was rounded by the fallback rather than by the currency's own definition.
 */
export async function readCurrencyScaleInfo(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  currencyCode: string,
): Promise<CurrencyScaleInfo> {
  const rows = (await (em.fork().getKysely<any>())
    .selectFrom('currencies')
    .select(['decimal_places'])
    .where('code', '=', currencyCode.toUpperCase())
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('deleted_at', 'is', null)
    .limit(1)
    .execute()) as Array<{ decimal_places: number | string | null }>

  const raw = rows[0]?.decimal_places
  if (raw === null || raw === undefined) {
    return { scale: resolveCurrencyScale(null), configured: false }
  }
  return {
    scale: resolveCurrencyScale(typeof raw === 'number' ? raw : Number(raw)),
    configured: true,
  }
}

export type ProductSnapshot = {
  productId: string
  sku: string | null
  name: string | null
  brand: string | null
  series: string | null
  model: string | null
  spec: string | null
  unit: string | null
  hsCode: string | null
  countryOfOriginCode: string | null
}

type ProductRow = {
  id: string
  sku: string
  name: string
  brand: string | null
  series: string | null
  manufacturer_model: string | null
  spec_summary: string | null
  unit: string | null
  hs_code: string | null
  country_of_origin_code: string | null
}

/**
 * Loads the display snapshot for the products a contract/invoice line references.
 *
 * The snapshot is frozen into the line at write time: renaming or deleting a product afterwards
 * must not rewrite a signed contract. A product that is not visible in this organization fails
 * the whole document — silently dropping a line would issue a document with the wrong total.
 */
export async function readProductSnapshots(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  productIds: string[],
): Promise<Map<string, ProductSnapshot>> {
  const unique = Array.from(new Set(productIds.filter((id) => !!id)))
  const result = new Map<string, ProductSnapshot>()
  if (unique.length === 0) return result

  const rows = (await (em.fork().getKysely<any>())
    .selectFrom('products_products')
    .select([
      'id',
      'sku',
      'name',
      'brand',
      'series',
      'manufacturer_model',
      'spec_summary',
      'unit',
      'hs_code',
      'country_of_origin_code',
    ])
    .where('id', 'in', unique)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('deleted_at', 'is', null)
    .execute()) as ProductRow[]

  for (const row of rows) {
    result.set(String(row.id), {
      productId: String(row.id),
      sku: row.sku ?? null,
      name: row.name ?? null,
      brand: row.brand ?? null,
      series: row.series ?? null,
      model: row.manufacturer_model ?? null,
      spec: row.spec_summary ?? null,
      unit: row.unit ?? null,
      hsCode: row.hs_code ?? null,
      countryOfOriginCode: row.country_of_origin_code ?? null,
    })
  }

  for (const id of unique) {
    if (!result.has(id)) throw badRequest(`Product not found in this organization: ${id}`)
  }
  return result
}

/** The snapshot as it is stored on a line (`product_snapshot` jsonb). */
export function productSnapshotPayload(snapshot: ProductSnapshot): Record<string, unknown> {
  return {
    sku: snapshot.sku,
    name: snapshot.name,
    brand: snapshot.brand,
    series: snapshot.series,
    model: snapshot.model,
    spec: snapshot.spec,
    unit: snapshot.unit,
    hsCode: snapshot.hsCode,
    countryOfOriginCode: snapshot.countryOfOriginCode,
  }
}
