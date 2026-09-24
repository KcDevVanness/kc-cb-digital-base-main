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
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationNames } from './useOrganizationNames'
import { useSelectedOrganizationId } from './useSelectedOrganizationId'
import { toProductTypeFormValues, type ProductTypeRecord } from './ProductTypeForm'

const API_PATH = 'products/types'
/**
 * The create/edit pages keep their original paths — a stored link must not break — so this base is no
 * longer a list destination: the list surface moved into `/backend/products/taxonomy?tab=lines`.
 */
const ROUTE_BASE = '/backend/products/types'
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
function buildColumns(
  t: TranslateFn,
  organizationLabel: (organizationId: string | null | undefined) => string | null,
): ColumnDef<ProductTypeRecord>[] {
  return [
    {
      id: 'organizationId',
      accessorFn: (row) => row.organizationId,
      header: t('products.types.list.columns.organization'),
      enableSorting: false,
      // Never truncated: two branch names can differ only in their tail, and that tail is exactly what
      // this column exists to show (`DataTable` truncates by default, at 150px when no width is set).
      meta: { priority: 2, truncate: false },
      cell: ({ row }) => {
        const organizationId = row.original.organizationId
        // The name is the point of the column: it is what tells two rows carrying the same code
        // apart. The id is the honest fallback while the switcher payload has not arrived.
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
      id: 'code',
      accessorFn: (row) => row.code,
      header: t('products.types.list.columns.code'),
      meta: { priority: 1 },
    },
    {
      id: 'name',
      accessorFn: (row) => row.name,
      header: t('products.types.list.columns.name'),
      meta: { priority: 3, truncate: true, maxWidth: 320 },
    },
    {
      id: 'nameEn',
      accessorFn: (row) => row.nameEn,
      header: t('products.types.list.columns.nameEn'),
      enableSorting: false,
      meta: { priority: 4, truncate: true, maxWidth: 320 },
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
      meta: { priority: 5 },
    },
    {
      id: 'isActive',
      accessorFn: (row) => row.isActive,
      header: t('products.types.list.columns.status'),
      enableSorting: false,
      meta: { priority: 6 },
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
  const { organizationId, settled: scopeSettled } = useSelectedOrganizationId()
  const organizationLabel = useOrganizationNames()
  const scopeVersion = useOrganizationScopeVersion()
  const [search, setSearch] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'sort_order', desc: false }])
  const [page, setPage] = React.useState(1)

  /**
   * With a concrete organization selected the list is narrowed to it, because every row on this page
   * is rewritten through commands scoped to that organization (`ensureScope`): the factory's read
   * scope expands to descendant organizations, so an unnarrowed list would show a branch's rows under
   * HQ and every save on one would answer `404 not found`. Switching organization switches the list.
   *
   * 「所有组织」 has no such organization, so the page turns into a read-only overview of the tenant:
   * every row carries its organization name in its own column (which is what tells same-coded rows
   * apart) and no row offers an action the commands would reject.
   */
  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sortField: sorting[0]?.id ?? 'sort_order',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    })
    const query = search.trim()
    if (query) params.set('search', query)
    if (organizationId) params.set('organizationId', organizationId)
    return params
  }, [organizationId, page, search, sorting])

  const queryKey = React.useMemo(
    () => [QUERY_KEY_ROOT, queryParams.toString(), scopeVersion],
    [queryParams, scopeVersion],
  )

  const columns = React.useMemo(() => buildColumns(t, organizationLabel), [organizationLabel, t])

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

  // 「所有组织」 is the one scope where a row's own organization is what the operator needs to read
  // the list: nothing can be saved from here (a command needs one organization), so the page becomes
  // a labelled read-only overview instead of offering actions the server would reject.
  const readOnlyScope = scopeSettled && organizationId === null

  return (
    <>
      {readOnlyScope ? (
        <Alert status="information">{t('products.taxonomy.scope.allOrganizationsReadOnly')}</Alert>
      ) : null}
      <DataTable<ProductTypeRecord>
        title={(
          <div className="flex flex-col gap-1">
            <h1 className="text-base font-semibold leading-tight">{t('products.types.page.title')}</h1>
            <p className="text-sm font-normal text-muted-foreground">{t('products.types.page.description')}</p>
          </div>
        )}
        columns={columns}
        data={rows}
        actions={readOnlyScope ? undefined : (
          <Button asChild>
            <Link href={`${ROUTE_BASE}/create`}>{t('products.types.actions.create')}</Link>
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
            createHref={`${ROUTE_BASE}/create`}
            createLabel={t('products.types.actions.create')}
          />
        )}
        rowActions={readOnlyScope ? undefined : (row) => (
          <RowActions
            items={[
              { id: 'edit', label: t('products.types.actions.edit'), href: `${ROUTE_BASE}/${row.id}/edit` },
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
        isLoading={!scopeSettled || isLoading}
        error={listError}
        onRowClick={readOnlyScope ? undefined : (row) => router.push(`${ROUTE_BASE}/${row.id}/edit`)}
      />
      {ConfirmDialogElement}
    </>
  )
}
