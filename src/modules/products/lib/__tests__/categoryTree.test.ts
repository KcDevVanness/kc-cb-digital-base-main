import { describe, expect, it } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/postgresql'
import { ProductsCategory } from '../../data/entities'
import { computeProductCategoryHierarchy, wouldCreateCategoryCycle } from '../categoryTree'

const TENANT = '00000000-0000-4000-8000-0000000000aa'
const ORG = '00000000-0000-4000-8000-0000000000bb'

function category(id: string, name: string, parentId: string | null): ProductsCategory {
  const entity = new ProductsCategory()
  entity.id = id
  entity.tenantId = TENANT
  entity.organizationId = ORG
  entity.code = name.toLowerCase()
  entity.name = name
  entity.parentId = parentId
  entity.depth = 0
  entity.ancestorIds = []
  entity.childIds = []
  entity.descendantIds = []
  entity.sortOrder = 0
  entity.isActive = true
  return entity
}

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'

function threeLevelTree(): ProductsCategory[] {
  return [category(A, '宠物', null), category(B, '饮水机', A), category(C, '无线饮水机', B)]
}

describe('computeProductCategoryHierarchy', () => {
  it('derives root, path, depth, ancestors and descendants for a three-level tree', () => {
    const { map, ordered } = computeProductCategoryHierarchy(threeLevelTree())

    const root = map.get(A)!
    expect(root.parentId).toBeNull()
    expect(root.depth).toBe(0)
    expect(root.rootId).toBe(A)
    expect(root.treePath).toBe(A)
    expect(root.ancestorIds).toEqual([])
    expect(root.childIds).toEqual([B])
    expect(root.descendantIds).toEqual([B, C])
    expect(root.pathLabel).toBe('宠物')

    const middle = map.get(B)!
    expect(middle.parentId).toBe(A)
    expect(middle.depth).toBe(1)
    expect(middle.rootId).toBe(A)
    expect(middle.treePath).toBe(`${A}/${B}`)
    expect(middle.ancestorIds).toEqual([A])
    expect(middle.childIds).toEqual([C])
    expect(middle.descendantIds).toEqual([C])
    expect(middle.pathLabel).toBe('宠物 / 饮水机')

    const leaf = map.get(C)!
    expect(leaf.depth).toBe(2)
    expect(leaf.rootId).toBe(A)
    expect(leaf.treePath).toBe(`${A}/${B}/${C}`)
    expect(leaf.ancestorIds).toEqual([A, B])
    expect(leaf.childIds).toEqual([])
    expect(leaf.descendantIds).toEqual([])
    expect(leaf.pathLabel).toBe('宠物 / 饮水机 / 无线饮水机')

    // Depth-first order: a parent is always emitted before its children.
    expect(ordered.map((node) => node.id)).toEqual([A, B, C])
  })

  it('recomputes the paths after a node is moved to the root', () => {
    const categories = threeLevelTree()
    categories[1]!.parentId = null

    const { map } = computeProductCategoryHierarchy(categories)

    const moved = map.get(B)!
    expect(moved.parentId).toBeNull()
    expect(moved.depth).toBe(0)
    expect(moved.rootId).toBe(B)
    expect(moved.treePath).toBe(B)
    expect(moved.ancestorIds).toEqual([])
    // The subtree follows its parent: C is now one level below a root node.
    expect(map.get(C)!.depth).toBe(1)
    expect(map.get(C)!.treePath).toBe(`${B}/${C}`)
    expect(map.get(C)!.ancestorIds).toEqual([B])
    expect(map.get(A)!.childIds).toEqual([])
    expect(map.get(A)!.descendantIds).toEqual([])
  })

  it('treats a node whose parent is missing from the set as a root', () => {
    const orphan = category(C, '无线饮水机', A)
    const { map } = computeProductCategoryHierarchy([orphan])
    expect(map.get(C)!.parentId).toBeNull()
    expect(map.get(C)!.treePath).toBe(C)
  })
})

describe('wouldCreateCategoryCycle', () => {
  function emWith(categories: ProductsCategory[]): EntityManager {
    const fake = {
      fork: () => ({ find: async () => categories }),
    }
    // A two-method structural stand-in for the EntityManager; the function under test only
    // reads rows through `fork().find`.
    return fake as unknown as EntityManager
  }

  const scope = { tenantId: TENANT, organizationId: ORG }

  it('rejects a node parented to itself', async () => {
    await expect(wouldCreateCategoryCycle(emWith(threeLevelTree()), scope, A, A)).resolves.toBe(true)
  })

  it('rejects moving a parent under its own descendant', async () => {
    await expect(wouldCreateCategoryCycle(emWith(threeLevelTree()), scope, A, C)).resolves.toBe(true)
  })

  it('allows an unrelated parent when the stored descendant list is stale', async () => {
    const tree = threeLevelTree()
    const { map } = computeProductCategoryHierarchy(tree)
    for (const row of tree) row.descendantIds = map.get(String(row.id))?.descendantIds ?? []
    // B no longer sits under A, but A's stored column still lists it: the walk of parent
    // pointers (not the stored column) must decide.
    tree[1]!.parentId = null

    await expect(wouldCreateCategoryCycle(emWith(tree), scope, C, A)).resolves.toBe(false)
  })
})
