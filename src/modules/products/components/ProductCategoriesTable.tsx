"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud, fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import {
  buildProductCategoryListRows,
  type ProductCategoryListRow,
} from './ProductCategoryForm'

const API_PATH = 'products/categories'
const LIST_HREF = '/backend/products/categories'
/**
 * The whole tree arrives in one page: the display path of a row is resolved against its
 * sibling rows, so a row whose ancestors fall on another page would lose its label.
 */
const PAGE_SIZE = 200
const QUERY_KEY_ROOT = 'products-categories'

/**
 * The list is ordered by the stored tree path, so a row's level is shown by a run of spacer
 * elements instead of an inline style: the nudge is a design token (`w-3`) and works at any
 * depth, which a fixed Tailwind class per level could not.
 */
function TreeIndent({ depth }: { depth: number }) {
  const levels = Math.max(0, Math.trunc(depth) - 1)
  if (levels === 0) return null
  return (
    <span className="inline-flex" aria-hidden="true">
      {Array.from({ length: levels }).map((_, index) => (
        <span key={index} className="inline-block w-3" />
      ))}
    </span>
  )
}

const PRODUCT_CATEGORY_STATUS_MAP: StatusMap<'active' | 'inactive'> = {
  active: 'success',
  inactive: 'neutral',
}

function buildColumns(t: TranslateFn): ColumnDef<ProductCategoryListRow>[] {
  return [
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
      meta: { priority: 1, truncate: true, maxWidth: 380 },
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          <TreeIndent depth={row.original.depth} />
          {row.original.pathLabel}
        </span>
      ),
    },
    {
      accessorKey: 'name',
      header: t('products.categories.list.columns.name'),
      enableSorting: false,
      meta: { priority: 3 },
    },
    {
      accessorKey: 'parentName',
      header: t('products.categories.list.columns.parent'),
      enableSorting: false,
      meta: { priority: 4 },
      cell: ({ getValue }) => {
        const raw = getValue()
        const parentName = typeof raw === 'string' ? raw.trim() : ''
        return parentName.length > 0
          ? parentName
          : <span className="text-xs text-muted-foreground">—</span>
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
  const scopeVersion = useOrganizationScopeVersion()
  const [search, setSearch] = React.useState('')
  const [page, setPage] = React.useState(1)

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
    })
    const query = search.trim()
    if (query) params.set('search', query)
    return params
  }, [page, search])

  const queryKey = React.useMemo(
    () => [QUERY_KEY_ROOT, queryParams.toString(), scopeVersion],
    [queryParams, scopeVersion],
  )

  const columns = React.useMemo(() => buildColumns(t), [t])

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

  const rows = data?.items ?? []
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

  return (
    <>
      <DataTable<ProductCategoryListRow>
        title={(
          <div className="flex flex-col gap-1">
            <h1 className="text-base font-semibold leading-tight">{t('products.categories.page.title')}</h1>
            <p className="text-sm font-normal text-muted-foreground">{t('products.categories.page.description')}</p>
          </div>
        )}
        columns={columns}
        data={rows}
        actions={(
          <Button asChild>
            <Link href={`${LIST_HREF}/create`}>{t('products.categories.actions.create')}</Link>
          </Button>
        )}
        searchValue={search}
        onSearchChange={handleSearchChange}
        searchPlaceholder={t('products.categories.list.searchPlaceholder')}
        searchAlign="right"
        emptyState={(
          <ListEmptyState
            title={t('products.categories.list.empty')}
            createHref={`${LIST_HREF}/create`}
            createLabel={t('products.categories.actions.create')}
          />
        )}
        rowActions={(row) => (
          <RowActions
            items={[
              { id: 'edit', label: t('products.categories.actions.edit'), href: `${LIST_HREF}/${row.id}/edit` },
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
        isLoading={isLoading}
        error={listError}
        onRowClick={(row) => router.push(`${LIST_HREF}/${row.id}/edit`)}
      />
      {ConfirmDialogElement}
    </>
  )
}
