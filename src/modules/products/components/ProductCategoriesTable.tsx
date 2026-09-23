"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud, fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { buildCategoryTree, flattenCategoryTree, type CategoryTreeRow } from '../lib/categoryRows'
import {
  buildProductCategoryListRows,
  type ProductCategoryListRow,
} from './ProductCategoryForm'
import { useOrganizationNames } from './useOrganizationNames'
import { useSelectedOrganizationId } from './useSelectedOrganizationId'

const API_PATH = 'products/categories'
/**
 * The create/edit pages keep their original paths — a stored link must not break — so this base is no
 * longer a list destination: the list surface moved into `/backend/products/taxonomy`.
 */
const ROUTE_BASE = '/backend/products/categories'
/**
 * The whole tree arrives in one page: the display path of a row is resolved against its
 * sibling rows, so a row whose ancestors fall on another page would lose its label.
 */
const PAGE_SIZE = 200
const QUERY_KEY_ROOT = 'products-categories'

/** Shared empty set: the collapsed-branch state starts here and is replaced, never mutated in place. */
const NO_COLLAPSED_IDS: ReadonlySet<string> = new Set()

const PRODUCT_CATEGORY_STATUS_MAP: StatusMap<'active' | 'inactive'> = {
  active: 'success',
  inactive: 'neutral',
}

/**
 * Indents a tree cell by its display depth with a run of spacer elements rather than an inline style:
 * the nudge is a design token (`w-3`) and works at any depth, which a fixed Tailwind class per level
 * could not.
 */
function TreeIndent({ levels }: { levels: number }) {
  if (levels <= 0) return null
  return (
    <span className="inline-flex shrink-0" aria-hidden="true">
      {Array.from({ length: levels }).map((_, index) => (
        <span key={index} className="inline-block w-3" />
      ))}
    </span>
  )
}

/**
 * Column order follows the tree: the name is the first data cell, which carries the indent and the branch
 * toggle. `层级路径` stays as a muted secondary column because a server-side search can return a child
 * whose ancestors are not in the result set.
 */
function buildColumns(
  t: TranslateFn,
  collapsedIds: ReadonlySet<string>,
  onToggleCollapsed: (id: string) => void,
  organizationLabel: (organizationId: string | null | undefined) => string | null,
): ColumnDef<CategoryTreeRow<ProductCategoryListRow>>[] {
  return [
    {
      accessorKey: 'name',
      header: t('products.categories.list.columns.name'),
      enableSorting: false,
      meta: { priority: 1, truncate: true, maxWidth: 320 },
      cell: ({ row }) => {
        const { id, name, displayDepth, hasChildren } = row.original
        const collapsed = collapsedIds.has(id)
        return (
          <span className="inline-flex min-w-0 items-center gap-1">
            <TreeIndent levels={displayDepth} />
            {hasChildren ? (
              <IconButton
                type="button"
                variant="ghost"
                size="xs"
                aria-label={collapsed
                  ? t('ui.dataTable.expand.expandRow', 'Expand row')
                  : t('ui.dataTable.expand.collapseRow', 'Collapse row')}
                aria-expanded={!collapsed}
                onClick={(event) => {
                  event.stopPropagation()
                  onToggleCollapsed(id)
                }}
              >
                {collapsed
                  ? <ChevronRight className="size-4" aria-hidden="true" />
                  : <ChevronDown className="size-4" aria-hidden="true" />}
              </IconButton>
            ) : (
              <span className="inline-block size-6" aria-hidden="true" />
            )}
            <span className="truncate">{name}</span>
          </span>
        )
      },
    },
    {
      accessorKey: 'code',
      header: t('products.categories.list.columns.code'),
      enableSorting: false,
      meta: { priority: 2 },
    },
    {
      accessorKey: 'pathLabel',
      header: t('products.categories.list.columns.path'),
      enableSorting: false,
      meta: { priority: 3, truncate: true, maxWidth: 380 },
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{row.original.pathLabel}</span>
      ),
    },
    {
      id: 'organizationId',
      accessorFn: (row) => row.organizationId,
      header: t('products.categories.list.columns.organization'),
      enableSorting: false,
      // Never truncated, same reason as the product-line tab: the tail of a branch name is the part
      // that tells it apart from its siblings.
      meta: { priority: 4, truncate: false },
      cell: ({ row }) => {
        const organizationId = row.original.organizationId
        // Same reason as the product-line tab: the organization name is what tells two same-coded
        // rows apart once the list can hold more than one organization.
        return (
          <span className="text-sm">
            {organizationLabel(organizationId) ?? (
              <span className="font-mono text-xs text-muted-foreground">{organizationId ?? '—'}</span>
            )}
          </span>
        )
      },
    },
    {
      id: 'isActive',
      accessorFn: (row) => row.isActive,
      header: t('products.categories.list.columns.status'),
      enableSorting: false,
      meta: { priority: 5 },
      cell: ({ row }) => {
        const status = row.original.isActive ? 'active' : 'inactive'
        return (
          <StatusBadge variant={PRODUCT_CATEGORY_STATUS_MAP[status]} dot>
            {status === 'active'
              ? t('products.items.list.status.active')
              : t('products.items.list.status.inactive')}
          </StatusBadge>
        )
      },
    },
  ]
}

/** A 401/403 from the list endpoint means the operator lacks `products.items.view` in this scope. */
function resolveListError(error: unknown, t: TranslateFn, fallback: string): string | null {
  if (!error) return null
  const status = (error as { status?: number }).status
  if (status === 401 || status === 403) return t('products.common.notAuthorized')
  return error instanceof Error && error.message ? error.message : fallback
}

export default function ProductCategoriesTable() {
  const t = useT()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { organizationId, settled: scopeSettled } = useSelectedOrganizationId()
  const organizationLabel = useOrganizationNames()
  const scopeVersion = useOrganizationScopeVersion()
  const [search, setSearch] = React.useState('')
  const [page, setPage] = React.useState(1)
  /**
   * Collapsed branches are the only expansion state this page stores: the tree opens fully — that is what
   * the flat list showed before — so a new search or organization selection starts open instead of
   * inheriting a collapse from rows that are no longer on screen.
   *
   * The table component's own expandable rows are deliberately not used: their state resets whenever the
   * row model changes, which would close the branch the operator just opened and could never open a tree
   * by default. See `lib/categoryRows.ts`.
   */
  const [collapsedIds, setCollapsedIds] = React.useState<ReadonlySet<string>>(NO_COLLAPSED_IDS)
  const handleToggleCollapsed = React.useCallback((id: string) => {
    setCollapsedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  /**
   * Narrowed to the selected organization for the same reason as the product-line tab: reads expand
   * to descendant organizations while every write on this page runs in the selected one, so a
   * tenant-wide tree would hand the operator rows whose saves answer `404 not found`.
   */
  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
    })
    const query = search.trim()
    if (query) params.set('search', query)
    if (organizationId) params.set('organizationId', organizationId)
    return params
  }, [organizationId, page, search])

  const queryKey = React.useMemo(
    () => [QUERY_KEY_ROOT, queryParams.toString(), scopeVersion],
    [queryParams, scopeVersion],
  )

  const columns = React.useMemo(
    () => buildColumns(t, collapsedIds, handleToggleCollapsed, organizationLabel),
    [collapsedIds, handleToggleCollapsed, organizationLabel, t],
  )

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>(
        API_PATH,
        Object.fromEntries(queryParams),
      )
      return { ...payload, items: buildProductCategoryListRows(payload.items ?? []) }
    },
  })

  // The flat, `tree_path`-ordered page becomes a tree: a row whose parent is missing from the result set
  // (a server-side search hit, or a branch cut off by paging) stays a root instead of disappearing.
  const tree = React.useMemo(() => buildCategoryTree(data?.items ?? []), [data])
  const visibleRows = React.useMemo(() => flattenCategoryTree(tree, collapsedIds), [collapsedIds, tree])
  const listError = resolveListError(error, t, t('products.categories.form.loadFailed'))

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const handleDelete = React.useCallback(async (row: ProductCategoryListRow) => {
    const confirmed = await confirm({
      title: t('products.categories.actions.deleteConfirmTitle'),
      description: t('products.categories.actions.deleteConfirmBody'),
      confirmText: t('products.categories.actions.delete'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      // Row deletes carry the row's own optimistic-lock version, so a list rendered
      // before someone else edited the record fails with a 409 instead of deleting a
      // row the user never saw.
      await withScopedApiRequestHeaders(
        buildOptimisticLockHeader(row.updatedAt),
        () => deleteCrud(API_PATH, { id: row.id }),
      )
      flash(t('ui.forms.flash.deleteSuccess'), 'success')
      void queryClient.invalidateQueries({ queryKey: [QUERY_KEY_ROOT] })
    } catch (deleteError) {
      if (surfaceRecordConflict(deleteError, t)) {
        void queryClient.invalidateQueries({ queryKey: [QUERY_KEY_ROOT] })
        return
      }
      // A category with sub-categories, or one products still reference, is refused with a
      // 422 carrying the reason; show the server's own wording instead of a generic text.
      const message = deleteError instanceof Error && deleteError.message
        ? deleteError.message
        : t('ui.forms.flash.deleteError')
      flash(message, 'error')
    }
  }, [confirm, queryClient, t])

  // Same rule as the product-line tab: with a concrete organization selected the tree is narrowed to
  // it, and 「所有组织」 becomes a labelled read-only overview (nothing can be saved from a scope that
  // names no organization).
  const readOnlyScope = scopeSettled && organizationId === null

  return (
    <>
      {readOnlyScope ? (
        <Alert status="information">{t('products.taxonomy.scope.allOrganizationsReadOnly')}</Alert>
      ) : null}
      <DataTable<CategoryTreeRow<ProductCategoryListRow>>
        title={(
          <div className="flex flex-col gap-1">
            <h1 className="text-base font-semibold leading-tight">{t('products.categories.page.title')}</h1>
            <p className="text-sm font-normal text-muted-foreground">{t('products.categories.page.description')}</p>
          </div>
        )}
        columns={columns}
        data={visibleRows}
        actions={readOnlyScope ? undefined : (
          <Button asChild>
            <Link href={`${ROUTE_BASE}/create`}>{t('products.categories.actions.create')}</Link>
          </Button>
        )}
        searchValue={search}
        onSearchChange={handleSearchChange}
        searchPlaceholder={t('products.categories.list.searchPlaceholder')}
        searchAlign="right"
        emptyState={(
          <ListEmptyState
            title={t('products.categories.list.empty')}
            createHref={`${ROUTE_BASE}/create`}
            createLabel={t('products.categories.actions.create')}
          />
        )}
        rowActions={readOnlyScope ? undefined : (row) => (
          <RowActions
            items={[
              { id: 'create-child', label: t('products.categories.actions.createChild'), href: `${ROUTE_BASE}/create?parentId=${row.id}` },
              { id: 'edit', label: t('products.categories.actions.edit'), href: `${ROUTE_BASE}/${row.id}/edit` },
              { id: 'delete', label: t('products.categories.actions.delete'), destructive: true, onSelect: () => { void handleDelete(row) } },
            ]}
          />
        )}
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          total: data?.total ?? 0,
          totalPages: data?.totalPages ?? 0,
          totalIsCapped: data?.totalIsCapped === true,
          onPageChange: setPage,
        }}
        isLoading={!scopeSettled || isLoading}
        error={listError}
        onRowClick={readOnlyScope ? undefined : (row) => router.push(`${ROUTE_BASE}/${row.id}/edit`)}
      />
      {ConfirmDialogElement}
    </>
  )
}
