/**
 * The "narrow this list to the ids a link table resolved" filter.
 *
 * A link filter resolves to a set of ids first (contract → shipments, sales order → shipments), and an
 * unknown or unused link resolves to the **empty** set. Written as `{ $in: [] }` that reaches Postgres
 * as `in ()`, which is a syntax error — the request answers 500 instead of an empty page, and the
 * order hub's 发运单 section would fail for every order that has not been shipped yet, which is the
 * common case.
 *
 * Ids are `gen_random_uuid()` values, so the nil uuid never matches a real row: using it as the single
 * member of an empty set is the honest way to say "match nothing" while still emitting valid SQL.
 */

export const NIL_UUID = '00000000-0000-0000-0000-000000000000'

export function linkIdFilter(ids: readonly string[]): { $in: string[] } {
  return { $in: ids.length > 0 ? [...ids] : [NIL_UUID] }
}
