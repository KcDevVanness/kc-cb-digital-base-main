import { describe, expect, it } from '@jest/globals'
import { buildNavTree, type NavRouteFacts } from '../buildNavTree'
import { NAV_TREE, isNavTreeBranch, type NavTreeChild } from '../navTree'
import type { NavTreeGroup } from '../treeTypes'

/**
 * Unit tests for the pure tree builder: config → chrome shape, the effective-feature filter, the
 * platform's preference pass order (role → adopt defaults → user) and the `itemOrder` pass the
 * installed renderer never applies.
 *
 * The facts are synthesised from `NAV_TREE` itself, so the tests stay valid as the tree grows and
 * the coverage test (`navTree.coverage.test.ts`) owns the "every page is registered" question.
 */

function collectHrefs(children: NavTreeChild[], into: string[] = []): string[] {
  for (const child of children) {
    if (isNavTreeBranch(child)) collectHrefs(child.children, into)
    else into.push(child.href)
  }
  return into
}

const TREE_HREFS = NAV_TREE.flatMap((node) => collectHrefs(node.children))

function facts(overrides: Record<string, Partial<NavRouteFacts>> = {}): NavRouteFacts[] {
  return TREE_HREFS.map((href) => ({
    pattern: href,
    title: `title:${href}`,
    titleKey: `key:${href}`,
    icon: 'package',
    requireFeatures: ['feature.allowed'],
    ...overrides[href],
  }))
}

const translate = (_key: string | undefined, fallback: string) => fallback

function findLeaf(groups: NavTreeGroup[], href: string) {
  for (const group of groups) {
    const stack = [...group.items]
    while (stack.length > 0) {
      const item = stack.pop()!
      if (item.href === href && (!item.children || item.children.length === 0)) return item
      if (item.children) stack.push(...item.children)
    }
  }
  return undefined
}

function findItem(groups: NavTreeGroup[], id: string) {
  for (const group of groups) {
    const stack = [...group.items]
    while (stack.length > 0) {
      const item = stack.pop()!
      if (item.id === id) return item
      if (item.children) stack.push(...item.children)
    }
  }
  return undefined
}

describe('buildNavTree', () => {
  it('maps the config into chrome-shaped groups, keeping node ids and page hrefs as keys', () => {
    const groups = buildNavTree({ entries: facts(), translate })

    expect(groups.map((group) => group.id)).toEqual(NAV_TREE.map((node) => node.id))
    expect(groups.every((group) => group.name.length > 0 && group.defaultName === group.name)).toBe(true)

    const orders = groups.find((group) => group.id === 'tree:orders')!
    expect(orders.items.map((item) => item.id)).toEqual([
      // The workbench is a plain page leaf — its label comes from the page's own metadata — and the
      // four business groups sit beside it on the same level.
      '/backend/orders',
      'tree:module:purchasing',
      'tree:module:export-sales',
      'tree:module:contracts',
      'tree:module:shipping',
    ])

    const purchasing = orders.items.find((item) => item.id === 'tree:module:purchasing')!
    // A group node has no page of its own: the chrome item contract requires an href, so it points
    // at its first page while its preference key stays the explicit node id.
    expect(purchasing.href).toBe('/backend/purchasing/orders')
    expect(purchasing.children?.map((child) => child.href)).toEqual([
      '/backend/purchasing/orders',
      '/backend/purchasing/suppliers',
      '/backend/purchasing/supplier-products',
      '/backend/sourcing/quotes',
    ])

    const leaf = findLeaf(groups, '/backend/wms/inventory')!
    // The translator falls back to the page's own title, so an untranslated key still reads well.
    expect(leaf.title).toBe('title:/backend/wms/inventory')
    expect(leaf.defaultTitle).toBe(leaf.title)
    expect(leaf.iconName).toBe('package')
    expect(leaf.requireFeatures).toEqual(['feature.allowed'])
  })

  it('translates domain and module labels through the supplied translator', () => {
    const groups = buildNavTree({
      entries: facts(),
      translate: (key, fallback) => (key === 'nav_shell.tree.domain.orders' ? '公司订单' : fallback),
    })

    expect(groups.find((group) => group.id === 'tree:orders')?.name).toBe('公司订单')
  })

  it('drops a page the caller is not allowed to see and prunes the nodes left empty', () => {
    const warehouse = NAV_TREE.find((node) => node.id === 'tree:warehouse')!
    const overrides: Record<string, Partial<NavRouteFacts>> = {}
    for (const href of collectHrefs(warehouse.children)) overrides[href] = { requireFeatures: ['feature.wms'] }

    const groups = buildNavTree({
      entries: facts(overrides),
      translate,
      isAllowed: (features) => features?.includes('feature.wms') ?? false,
    })

    expect(groups.map((group) => group.id)).toEqual(['tree:warehouse'])
    expect(findLeaf(groups, '/backend/export-finance/orders')).toBeUndefined()
    expect(findLeaf(groups, '/backend/wms')).toBeDefined()
  })

  it('keeps a page that declares no features for any caller', () => {
    const groups = buildNavTree({
      entries: facts({ '/backend/wms': { requireFeatures: undefined } }),
      translate,
      isAllowed: () => false,
    })

    expect(groups.map((group) => group.id)).toEqual(['tree:warehouse'])
  })

  it('removes a page the route manifest does not publish', () => {
    const entries = facts().filter((entry) => entry.pattern !== '/backend/dictionaries')
    const groups = buildNavTree({ entries, translate })

    expect(findLeaf(groups, '/backend/dictionaries')).toBeUndefined()
    expect(groups.find((group) => group.id === 'tree:master_data')).toBeDefined()
  })

  it('points a group at its first surviving page', () => {
    // The group's href follows the filtered children: a page the manifest does not publish, or the
    // caller may not open, shifts the group's link to the next one instead of leaving a dead href.
    const unpublished = buildNavTree({
      entries: facts().filter((entry) => entry.pattern !== '/backend/purchasing/orders'),
      translate,
    })
    expect(findItem(unpublished, 'tree:module:purchasing')?.href).toBe('/backend/purchasing/suppliers')

    const forbidden = buildNavTree({
      entries: facts({ '/backend/purchasing/orders': { requireFeatures: ['feature.orders'] } }),
      translate,
      isAllowed: (features) => !features?.includes('feature.orders'),
    })
    expect(findItem(forbidden, 'tree:module:purchasing')?.href).toBe('/backend/purchasing/suppliers')
  })

  it('applies role labels, then user labels over them', () => {
    const groups = buildNavTree({
      entries: facts(),
      translate,
      rolePreference: {
        version: 2,
        groupLabels: { 'tree:orders': 'Role orders' },
        itemLabels: { '/backend/wms/inventory': 'Role inventory' },
      },
      userPreference: {
        version: 2,
        groupLabels: { 'tree:orders': 'My orders' },
        itemLabels: { '/backend/wms/inventory': 'My inventory' },
      },
    })

    expect(groups.find((group) => group.id === 'tree:orders')?.name).toBe('My orders')
    expect(findLeaf(groups, '/backend/wms/inventory')?.title).toBe('My inventory')
  })

  it('marks hidden items instead of dropping them, so the editor can offer "show again"', () => {
    const groups = buildNavTree({
      entries: facts(),
      translate,
      rolePreference: { version: 2, hiddenItems: ['/backend/wms/lots'] },
    })

    expect(findLeaf(groups, '/backend/wms/lots')?.hidden).toBe(true)
    expect(findLeaf(groups, '/backend/wms/lots')?.title.length).toBeGreaterThan(0)
  })

  it('recomputes hidden from the user settings once the caller has their own layout', () => {
    // Platform parity, not an accident: `applySidebarPreference` assigns `hidden` from the settings
    // it is given, so the user pass reads the user's own list. The customization editor seeds its
    // draft from the same effective settings, so what it shows and what the tree renders agree.
    const groups = buildNavTree({
      entries: facts(),
      translate,
      rolePreference: { version: 2, hiddenItems: ['/backend/wms/lots'] },
      userPreference: { version: 2, groupLabels: { 'tree:orders': 'My orders' } },
    })

    expect(findLeaf(groups, '/backend/wms/lots')?.hidden).toBe(false)
  })

  it('reorders groups by groupOrder and keeps the config order for unlisted ones', () => {
    const groups = buildNavTree({
      entries: facts(),
      translate,
      userPreference: { version: 2, groupOrder: ['tree:system', 'tree:orders'] },
    })

    expect(groups.slice(0, 2).map((group) => group.id)).toEqual(['tree:system', 'tree:orders'])
    expect(groups.length).toBe(NAV_TREE.length)
  })

  it('applies itemOrder — which the installed renderer persists but never reads back', () => {
    const groups = buildNavTree({
      entries: facts(),
      translate,
      userPreference: {
        version: 2,
        // The keys are the depth-0 items of the group: `tree:finance` holds pages directly, so a
        // page-level order reads there (`tree:orders` holds the workbench page and the four group
        // nodes instead).
        itemOrder: { 'tree:finance': ['/backend/finance/receivables', '/backend/finance/payables'] },
      },
    })

    const finance = groups.find((group) => group.id === 'tree:finance')!
    expect(finance.items.map((item) => item.href).slice(0, 2)).toEqual([
      '/backend/finance/receivables',
      '/backend/finance/payables',
    ])
    // A page the order does not name keeps the config position, after the ranked ones.
    expect(finance.items.map((item) => item.href)).toContain('/backend/finance/expenses')
  })

  it('lets the user itemOrder win over the role itemOrder per group', () => {
    const groups = buildNavTree({
      entries: facts(),
      translate,
      rolePreference: {
        version: 2,
        itemOrder: { 'tree:finance': ['/backend/finance/receivables', '/backend/finance/payables'] },
      },
      userPreference: {
        version: 2,
        itemOrder: { 'tree:finance': ['/backend/finance/payables', '/backend/finance/receivables'] },
      },
    })

    const finance = groups.find((group) => group.id === 'tree:finance')!
    expect(finance.items[0].href).toBe('/backend/finance/payables')
  })

  it('renders a config iconName when the page manifest icon is a ReactNode, not a name', () => {
    // Installed pages export their icon as a ReactNode, so the manifest yields no icon name and the
    // config's `iconName` is what makes the leaf icon-bearing.
    const groups = buildNavTree({
      entries: facts({ '/backend/users': { icon: {} } }),
      translate,
    })

    expect(findLeaf(groups, '/backend/users')?.iconName).toBe('users')
  })

  it('lets a page manifest icon string win over the config iconName', () => {
    const groups = buildNavTree({
      entries: facts({ '/backend/users': { icon: 'target' } }),
      translate,
    })

    expect(findLeaf(groups, '/backend/users')?.iconName).toBe('target')
  })
})
