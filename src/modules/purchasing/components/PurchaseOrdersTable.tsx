"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { Button } from '@open-mercato/ui/primitives/button'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useLocale, useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import {
  ORDERS_API_PATH,
  ORDERS_LIST_HREF,
  ORDER_STATUSES,
  PurchaseOrderStatusBadge,
  formatMoney,
  formatOrderDate,
  orderStatusLabel,
  toPurchaseOrderRecord,
  type OrderStatus,
  type PurchaseOrderRecord,
} from './PurchaseOrderForm'

const PAGE_SIZE = 50
const QUERY_KEY_ROOT = 'purchasing-purchase-orders'
const ALL_STATUSES = 'all'

/** Sentinel row value used where a PO carries no value yet (a draft has no number). */
function EmptyCell() {
  return <span className="text-xs text-muted-foreground">—</span>
}

function buildColumns(t: TranslateFn, locale: string): ColumnDef<PurchaseOrderRecord>[] {
  return [
    {
      accessorKey: 'number',
      header: t('purchasing.orders.list.columns.number'),
      meta: { priority: 1 },
      cell: ({ row }) => {
        const number = row.original.number
        return number ? number : <EmptyCell />
      },
    },
    {
      accessorKey: 'supplierName',
      header: t('purchasing.orders.list.columns.supplier'),
      enableSorting: false,
      meta: { priority: 2, truncate: true, maxWidth: 320 },
      cell: ({ row }) => {
        const supplier = row.original.supplierName
        return supplier ? supplier : <EmptyCell />
      },
    },
    {
      accessorKey: 'status',
      header: t('purchasing.orders.list.columns.status'),
      meta: { priority: 3 },
      cell: ({ row }) => <PurchaseOrderStatusBadge status={row.original.status} />,
    },
    {
      accessorKey: 'total',
      header: t('purchasing.orders.list.columns.total'),
      meta: { priority: 4, align: 'right' },
      cell: ({ row }) => formatMoney(row.original.total, row.original.currencyCode, locale),
    },
    {
      accessorKey: 'expectedShipAt',
      header: t('purchasing.orders.list.columns.expectedShipAt'),
      enableSorting: false,
      meta: { priority: 5 },
      cell: ({ row }) => {
        const expected = formatOrderDate(row.original.expectedShipAt, locale)
        return expected ? expected : <EmptyCell />
      },
    },
  ]
}

export default function PurchaseOrdersTable() {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const [search, setSearch] = React.useState('')
  const [status, setStatus] = React.useState<OrderStatus | typeof ALL_STATUSES>(ALL_STATUSES)
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [page, setPage] = React.useState(1)

  const queryParams = React.useMemo(() => {
    const activeSort = sorting[0]
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sortField: activeSort?.id ?? 'created_at',
      sortDir: activeSort ? (activeSort.desc ? 'desc' : 'asc') : 'desc',
    })
    const term = search.trim()
    if (term) params.set('search', term)
    if (status !== ALL_STATUSES) params.set('status', status)
    return params
  }, [page, search, sorting, status])

  const queryKey = React.useMemo(
    () => [QUERY_KEY_ROOT, queryParams.toString(), scopeVersion],
    [queryParams, scopeVersion],
  )

  const columns = React.useMemo(() => buildColumns(t, locale), [locale, t])

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>(
        ORDERS_API_PATH,
        Object.fromEntries(queryParams),
      )
      return { ...payload, items: (payload.items ?? []).map(toPurchaseOrderRecord) }
    },
  })

  const rows = data?.items ?? []
  const listError = error
    ? (error instanceof Error && error.message ? error.message : t('purchasing.orders.form.loadFailed'))
    : null

  const handleSortingChange = React.useCallback((next: SortingState) => {
    setSorting(next)
    setPage(1)
  }, [])

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const detailHref = React.useCallback(
    (row: PurchaseOrderRecord) => `${ORDERS_LIST_HREF}/${encodeURIComponent(row.id)}`,
    [],
  )

  return (
    <DataTable<PurchaseOrderRecord>
      title={(
        <div className="flex flex-col gap-1">
          <h1 className="text-base font-semibold leading-tight">{t('purchasing.orders.page.title')}</h1>
          <p className="text-sm font-normal text-muted-foreground">{t('purchasing.orders.page.description')}</p>
        </div>
      )}
      columns={columns}
      data={rows}
      actions={(
        <Button asChild>
          <Link href={`${ORDERS_LIST_HREF}/create`}>{t('purchasing.orders.actions.create')}</Link>
        </Button>
      )}
      searchValue={search}
      onSearchChange={handleSearchChange}
      searchPlaceholder={t('purchasing.orders.list.searchPlaceholder')}
      searchAlign="right"
      filters={[
        {
          id: 'status',
          label: t('purchasing.orders.list.columns.status'),
          type: 'select',
          options: ORDER_STATUSES.map((value) => ({ value, label: orderStatusLabel(t, value) })),
        },
      ]}
      filterValues={status === ALL_STATUSES ? {} : { status }}
      onFiltersApply={(values: FilterValues) => {
        const next = values.status
        setStatus(typeof next === 'string' && next.length ? (next as OrderStatus) : ALL_STATUSES)
        setPage(1)
      }}
      onFiltersClear={() => {
        setStatus(ALL_STATUSES)
        setPage(1)
      }}
      sortable
      manualSorting
      sorting={sorting}
      onSortingChange={handleSortingChange}
      emptyState={(
        <ListEmptyState
          title={t('purchasing.orders.list.empty')}
          createHref={`${ORDERS_LIST_HREF}/create`}
          createLabel={t('purchasing.orders.actions.create')}
        />
      )}
      rowActions={(row) => (
        <RowActions
          items={[
            {
              id: 'open',
              label: t('purchasing.orders.actions.open'),
              onSelect: () => router.push(detailHref(row)),
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
      onRowClick={(row) => router.push(detailHref(row))}
    />
  )
}
