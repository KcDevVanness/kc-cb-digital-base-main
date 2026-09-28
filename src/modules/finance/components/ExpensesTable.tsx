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
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { EXPENSES_API_PATH, EXPENSES_LIST_HREF, loadExpenseTypeLabels } from './expenseOptions'
import { toExpenseFormValues, type ExpenseRecord } from './ExpenseForm'

const PAGE_SIZE = 50
const QUERY_KEY_ROOT = 'finance-expenses'

function buildColumns(t: TranslateFn, typeLabels: Record<string, string>): ColumnDef<ExpenseRecord>[] {
  return [
    {
      accessorKey: 'expenseType',
      header: t('finance.expenses.list.columns.expenseType'),
      meta: { priority: 1 },
      // The stored value is a dictionary code; the column shows the display name and falls back to
      // the code when the entry was removed after the row was written.
      cell: ({ row }) => <span>{typeLabels[row.original.expenseType] ?? row.original.expenseType}</span>,
    },
    {
      accessorKey: 'periodStart',
      header: t('finance.expenses.list.columns.period'),
      meta: { priority: 2 },
      cell: ({ row }) => (
        <span className="tabular-nums">
          {row.original.periodStart || '—'} → {row.original.periodEnd || '—'}
        </span>
      ),
    },
    {
      accessorKey: 'amount',
      header: t('finance.expenses.list.columns.amount'),
      meta: { priority: 3, align: 'right' },
      cell: ({ row }) => (
        <span className="tabular-nums">
          {row.original.amount} {row.original.currencyCode}
        </span>
      ),
    },
    {
      accessorKey: 'exchangeRate',
      header: t('finance.expenses.list.columns.exchangeRate'),
      enableSorting: false,
      meta: { priority: 5, align: 'right' },
      cell: ({ row }) => (
        <span className="tabular-nums">
          {row.original.exchangeRate && row.original.exchangeRate.length > 0
            ? row.original.exchangeRate
            : t('finance.expenses.list.rateFromMaster')}
        </span>
      ),
    },
    {
      accessorKey: 'note',
      header: t('finance.expenses.list.columns.note'),
      enableSorting: false,
      meta: { priority: 4, truncate: true, maxWidth: 260 },
      cell: ({ row }) => <span>{row.original.note ?? '—'}</span>,
    },
  ]
}

export default function ExpensesTable() {
  const t = useT()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const scopeVersion = useOrganizationScopeVersion()
  const [search, setSearch] = React.useState('')
  const [typeLabels, setTypeLabels] = React.useState<Record<string, string>>({})
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'periodStart', desc: true }])
  const [page, setPage] = React.useState(1)

  React.useEffect(() => {
    let cancelled = false
    loadExpenseTypeLabels()
      .then((labels) => {
        if (!cancelled) setTypeLabels(labels)
      })
      .catch(() => {
        // The column falls back to the stored code; a dictionary gap must not break the list.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sortField: sorting[0]?.id ?? 'period_start',
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
  const columns = React.useMemo(() => buildColumns(t, typeLabels), [t, typeLabels])

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>(EXPENSES_API_PATH, Object.fromEntries(queryParams))
      return { ...payload, items: (payload.items ?? []).map(toExpenseFormValues) }
    },
  })

  const rows = data?.items ?? []
  const listError = error
    ? error instanceof Error && error.message
      ? error.message
      : t('finance.expenses.form.loadFailed')
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
    async (row: ExpenseRecord) => {
      const confirmed = await confirm({
        title: t('finance.expenses.actions.deleteConfirmTitle'),
        description: t('finance.expenses.actions.deleteConfirmBody'),
        confirmText: t('finance.expenses.actions.delete'),
        variant: 'destructive',
      })
      if (!confirmed) return
      try {
        await withScopedApiRequestHeaders(buildOptimisticLockHeader(row.updatedAt), () =>
          deleteCrud(EXPENSES_API_PATH, { id: row.id }),
        )
        flash(t('ui.forms.flash.deleteSuccess'), 'success')
        void queryClient.invalidateQueries({ queryKey: [QUERY_KEY_ROOT] })
      } catch (deleteError) {
        if (surfaceRecordConflict(deleteError, t)) {
          void queryClient.invalidateQueries({ queryKey: [QUERY_KEY_ROOT] })
          return
        }
        const message =
          deleteError instanceof Error && deleteError.message ? deleteError.message : t('ui.forms.flash.deleteError')
        flash(message, 'error')
      }
    },
    [confirm, queryClient, t],
  )

  return (
    <>
      <DataTable<ExpenseRecord>
        title={(
          <div className="flex flex-col gap-1">
            <h1 className="text-base font-semibold leading-tight">{t('finance.expenses.page.title')}</h1>
            <p className="text-sm font-normal text-muted-foreground">{t('finance.expenses.page.description')}</p>
          </div>
        )}
        columns={columns}
        data={rows}
        actions={(
          <Button asChild>
            <Link href={`${EXPENSES_LIST_HREF}/create`}>{t('finance.expenses.actions.create')}</Link>
          </Button>
        )}
        searchValue={search}
        onSearchChange={handleSearchChange}
        searchPlaceholder={t('finance.expenses.list.searchPlaceholder')}
        searchAlign="right"
        sortable
        sorting={sorting}
        onSortingChange={handleSortingChange}
        emptyState={(
          <ListEmptyState
            title={t('finance.expenses.list.empty')}
            createHref={`${EXPENSES_LIST_HREF}/create`}
            createLabel={t('finance.expenses.actions.create')}
          />
        )}
        rowActions={(row) => (
          <RowActions
            items={[
              { id: 'edit', label: t('finance.expenses.actions.edit'), href: `${EXPENSES_LIST_HREF}/${row.id}/edit` },
              {
                id: 'delete',
                label: t('finance.expenses.actions.delete'),
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
        onRowClick={(row) => router.push(`${EXPENSES_LIST_HREF}/${row.id}/edit`)}
      />
      {ConfirmDialogElement}
    </>
  )
}
