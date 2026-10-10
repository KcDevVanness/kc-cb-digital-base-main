import { describe, expect, it, jest } from '@jest/globals'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { ActionItem, ActionMenuEntry } from '@open-mercato/ui/backend/forms'
import { buildPurchaseOrderRowActions } from '../purchaseOrderRowActions'

/**
 * The purchase-order row's ⋯ menu (REQ-057, TEST-037).
 *
 * The company-order entry is a **state inside the menu** (owner 2026-10-10 复查·三), so the three
 * answers of the batched `order_hub/orders/links?refIds=` lookup have to map to exactly three menus:
 * linked → a jump item, unlinked → a disabled 未关联公司订单 item, unresolved (loading or a 403 the
 * lookup swallowed) → no company-order entry at all.
 */

const t = ((key: string) => `t:${key}`) as TranslateFn

const handlers = () => ({ open: jest.fn(), openCompanyOrder: jest.fn() })

const asItems = (entries: ActionMenuEntry[]): ActionItem[] =>
  entries.filter((entry): entry is ActionItem => 'label' in entry)

describe('buildPurchaseOrderRowActions', () => {
  it('offers only 打开 while the batched lookup has not answered or failed', () => {
    for (const companyOrders of [undefined, null]) {
      const menu = buildPurchaseOrderRowActions({ t, rowId: 'po-1', companyOrders, ...handlers() })
      expect(menu.map((entry) => entry.id)).toEqual(['open'])
    }
  })

  it('opens the row from the always-present 打开 item', () => {
    const spies = handlers()
    const menu = asItems(buildPurchaseOrderRowActions({ t, rowId: 'po-1', companyOrders: new Map(), ...spies }))
    expect(menu[0]).toMatchObject({ id: 'open', label: 't:purchasing.orders.actions.open' })
    menu[0].onSelect?.()
    expect(spies.open).toHaveBeenCalledTimes(1)
  })

  it('jumps to the root order of a linked row', () => {
    const spies = handlers()
    const companyOrders = new Map([['po-1', 'co-1']])
    const menu = asItems(buildPurchaseOrderRowActions({ t, rowId: 'po-1', companyOrders, ...spies }))
    expect(menu[1]).toMatchObject({ id: 'openCompanyOrder', label: 't:purchasing.orders.list.actions.openCompanyOrder' })
    expect(menu[1].disabled).toBeUndefined()
    menu[1].onSelect?.()
    expect(spies.openCompanyOrder).toHaveBeenCalledWith('co-1')
  })

  it('shows an unlinked row as a disabled menu item, never a clickable dead end', () => {
    const spies = handlers()
    const menu = asItems(buildPurchaseOrderRowActions({
      t,
      rowId: 'po-2',
      companyOrders: new Map([['po-1', 'co-1']]),
      ...spies,
    }))
    expect(menu[1]).toMatchObject({
      id: 'noCompanyOrder',
      label: 't:purchasing.orders.list.actions.noCompanyOrder',
      disabled: true,
    })
    menu[1].onSelect?.()
    expect(spies.openCompanyOrder).not.toHaveBeenCalled()
  })
})
