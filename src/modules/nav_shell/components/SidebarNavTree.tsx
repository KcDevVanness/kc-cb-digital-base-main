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
 */

type SidebarNavTreeProps = {
  variant?: 'desktop' | 'mobile'
}

type TreeRow = { item: NavTreeItem; depth: number }

/**
 * Indentation by depth, as classes rather than a computed `paddingLeft`: the design-system check
 * rejects inline styles, and the tree is at most three levels deep (域 → 模块 → 页面).
 */
const DEPTH_PADDING = ['pl-2', 'pl-5', 'pl-8', 'pl-11'] as const

function hrefIsActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false
  return pathname === href || pathname.startsWith(`${href}/`)
}

function collectActiveIds(items: NavTreeItem[], pathname: string | null, into: Set<string>): boolean {
  let hasActive = false
  for (const item of items) {
    const childActive = item.children ? collectActiveIds(item.children, pathname, into) : false
    const selfActive = hrefIsActive(pathname, item.href)
    if (childActive) into.add(item.id ?? item.href)
    if (childActive || selfActive) hasActive = true
  }
  return hasActive
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

  const activeIds = React.useMemo(() => {
    const into = new Set<string>()
    for (const group of tree.data?.groups ?? []) collectActiveIds(group.items, pathname, into)
    return into
  }, [pathname, tree.data?.groups])

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
    const selfActive = hrefIsActive(pathname, item.href)
    const active = selfActive || activeIds.has(key)
    const padding = DEPTH_PADDING[Math.min(depth, DEPTH_PADDING.length - 1)]

    if (compact) {
      return (
        <div key={key} className="flex flex-col items-center gap-1">
          {hasChildren ? (
            <button
              type="button"
              title={item.title}
              aria-label={item.title}
              aria-expanded={open}
              onClick={() => toggle(key, open)}
              className={`flex h-10 w-10 items-center justify-center rounded-lg ${active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'}`}
            >
              {renderIcon(item, 'size-4')}
            </button>
          ) : (
            <Link
              href={item.href}
              title={item.title}
              aria-label={item.title}
              className={`flex h-10 w-10 items-center justify-center rounded-lg ${active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'}`}
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
          <button
            type="button"
            onClick={() => toggle(key, open)}
            aria-expanded={open}
            className={`relative flex w-full items-center justify-between gap-2 rounded-lg py-2 pr-3 text-left text-sm font-medium ${padding} ${active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'}`}
          >
            <span className="flex min-w-0 items-center gap-2">
              {renderIcon(item, 'size-4')}
              <span className="truncate">{item.title}</span>
            </span>
            <ChevronDown
              aria-hidden
              className={`size-3.5 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`}
            />
          </button>
        ) : (
          <Link
            href={item.href}
            className={`relative flex w-full items-center gap-2 rounded-lg py-2 pr-3 text-sm font-medium ${padding} ${active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'}`}
          >
            {active ? (
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
        const active = group.items.some(
          (item) => hrefIsActive(pathname, item.href) || activeIds.has(item.id ?? item.href),
        )
        return (
          <div key={group.id ?? group.name} className="flex flex-col gap-1 border-b pb-2 last:border-b-0">
            {compact ? null : (
              <button
                type="button"
                onClick={() => toggle(group.id ?? group.name, open)}
                aria-expanded={open}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1 text-left text-xs font-medium uppercase tracking-wider ${active ? 'text-foreground' : 'text-muted-foreground/70'} hover:bg-muted`}
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
