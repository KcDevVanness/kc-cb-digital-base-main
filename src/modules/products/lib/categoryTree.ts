import type { EntityManager } from '@mikro-orm/postgresql'
import { ProductsCategory } from '../data/entities'

/**
 * Product-category hierarchy computation.
 *
 * A structural copy of the installed catalog's algorithm
 * (`@open-mercato/core/src/modules/catalog/lib/categoryHierarchy.ts`), rewritten against this
 * module's own entity: the official function is typed to `CatalogProductCategory`, and this
 * module must not import another module's entities. Semantics are identical — a node whose
 * parent is missing (or is itself) is treated as a root, and a cyclic component is broken at
 * the cycle entry instead of recursing forever.
 */

export type ComputedProductCategoryNode = {
  id: string
  tenantId: string
  organizationId: string
  name: string
  pathLabel: string
  parentId: string | null
  depth: number
  rootId: string
  treePath: string
  ancestorIds: string[]
  childIds: string[]
  descendantIds: string[]
  isActive: boolean
}

export type ComputedProductCategoryHierarchy = {
  map: Map<string, ComputedProductCategoryNode>
  ordered: ComputedProductCategoryNode[]
}

type InternalNode = {
  category: ProductsCategory
  parentId: string | null
  children: Set<string>
}

function normalizeId(value: unknown): string | null {
  if (!value) return null
  const normalized = String(value).trim()
  if (!normalized || normalized.toLowerCase() === 'null' || normalized.toLowerCase() === 'undefined') return null
  return normalized
}

export function computeProductCategoryHierarchy(
  categories: ProductsCategory[],
): ComputedProductCategoryHierarchy {
  const nodes = new Map<string, InternalNode>()

  for (const category of categories) {
    const id = String(category.id)
    nodes.set(id, {
      category,
      parentId: normalizeId(category.parentId),
      children: new Set<string>(),
    })
  }

  for (const [id, node] of nodes) {
    const parentId = node.parentId
    if (!parentId || parentId === id || !nodes.has(parentId)) {
      node.parentId = null
      continue
    }
    nodes.get(parentId)!.children.add(id)
  }

  const computed = new Map<string, ComputedProductCategoryNode>()
  const orderedIds: string[] = []
  const orderedSet = new Set<string>()
  const visited = new Set<string>()

  function walk(nodeId: string, ancestors: string[]): string[] {
    if (ancestors.includes(nodeId)) {
      const cyclic = nodes.get(nodeId)
      if (cyclic) {
        computed.set(nodeId, {
          id: nodeId,
          tenantId: cyclic.category.tenantId,
          organizationId: cyclic.category.organizationId,
          name: cyclic.category.name,
          pathLabel: cyclic.category.name,
          parentId: null,
          depth: 0,
          rootId: nodeId,
          treePath: nodeId,
          ancestorIds: [],
          childIds: [],
          descendantIds: [],
          isActive: !!cyclic.category.isActive,
        })
        if (!orderedSet.has(nodeId)) {
          orderedIds.push(nodeId)
          orderedSet.add(nodeId)
        }
      }
      visited.add(nodeId)
      return []
    }

    const node = nodes.get(nodeId)
    if (!node) return []

    visited.add(nodeId)
    const category = node.category
    const id = String(category.id)
    const nextAncestors = [...ancestors, id]
    if (!orderedSet.has(id)) {
      orderedIds.push(id)
      orderedSet.add(id)
    }

    const childIds = Array.from(node.children)
      .filter((childId) => nodes.has(childId))
      .sort((a, b) => {
        const an = nodes.get(a)!.category.name.toLowerCase()
        const bn = nodes.get(b)!.category.name.toLowerCase()
        return an === bn ? a.localeCompare(b) : an.localeCompare(bn)
      })

    const descendantIds: string[] = []
    for (const childId of childIds) {
      const descendants = walk(childId, nextAncestors)
      descendantIds.push(childId, ...descendants)
    }

    const depth = ancestors.length
    const rootId = ancestors.length ? ancestors[0]! : id
    const treePath = nextAncestors.join('/')
    const ancestorNames = ancestors
      .map((ancestorId) => nodes.get(ancestorId)?.category.name)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
    const pathLabel = [...ancestorNames, category.name].join(' / ')

    computed.set(id, {
      id,
      tenantId: category.tenantId,
      organizationId: category.organizationId,
      name: category.name,
      pathLabel,
      parentId: node.parentId,
      depth,
      rootId,
      treePath,
      ancestorIds: ancestors,
      childIds,
      descendantIds,
      isActive: !!category.isActive,
    })
    return descendantIds
  }

  for (const [id, node] of nodes) {
    if (!node.parentId || !nodes.has(node.parentId)) walk(id, [])
  }

  for (const id of nodes.keys()) {
    if (!visited.has(id)) walk(id, [])
  }

  const ordered = orderedIds
    .map((id) => computed.get(id))
    .filter((node): node is ComputedProductCategoryNode => !!node)

  return { map: computed, ordered }
}

/**
 * Recomputes and persists the hierarchy columns for one organization's categories.
 *
 * Called by the category commands after every create/update, so reads are a plain
 * `select` on `products_categories` with the path already stored.
 */
export async function rebuildProductCategoryHierarchyForOrganization(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<ComputedProductCategoryHierarchy> {
  const categories = await em.find(
    ProductsCategory,
    { organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null },
    { orderBy: { name: 'ASC' } },
  )
  const hierarchy = computeProductCategoryHierarchy(categories)
  const now = new Date()
  for (const category of categories) {
    const computed = hierarchy.map.get(String(category.id))
    if (!computed) {
      category.parentId = null
      category.rootId = String(category.id)
      category.treePath = String(category.id)
      category.depth = 0
      category.ancestorIds = []
      category.childIds = []
      category.descendantIds = []
      category.updatedAt = now
      continue
    }
    category.parentId = computed.parentId
    category.rootId = computed.rootId
    category.treePath = computed.treePath
    category.depth = computed.depth
    category.ancestorIds = computed.ancestorIds
    category.childIds = computed.childIds
    category.descendantIds = computed.descendantIds
    category.updatedAt = now
  }
  await em.flush()
  return hierarchy
}

/**
 * True when `candidateParentId` is the node itself or one of its descendants.
 *
 * The stored `descendant_ids` is used when present; the parent chain is walked as well, so the
 * check still holds if a row was imported or edited outside the commands and its hierarchy
 * columns are stale. A cycle must be rejected *before* the write: the rebuild would otherwise
 * silently break the ring at an arbitrary node.
 */
export async function wouldCreateCategoryCycle(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  nodeId: string,
  candidateParentId: string,
): Promise<boolean> {
  if (nodeId === candidateParentId) return true

  const rows = await em.fork().find(
    ProductsCategory,
    { organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null },
    { fields: ['id', 'parentId', 'descendantIds'] },
  )
  // Only the three hierarchy columns are selected, so the map stores exactly those rather than
  // pretending a partially loaded entity is a complete one.
  const byId = new Map<string, { parentId: string | null; descendantIds: string[] }>()
  for (const row of rows) {
    byId.set(String(row.id), {
      parentId: row.parentId ? String(row.parentId) : null,
      descendantIds: Array.isArray(row.descendantIds) ? row.descendantIds.map(String) : [],
    })
  }

  const self = byId.get(nodeId)
  if (self?.descendantIds.some((id) => id === candidateParentId)) return true

  const seen = new Set<string>([candidateParentId])
  let cursor: string | null = candidateParentId
  while (cursor) {
    if (cursor === nodeId) return true
    if (seen.size > rows.length + 1) return true
    const parent = byId.get(cursor)
    const next: string | null = parent?.parentId ?? null
    if (!next || seen.has(next)) return false
    seen.add(next)
    cursor = next
  }
  return false
}
