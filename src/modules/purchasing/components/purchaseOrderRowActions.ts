import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { ActionMenuEntry } from '@open-mercato/ui/backend/forms'

/**
 * The ⋯ menu of one purchase-order row.
 *
 * 打开 is always there. The company-order entry joins it **as a menu item** (owner 2026-10-10 复查·三:
 * a second button sitting beside the ⋯ 很丑): when the batched reverse lookup answered, a linked row
 * jumps to the root and an unlinked row shows 未关联公司订单 as a disabled item where the action would
 * be; when the lookup has not answered (`undefined`) or failed (`null` — a role without
 * `order_hub.view` gets a 403), the row gets no entry at all rather than a wrong state.
 *
 * Pure on purpose: the three states are the row's behavior contract, so the test pins them without
 * rendering the table.
 */
export function buildPurchaseOrderRowActions({
  t,
  rowId,
  companyOrders,
  open,
  openCompanyOrder,
}: {
  t: TranslateFn
  rowId: string
  /** The page's `order_hub/orders/links?refIds=` answer, or `null`/`undefined` when it is unusable. */
  companyOrders: Map<string, string> | null | undefined
  open: () => void
  openCompanyOrder: (companyOrderId: string) => void
}): ActionMenuEntry[] {
  const items: ActionMenuEntry[] = [
    {
      id: 'open',
      label: t('purchasing.orders.actions.open'),
      onSelect: open,
    },
  ]
  if (!(companyOrders instanceof Map)) return items
  const companyOrderId = companyOrders.get(rowId) ?? null
  if (companyOrderId) {
    items.push({
      id: 'openCompanyOrder',
      label: t('purchasing.orders.list.actions.openCompanyOrder'),
      onSelect: () => openCompanyOrder(companyOrderId),
    })
  } else {
    items.push({
      id: 'noCompanyOrder',
      label: t('purchasing.orders.list.actions.noCompanyOrder'),
      // The row is not on a company order: the menu shows that state where the action would be.
      disabled: true,
      onSelect: () => {},
    })
  }
  return items
}
