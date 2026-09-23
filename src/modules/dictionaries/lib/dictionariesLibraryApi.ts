import { z } from 'zod'
import {
  DEFAULT_DICTIONARY_ENTRY_SORT_MODE,
  dictionaryEntrySortModes,
  type DictionaryEntrySortMode,
} from '@open-mercato/core/modules/dictionaries/lib/entrySort'

/**
 * Boundaries for the two installed read APIs the app-owned dictionary library page consumes.
 *
 * Both payloads are parsed once, here, into the page's own types: the list route reports the
 * organization each dictionary belongs to (`organizationId`) plus whether it is inherited, and the
 * switcher route is the same organization menu the top bar renders — the page must never borrow
 * organization names from anywhere else, or the two surfaces would disagree about which
 * organization the operator is looking at.
 */

export type DictionaryLibraryEntry = {
  id: string
  key: string
  name: string
  description: string | null
  isSystem: boolean
  isActive: boolean
  entrySortMode: DictionaryEntrySortMode
  organizationId: string
  isInherited: boolean
  managerVisibility: 'default' | 'hidden'
  updatedAt: string | null
}

const dictionaryRowSchema = z
  .object({
    id: z.string().min(1),
    key: z.string().min(1),
    name: z.string().optional(),
    description: z.string().nullish(),
    isSystem: z.boolean().optional(),
    isActive: z.boolean().optional(),
    entrySortMode: z.string().optional(),
    organizationId: z.string().nullish(),
    isInherited: z.boolean().optional(),
    managerVisibility: z.string().optional(),
    updatedAt: z.string().nullish(),
  })
  .passthrough()

export function parseDictionaryRows(raw: unknown): DictionaryLibraryEntry[] {
  const rows = z.array(z.unknown()).safeParse(raw)
  if (!rows.success) return []
  const entries: DictionaryLibraryEntry[] = []
  for (const candidate of rows.data) {
    const parsed = dictionaryRowSchema.safeParse(candidate)
    if (!parsed.success) continue
    const row = parsed.data
    entries.push({
      id: row.id,
      key: row.key,
      name: typeof row.name === 'string' && row.name.trim().length ? row.name : row.key,
      description: row.description ?? null,
      isSystem: row.isSystem === true,
      isActive: row.isActive !== false,
      entrySortMode: dictionaryEntrySortModes.includes(row.entrySortMode as DictionaryEntrySortMode)
        ? (row.entrySortMode as DictionaryEntrySortMode)
        : DEFAULT_DICTIONARY_ENTRY_SORT_MODE,
      organizationId: row.organizationId ?? '',
      isInherited: row.isInherited === true,
      managerVisibility: row.managerVisibility === 'hidden' ? 'hidden' : 'default',
      updatedAt: row.updatedAt ?? null,
    })
  }
  return entries
}

export type OrganizationMenuNode = {
  id: string
  name: string
  depth: number
  selectable: boolean
  children: OrganizationMenuNode[]
}

const organizationNodeSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  depth: z.number().optional(),
  selectable: z.boolean().optional(),
})

/** One malformed node is dropped with its subtree; the rest of the menu still renders. */
function parseOrganizationNodes(raw: unknown): OrganizationMenuNode[] {
  const list = z.array(z.unknown()).safeParse(raw)
  if (!list.success) return []
  const nodes: OrganizationMenuNode[] = []
  for (const candidate of list.data) {
    const parsed = organizationNodeSchema.safeParse(candidate)
    if (!parsed.success) continue
    const node = parsed.data
    nodes.push({
      id: node.id,
      name: typeof node.name === 'string' && node.name.trim().length ? node.name : node.id,
      depth: typeof node.depth === 'number' ? node.depth : 0,
      selectable: node.selectable !== false,
      children: parseOrganizationNodes(
        typeof candidate === 'object' && candidate !== null
          ? (candidate as { children?: unknown }).children
          : undefined,
      ),
    })
  }
  return nodes
}

export type OrganizationSwitcherScope = {
  organizations: OrganizationMenuNode[]
  selectedId: string | null
  canViewAllOrganizations: boolean
}

const organizationSwitcherPayloadSchema = z
  .object({
    items: z.array(z.unknown()).optional(),
    selectedId: z.string().nullish(),
    canViewAllOrganizations: z.boolean().optional(),
  })
  .passthrough()

/**
 * A failing payload yields no organizations and no selection, so the page treats every write as
 * unavailable instead of writing into an organization it cannot name.
 */
export function parseOrganizationSwitcherScope(raw: unknown): OrganizationSwitcherScope {
  const parsed = organizationSwitcherPayloadSchema.safeParse(raw)
  if (!parsed.success) return { organizations: [], selectedId: null, canViewAllOrganizations: false }
  const selectedId = parsed.data.selectedId
  return {
    organizations: parseOrganizationNodes(parsed.data.items),
    selectedId: typeof selectedId === 'string' && selectedId.trim().length ? selectedId : null,
    canViewAllOrganizations: parsed.data.canViewAllOrganizations === true,
  }
}

/** Depth-first organization order — the order the top-bar switcher renders. */
export function flattenOrganizationNodes(nodes: OrganizationMenuNode[]): OrganizationMenuNode[] {
  return nodes.flatMap((node) => [node, ...flattenOrganizationNodes(node.children)])
}
