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
import { toPartyFormValues, type PartyRecord } from './PartyForm'

const API_PATH = 'parties'
const LIST_HREF = '/backend/parties'
const PAGE_SIZE = 50
const QUERY_KEY_ROOT = 'parties-list'

const PARTY_STATUS_MAP: StatusMap<'active' | 'inactive'> = {
  active: 'success',
  inactive: 'neutral',
}

/**
 * Sort options stay on plaintext columns: `name` is encrypted, and sorting ciphertext returns rows
 * in a meaningless order (see the module's `encryption.ts`). The code column carries the identity an
 * operator actually reads in lists.
 */
function buildColumns(t: TranslateFn): ColumnDef<PartyRecord>[] {
  return [
    {
      accessorKey: 'code',
      header: t('parties.list.columns.code'),
      meta: { priority: 1 },
    },
    {
      accessorKey: 'name',
      header: t('parties.list.columns.name'),
      enableSorting: false,
      meta: { priority: 2, truncate: true, maxWidth: 320 },
    },
    {
      accessorKey: 'countryCode',
      header: t('parties.list.columns.country'),
      enableSorting: false,
      meta: { priority: 3 },
      cell: ({ getValue }) => {
        const raw = getValue()
        const value = typeof raw === 'string' ? raw.trim() : ''
        return value.length > 0 ? value : <span className="text-xs text-muted-foreground">—</span>
      },
    },
    {
      accessorKey: 'contactName',
      header: t('parties.list.columns.contact'),
      enableSorting: false,
      meta: { priority: 4, truncate: true, maxWidth: 240 },
      cell: ({ row }) => {
        const contact = row.original.contactName.trim()
        const phone = row.original.contactPhone.trim()
        if (contact.length === 0 && phone.length === 0) {
          return <span className="text-xs text-muted-foreground">—</span>
        }
        return (
          <span className="flex flex-col">
            {contact.length > 0 ? <span>{contact}</span> : null}
            {phone.length > 0 ? <span className="text-xs text-muted-foreground">{phone}</span> : null}
          </span>
        )
      },
    },
    {
      accessorKey: 'status',
      header: t('parties.list.columns.status'),
      enableSorting: false,
      meta: { priority: 5 },
      cell: ({ row }) => {
        const status = row.original.status === 'inactive' ? 'inactive' : 'active'
        return (
          <StatusBadge variant={PARTY_STATUS_MAP[status]} dot>
            {status === 'active' ? t('parties.list.status.active') : t('parties.list.status.inactive')}
          </StatusBadge>
        )
      },
    },
  ]
}

export default function PartiesTable() {
  const t = useT()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const scopeVersion = useOrganizationScopeVersion()
  const [search, setSearch] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'code', desc: false }])
  const [page, setPage] = React.useState(1)

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sortField: sorting[0]?.id ?? 'code',
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
      return { ...payload, items: (payload.items ?? []).map(toPartyFormValues) }
    },
  })

  const rows = data?.items ?? []
  const listError = error
    ? (error instanceof Error && error.message ? error.message : t('parties.form.loadFailed'))
    : null

  const handleSortingChange = React.useCallback((next: SortingState) => {
    setSorting(next)
    setPage(1)
  }, [])

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const handleDelete = React.useCallback(
    async (row: PartyRecord) => {
      const confirmed = await confirm({
        title: t('parties.actions.deleteConfirmTitle'),
        description: t('parties.actions.deleteConfirmBody'),
        confirmText: t('parties.actions.delete'),
        variant: 'destructive',
      })
      if (!confirmed) return
      try {
        // The row carries its own version so a list rendered before someone else edited the party
        // fails with a 409 instead of deleting a row the user never saw.
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
    },
    [confirm, queryClient, t],
  )

  return (
    <>
      <DataTable<PartyRecord>
        title={(
          <div className="flex flex-col gap-1">
            <h1 className="text-base font-semibold leading-tight">{t('parties.page.title')}</h1>
            <p className="text-sm font-normal text-muted-foreground">{t('parties.page.description')}</p>
          </div>
        )}
        columns={columns}
        data={rows}
        actions={(
          <Button asChild>
            <Link href={`${LIST_HREF}/create`}>{t('parties.actions.create')}</Link>
          </Button>
        )}
        searchValue={search}
        onSearchChange={handleSearchChange}
        searchPlaceholder={t('parties.list.searchPlaceholder')}
        searchAlign="right"
        sortable
        sorting={sorting}
        onSortingChange={handleSortingChange}
        emptyState={(
          <ListEmptyState
            title={t('parties.list.empty')}
            createHref={`${LIST_HREF}/create`}
            createLabel={t('parties.actions.create')}
          />
        )}
        rowActions={(row) => (
          <RowActions
            items={[
              { id: 'edit', label: t('parties.actions.edit'), href: `${LIST_HREF}/${row.id}/edit` },
              { id: 'view', label: t('parties.actions.view'), href: `${LIST_HREF}/${row.id}` },
              { id: 'delete', label: t('parties.actions.delete'), destructive: true, onSelect: () => { void handleDelete(row) } },
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
