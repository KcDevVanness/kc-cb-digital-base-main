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
import {
  CHANNELS_API_PATH,
  CHANNELS_LIST_HREF,
  toChannelFormValues,
  type ChannelRecord,
} from './ChannelForm'

const PAGE_SIZE = 50
const QUERY_KEY_ROOT = 'platform-ops-channels'

const CHANNEL_STATUS_MAP: StatusMap<'active' | 'inactive'> = {
  active: 'success',
  inactive: 'neutral',
}

function buildColumns(t: TranslateFn): ColumnDef<ChannelRecord>[] {
  return [
    {
      accessorKey: 'name',
      header: t('platform_ops.channels.list.columns.name'),
      meta: { priority: 1, truncate: true, maxWidth: 320 },
    },
    {
      accessorKey: 'code',
      header: t('platform_ops.channels.list.columns.code'),
      meta: { priority: 2 },
    },
    {
      accessorKey: 'platform',
      header: t('platform_ops.channels.list.columns.platform'),
      meta: { priority: 3, truncate: true, maxWidth: 240 },
    },
    {
      accessorKey: 'currencyCode',
      header: t('platform_ops.channels.list.columns.currency'),
      enableSorting: false,
      meta: { priority: 4 },
    },
    {
      accessorKey: 'isActive',
      header: t('platform_ops.channels.list.columns.status'),
      enableSorting: false,
      meta: { priority: 5 },
      cell: ({ row }) => {
        const status = row.original.isActive ? 'active' : 'inactive'
        return (
          <StatusBadge variant={CHANNEL_STATUS_MAP[status]} dot>
            {status === 'active'
              ? t('platform_ops.channels.list.status.active')
              : t('platform_ops.channels.list.status.inactive')}
          </StatusBadge>
        )
      },
    },
  ]
}

export default function ChannelsTable() {
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
        CHANNELS_API_PATH,
        Object.fromEntries(queryParams),
      )
      return { ...payload, items: (payload.items ?? []).map(toChannelFormValues) }
    },
  })

  const rows = data?.items ?? []
  const listError = error
    ? (error instanceof Error && error.message ? error.message : t('platform_ops.channels.form.loadFailed'))
    : null

  const handleSortingChange = React.useCallback((next: SortingState) => {
    setSorting(next)
    setPage(1)
  }, [])

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const handleDelete = React.useCallback(async (row: ChannelRecord) => {
    const confirmed = await confirm({
      title: t('platform_ops.channels.actions.deleteConfirmTitle'),
      description: t('platform_ops.channels.actions.deleteConfirmBody'),
      confirmText: t('platform_ops.channels.actions.delete'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      // Row deletes carry the row's own optimistic-lock version, so a list rendered
      // before someone else edited the channel fails with a 409 instead of deleting a
      // row the user never saw.
      await withScopedApiRequestHeaders(
        buildOptimisticLockHeader(row.updatedAt),
        () => deleteCrud(CHANNELS_API_PATH, { id: row.id }),
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
      <DataTable<ChannelRecord>
        title={(
          <div className="flex flex-col gap-1">
            <h1 className="text-base font-semibold leading-tight">{t('platform_ops.channels.page.title')}</h1>
            <p className="text-sm font-normal text-muted-foreground">{t('platform_ops.channels.page.description')}</p>
          </div>
        )}
        columns={columns}
        data={rows}
        actions={(
          <Button asChild>
            <Link href={`${CHANNELS_LIST_HREF}/create`}>{t('platform_ops.channels.actions.create')}</Link>
          </Button>
        )}
        searchValue={search}
        onSearchChange={handleSearchChange}
        searchPlaceholder={t('platform_ops.channels.list.searchPlaceholder')}
        searchAlign="right"
        sortable
        sorting={sorting}
        onSortingChange={handleSortingChange}
        emptyState={(
          <ListEmptyState
            title={t('platform_ops.channels.list.empty')}
            createHref={`${CHANNELS_LIST_HREF}/create`}
            createLabel={t('platform_ops.channels.actions.create')}
          />
        )}
        rowActions={(row) => (
          <RowActions
            items={[
              { id: 'edit', label: t('platform_ops.channels.actions.edit'), href: `${CHANNELS_LIST_HREF}/${row.id}/edit` },
              { id: 'delete', label: t('platform_ops.channels.actions.delete'), destructive: true, onSelect: () => { void handleDelete(row) } },
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
        onRowClick={(row) => router.push(`${CHANNELS_LIST_HREF}/${row.id}/edit`)}
      />
      {ConfirmDialogElement}
    </>
  )
}
