import type { EntityManager } from '@mikro-orm/postgresql'
import type { Kysely } from 'kysely'

/**
 * Which rows a retired code still resolves to.
 *
 * A re-coded row keeps its old characters only in `product_codes_aliases`, so a list search that wants
 * to find the row by the code somebody still has on paper has to ask this module. The read is a
 * declared projection because the caller owns a different table — the same pattern the app uses for
 * every cross-module read.
 */

type AliasTable = {
  product_codes_aliases: {
    id: string
    tenant_id: string
    organization_id: string
    alias_code: string
    target_kind: string
    target_id: string
  }
}

export type AliasTargetKind = 'product' | 'supplier_product'

/**
 * The ids whose retired codes match `likeTerm` (a `%`-wrapped, escaped pattern).
 *
 * Returns an empty array when nothing matches, which callers treat as "no extra branch" rather than
 * as an error: a search that finds nothing by alias must still find everything else.
 */
export async function findAliasTargetIds(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  kind: AliasTargetKind,
  likeTerm: string,
): Promise<string[]> {
  const db = em.fork().getKysely() as unknown as Kysely<AliasTable>
  const rows = await db
    .selectFrom('product_codes_aliases')
    .select(['target_id'])
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('target_kind', '=', kind)
    .where('alias_code', 'ilike', likeTerm)
    .limit(200)
    .execute()
  return rows.map((row) => String(row.target_id))
}
