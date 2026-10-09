import type { NavTreeItem } from './treeTypes'

/**
 * Which row of the sidebar owns the current page, and which rows merely sit above it.
 *
 * Two states, not one. The row whose own page is the current page carries the *marker* (the left bar
 * and the filled background); a row above it is *on the path* and is only bolded. Without the split
 * a branch row lights up next to its own page, because `buildNavTree` hands a branch without a page
 * of its own the href of its first surviving child — 采购 and 采购单 share an href, both read as
 * active — and the marker stops saying which page is open.
 *
 * Pure and pathname-driven so the rule is testable without rendering the tree.
 */

/** How one tree row relates to the current page. */
export type NavRowState =
  /** The current page is this node's own page: marker + filled background. */
  | 'active'
  /** The current page sits below this node: bold, no marker. */
  | 'on-path'
  /** Unrelated. */
  | 'idle'

/** A page is active on its own path and below it (the order hub under `/backend/orders/<id>`). */
export function hrefIsActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** Keys of the nodes that contain the current page — the ancestors a row should bold. */
export function collectActiveIds(items: readonly NavTreeItem[], pathname: string | null): Set<string> {
  const into = new Set<string>()
  const visit = (nodes: readonly NavTreeItem[]): boolean => {
    let hasActive = false
    for (const item of nodes) {
      const childActive = item.children ? visit(item.children) : false
      if (childActive) into.add(item.id ?? item.href)
      if (childActive || hrefIsActive(pathname, item.href)) hasActive = true
    }
    return hasActive
  }
  visit(items)
  return into
}

/**
 * The container always yields: a node that holds the current page is `on-path` even when it links at
 * the very page that is open (采购 → `/backend/purchasing/orders`, the same href as 采购单), so the
 * marker stays on the deepest row that publishes the page.
 */
export function resolveRowState(
  pathname: string | null,
  item: NavTreeItem,
  activeIds: ReadonlySet<string>,
): NavRowState {
  if (activeIds.has(item.id ?? item.href)) return 'on-path'
  return hrefIsActive(pathname, item.href) ? 'active' : 'idle'
}
