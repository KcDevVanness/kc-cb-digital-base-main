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
import { toSupplierFormValues, type SupplierRecord } from './SupplierForm'

const API_PATH = 'purchasing/suppliers'
const LIST_HREF = '/backend/purchasing/suppliers'
const PAGE_SIZE = 50
const QUERY_KEY_ROOT = 'purchasing-suppliers'

const SUPPLIER_STATUS_MAP: StatusMap<'active' | 'inactive'> = {
  active: 'success',
  inactive: 'neutral',
}

function buildColumns(t: TranslateFn): ColumnDef<SupplierRecord>[] {
  return [
    {
      accessorKey: 'name',
      header: t('purchasing.suppliers.list.columns.name'),
      meta: { priority: 1, truncate: true, maxWidth: 320 },
    },
    {
      accessorKey: 'code',
      header: t('purchasing.suppliers.list.columns.code'),
      meta: { priority: 2 },
    },
    {
      accessorKey: 'contactName',
      header: t('purchasing.suppliers.list.columns.contact'),
      enableSorting: false,
      meta: { priority: 3, truncate: true, maxWidth: 240 },
      cell: ({ getValue }) => {
        const raw = getValue()
        const contact = typeof raw === 'string' ? raw.trim() : ''
        return contact.length > 0
          ? contact
          : <span className="text-xs text-muted-foreground">—</span>
      },
    },
    {
      accessorKey: 'defaultCurrencyCode',
      header: t('purchasing.suppliers.list.columns.currency'),
      enableSorting: false,
      meta: { priority: 4 },
    },
    {
      accessorKey: 'isActive',
      header: t('purchasing.suppliers.list.columns.status'),
      enableSorting: false,
      meta: { priority: 5 },
      cell: ({ row }) => {
        const status = row.original.isActive ? 'active' : 'inactive'
        return (
          <StatusBadge variant={SUPPLIER_STATUS_MAP[status]} dot>
            {status === 'active'
              ? t('purchasing.suppliers.list.status.active')
              : t('purchasing.suppliers.list.status.inactive')}
          </StatusBadge>
        )
      },
    },
  ]
}

export default function SuppliersTable() {
  const t = useT()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const scopeVersion = useOrganizationScopeVersion()
  const [search, setSearch] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'name', desc: false }])
  const [page, setPage] = React.useState(1)

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sortField: sorting[0]?.id ?? 'name',
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
      return { ...payload, items: (payload.items ?? []).map(toSupplierFormValues) }
    },
  })

  const rows = data?.items ?? []
  const listError = error
    ? (error instanceof Error && error.message ? error.message : t('purchasing.suppliers.form.loadFailed'))
    : null

  const handleSortingChange = React.useCallback((next: SortingState) => {
    setSorting(next)
    setPage(1)
  }, [])

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const handleDelete = React.useCallback(async (row: SupplierRecord) => {
    const confirmed = await confirm({
      title: t('purchasing.suppliers.actions.deleteConfirmTitle'),
      description: t('purchasing.suppliers.actions.deleteConfirmBody'),
      confirmText: t('purchasing.suppliers.actions.delete'),
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
      const message = deleteError instanceof Error && deleteError.message
        ? deleteError.message
        : t('ui.forms.flash.deleteError')
      flash(message, 'error')
    }
  }, [confirm, queryClient, t])

  return (
    <>
      <DataTable<SupplierRecord>
        title={(
          <div className="flex flex-col gap-1">
            <h1 className="text-base font-semibold leading-tight">{t('purchasing.suppliers.page.title')}</h1>
            <p className="text-sm font-normal text-muted-foreground">{t('purchasing.suppliers.page.description')}</p>
          </div>
        )}
        columns={columns}
        data={rows}
        actions={(
          <Button asChild>
            <Link href={`${LIST_HREF}/create`}>{t('purchasing.suppliers.actions.create')}</Link>
          </Button>
        )}
        searchValue={search}
        onSearchChange={handleSearchChange}
        searchPlaceholder={t('purchasing.suppliers.list.searchPlaceholder')}
        searchAlign="right"
        sortable
        sorting={sorting}
        onSortingChange={handleSortingChange}
        emptyState={(
          <ListEmptyState
            title={t('purchasing.suppliers.list.empty')}
            createHref={`${LIST_HREF}/create`}
            createLabel={t('purchasing.suppliers.actions.create')}
          />
        )}
        rowActions={(row) => (
          <RowActions
            items={[
              { id: 'edit', label: t('purchasing.suppliers.actions.edit'), href: `${LIST_HREF}/${row.id}/edit` },
              { id: 'delete', label: t('purchasing.suppliers.actions.delete'), destructive: true, onSelect: () => { void handleDelete(row) } },
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
