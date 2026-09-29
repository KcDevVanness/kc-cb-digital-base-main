import type { BuyerRefKind } from './buyer'

/**
 * Trade type of a sales document, and the engine marker it travels on.
 *
 * The installed sales chain has no "internal vs external" column, and its `metadata` jsonb is not
 * list-filterable. `channel_id` is the only server-filterable marker a document carries (the list
 * query supports `channelId` / `channelIds` / `channelIdsEmpty`), so each organization owns exactly
 * two system channels and a document points at one of them:
 *
 * - `internal` — 总部 → 分公司 (the buyer is a related organization);
 * - `external` — 分公司 → 当地客户 (the buyer is an app-owned `parties` record).
 *
 * The type is never chosen independently of the buyer: `tradeTypeFromBuyerKind` derives it, so a
 * document cannot end up "internal + external customer". Everything here is pure.
 */

export const SALES_TRADE_TYPES = ['internal', 'external'] as const
export type SalesTradeType = (typeof SALES_TRADE_TYPES)[number]

/**
 * Fixed channel codes. They are the identity the module resolves by — a rename of the channel's
 * display name never breaks the lookup, and a re-run of the seeder never duplicates a channel.
 */
export const TRADE_TYPE_CHANNEL_CODES: Record<SalesTradeType, string> = {
  internal: 'INTERNAL_SALES',
  external: 'EXTERNAL_SALES',
}

/**
 * Channel display names, seeded once per organization. The channel is a *system* row, not a
 * marketing channel: the names are written in one language (the seeded value is the data), and the
 * two trade-type channels are excluded from channel analytics by their code, not by their label.
 */
export const TRADE_TYPE_CHANNEL_NAMES: Record<SalesTradeType, string> = {
  internal: '内部销售',
  external: '对外销售',
}

export function isSalesTradeType(value: unknown): value is SalesTradeType {
  return typeof value === 'string' && (SALES_TRADE_TYPES as readonly string[]).includes(value)
}

/** The trade type a buyer source implies; `none` (a hand-typed name) has no type. */
export function tradeTypeFromBuyerKind(kind: BuyerRefKind): SalesTradeType | null {
  if (kind === 'organization') return 'internal'
  if (kind === 'party') return 'external'
  return null
}

/** The channel id a resolved trade type points at, or `null` when that channel is missing. */
export function channelIdForTradeType(
  type: SalesTradeType,
  channelIds: Partial<Record<SalesTradeType, string | null | undefined>>,
): string | null {
  const id = channelIds[type]
  return typeof id === 'string' && id.length > 0 ? id : null
}

/** Reverse lookup for list rows: which trade type does this document's channel mean. */
export function tradeTypeFromChannelId(
  channelId: string | null | undefined,
  channelIds: Partial<Record<SalesTradeType, string | null | undefined>>,
): SalesTradeType | null {
  if (typeof channelId !== 'string' || channelId.length === 0) return null
  for (const type of SALES_TRADE_TYPES) {
    if (channelIds[type] === channelId) return type
  }
  return null
}

/** Reads `channelId`/`channel_id` off an installed list/detail payload. */
export function readChannelId(item: Record<string, unknown>): string | null {
  const value = item.channelId ?? item.channel_id
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * The trade type a **stored snapshot** implies, for documents written before the channel marker
 * existed (and for the backfill): an organization link is an internal sale, a party link external.
 */
export function tradeTypeFromSnapshot(snapshot: unknown): SalesTradeType | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null
  const link = (snapshot as Record<string, unknown>).internalSales
  if (!link || typeof link !== 'object' || Array.isArray(link)) return null
  const record = link as Record<string, unknown>
  if (typeof record.organizationId === 'string' && record.organizationId.length > 0) return 'internal'
  if (typeof record.partyId === 'string' && record.partyId.length > 0) return 'external'
  return null
}

/** Trade type of a list row: the channel marker first, the frozen snapshot as the fallback. */
export function resolveRowTradeType(
  item: Record<string, unknown>,
  channelIds: Partial<Record<SalesTradeType, string | null | undefined>>,
): SalesTradeType | null {
  const fromChannel = tradeTypeFromChannelId(readChannelId(item), channelIds)
  if (fromChannel) return fromChannel
  const snapshot = item.customerSnapshot ?? item.customer_snapshot
  return tradeTypeFromSnapshot(snapshot)
}

/**
 * Which menu entry a route belongs to. One implementation serves two entries: `/backend/internal-sales/**`
 * (the sales entry — it owns the documents of **both** trade types and lists them together) and
 * `/backend/external-sales/**` (the external-only view of the same documents). The pages under the
 * two prefixes are re-exports, so this is what tells them apart.
 */
export type SalesEntry = 'sales' | 'external'

export function salesEntryFromPathname(pathname: string | null | undefined): SalesEntry {
  return typeof pathname === 'string' && pathname.includes('/external-sales/') ? 'external' : 'sales'
}
