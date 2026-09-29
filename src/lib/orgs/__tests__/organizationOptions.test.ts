import { describe, expect, it } from '@jest/globals'
import {
  findOrganizationName,
  relatedOrganizationEntries,
  type RelatedOrganizationNode,
} from '../organizationOptions'

/**
 * The organization-tree rules every picker shares (`src/lib/orgs/organizationOptions.ts`): offer the
 * nodes the switcher marks selectable, never the record's own organization, and never a
 * non-selectable context ancestor — while still walking through one to reach its selectable
 * children. The subsidiary-view case is the fail-closed one: it must hold for whatever the switcher
 * payload happens to contain.
 */

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const BRANCH_ID = '22222222-2222-4222-8222-222222222222'
const SEA_BRANCH_ID = '33333333-3333-4333-8333-333333333333'

const node = (
  id: string,
  name: string,
  selectable = true,
  children: RelatedOrganizationNode[] = [],
): RelatedOrganizationNode => ({ id, name, selectable, children })

describe('relatedOrganizationEntries', () => {
  const tree: RelatedOrganizationNode[] = [
    node(ORG_ID, '广州凯翠国际贸易有限公司', true, [
      node(BRANCH_ID, '俄罗斯 AB 有限公司'),
      node(SEA_BRANCH_ID, '东南亚 AB 有限公司'),
    ]),
  ]

  it('offers the visible organizations except the one the record is written in', () => {
    expect(relatedOrganizationEntries(tree, ORG_ID)).toEqual([
      { id: BRANCH_ID, name: '俄罗斯 AB 有限公司' },
      { id: SEA_BRANCH_ID, name: '东南亚 AB 有限公司' },
    ])
  })

  it('keeps every organization when the scope is "all organizations"', () => {
    expect(relatedOrganizationEntries(tree, null).map((entry) => entry.id)).toEqual([
      ORG_ID,
      BRANCH_ID,
      SEA_BRANCH_ID,
    ])
  })

  it('drops non-selectable context nodes but still walks their children', () => {
    const subsidiaryView: RelatedOrganizationNode[] = [
      node(ORG_ID, '广州凯翠国际贸易有限公司', false, [node(BRANCH_ID, '俄罗斯 AB 有限公司')]),
    ]
    // An ancestor shows up as tree context only; it must never become an option.
    expect(relatedOrganizationEntries(subsidiaryView, BRANCH_ID)).toEqual([])
    expect(relatedOrganizationEntries(subsidiaryView, null)).toEqual([
      { id: BRANCH_ID, name: '俄罗斯 AB 有限公司' },
    ])
  })

  it('falls back to the id when a node carries no name', () => {
    expect(relatedOrganizationEntries([node(BRANCH_ID, '   ')], null)).toEqual([
      { id: BRANCH_ID, name: BRANCH_ID },
    ])
  })
})

describe('findOrganizationName', () => {
  const tree: RelatedOrganizationNode[] = [
    node(ORG_ID, '广州凯翠国际贸易有限公司', true, [node(BRANCH_ID, '俄罗斯 AB 有限公司')]),
  ]

  it('finds a name for label resolution even when the node is not selectable', () => {
    expect(findOrganizationName(tree, BRANCH_ID)).toBe('俄罗斯 AB 有限公司')
    expect(findOrganizationName(tree, ORG_ID)).toBe('广州凯翠国际贸易有限公司')
    expect(findOrganizationName(tree, SEA_BRANCH_ID)).toBe('')
    expect(findOrganizationName([node(SEA_BRANCH_ID, '')], SEA_BRANCH_ID)).toBe(SEA_BRANCH_ID)
  })
})
