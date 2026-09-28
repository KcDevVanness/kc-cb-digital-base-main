/**
 * Organization-tree helpers for pickers that offer "an organization the caller may work with".
 *
 * The source of every list here is the **top-bar organization switcher payload**
 * (`parseOrganizationSwitcherScope` in the dictionaries module reads it): it already carries exactly
 * the organizations the caller's ACL grants, with names and a `selectable` flag, so a picker built
 * on it inherits the platform's visibility rules instead of restating them. Three surfaces share
 * this file — the dictionaries page, the internal-sales buyer picker and the product-distribution
 * dialog — which is why the rules live in one place.
 */

/**
 * Structural shape of the switcher's menu nodes. Kept structural so this module does not depend on
 * the dictionaries parser's types.
 */
export type RelatedOrganizationNode = {
  id: string
  name: string
  selectable: boolean
  children: RelatedOrganizationNode[]
}

/**
 * The organizations a record may be addressed to: every node the caller's switcher offers
 * (`selectable`), minus the organization the record is being written in — a record is never
 * addressed to its own organization.
 *
 * Fail-closed by construction: a subsidiary account's payload holds only itself (plus non-selectable
 * ancestors), so it yields no options without a business rule being written here. Non-selectable
 * nodes act as tree context only; their children are still walked.
 */
export function relatedOrganizationEntries(
  nodes: readonly RelatedOrganizationNode[],
  excludeOrganizationId?: string | null,
): Array<{ id: string; name: string }> {
  const entries: Array<{ id: string; name: string }> = []
  const walk = (list: readonly RelatedOrganizationNode[]) => {
    for (const node of list) {
      if (!node || typeof node.id !== 'string' || node.id.length === 0) continue
      const name = typeof node.name === 'string' && node.name.trim().length > 0 ? node.name : node.id
      if (node.selectable !== false && node.id !== excludeOrganizationId) {
        entries.push({ id: node.id, name })
      }
      if (Array.isArray(node.children) && node.children.length > 0) walk(node.children)
    }
  }
  walk(nodes)
  return entries
}

/**
 * Depth-first name lookup for one organization id, regardless of `selectable` — a stored record may
 * already reference an organization the caller can no longer *write* to, and its label must still
 * render instead of the raw id.
 */
export function findOrganizationName(
  nodes: readonly RelatedOrganizationNode[],
  organizationId: string,
): string {
  for (const node of nodes) {
    if (!node || typeof node.id !== 'string') continue
    if (node.id === organizationId) {
      return typeof node.name === 'string' && node.name.trim().length > 0 ? node.name : node.id
    }
    const child = findOrganizationName(Array.isArray(node.children) ? node.children : [], organizationId)
    if (child) return child
  }
  return ''
}
