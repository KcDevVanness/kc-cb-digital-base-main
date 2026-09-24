"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
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
import { formatDate } from '@open-mercato/ui/utils/format'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useLocale, useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { MoneyAmount } from '@/lib/money/MoneyAmount'
import { downloadApiFile } from './downloadFile'
import { CONTRACT_STATUSES, type ContractStatus, contractStatusLabel, directionLabel } from './contractLabels'

const API_PATH = 'trade_docs/contracts'
const LIST_HREF = '/backend/trade-docs/contracts'
const PAGE_SIZE = 50
const QUERY_KEY_ROOT = 'trade-docs-contracts'
const ALL = 'all'

export type ContractRecord = {
  id: string
  number: string | null
  direction: string
  status: ContractStatus
  counterpartyKind: string
  counterpartyName: string | null
  priceTier: string | null
  currencyCode: string
  contractTotal: string
  financeTotal: string
  differenceTotal: string
  signedAt: string | null
  updatedAt: string | null
}

const STATUS_VARIANT: StatusMap<ContractStatus> = {
  draft: 'neutral',
  issued: 'info',
  signed: 'success',
  closed: 'neutral',
  cancelled: 'error',
}

export function toContractRecord(item: Record<string, unknown>): ContractRecord {
  const status = String(item.status ?? 'draft')
  return {
    id: String(item.id),
    number: (item.number ?? null) as string | null,
    direction: String(item.direction ?? 'purchase'),
    status: (CONTRACT_STATUSES as readonly string[]).includes(status) ? (status as ContractStatus) : 'draft',
    counterpartyKind: String(item.counterpartyKind ?? 'supplier'),
    counterpartyName: (item.counterpartyName ?? null) as string | null,
    priceTier: (item.priceTier ?? null) as string | null,
    currencyCode: String(item.currencyCode ?? 'CNY'),
    contractTotal: String(item.contractTotal ?? '0'),
    financeTotal: String(item.financeTotal ?? '0'),
    differenceTotal: String(item.differenceTotal ?? '0'),
    signedAt: (item.signedAt ?? null) as string | null,
    updatedAt: (item.updatedAt ?? item.updated_at ?? null) as string | null,
  }
}

/**
 * The list's money cells render through the shared `MoneyAmount`, so a foreign-currency total carries
 * its `≈ ¥…` line; an empty total keeps the em dash and never invents a figure.
 */
function amountCell(value: string, currencyCode: string): React.ReactNode {
  const text = value.trim()
  if (!text) return <span className="text-xs text-muted-foreground">—</span>
  return <MoneyAmount currencyCode={currencyCode} amount={text} />
}

function buildColumns(t: TranslateFn, locale: string): ColumnDef<ContractRecord>[] {
  return [
    {
      accessorKey: 'number',
      header: t('trade_docs.contracts.list.columns.number'),
      meta: { priority: 1 },
      cell: ({ row }) =>
        row.original.number ?? <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      accessorKey: 'direction',
      header: t('trade_docs.contracts.list.columns.direction'),
      enableSorting: false,
      meta: { priority: 2 },
      cell: ({ row }) => directionLabel(t, row.original.direction),
    },
    {
      accessorKey: 'counterpartyName',
      header: t('trade_docs.contracts.list.columns.counterparty'),
      enableSorting: false,
      meta: { priority: 3, truncate: true, maxWidth: 260 },
      cell: ({ row }) =>
        row.original.counterpartyName ?? <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      accessorKey: 'status',
      header: t('trade_docs.contracts.list.columns.status'),
      enableSorting: false,
      meta: { priority: 4 },
      cell: ({ row }) => (
        <StatusBadge variant={STATUS_VARIANT[row.original.status]} dot>
          {contractStatusLabel(t, row.original.status)}
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'contractTotal',
      header: t('trade_docs.contracts.list.columns.contractTotal'),
      meta: { priority: 5 },
      cell: ({ row }) => amountCell(row.original.contractTotal, row.original.currencyCode),
    },
    {
      accessorKey: 'financeTotal',
      header: t('trade_docs.contracts.list.columns.financeTotal'),
      meta: { priority: 6 },
      cell: ({ row }) => amountCell(row.original.financeTotal, row.original.currencyCode),
    },
    {
      id: 'differenceTotal',
      header: t('trade_docs.contracts.list.columns.differenceTotal'),
      enableSorting: false,
      meta: { priority: 7 },
      cell: ({ row }) => {
        const diff = Number(row.original.differenceTotal)
        if (!Number.isFinite(diff) || diff === 0) {
          return <span className="tabular-nums text-xs text-muted-foreground">0</span>
        }
        return (
          <MoneyAmount
            currencyCode={row.original.currencyCode}
            amount={row.original.differenceTotal}
            className="font-medium text-status-error-text"
          />
        )
      },
    },
    {
      accessorKey: 'signedAt',
      header: t('trade_docs.contracts.list.columns.signedAt'),
      enableSorting: false,
      meta: { priority: 8 },
      cell: ({ row }) =>
        row.original.signedAt ?? <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      accessorKey: 'updatedAt',
      header: t('trade_docs.contracts.list.columns.updatedAt'),
      meta: { priority: 9 },
      cell: ({ row }) => formatDate(row.original.updatedAt, locale) ?? '—',
    },
  ]
}

export default function ContractsTable() {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const scopeVersion = useOrganizationScopeVersion()
  const [search, setSearch] = React.useState('')
  const [status, setStatus] = React.useState<string>(ALL)
  const [direction, setDirection] = React.useState<string>(ALL)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'updated_at', desc: true }])
  const [page, setPage] = React.useState(1)
  const [isExporting, setIsExporting] = React.useState(false)

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sortField: sorting[0]?.id ?? 'created_at',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    })
    const trimmed = search.trim()
    if (trimmed) params.set('search', trimmed)
    if (status !== ALL) params.set('status', status)
    if (direction !== ALL) params.set('direction', direction)
    return params
  }, [direction, page, search, sorting, status])

  const queryKey = React.useMemo(
    () => [QUERY_KEY_ROOT, queryParams.toString(), scopeVersion],
    [queryParams, scopeVersion],
  )
  const columns = React.useMemo(() => buildColumns(t, locale), [locale, t])

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>(API_PATH, Object.fromEntries(queryParams))
      return { ...payload, items: (payload.items ?? []).map(toContractRecord) }
    },
  })

  const rows = data?.items ?? []
  const listError = error
    ? (error instanceof Error && error.message ? error.message : t('trade_docs.contracts.form.loadFailed'))
    : null

  const handleSortingChange = React.useCallback((next: SortingState) => {
    setSorting(next)
    setPage(1)
  }, [])

  /** Exports the current filter set, not just the visible page. */
  const handleExport = React.useCallback(async () => {
    setIsExporting(true)
    try {
      const params = new URLSearchParams(queryParams)
      params.delete('page')
      params.delete('pageSize')
      params.set('format', 'csv')
      await downloadApiFile({
        url: `/api/${API_PATH}?${params.toString()}`,
        expectedContentType: 'text/csv',
        fallbackName: 'contracts.csv',
        errorMessage: t('trade_docs.contracts.actions.exportFailed'),
      })
    } catch (exportError) {
      flash(
        exportError instanceof Error && exportError.message
          ? exportError.message
          : t('trade_docs.contracts.actions.exportFailed'),
        'error',
      )
    } finally {
      setIsExporting(false)
    }
  }, [queryParams, t])

  const handleDelete = React.useCallback(async (row: ContractRecord) => {
    const confirmed = await confirm({
      title: t('trade_docs.contracts.actions.deleteConfirmTitle'),
      description: t('trade_docs.contracts.actions.deleteConfirmBody'),
      confirmText: t('trade_docs.contracts.actions.delete'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
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
      flash(
        deleteError instanceof Error && deleteError.message ? deleteError.message : t('ui.forms.flash.deleteError'),
        'error',
      )
    }
  }, [confirm, queryClient, t])

  return (
    <>
      <DataTable<ContractRecord>
        title={(
          <div className="flex flex-col gap-1">
            <h1 className="text-base font-semibold leading-tight">{t('trade_docs.contracts.page.title')}</h1>
            <p className="text-sm font-normal text-muted-foreground">{t('trade_docs.contracts.page.description')}</p>
          </div>
        )}
        columns={columns}
        data={rows}
        actions={(
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => void handleExport()} disabled={isExporting}>
              {t('trade_docs.contracts.actions.export')}
            </Button>
            <Button asChild>
              <Link href={`${LIST_HREF}/create`}>{t('trade_docs.contracts.actions.create')}</Link>
            </Button>
          </div>
        )}
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPage(1)
        }}
        searchPlaceholder={t('trade_docs.contracts.list.searchPlaceholder')}
        searchAlign="right"
        filters={[
          {
            id: 'direction',
            label: t('trade_docs.contracts.list.filter.direction'),
            type: 'select',
            options: [
              { value: 'purchase', label: directionLabel(t, 'purchase') },
              { value: 'sales', label: directionLabel(t, 'sales') },
            ],
          },
          {
            id: 'status',
            label: t('trade_docs.contracts.list.filter.status'),
            type: 'select',
            options: CONTRACT_STATUSES.map((value) => ({ value, label: contractStatusLabel(t, value) })),
          },
        ]}
        filterValues={{
          ...(direction === ALL ? {} : { direction }),
          ...(status === ALL ? {} : { status }),
        }}
        onFiltersApply={(values: FilterValues) => {
          setDirection(typeof values.direction === 'string' && values.direction.length ? values.direction : ALL)
          setStatus(typeof values.status === 'string' && values.status.length ? values.status : ALL)
          setPage(1)
        }}
        onFiltersClear={() => {
          setDirection(ALL)
          setStatus(ALL)
          setPage(1)
        }}
        sortable
        manualSorting
        sorting={sorting}
        onSortingChange={handleSortingChange}
        emptyState={(
          <ListEmptyState
            title={t('trade_docs.contracts.list.empty')}
            createHref={`${LIST_HREF}/create`}
            createLabel={t('trade_docs.contracts.actions.create')}
          />
        )}
        rowActions={(row) => (
          <RowActions
            items={[
              { id: 'open', label: t('trade_docs.contracts.actions.open'), href: `${LIST_HREF}/${row.id}` },
              { id: 'edit', label: t('trade_docs.contracts.actions.edit'), href: `${LIST_HREF}/${row.id}/edit` },
              {
                id: 'delete',
                label: t('trade_docs.contracts.actions.delete'),
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
