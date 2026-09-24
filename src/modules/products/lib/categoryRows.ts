/**
 * Hierarchy shaping for the product-category list.
 *
 * `DataTable`'s `getSubRows` contract expects `data` to hold the **root** rows only: a row that is also
 * returned as someone's child would render twice. The API sends the whole tree as one flat, `tree_path`
 *-ordered page, so the split happens here — and a row whose parent is missing from the set (a server-side
 * search hit, or a subtree split across pages) stays a root instead of disappearing.
 */

export type CategoryTreeSource = { id: string; parentId?: string | null }

export type CategoryTree<T extends CategoryTreeSource> = {
  /** Rows whose parent is absent from the input — the level the table renders directly. */
  roots: T[]
  /** Direct children by parent id, in input order. */
  childrenByParentId: Map<string, T[]>
}

/** A row plus what the tree cell needs: its display indentation and whether it has a branch to toggle. */
export type CategoryTreeRow<T extends CategoryTreeSource> = T & {
  displayDepth: number
  hasChildren: boolean
}

/**
 * True when following `parentId` from `row` comes back to `row`.
 *
 * The write commands reject a category hung under itself or one of its descendants (422), so only
 * raw-SQL data can hold a cycle — but a cycle fed to a recursive row model hangs the browser, so it is
 * worth one bounded walk per row to keep such a row at the root instead.
 */
function isOwnAncestor<T extends CategoryTreeSource>(byId: Map<string, T>, row: T): boolean {
  let current = row.parentId ? byId.get(row.parentId) : undefined
  let hops = 0
  while (current && hops <= byId.size) {
    if (current.id === row.id) return true
    current = current.parentId ? byId.get(current.parentId) : undefined
    hops += 1
  }
  return false
}

export function buildCategoryTree<T extends CategoryTreeSource>(rows: T[]): CategoryTree<T> {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const childrenByParentId = new Map<string, T[]>()
  const roots: T[] = []
  for (const row of rows) {
    const parentId = row.parentId && byId.has(row.parentId) ? row.parentId : null
    if (!parentId || isOwnAncestor(byId, row)) {
      roots.push(row)
      continue
    }
    const siblings = childrenByParentId.get(parentId)
    if (siblings) siblings.push(row)
    else childrenByParentId.set(parentId, [row])
  }
  return { roots, childrenByParentId }
}

/**
 * The rows a tree table shows, in display order: depth-first, with each row's indent level, and a
 * collapsed row hiding its whole branch.
 *
 * The table renders this flat list and owns the toggle, instead of leaning on the table component's own
 * expandable rows — that state resets whenever the row model changes, which would close a tree the
 * operator just opened (and could never default to "all open").
 */
export function flattenCategoryTree<T extends CategoryTreeSource>(
  tree: CategoryTree<T>,
  collapsedIds: ReadonlySet<string>,
): CategoryTreeRow<T>[] {
  const visible: CategoryTreeRow<T>[] = []
  const visit = (row: T, displayDepth: number) => {
    const children = tree.childrenByParentId.get(row.id) ?? []
    visible.push({ ...row, displayDepth, hasChildren: children.length > 0 })
    if (children.length === 0 || collapsedIds.has(row.id)) return
    for (const child of children) visit(child, displayDepth + 1)
  }
  for (const root of tree.roots) visit(root, 0)
  return visible
}
