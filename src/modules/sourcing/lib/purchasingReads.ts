import type { EntityManager } from '@mikro-orm/postgresql'

/**
 * Scoped reads of a neighbouring module's table.
 *
 * Raw Kysely on purpose, mirroring `cross_border/lib/purchasingReads.ts`: this module must not
 * import another module's entities (the app-wide rule against cross-module coupling), it needs a
 * single display column, and every query is filtered by the same tenant + organization scope the
 * caller acts in. Nothing here writes — supplier changes go through the purchasing module.
 */
export async function loadSupplierName(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  supplierId: string | null | undefined,
): Promise<string | null> {
  if (!supplierId) return null
  const rows = (await (em.fork().getKysely<any>())
    .selectFrom('purchasing_suppliers')
    .select(['name'])
    .where('id', '=', supplierId)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('deleted_at', 'is', null)
    .execute()) as Array<{ name: string }>
  return rows[0]?.name ?? null
}
