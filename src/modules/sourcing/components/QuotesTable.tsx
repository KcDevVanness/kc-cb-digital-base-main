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
import type { QuoteListRow, QuoteStatus } from '../types'

const API_PATH = 'sourcing/quotes'
const LIST_HREF = '/backend/sourcing/quotes'
const PAGE_SIZE = 50
const QUERY_KEY_ROOT = 'sourcing-quotes'

const QUOTE_STATUS_MAP: StatusMap<QuoteStatus> = {
  draft: 'neutral',
  approved: 'success',
  archived: 'info',
  cancelled: 'warning',
}

function buildColumns(t: TranslateFn): ColumnDef<QuoteListRow>[] {
  return [
    {
      accessorKey: 'number',
      header: t('sourcing.quotes.list.columns.number', 'Number'),
      meta: { priority: 1 },
      cell: ({ getValue }) => {
        const value = getValue()
        return typeof value === 'string' && value.length > 0 ? value : <span className="text-xs text-muted-foreground">—</span>
      },
    },
    {
      accessorKey: 'supplierNameSnapshot',
      header: t('sourcing.quotes.list.columns.supplier', 'Supplier'),
      enableSorting: false,
      meta: { priority: 2, truncate: true, maxWidth: 240 },
    },
    {
      accessorKey: 'quoteDate',
      header: t('sourcing.quotes.list.columns.quoteDate', 'Quote date'),
      meta: { priority: 3 },
    },
    {
      accessorKey: 'currencyCode',
      header: t('sourcing.quotes.list.columns.currency', 'Currency'),
      enableSorting: false,
      meta: { priority: 4 },
    },
    {
      accessorKey: 'lineCount',
      header: t('sourcing.quotes.list.columns.lines', 'Lines'),
      enableSorting: false,
      meta: { priority: 5 },
    },
    {
      accessorKey: 'promotedCount',
      header: t('sourcing.quotes.list.columns.promoted', 'Promoted'),
      enableSorting: false,
      meta: { priority: 6 },
    },
    {
      accessorKey: 'sourceFileName',
      header: t('sourcing.quotes.list.columns.sourceFile', 'Source file'),
      enableSorting: false,
      meta: { priority: 7, truncate: true, maxWidth: 260 },
      cell: ({ getValue }) => {
        const value = getValue()
        return typeof value === 'string' && value.length > 0 ? value : <span className="text-xs text-muted-foreground">—</span>
      },
    },
    {
      accessorKey: 'status',
      header: t('sourcing.quotes.list.columns.status', 'Status'),
      enableSorting: false,
      meta: { priority: 8 },
      cell: ({ row }) => (
        <StatusBadge variant={QUOTE_STATUS_MAP[row.original.status]} dot>
          {t(`sourcing.quotes.status.${row.original.status}`, row.original.status)}
        </StatusBadge>
      ),
    },
  ]
}

export default function QuotesTable() {
  const t = useT()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const scopeVersion = useOrganizationScopeVersion()
  const [search, setSearch] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'created_at', desc: true }])
  const [page, setPage] = React.useState(1)

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sortField: sorting[0]?.id ?? 'created_at',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    })
    const query = search.trim()
    if (query) params.set('search', query)
    return params
  }, [page, search, sorting])

  const queryKey = React.useMemo(() => [QUERY_KEY_ROOT, queryParams.toString(), scopeVersion], [queryParams, scopeVersion])
  const columns = React.useMemo(() => buildColumns(t), [t])

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => fetchCrudList<QuoteListRow>(API_PATH, Object.fromEntries(queryParams.entries())),
  })

  const rows = data?.items ?? []
  const listError = error ? (error instanceof Error && error.message ? error.message : t('sourcing.errors.loadFailed', 'Loading failed')) : null

  const handleSortingChange = React.useCallback((next: SortingState) => {
    setSorting(next)
    setPage(1)
  }, [])

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const handleDelete = React.useCallback(async (row: QuoteListRow) => {
    const confirmed = await confirm({
      title: t('sourcing.quotes.deleteConfirmTitle', 'Delete this quotation?'),
      description: t('sourcing.quotes.deleteConfirmBody', 'A draft quotation is soft-deleted and can be restored.'),
      confirmText: t('sourcing.quotes.actions.delete', 'Delete'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      // The delete carries the row's own optimistic-lock version, so a list rendered before
      // someone else edited the quotation fails with a 409 instead of deleting unseen work.
      await withScopedApiRequestHeaders(buildOptimisticLockHeader(row.updatedAt), () => deleteCrud(API_PATH, { id: row.id }))
      flash(t('ui.forms.flash.deleteSuccess'), 'success')
      void queryClient.invalidateQueries({ queryKey: [QUERY_KEY_ROOT] })
    } catch (deleteError) {
      if (surfaceRecordConflict(deleteError, t)) {
        void queryClient.invalidateQueries({ queryKey: [QUERY_KEY_ROOT] })
        return
      }
      const message = deleteError instanceof Error && deleteError.message ? deleteError.message : t('ui.forms.flash.deleteError')
      flash(message, 'error')
    }
  }, [confirm, queryClient, t])

  return (
    <>
      <DataTable<QuoteListRow>
        title={(
          <div className="flex flex-col gap-1">
            <h1 className="text-base font-semibold leading-tight">{t('sourcing.quotes.page.title', 'Supplier quotations')}</h1>
            <p className="text-sm font-normal text-muted-foreground">
              {t('sourcing.quotes.page.description', 'Import a supplier quotation workbook, review it, then promote the lines.')}
            </p>
          </div>
        )}
        columns={columns}
        data={rows}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                // A real navigation, not a client-side route: the endpoint answers with a file.
                // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- file download, not a page
                window.location.assign('/api/sourcing/template')
              }}
            >
              {t('sourcing.quotes.actions.template', 'Download template')}
            </Button>
            <Button variant="secondary" asChild>
              <Link href={`${LIST_HREF}/create#manual`}>{t('sourcing.quotes.actions.create', 'New quotation')}</Link>
            </Button>
            <Button asChild>
              <Link href={`${LIST_HREF}/create#import`}>{t('sourcing.quotes.actions.import', 'Import Excel')}</Link>
            </Button>
          </div>
        )}
        searchValue={search}
        onSearchChange={handleSearchChange}
        searchPlaceholder={t('sourcing.quotes.list.searchPlaceholder', 'Search number, supplier or file name')}
        searchAlign="right"
        sortable
        sorting={sorting}
        onSortingChange={handleSortingChange}
        emptyState={(
          <ListEmptyState
            title={t('sourcing.quotes.list.empty', 'No quotations yet')}
            createHref={`${LIST_HREF}/create#import`}
            createLabel={t('sourcing.quotes.actions.import', 'Import Excel')}
          />
        )}
        rowActions={(row) => (
          <RowActions
            items={[
              { id: 'open', label: t('sourcing.quotes.actions.open', 'Open'), href: `${LIST_HREF}/${row.id}` },
              {
                id: 'delete',
                label: t('sourcing.quotes.actions.delete', 'Delete'),
                destructive: true,
                onSelect: () => {
                  void handleDelete(row)
                },
              },
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
        onRowClick={(row) => router.push(`${LIST_HREF}/${row.id}`)}
      />
      {ConfirmDialogElement}
    </>
  )
}
