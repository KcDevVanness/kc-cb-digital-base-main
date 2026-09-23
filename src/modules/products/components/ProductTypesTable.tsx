"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
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
import { toProductTypeFormValues, type ProductTypeRecord } from './ProductTypeForm'

const API_PATH = 'products/types'
const LIST_HREF = '/backend/products/types'
const PAGE_SIZE = 50
const QUERY_KEY_ROOT = 'products-types'

const PRODUCT_TYPE_STATUS_MAP: StatusMap<'active' | 'inactive'> = {
  active: 'success',
  inactive: 'neutral',
}

/**
 * Column ids double as the API's `sortField` values: the types list validates `sortField`
 * against `code | name | sort_order`, so the sort-order column must be addressed by its
 * snake_case id even though the payload field is `sortOrder`.
 */
function buildColumns(t: TranslateFn): ColumnDef<ProductTypeRecord>[] {
  return [
    {
      id: 'code',
      accessorFn: (row) => row.code,
      header: t('products.types.list.columns.code'),
      meta: { priority: 1 },
    },
    {
      id: 'name',
      accessorFn: (row) => row.name,
      header: t('products.types.list.columns.name'),
      meta: { priority: 2, truncate: true, maxWidth: 320 },
    },
    {
      id: 'nameEn',
      accessorFn: (row) => row.nameEn,
      header: t('products.types.list.columns.nameEn'),
      enableSorting: false,
      meta: { priority: 3, truncate: true, maxWidth: 320 },
      cell: ({ getValue }) => {
        const raw = getValue()
        const nameEn = typeof raw === 'string' ? raw.trim() : ''
        return nameEn.length > 0
          ? nameEn
          : <span className="text-xs text-muted-foreground">—</span>
      },
    },
    {
      id: 'sort_order',
      accessorFn: (row) => row.sortOrder,
      header: t('products.types.list.columns.sortOrder'),
      meta: { priority: 4 },
    },
    {
      id: 'isActive',
      accessorFn: (row) => row.isActive,
      header: t('products.types.list.columns.status'),
      enableSorting: false,
      meta: { priority: 5 },
      cell: ({ row }) => {
        const status = row.original.isActive ? 'active' : 'inactive'
        return (
          <StatusBadge variant={PRODUCT_TYPE_STATUS_MAP[status]} dot>
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

export default function ProductTypesTable() {
  const t = useT()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const scopeVersion = useOrganizationScopeVersion()
  const [search, setSearch] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'sort_order', desc: false }])
  const [page, setPage] = React.useState(1)

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sortField: sorting[0]?.id ?? 'sort_order',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    })
    const query = search.trim()
    if (query) params.set('search', query)
    return params
  }, [page, search, sorting])

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
      return { ...payload, items: (payload.items ?? []).map(toProductTypeFormValues) }
    },
  })

  const rows = data?.items ?? []
  const listError = resolveListError(error, t, t('products.types.form.loadFailed'))

  const handleSortingChange = React.useCallback((next: SortingState) => {
    setSorting(next)
    setPage(1)
  }, [])

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const handleDelete = React.useCallback(async (row: ProductTypeRecord) => {
    const confirmed = await confirm({
      title: t('products.types.actions.deleteConfirmTitle'),
      description: t('products.types.actions.deleteConfirmBody'),
      confirmText: t('products.types.actions.delete'),
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
      // A type that products still reference is refused with a 422 carrying the reason
      // ("deactivate it instead of deleting"); show the server's own wording.
      const message = deleteError instanceof Error && deleteError.message
        ? deleteError.message
        : t('ui.forms.flash.deleteError')
      flash(message, 'error')
    }
  }, [confirm, queryClient, t])

  return (
    <>
      <DataTable<ProductTypeRecord>
        title={(
          <div className="flex flex-col gap-1">
            <h1 className="text-base font-semibold leading-tight">{t('products.types.page.title')}</h1>
            <p className="text-sm font-normal text-muted-foreground">{t('products.types.page.description')}</p>
          </div>
        )}
        columns={columns}
        data={rows}
        actions={(
          <Button asChild>
            <Link href={`${LIST_HREF}/create`}>{t('products.types.actions.create')}</Link>
          </Button>
        )}
        searchValue={search}
        onSearchChange={handleSearchChange}
        searchPlaceholder={t('products.types.list.searchPlaceholder')}
        searchAlign="right"
        sortable
        sorting={sorting}
        onSortingChange={handleSortingChange}
        emptyState={(
          <ListEmptyState
            title={t('products.types.list.empty')}
            createHref={`${LIST_HREF}/create`}
            createLabel={t('products.types.actions.create')}
          />
        )}
        rowActions={(row) => (
          <RowActions
            items={[
              { id: 'edit', label: t('products.types.actions.edit'), href: `${LIST_HREF}/${row.id}/edit` },
              { id: 'delete', label: t('products.types.actions.delete'), destructive: true, onSelect: () => { void handleDelete(row) } },
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
