import type { EntityManager } from '@mikro-orm/postgresql'
import type { Kysely } from 'kysely'

/** The trusted scope every order_hub read/write carries. */
export type CompanyOrderScope = { tenantId: string; organizationId: string }

// MikroORM types `getKysely()`'s DB generic as `never`; the handle is cast once to the columns this
// projection actually reads (lesson `.ai/lessons/kysely-bare-handle-types-tables-away.md`).
type NumberReadTable = {
  order_hub_company_orders: {
    number: string | null
    tenant_id: string
    organization_id: string
  }
}

const TABLE = 'order_hub_company_orders'
const NUMBER_PREFIX = 'CO-'
const SEQUENCE_WIDTH = 4

/**
 * The next company-order number in a scope: `CO-<UTC year>-<4 digits>`.
 *
 * The unique index on `(tenant_id, organization_id, number)` is the real guarantee — this only
 * picks the next value, so two concurrent creates can compute the same number and the loser must
 * retry. The create command (`order_hub.orders.create`) therefore catches a unique violation and
 * retries once with a freshly computed number; a second collision is a 409. The sequence is derived
 * from the highest existing number in the same scope and year, so a gap (a deleted order) is never
 * reused.
 */
export async function nextCompanyOrderNumber(
  em: EntityManager,
  scope: CompanyOrderScope,
): Promise<string> {
  const year = new Date().getUTCFullYear()
  const prefix = `${NUMBER_PREFIX}${year}-`
  const rows = (await (em.fork().getKysely() as unknown as Kysely<NumberReadTable>)
    .selectFrom(TABLE)
    .select('number')
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('number', 'like', `${prefix}%`)
    .orderBy('number', 'desc')
    .limit(1)
    .execute()) as Array<{ number: string | null }>
  const last = rows[0]?.number ?? null
  const lastSequence = last ? Number.parseInt(last.slice(prefix.length), 10) : 0
  const next = Number.isFinite(lastSequence) && lastSequence > 0 ? lastSequence + 1 : 1
  return `${prefix}${String(next).padStart(SEQUENCE_WIDTH, '0')}`
}

/** Exposed for the unit test; formatting is the pure part of the number rule. */
export function formatCompanyOrderNumber(year: number, sequence: number): string {
  return `${NUMBER_PREFIX}${year}-${String(sequence).padStart(SEQUENCE_WIDTH, '0')}`
}
