import type { EntityManager } from '@mikro-orm/postgresql'
import type { ReadScope } from './readScope'
import type { SkuMapStatus } from '../data/validators'

/**
 * 未映射 SKU 清单 — **derived**, never a second table.
 *
 * The list is the union of two sources:
 *
 * - every RU code the snapshots have seen (`sku` on the SKU/stock/in-transit/plan/unrecognized
 *   rows, `ru_code` on the mapping rows), which is what "the RU side has this code" means;
 * - every decision recorded in `ru_sync_sku_map` (a binding, or a deliberate ignore).
 *
 * A code with no `mapped` decision is therefore unmapped by construction, and removing a decision
 * (or adding a new RU code) cannot leave the list stale.
 */

const CODE_ENDPOINTS = ['skus', 'sku_mappings', 'stock', 'in_transit', 'plan', 'unrecognized_inbound'] as const

export type SkuMapSources = { endpoint: string; count: number; lastAsOf: string | null }

export type SkuMapListRow = {
  ruSku: string
  status: SkuMapStatus
  productId: string | null
  productSku: string | null
  productName: string | null
  note: string | null
  updatedAt: string | null
  sources: SkuMapSources[]
}

export type SkuMapListResult = {
  items: SkuMapListRow[]
  total: number
  counts: { mapped: number; ignored: number; unmapped: number }
  /** True when at least one product carries no binding — the cockpit's coverage number. */
  hasUnmapped: boolean
}

export type SkuMapFilters = {
  status?: SkuMapStatus | 'all'
  search?: string
  page?: number
  pageSize?: number
}

export async function loadSkuMap(em: EntityManager, scope: ReadScope, filters: SkuMapFilters = {}): Promise<SkuMapListResult> {
  const connection = em.fork().getConnection()
  const organizationIds = scope.organizationIds.length > 0 ? scope.organizationIds : ['00000000-0000-0000-0000-000000000000']
  const placeholders = organizationIds.map(() => '?').join(', ')

  const snapshotCodes = (await connection.execute<Array<{ ru_sku: string; endpoint: string; as_of: string | null; rows: number }>>(
    `select coalesce(payload->>'sku', payload->>'ru_code') as ru_sku,
            endpoint,
            to_char(max(as_of), 'YYYY-MM-DD') as as_of,
            count(*)::int as rows
       from ru_sync_snapshots
      where tenant_id = ?
        and organization_id in (${placeholders})
        and endpoint in (${CODE_ENDPOINTS.map(() => '?').join(', ')})
        and coalesce(payload->>'sku', payload->>'ru_code') is not null
      group by 1, 2`,
    [scope.tenantId, ...organizationIds, ...CODE_ENDPOINTS],
  )) as Array<{ ru_sku: string; endpoint: string; as_of: string | null; rows: number }>

  const decisions = (await connection.execute<
    Array<{
      ru_sku: string
      status: string
      product_id: string | null
      note: string | null
      updated_at: Date | string
      product_sku: string | null
      product_name: string | null
    }>
  >(
    `select m.ru_sku, m.status, m.product_id, m.note, m.updated_at,
            p.sku as product_sku,
            coalesce(cf.value_text, p.title) as product_name
       from ru_sync_sku_map m
       left join catalog_products p
              on p.id = m.product_id and p.deleted_at is null
       left join custom_field_values cf
              on cf.entity_id = 'catalog:catalog_product'
             and cf.record_id = p.id::text
             and cf.field_key = 'name_en'
             and cf.deleted_at is null
      where m.tenant_id = ?
        and m.organization_id in (${placeholders})`,
    [scope.tenantId, ...organizationIds],
  )) as Array<{
    ru_sku: string
    status: string
    product_id: string | null
    note: string | null
    updated_at: Date | string
    product_sku: string | null
    product_name: string | null
  }>

  const sourcesByCode = new Map<string, SkuMapSources[]>()
  for (const row of snapshotCodes) {
    const code = String(row.ru_sku)
    const list = sourcesByCode.get(code) ?? []
    list.push({ endpoint: String(row.endpoint), count: Number(row.rows ?? 0), lastAsOf: row.as_of ?? null })
    sourcesByCode.set(code, list)
  }

  const decisionByCode = new Map(decisions.map((row) => [String(row.ru_sku), row]))
  const codes = new Set<string>([...sourcesByCode.keys(), ...decisionByCode.keys()])

  const all: SkuMapListRow[] = [...codes].map((code) => {
    const decision = decisionByCode.get(code)
    const rawStatus = decision ? String(decision.status) : 'unmapped'
    const status: SkuMapStatus = rawStatus === 'mapped' || rawStatus === 'ignored' ? rawStatus : 'unmapped'
    return {
      ruSku: code,
      status,
      productId: decision?.product_id ? String(decision.product_id) : null,
      productSku: decision?.product_sku ? String(decision.product_sku) : null,
      productName: decision?.product_name ? String(decision.product_name) : null,
      note: decision?.note ?? null,
      updatedAt: decision ? new Date(decision.updated_at).toISOString() : null,
      sources: (sourcesByCode.get(code) ?? []).sort((left, right) => left.endpoint.localeCompare(right.endpoint)),
    }
  })

  const counts = {
    mapped: all.filter((row) => row.status === 'mapped').length,
    ignored: all.filter((row) => row.status === 'ignored').length,
    unmapped: all.filter((row) => row.status === 'unmapped').length,
  }

  const status = filters.status ?? 'all'
  const search = filters.search?.trim().toLowerCase() ?? ''
  const filtered = all
    .filter((row) => (status === 'all' ? true : row.status === status))
    .filter((row) =>
      search.length === 0
        ? true
        : row.ruSku.toLowerCase().includes(search) ||
          (row.productSku ?? '').toLowerCase().includes(search) ||
          (row.productName ?? '').toLowerCase().includes(search),
    )
    // Unmapped first: the list's job is to show what still needs a decision.
    .sort((left, right) => {
      const rank = (row: SkuMapListRow) => (row.status === 'unmapped' ? 0 : row.status === 'mapped' ? 1 : 2)
      if (rank(left) !== rank(right)) return rank(left) - rank(right)
      return left.ruSku.localeCompare(right.ruSku)
    })

  const page = Math.max(1, filters.page ?? 1)
  const pageSize = Math.min(Math.max(filters.pageSize ?? 50, 1), 100)
  const start = (page - 1) * pageSize

  return {
    items: filtered.slice(start, start + pageSize),
    total: filtered.length,
    counts,
    hasUnmapped: counts.unmapped > 0,
  }
}
