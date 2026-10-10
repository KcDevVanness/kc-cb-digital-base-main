import type { DictionaryMap } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { isPurchaseOrderStatus, purchaseOrderStatusLabel } from '@/lib/orders/purchaseOrderStatus'
import type { CompanyOrderLinkKind } from '../data/validators'

/**
 * A linked child's frozen status in the hub's own words: the sales dictionary for the two sales
 * kinds, the purchase vocabulary for a purchase order, the raw value otherwise.
 *
 * `null` when the child carries no status at all — sales orders written before the status field was
 * used do (8 of the 9 rows in the development database), and a status badge reading 「—」 is noise,
 * not a state. Callers render a badge only for a non-null label; the hub's row layout simply does
 * without it.
 */
export function childStatusLabel(
  t: TranslateFn,
  kind: CompanyOrderLinkKind,
  status: string | null,
  salesDictionary: DictionaryMap | null,
): string | null {
  if (!status) return null
  if (kind === 'purchase_order') return isPurchaseOrderStatus(status) ? purchaseOrderStatusLabel(t, status) : status
  return salesDictionary?.[status]?.label ?? status
}
