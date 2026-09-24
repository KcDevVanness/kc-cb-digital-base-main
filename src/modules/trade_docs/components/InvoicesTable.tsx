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
import { formatCurrency, formatDate } from '@open-mercato/ui/utils/format'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useLocale, useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { INVOICE_DIRECTIONS, INVOICE_STATUSES, directionLabel, invoiceStatusLabel, type InvoiceStatus } from './contractLabels'

const API_PATH = 'trade_docs/invoices'
const LIST_HREF = '/backend/trade-docs/invoices'
const PAGE_SIZE = 50
const QUERY_KEY_ROOT = 'trade-docs-invoices'
const ALL = 'all'

export type InvoiceRecord = {
  id: string
  number: string | null
  direction: string
  status: InvoiceStatus
  counterpartyName: string | null
  contractId: string | null
  contractNumber: string | null
  currencyCode: string
  total: string
  issuedAt: string | null
  attachmentId: string | null
  updatedAt: string | null
}

const STATUS_VARIANT: StatusMap<InvoiceStatus> = {
  draft: 'neutral',
  confirmed: 'success',
  void: 'error',
}

export function toInvoiceRecord(item: Record<string, unknown>): InvoiceRecord {
  const status = String(item.status ?? 'draft')
  return {
    id: String(item.id),
    number: (item.number ?? null) as string | null,
    direction: String(item.direction ?? 'inbound'),
    status: (INVOICE_STATUSES as readonly string[]).includes(status) ? (status as InvoiceStatus) : 'draft',
    counterpartyName: (item.counterpartyName ?? null) as string | null,
    contractId: (item.contractId ?? null) as string | null,
    contractNumber: (item.contractNumber ?? null) as string | null,
    currencyCode: String(item.currencyCode ?? 'CNY'),
    total: String(item.total ?? '0'),
    issuedAt: (item.issuedAt ?? null) as string | null,
    attachmentId: (item.attachmentId ?? null) as string | null,
    updatedAt: (item.updatedAt ?? item.updated_at ?? null) as string | null,
  }
}

function buildColumns(t: TranslateFn, locale: string): ColumnDef<InvoiceRecord>[] {
  return [
    {
      accessorKey: 'number',
      header: t('trade_docs.invoices.list.columns.number'),
      meta: { priority: 1 },
      cell: ({ row }) => row.original.number ?? <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      accessorKey: 'direction',
      header: t('trade_docs.invoices.list.columns.direction'),
      enableSorting: false,
      meta: { priority: 2 },
      cell: ({ row }) => directionLabel(t, row.original.direction),
    },
    {
      accessorKey: 'counterpartyName',
      header: t('trade_docs.invoices.list.columns.counterparty'),
      enableSorting: false,
      meta: { priority: 3, truncate: true, maxWidth: 240 },
      cell: ({ row }) => row.original.counterpartyName ?? <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      id: 'contract',
      header: t('trade_docs.invoices.list.columns.contract'),
      enableSorting: false,
      meta: { priority: 4 },
      cell: ({ row }) =>
        row.original.contractId ? (
          <Link className="text-sm hover:underline" href={`/backend/trade-docs/contracts/${row.original.contractId}`}>
            {row.original.contractNumber ?? row.original.contractId.slice(0, 8)}
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      accessorKey: 'status',
      header: t('trade_docs.invoices.list.columns.status'),
      enableSorting: false,
      meta: { priority: 5 },
      cell: ({ row }) => (
        <StatusBadge variant={STATUS_VARIANT[row.original.status]} dot>
          {invoiceStatusLabel(t, row.original.status)}
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'total',
      header: t('trade_docs.invoices.list.columns.total'),
      meta: { priority: 6 },
      cell: ({ row }) => (
        <span className="tabular-nums">
          {formatCurrency(row.original.total, row.original.currencyCode, locale) ?? row.original.total}
        </span>
      ),
    },
    {
      accessorKey: 'issuedAt',
      header: t('trade_docs.invoices.list.columns.issuedAt'),
      enableSorting: false,
      meta: { priority: 7 },
      cell: ({ row }) => row.original.issuedAt ?? <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      id: 'attachment',
      header: t('trade_docs.invoices.list.columns.attachment'),
      enableSorting: false,
      meta: { priority: 8 },
      cell: ({ row }) =>
        row.original.attachmentId ? (
          <a
            className="text-sm hover:underline"
            href={`/api/attachments/file/${encodeURIComponent(row.original.attachmentId)}?download=1`}
            target="_blank"
            rel="noreferrer"
          >
            {t('trade_docs.invoices.list.attachment.yes')}
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">{t('trade_docs.invoices.list.attachment.no')}</span>
        ),
    },
    {
      accessorKey: 'updatedAt',
      header: t('trade_docs.contracts.list.columns.updatedAt'),
      meta: { priority: 9 },
      cell: ({ row }) => formatDate(row.original.updatedAt, locale) ?? '—',
    },
  ]
}

export default function InvoicesTable() {
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
      return { ...payload, items: (payload.items ?? []).map(toInvoiceRecord) }
    },
  })

  const rows = data?.items ?? []
  const listError = error
    ? (error instanceof Error && error.message ? error.message : t('trade_docs.invoices.form.loadFailed'))
    : null

  const handleDelete = React.useCallback(async (row: InvoiceRecord) => {
    const confirmed = await confirm({
      title: t('trade_docs.invoices.actions.deleteConfirmTitle'),
      description: t('trade_docs.invoices.actions.deleteConfirmBody'),
      confirmText: t('trade_docs.invoices.actions.delete'),
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
      <DataTable<InvoiceRecord>
        title={(
          <div className="flex flex-col gap-1">
            <h1 className="text-base font-semibold leading-tight">{t('trade_docs.invoices.page.title')}</h1>
            <p className="text-sm font-normal text-muted-foreground">{t('trade_docs.invoices.page.description')}</p>
          </div>
        )}
        columns={columns}
        data={rows}
        actions={(
          <Button asChild>
            <Link href={`${LIST_HREF}/create`}>{t('trade_docs.invoices.actions.create')}</Link>
          </Button>
        )}
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPage(1)
        }}
        searchPlaceholder={t('trade_docs.invoices.list.searchPlaceholder')}
        searchAlign="right"
        filters={[
          {
            id: 'direction',
            label: t('trade_docs.invoices.list.filter.direction'),
            type: 'select',
            options: INVOICE_DIRECTIONS.map((value) => ({ value, label: directionLabel(t, value) })),
          },
          {
            id: 'status',
            label: t('trade_docs.invoices.list.filter.status'),
            type: 'select',
            options: INVOICE_STATUSES.map((value) => ({ value, label: invoiceStatusLabel(t, value) })),
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
        onSortingChange={(next) => {
          setSorting(next)
          setPage(1)
        }}
        emptyState={(
          <ListEmptyState
            title={t('trade_docs.invoices.list.empty')}
            createHref={`${LIST_HREF}/create`}
            createLabel={t('trade_docs.invoices.actions.create')}
          />
        )}
        rowActions={(row) => (
          <RowActions
            items={[
              { id: 'edit', label: t('trade_docs.invoices.actions.edit'), href: `${LIST_HREF}/${row.id}/edit` },
              {
                id: 'delete',
                label: t('trade_docs.invoices.actions.delete'),
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
        onRowClick={(row) => router.push(`${LIST_HREF}/${row.id}/edit`)}
      />
      {ConfirmDialogElement}
    </>
  )
}
