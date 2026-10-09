'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Search } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { resolveInjectedIcon } from '@open-mercato/ui/backend/injection/resolveInjectedIcon'
import { useSidebarCollapse } from '@open-mercato/ui/backend/AppShell'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { Input } from '@open-mercato/ui/primitives/input'
import type { NavTreeGroup, NavTreeItem, NavTreePayload } from '../lib/treeTypes'
import { collectActiveIds, resolveRowState, type NavRowState } from '../lib/navActive'

/**
 * The app's sidebar navigation tree: 域 → 模块 → 页面, rendered from `/api/nav_shell/tree`.
 *
 * Mounted twice by the shell — into the `backend:sidebar:nav` injection spot on desktop and as
 * `mobileSidebarSlot` in the mobile drawer (the drawer does not render injection spots, so the slot
 * is the only way in there). Both mounts read the same uncached endpoint, so a layout saved in
 * `/backend/sidebar-customization` shows up on the next render.
 *
 * The server already removed every page the caller is not authorized for. The client re-checks the
 * surviving entries against the `grantedFeatures` the chrome payload shipped — a second, independent
 * reading of the same rule — and skips that check when the payload says the caller is unrestricted
 * (`featureFiltered: false`), so an admin never loses an entry the server deliberately kept.
 *
 * The open page is marked once: `lib/navActive.ts` decides which row carries the marker (the open
 * page) and which rows only sit above it and are bolded — see the module for why one "active" style
 * is not enough.
 */

type SidebarNavTreeProps = {
  variant?: 'desktop' | 'mobile'
}

type TreeRow = { item: NavTreeItem; depth: number }

/**
 * Indentation by depth, as classes rather than a computed `paddingLeft`: the design-system check
 * rejects inline styles, and the tree is four levels deep in the widest branch (域 → 订单工作台 →
 * 业务组 → 页面); deeper nesting saturates at the last step.
 */
const DEPTH_PADDING = ['pl-2', 'pl-5', 'pl-8', 'pl-11'] as const

/**
 * Row styling per activity state: only the current page carries the marker (the bar and the filled
 * background), while the rows above it are bolded. A branch row shares the href of its first page
 * (采购 → `/backend/purchasing/orders`, the same href 采购单 publishes), so one "active" style lit
 * both rows and the marker stopped naming the open page.
 */
const ROW_TONE: Record<NavRowState, string> = {
  active: 'bg-muted font-semibold text-foreground',
  'on-path': 'font-semibold text-foreground hover:bg-muted',
  idle: 'font-medium text-muted-foreground hover:bg-muted',
}

/** Compact rows are icons alone — no text to bold, so an ancestor keeps just the foreground tone. */
const COMPACT_TONE: Record<NavRowState, string> = {
  active: 'bg-muted text-foreground',
  'on-path': 'text-foreground hover:bg-muted',
  idle: 'text-muted-foreground hover:bg-muted',
}

function filterItems(
  items: NavTreeItem[],
  isVisible: (item: NavTreeItem) => boolean,
  matches: (title: string) => boolean,
): NavTreeItem[] {
  const out: NavTreeItem[] = []
  for (const item of items) {
    if (!isVisible(item)) continue
    const children = item.children ? filterItems(item.children, isVisible, matches) : undefined
    const selfMatches = matches(item.title)
    if (!selfMatches && (!children || children.length === 0)) continue
    out.push({ ...item, children })
  }
  return out
}

export default function SidebarNavTree({ variant = 'desktop' }: SidebarNavTreeProps) {
  const t = useT()
  const pathname = usePathname()
  const { collapsed } = useSidebarCollapse()
  const { payload: chromePayload } = useBackendChrome()
  const compact = variant === 'desktop' && collapsed
  const [query, setQuery] = React.useState('')
  const [openNodes, setOpenNodes] = React.useState<Record<string, boolean>>({})

  const tree = useQuery({
    queryKey: ['nav_shell', 'tree'],
    queryFn: async () => {
      const call = await apiCall<NavTreePayload>('/api/nav_shell/tree', {
        credentials: 'include' as never,
      })
      if (!call.ok || !call.result) throw new Error('nav_shell.tree.unavailable')
      return call.result
    },
    staleTime: 15_000,
  })

  const granted = React.useMemo(
    () => new Set(chromePayload?.grantedFeatures ?? []),
    [chromePayload?.grantedFeatures],
  )
  const recheckFeatures = tree.data?.featureFiltered === true && granted.size > 0
  const isVisible = React.useCallback(
    (item: NavTreeItem): boolean => {
      if (item.hidden === true) return false
      if (!recheckFeatures) return true
      if (!item.requireFeatures || item.requireFeatures.length === 0) return true
      return item.requireFeatures.some((feature) => granted.has(feature))
    },
    [granted, recheckFeatures],
  )

  const queryNorm = query.trim().toLowerCase()
  const queryActive = queryNorm.length > 0
  const matches = React.useCallback(
    (title: string) => !queryActive || title.toLowerCase().includes(queryNorm),
    [queryActive, queryNorm],
  )

  const activeIds = React.useMemo(
    () => collectActiveIds(tree.data?.groups.flatMap((group) => group.items) ?? [], pathname),
    [pathname, tree.data?.groups],
  )

  const groups = React.useMemo(() => {
    if (!tree.data) return []
    const visible = tree.data.groups
      .map((group: NavTreeGroup) => ({ ...group, items: filterItems(group.items, isVisible, matches) }))
      .filter((group) => group.items.length > 0)
    return visible
  }, [isVisible, matches, tree.data])

  const isOpen = React.useCallback(
    (key: string) => {
      if (queryActive) return true
      const explicit = openNodes[key]
      if (explicit !== undefined) return explicit
      // Open by default, like the platform's flat groups: the tree is an overview first, and folding
      // is the user's choice for the session.
      return true
    },
    [openNodes, queryActive],
  )

  const toggle = React.useCallback((key: string, currentlyOpen: boolean) => {
    setOpenNodes((prev) => ({ ...prev, [key]: !currentlyOpen }))
  }, [])

  const renderIcon = React.useCallback(
    (item: NavTreeItem, fallbackClassName: string) =>
      (item.iconName ? resolveInjectedIcon(item.iconName, fallbackClassName) : null) ?? (
        <span aria-hidden className={`${fallbackClassName} rounded-sm bg-muted-foreground/30`} />
      ),
    [],
  )

  const renderRow = (row: TreeRow): React.ReactNode => {
    const { item, depth } = row
    const key = item.id ?? item.href
    const children = item.children ?? []
    const hasChildren = children.length > 0
    const open = isOpen(key)
    const rowState = resolveRowState(pathname, item, activeIds)
    const padding = DEPTH_PADDING[Math.min(depth, DEPTH_PADDING.length - 1)]

    if (compact) {
      return (
        <div key={key} className="flex flex-col items-center gap-1">
          {hasChildren ? (
            <>
              <Link
                href={item.href}
                title={item.title}
                aria-label={item.title}
                className={`flex h-10 w-10 items-center justify-center rounded-lg ${COMPACT_TONE[rowState]}`}
              >
                {renderIcon(item, 'size-4')}
              </Link>
              <button
                type="button"
                title={item.title}
                aria-label={item.title}
                aria-expanded={open}
                onClick={() => toggle(key, open)}
                className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-muted"
              >
                <ChevronDown
                  aria-hidden
                  className={`size-3 transition-transform ${open ? '' : '-rotate-90'}`}
                />
              </button>
            </>
          ) : (
            <Link
              href={item.href}
              title={item.title}
              aria-label={item.title}
              className={`flex h-10 w-10 items-center justify-center rounded-lg ${COMPACT_TONE[rowState]}`}
            >
              {renderIcon(item, 'size-4')}
            </Link>
          )}
          {hasChildren && open ? (
            <div className="flex flex-col items-center gap-1">
              {children.map((child) => renderRow({ item: child, depth: depth + 1 }))}
            </div>
          ) : null}
        </div>
      )
    }

    return (
      <div key={key} className="flex flex-col gap-1">
        {hasChildren ? (
          <div
            className={`relative flex w-full items-center rounded-lg text-sm ${padding} ${ROW_TONE[rowState]}`}
          >
            {rowState === 'active' ? (
              <span aria-hidden className="absolute left-0 top-2 h-5 w-1 rounded-r bg-foreground" />
            ) : null}
            <Link href={item.href} className="flex min-w-0 flex-1 items-center gap-2 py-2 pr-2">
              {renderIcon(item, 'size-4')}
              <span className="truncate">{item.title}</span>
            </Link>
            <button
              type="button"
              onClick={() => toggle(key, open)}
              aria-expanded={open}
              aria-label={item.title}
              className="flex shrink-0 items-center self-stretch pl-1 pr-3"
            >
              <ChevronDown
                aria-hidden
                className={`size-3.5 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`}
              />
            </button>
          </div>
        ) : (
          <Link
            href={item.href}
            className={`relative flex w-full items-center gap-2 rounded-lg py-2 pr-3 text-sm ${padding} ${ROW_TONE[rowState]}`}
          >
            {rowState === 'active' ? (
              <span aria-hidden className="absolute left-0 top-2 h-5 w-1 rounded-r bg-foreground" />
            ) : null}
            {renderIcon(item, 'size-4')}
            <span className="truncate">{item.title}</span>
          </Link>
        )}
        {hasChildren && open ? (
          <div className="flex flex-col gap-1">
            {children.map((child) => renderRow({ item: child, depth: depth + 1 }))}
          </div>
        ) : null}
      </div>
    )
  }

  const showEmpty = !tree.isPending && !tree.isError && groups.length === 0
  const showError = tree.isError && !tree.data

  return (
    <div
      data-nav-shell-tree={variant}
      className={
        variant === 'mobile'
          ? 'flex max-h-128 flex-col gap-2 overflow-y-auto'
          : 'flex flex-col gap-2'
      }
    >
      {!compact ? (
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('nav_shell.search.placeholder')}
          aria-label={t('nav_shell.search.aria')}
          leftIcon={<Search aria-hidden className="size-3.5" />}
          className="text-sm"
        />
      ) : null}

      {tree.isPending ? (
        <p className="px-1 py-2 text-xs text-muted-foreground">{t('nav_shell.loading')}</p>
      ) : null}

      {showError ? (
        <div className="flex flex-col items-start gap-2 px-1 py-2">
          <p className="text-xs text-muted-foreground">{t('nav_shell.loadFailed')}</p>
          <button
            type="button"
            onClick={() => void tree.refetch()}
            className="text-xs font-medium text-foreground underline"
          >
            {t('nav_shell.retry')}
          </button>
        </div>
      ) : null}

      {showEmpty ? (
        <p className="px-1 py-2 text-xs text-muted-foreground">{t('nav_shell.empty')}</p>
      ) : null}

      {groups.map((group) => {
        const open = isOpen(group.id ?? group.name)
        // The domain of the open page is bolded like the rows above it — the marker stays on the page.
        const holdsOpenPage = group.items.some(
          (item) => resolveRowState(pathname, item, activeIds) !== 'idle',
        )
        return (
          <div key={group.id ?? group.name} className="flex flex-col gap-1 border-b pb-2 last:border-b-0">
            {compact ? null : (
              <button
                type="button"
                onClick={() => toggle(group.id ?? group.name, open)}
                aria-expanded={open}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1 text-left text-xs uppercase tracking-wider ${holdsOpenPage ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground/70'} hover:bg-muted`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {renderIcon({ href: group.id ?? group.name, title: group.name, iconName: group.iconName }, 'size-3.5')}
                  <span className="truncate">{group.name}</span>
                </span>
                <ChevronDown
                  aria-hidden
                  className={`size-3 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`}
                />
              </button>
            )}
            {open || compact ? (
              <div className={`flex flex-col gap-1 ${compact ? 'items-center' : ''}`}>
                {group.items.map((item) => renderRow({ item, depth: 0 }))}
              </div>
            ) : null}
          </div>
        )
      })}

      {tree.isError && tree.data ? (
        <div className="flex items-center gap-2 px-1 py-1">
          <span className="text-xs text-muted-foreground">{t('nav_shell.refreshFailed')}</span>
          <button
            type="button"
            onClick={() => void tree.refetch()}
            className="text-xs font-medium text-foreground underline"
          >
            {t('nav_shell.retry')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
