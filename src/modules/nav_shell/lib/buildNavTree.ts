import type {
  BackendChromeNavGroup,
  BackendChromeNavItem,
} from '@open-mercato/shared/modules/navigation/backendChrome'
import type { SidebarPreferencesSettings } from '@open-mercato/shared/modules/navigation/sidebarPreferences'
import {
  applySidebarPreference,
  type SidebarGroupLike,
  type SidebarItemLike,
} from '@open-mercato/core/modules/auth/services/sidebarPreferencesService'
import { NAV_TREE, isNavTreeBranch, type NavTreeBranch, type NavTreeLeaf, type NavTreeNode } from './navTree'

/**
 * Turns `NAV_TREE` into the chrome payload shape the sidebar and the customization editor both
 * read, applying — in the platform's own order — the effective-feature filter, the role preference,
 * the default adoption pass, and the user preference.
 *
 * Pure and dependency-injected on purpose: the route supplies the route manifest, the translator and
 * the two preference records; the unit tests supply their own. Nothing here reads auth, the ORM or
 * the request.
 *
 * Deliberate differences from `resolveBackendChromePayload` (`auth/lib/backendChrome.tsx`), both
 * documented in the module README:
 * - a page whose `requireFeatures` the caller does not hold is **removed**, not marked; nodes left
 *   without any visible page disappear with it, so an unauthorized page never reaches the client;
 * - `itemOrder` is applied here. The installed renderer persists it but never reads it back, so
 *   without this step reordering items inside a domain would save and do nothing.
 */

export type NavRouteFacts = {
  pattern: string
  title?: string
  titleKey?: string
  icon?: unknown
  requireFeatures?: string[]
}

/**
 * The tree payload is a chrome payload plus one field the chrome contract does not carry: the
 * features a page declares, so the client can re-check the server's filtering against the
 * `grantedFeatures` the chrome payload shipped (`SidebarNavTree` does, and skips the check when the
 * payload says it was not feature-filtered — a superadmin's tree).
 */
export type NavTreeItem = BackendChromeNavItem & { requireFeatures?: string[] }
export type NavTreeGroup = Omit<BackendChromeNavGroup, 'items'> & { items: NavTreeItem[] }

export type BuildNavTreeInput = {
  /** Route manifest entries (`BackendRouteManifestEntry[]`); only `pattern` + page metadata is read. */
  entries: readonly NavRouteFacts[]
  translate: (key: string | undefined, fallback: string) => string
  /** Effective-feature predicate; an entry without `requireFeatures` is always allowed. */
  isAllowed?: (features: readonly string[] | undefined) => boolean
  rolePreference?: SidebarPreferencesSettings | null
  userPreference?: SidebarPreferencesSettings | null
}

type TreeItem = {
  id?: string
  href: string
  title: string
  defaultTitle: string
  children?: TreeItem[]
  iconName?: string
  order: number
  requireFeatures?: string[]
  /** Set by the preference pass; the renderer skips hidden entries and the editor can un-hide them. */
  hidden?: boolean
}

type TreeGroup = {
  id: string
  name: string
  defaultName: string
  items: TreeItem[]
  weight: number
  iconName?: string
}

/**
 * `applySidebarPreference`'s generic flows into the *item* type as well as the group type, so calling
 * it as `applySidebarPreference<TreeGroup>` would demand that every item carry the group's extra
 * fields. The runtime contract is the base `SidebarGroupLike` shape (group: id/name/defaultName/
 * items; item: id/href/title/defaultTitle/children), which is exactly what the cast asserts.
 */
function applyPreference(groups: TreeGroup[], settings: SidebarPreferencesSettings): TreeGroup[] {
  return applySidebarPreference(groups as unknown as SidebarGroupLike[], settings) as unknown as TreeGroup[]
}

/** Mirrors `adoptSidebarDefaults` (`backendChrome.tsx:296`): the current label becomes the default. */
function adoptDefaults(groups: TreeGroup[]): TreeGroup[] {
  const adoptItems = (items: TreeItem[]): TreeItem[] =>
    items.map((item) => ({
      ...item,
      defaultTitle: item.title,
      children: item.children ? adoptItems(item.children) : undefined,
    }))
  return groups.map((group) => ({
    ...group,
    defaultName: group.name,
    items: adoptItems(group.items),
  }))
}

/**
 * Reorders the items of each group (and, when a key exists for it, of each nested node) by the
 * persisted `itemOrder` map. User settings win over role settings per key, matching the pass order.
 */
function applyItemOrder(
  groups: TreeGroup[],
  rolePreference: SidebarPreferencesSettings | null | undefined,
  userPreference: SidebarPreferencesSettings | null | undefined,
): TreeGroup[] {
  const orderFor = (key: string): string[] | undefined =>
    userPreference?.itemOrder?.[key] ?? rolePreference?.itemOrder?.[key]

  const reorder = <T extends { id?: string; href: string }>(items: T[], key: string): T[] => {
    const order = orderFor(key)
    if (!order || order.length === 0) return items
    const rank: Record<string, number> = Object.fromEntries(order.map((id, index) => [id, index]))
    return [...items].sort((a, b) => {
      const aRank = rank[a.id ?? a.href]
      const bRank = rank[b.id ?? b.href]
      if (aRank === undefined && bRank === undefined) return 0
      if (aRank === undefined) return 1
      if (bRank === undefined) return -1
      return aRank - bRank
    })
  }

  const reorderItems = (items: TreeItem[]): TreeItem[] =>
    reorder(items, '').map((item) => ({
      ...item,
      children: item.children ? reorderItems(item.children) : undefined,
    }))

  return groups.map((group) => ({
    ...group,
    items: reorderItems(reorder(group.items, group.id)),
  }))
}

export function buildNavTree(input: BuildNavTreeInput): NavTreeGroup[] {
  const byHref: Record<string, NavRouteFacts> = Object.fromEntries(
    input.entries.map((entry) => [entry.pattern, entry]),
  )
  const allowed = input.isAllowed ?? (() => true)
  const label = (key: string | undefined, fallback: string) => input.translate(key, fallback)

  const buildLeaf = (leaf: NavTreeLeaf, order: number): TreeItem | null => {
    const facts = byHref[leaf.href]
    // A page the manifest does not publish is not navigable in this deployment: dropping it keeps
    // the tree honest instead of rendering a link that 404s.
    if (!facts) return null
    // A page that declares no feature is open to every authenticated caller; the predicate only
    // answers the question the page asked.
    if (facts.requireFeatures?.length && !allowed(facts.requireFeatures)) return null
    const title = label(facts.titleKey, facts.title ?? leaf.href)
    return {
      id: leaf.href,
      href: leaf.href,
      title,
      defaultTitle: title,
      // A page's own metadata wins when it names its icon; an exported ReactNode is not a name, so
      // the config's `iconName` is what makes such a page icon-bearing.
      iconName: typeof facts.icon === 'string' ? facts.icon : leaf.iconName,
      requireFeatures: facts.requireFeatures,
      order,
    }
  }

  const buildBranch = (branch: NavTreeBranch, order: number): TreeItem | null => {
    const children = branch.children
      .map((child, index) =>
        isNavTreeBranch(child) ? buildBranch(child, index) : buildLeaf(child, index),
      )
      .filter((item): item is TreeItem => item !== null)
    if (children.length === 0) return null
    const title = label(branch.labelKey, branch.labelKey)
    // The chrome item contract requires an href and the renderer makes the row title a link to it. A
    // group node holds pages, never a page of its own, so it opens its first surviving child — the
    // title reads as "go to the group" (采购 → `/backend/purchasing/orders`) — while the preference
    // key stays the explicit node id.
    return {
      id: branch.id,
      href: children[0].href,
      title,
      defaultTitle: title,
      iconName: branch.iconName,
      order,
      children,
    }
  }

  const buildGroup = (node: NavTreeNode, weight: number): TreeGroup | null => {
    const items = node.children
      .map((child, index) =>
        isNavTreeBranch(child) ? buildBranch(child, index) : buildLeaf(child, index),
      )
      .filter((item): item is TreeItem => item !== null)
    if (items.length === 0) return null
    const name = label(node.labelKey, node.labelKey)
    return {
      id: node.id,
      name,
      defaultName: name,
      weight,
      iconName: node.iconName,
      items: items.map((item, index) => ({ ...item, order: index })),
    }
  }

  const baseGroups = NAV_TREE
    .map((node, index) => buildGroup(node, index))
    .filter((group): group is TreeGroup => group !== null)

  // The platform's pass order, reproduced exactly: role → adopt defaults → user.
  const withRole = input.rolePreference
    ? applyPreference(baseGroups, input.rolePreference)
    : baseGroups
  const adopted = adoptDefaults(withRole)
  const withUser = input.userPreference
    ? applyPreference(adopted, input.userPreference)
    : adopted

  return applyItemOrder(withUser, input.rolePreference, input.userPreference).map(
    ({ weight: _weight, ...group }) => group,
  )
}
