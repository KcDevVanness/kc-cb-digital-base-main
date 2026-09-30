import type { EntityManager } from '@mikro-orm/postgresql'

/**
 * 已提醒 — whether a row of the 逾期清单 already has a reminder out.
 *
 * The reminder command keys every notification by `<kind>:<resourceId>:<the day it became late>`
 * (see `overdueReminders.ts`), so the answer is a lookup of that key rather than a second rule: this
 * module reads the `notifications` rows it wrote and reports the newest timestamp per resource. That
 * keeps the worklist honest — it shows exactly what the platform accepted, not what the page assumes
 * was sent.
 *
 * The read is a scoped scalar read of an installed peer table, the same shape as the channel lookup
 * in `lib/tradeTypeChannels.server.ts`.
 */

export type ReminderGroupKeyParts = {
  kind: 'collection_overdue' | 'refund_overdue'
  resourceId: string
  /** `YYYY-MM-DD` — the day the resource became late. */
  lateOn: string
}

/** Parses a reminder group key; anything else (other modules' keys) answers `null`, never a guess. */
export function parseReminderGroupKey(key: string | null | undefined): ReminderGroupKeyParts | null {
  if (!key) return null
  const parts = key.split(':')
  if (parts.length !== 3) return null
  const [kind, resourceId, lateOn] = parts
  if (kind !== 'collection_overdue' && kind !== 'refund_overdue') return null
  if (!resourceId || !/^\d{4}-\d{2}-\d{2}$/.test(lateOn)) return null
  return { kind, resourceId, lateOn }
}

export type ReminderStatusScope = { tenantId: string; organizationId: string }

/**
 * Newest reminder timestamp per resource, for the reminder types this module owns.
 *
 * Plural by design: one resource may have carried several keys over time (a collection that was
 * reminded once, cleared, then went late again gets a new `lateOn`), and the page wants "when was
 * this last told", which is the maximum.
 */
export async function loadOverdueReminderStatuses(
  em: EntityManager,
  scope: ReminderStatusScope,
): Promise<Record<string, string>> {
  const rows = (await (em.fork().getKysely<any>())
    .selectFrom('notifications')
    .select(['group_key', 'created_at'])
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where((eb) =>
      eb.or([
        eb('group_key', 'like', 'collection_overdue:%'),
        eb('group_key', 'like', 'refund_overdue:%'),
      ]),
    )
    .execute()) as Array<{ group_key: string | null; created_at: Date | string | null }>

  const byResource: Record<string, string> = {}
  for (const row of rows) {
    const parsed = parseReminderGroupKey(row.group_key)
    if (!parsed) continue
    const created = row.created_at instanceof Date ? row.created_at : row.created_at ? new Date(row.created_at) : null
    if (!created || Number.isNaN(created.getTime())) continue
    const iso = created.toISOString()
    const current = byResource[parsed.resourceId]
    if (!current || iso > current) byResource[parsed.resourceId] = iso
  }
  return byResource
}
