import { describe, expect, it } from '@jest/globals'
import { collectActiveIds, hrefIsActive, resolveRowState } from '../navActive'
import type { NavTreeItem } from '../treeTypes'

/**
 * The tree of the reported bug, in the shape `buildNavTree` publishes it: a branch without a page of
 * its own (采购) carries the href of its first surviving child (采购单) — the group row and the page
 * row share one href, which is why a single "this node or a child is active" rule marked both rows
 * and the marker stopped naming the open page.
 */
const COMPANY_ORDER_TREE: NavTreeItem[] = [
  {
    id: 'tree:module:order-workbench',
    href: '/backend/orders',
    title: '订单工作台',
    children: [
      {
        id: 'tree:module:purchasing',
        href: '/backend/purchasing/orders',
        title: '采购',
        children: [
          { id: '/backend/purchasing/orders', href: '/backend/purchasing/orders', title: '采购单' },
          {
            id: '/backend/purchasing/suppliers',
            href: '/backend/purchasing/suppliers',
            title: '供应商',
          },
        ],
      },
    ],
  },
]

const nodes: Record<string, NavTreeItem> = {}
for (const workbench of COMPANY_ORDER_TREE) {
  nodes[workbench.title] = workbench
  for (const group of workbench.children ?? []) {
    nodes[group.title] = group
    for (const page of group.children ?? []) nodes[page.title] = page
  }
}

function rowState(pathname: string, title: string): string {
  return resolveRowState(pathname, nodes[title], collectActiveIds(COMPANY_ORDER_TREE, pathname))
}

describe('hrefIsActive', () => {
  it('matches the page itself and everything below it', () => {
    expect(hrefIsActive('/backend/orders', '/backend/orders')).toBe(true)
    expect(hrefIsActive('/backend/orders/42', '/backend/orders')).toBe(true)
    expect(hrefIsActive('/backend/orders-archive', '/backend/orders')).toBe(false)
    expect(hrefIsActive(null, '/backend/orders')).toBe(false)
  })
})

describe('collectActiveIds', () => {
  it('collects the nodes above the open page, never the page itself', () => {
    expect([...collectActiveIds(COMPANY_ORDER_TREE, '/backend/purchasing/orders')].sort()).toEqual([
      'tree:module:order-workbench',
      'tree:module:purchasing',
    ])
  })

  it('keys a node without an explicit id by its href', () => {
    const pages: NavTreeItem[] = [
      {
        href: '/backend/wms',
        title: '仓储与库存',
        children: [{ href: '/backend/wms/inventory', title: '库存' }],
      },
    ]
    expect([...collectActiveIds(pages, '/backend/wms/inventory')]).toEqual(['/backend/wms'])
  })
})

describe('resolveRowState', () => {
  it('marks only the deepest row that publishes the open page', () => {
    expect(rowState('/backend/purchasing/orders', '采购单')).toBe('active')
    expect(rowState('/backend/purchasing/orders', '采购')).toBe('on-path')
    expect(rowState('/backend/purchasing/orders', '订单工作台')).toBe('on-path')
  })

  it('hands the marker to the page row when the group opened on a sibling', () => {
    expect(rowState('/backend/purchasing/suppliers', '供应商')).toBe('active')
    expect(rowState('/backend/purchasing/suppliers', '采购')).toBe('on-path')
    expect(rowState('/backend/purchasing/suppliers', '采购单')).toBe('idle')
  })

  it('keeps the marker on a branch that is itself the open page', () => {
    expect(rowState('/backend/orders', '订单工作台')).toBe('active')
    expect(rowState('/backend/orders', '采购')).toBe('idle')
  })

  it('reads the hub below a page as that page being open', () => {
    expect(rowState('/backend/orders/42', '订单工作台')).toBe('active')
  })
})
