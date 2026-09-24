import { describe, expect, it } from '@jest/globals'
import { buildCategoryTree, flattenCategoryTree } from '../categoryRows'

type Row = { id: string; parentId?: string | null }

describe('buildCategoryTree', () => {
  it('splits a flat tree_path-ordered page into roots and child buckets', () => {
    const rows: Row[] = [
      { id: 'pet', parentId: null },
      { id: 'fountain', parentId: 'pet' },
      { id: 'wireless', parentId: 'fountain' },
    ]

    const { roots, childrenByParentId } = buildCategoryTree(rows)

    expect(roots.map((row) => row.id)).toEqual(['pet'])
    expect(childrenByParentId.get('pet')?.map((row) => row.id)).toEqual(['fountain'])
    expect(childrenByParentId.get('fountain')?.map((row) => row.id)).toEqual(['wireless'])
    expect(childrenByParentId.get('wireless')).toBeUndefined()
  })

  it('keeps a row whose parent is absent from the set as a root', () => {
    const { roots, childrenByParentId } = buildCategoryTree<Row>([
      { id: 'wireless', parentId: 'fountain' },
    ])

    expect(roots.map((row) => row.id)).toEqual(['wireless'])
    expect(childrenByParentId.size).toBe(0)
  })

  it('preserves input order within each level', () => {
    const { roots, childrenByParentId } = buildCategoryTree<Row>([
      { id: 'a', parentId: null },
      { id: 'b', parentId: null },
      { id: 'a1', parentId: 'a' },
      { id: 'a2', parentId: 'a' },
    ])

    expect(roots.map((row) => row.id)).toEqual(['a', 'b'])
    expect(childrenByParentId.get('a')?.map((row) => row.id)).toEqual(['a1', 'a2'])
  })

  it('treats an empty parent id as a root', () => {
    const { roots } = buildCategoryTree<Row>([{ id: 'x', parentId: '' }])

    expect(roots.map((row) => row.id)).toEqual(['x'])
  })

  it('keeps a self-parented or mutually-parented row at the root instead of nesting it forever', () => {
    const { roots, childrenByParentId } = buildCategoryTree<Row>([
      { id: 'self', parentId: 'self' },
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ])

    expect(roots.map((row) => row.id)).toEqual(['self', 'a', 'b'])
    expect(childrenByParentId.size).toBe(0)
  })
})

describe('flattenCategoryTree', () => {
  const rows: Row[] = [
    { id: 'pet', parentId: null },
    { id: 'fountain', parentId: 'pet' },
    { id: 'wireless', parentId: 'fountain' },
    { id: 'food', parentId: null },
  ]

  it('lists the whole tree depth-first with the indent level of each row', () => {
    const visible = flattenCategoryTree(buildCategoryTree(rows), new Set())

    expect(visible.map((row) => [row.id, row.displayDepth])).toEqual([
      ['pet', 0],
      ['fountain', 1],
      ['wireless', 2],
      ['food', 0],
    ])
    expect(visible.map((row) => row.hasChildren)).toEqual([true, true, false, false])
  })

  it('hides a collapsed branch but keeps the row itself', () => {
    const visible = flattenCategoryTree(buildCategoryTree(rows), new Set(['pet']))

    expect(visible.map((row) => row.id)).toEqual(['pet', 'food'])
  })

  it('keeps a collapsed leaf visible once its parent is collapsed away', () => {
    const visible = flattenCategoryTree(buildCategoryTree(rows), new Set(['fountain']))

    expect(visible.map((row) => row.id)).toEqual(['pet', 'fountain', 'food'])
  })
})
