import { describe, expect, it } from '@jest/globals'
import { backendRouteMetadata } from '@/.mercato/generated/backend-route-metadata.generated'
import { NAV_TREE, TREE_EXCLUDED, isNavTreeBranch, type NavTreeChild } from '../navTree'

/**
 * The registration ledger for the sidebar tree.
 *
 * A page that the route manifest publishes as navigable (static path, main context, not `navHidden`)
 * must appear either in `NAV_TREE` or in `TREE_EXCLUDED` with a reason — so adding a page without
 * deciding where it belongs in the navigation turns this test red instead of silently shipping a
 * page nobody can reach from the sidebar.
 *
 * Settings- and profile-context pages are out of scope: the shell renders its own settings/profile
 * sidebar for those, and `navHidden` pages are reached from the page that owns the action.
 */

function collectHrefs(children: NavTreeChild[], into: string[] = []): string[] {
  for (const child of children) {
    if (isNavTreeBranch(child)) {
      // A node with a page of its own is a link target too (the workbench node), so its href is part
      // of the registration ledger: it must name a page the manifest publishes.
      if (child.href) into.push(child.href)
      collectHrefs(child.children, into)
    } else into.push(child.href)
  }
  return into
}

const SETTINGS_OR_PROFILE = new Set(
  backendRouteMetadata
    .filter((route) => route.pageContext === 'settings' || route.pageContext === 'profile')
    .map((route) => route.pattern ?? ''),
)

const HIDDEN = new Set(
  backendRouteMetadata.filter((route) => route.navHidden === true).map((route) => route.pattern ?? ''),
)

const TREE_HREFS = NAV_TREE.flatMap((node) => collectHrefs(node.children))
const EXCLUDED_HREFS = TREE_EXCLUDED.map((entry) => entry.href)

const NAVIGABLE = backendRouteMetadata
  .map((route) => route.pattern ?? '')
  .filter(
    (pattern) =>
      pattern.length > 0 &&
      !pattern.includes('[') &&
      !SETTINGS_OR_PROFILE.has(pattern) &&
      !HIDDEN.has(pattern),
  )

describe('nav_shell tree registration', () => {
  it('registers every navigable page in NAV_TREE or TREE_EXCLUDED', () => {
    const tree = new Set(TREE_HREFS)
    const excluded = new Set(EXCLUDED_HREFS)
    const unregistered = NAVIGABLE.filter((pattern) => !tree.has(pattern) && !excluded.has(pattern))

    expect(unregistered).toEqual([])
  })

  it('references only pages the route manifest actually publishes', () => {
    const published = new Set(backendRouteMetadata.map((route) => route.pattern ?? ''))
    const unknown = [...TREE_HREFS, ...EXCLUDED_HREFS].filter((href) => !published.has(href))

    expect(unknown).toEqual([])
  })

  it('never lists the same page as both in-tree and excluded', () => {
    const excluded = new Set(EXCLUDED_HREFS)
    expect(TREE_HREFS.filter((href) => excluded.has(href))).toEqual([])
  })

  it('carries a reason for every exclusion and lists each page once', () => {
    expect(TREE_EXCLUDED.filter((entry) => entry.reason.trim().length === 0)).toEqual([])
    expect(new Set(EXCLUDED_HREFS).size).toBe(EXCLUDED_HREFS.length)
    expect(new Set(TREE_HREFS).size).toBe(TREE_HREFS.length)
  })

  it('uses domain ids and explicit node ids as preference keys', () => {
    const ids = NAV_TREE.map((node) => node.id)
    expect(ids.every((id) => id.startsWith('tree:'))).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)

    const branchIds: string[] = []
    const walk = (children: NavTreeChild[]) => {
      for (const child of children) {
        if (isNavTreeBranch(child)) {
          branchIds.push(child.id)
          walk(child.children)
        }
      }
    }
    for (const node of NAV_TREE) walk(node.children)

    // App-owned module nodes (`tree:module:*`) need an explicit id: without one a node would key
    // itself by its href and collide with the first child page's preference key.
    expect(branchIds.every((id) => id.startsWith('tree:module:'))).toBe(true)
    expect(new Set(branchIds).size).toBe(branchIds.length)
    expect(branchIds.filter((id) => TREE_HREFS.includes(id))).toEqual([])
  })

  it('leads the orders domain with the workbench node and keeps the four business groups under it', () => {
    const orders = NAV_TREE.find((node) => node.id === 'tree:orders')!

    // A future edit that reorders a group or drops one fails here: the workbench is the only entry
    // for creating an order and the four groups are where its blocks are filled in and looked up.
    expect(orders.children.map((child) => (isNavTreeBranch(child) ? child.id : child.href))).toEqual([
      'tree:module:order-workbench',
    ])

    const workbench = orders.children[0]
    if (!isNavTreeBranch(workbench)) throw new Error('the orders domain leads with the workbench node')
    // The second level is the node with a page of its own: its row title opens `/backend/orders` and
    // the four groups hang one level under it.
    expect(workbench.href).toBe('/backend/orders')
    expect(workbench.labelKey).toBe('nav_shell.tree.module.orderWorkbench')
    expect(
      workbench.children.map((child) => (isNavTreeBranch(child) ? child.id : child.href)),
    ).toEqual([
      'tree:module:purchasing',
      'tree:module:export-sales',
      'tree:module:contracts',
      'tree:module:shipping',
    ])
  })

  it('gives every system entry an icon, since their page metadata carries a ReactNode', () => {
    const system = NAV_TREE.find((node) => node.id === 'tree:system')!

    // These installed pages export a ReactNode icon, so a leaf without a config `iconName` would
    // render with no icon at all — the regression these names exist to prevent.
    expect(
      system.children.every(
        (child) => !isNavTreeBranch(child) && (child.iconName ?? '').length > 0,
      ),
    ).toBe(true)
  })

  it('registers the retired order lists in TREE_EXCLUDED so re-adding one fails loudly', () => {
    expect(EXCLUDED_HREFS).toEqual(
      expect.arrayContaining(['/backend/internal-sales/orders', '/backend/external-sales/orders']),
    )
  })
})
