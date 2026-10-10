import type { DictionaryMap } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import type { StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import {
  isPurchaseOrderStatus,
  purchaseOrderStatusLabel,
  PURCHASE_ORDER_STATUS_TONES,
} from '@/lib/orders/purchaseOrderStatus'
import type { CompanyOrderLinkKind } from '../data/validators'

/** A linked child's status as the hub renders it: the words **and** the colour. */
export type ChildStatusAppearance = {
  label: string
  /**
   * The badge tone for a status whose colours this app owns (the purchase-order vocabulary). `null`
   * when the colour comes from the sales dictionary instead — `color` below carries it.
   */
  tone: StatusBadgeVariant | null
  /** The sales dictionary's own colour for this value (`#rrggbb`), when it carries one. */
  color: string | null
}

/**
 * A linked child's frozen status in the hub's own words, with the colour it must be drawn in.
 *
 * The words come from where the status lives: the sales dictionary for the two sales kinds, the
 * purchase vocabulary for a purchase order, the raw value otherwise. The colour follows the same
 * split — purchase statuses use the tones `PurchaseOrderStatusBadge` uses (owner 2026-10-10: 不同状态
 * 需要用颜色区分), while a sales status keeps its dictionary colour, exactly as the sales lists draw
 * it — so a 已下单 row can never be one colour here and another on the module's own page.
 *
 * `null` when the child carries no status at all — sales orders written before the status field was
 * used do (8 of the 9 rows in the development database), and a status badge reading 「—」 is noise,
 * not a state. Callers render a badge only for a non-null appearance; the hub's row layout simply
 * does without it.
 */
export function childStatusAppearance(
  t: TranslateFn,
  kind: CompanyOrderLinkKind,
  status: string | null,
  salesDictionary: DictionaryMap | null,
): ChildStatusAppearance | null {
  if (!status) return null
  if (kind === 'purchase_order') {
    // A status outside the vocabulary is a row written by hand: shown as stored, in the neutral tone.
    return isPurchaseOrderStatus(status)
      ? { label: purchaseOrderStatusLabel(t, status), tone: PURCHASE_ORDER_STATUS_TONES[status], color: null }
      : { label: status, tone: 'neutral', color: null }
  }
  const entry = salesDictionary?.[status]
  return { label: entry?.label ?? status, tone: null, color: entry?.color ?? null }
}
