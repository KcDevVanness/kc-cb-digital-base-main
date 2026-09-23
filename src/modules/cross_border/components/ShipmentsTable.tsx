"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { Button } from '@open-mercato/ui/primitives/button'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useLocale, useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import {
  SHIPMENTS_API_PATH,
  SHIPMENTS_LIST_HREF,
  SHIPMENT_STATUSES,
  ShipmentStatusBadge,
  formatShipmentDate,
  shipmentMilestoneLabel,
  shipmentStatusLabel,
  toShipmentRecord,
  type ShipmentRecord,
  type ShipmentStatus,
} from './ShipmentForm'

const PAGE_SIZE = 50
const QUERY_KEY_ROOT = 'cross-border-shipments'
const ALL_STATUSES = 'all'

/** Sentinel row value used where a shipment carries no value yet (a draft has no number). */
function EmptyCell() {
  return <span className="text-xs text-muted-foreground">—</span>
}

function buildColumns(t: TranslateFn, locale: string): ColumnDef<ShipmentRecord>[] {
  return [
    {
      accessorKey: 'number',
      header: t('cross_border.shipments.list.columns.number'),
      meta: { priority: 1 },
      cell: ({ row }) => {
        const number = row.original.number
        return number ? number : <EmptyCell />
      },
    },
    {
      accessorKey: 'carrierName',
      header: t('cross_border.shipments.list.columns.carrier'),
      enableSorting: false,
      meta: { priority: 2, truncate: true, maxWidth: 320 },
      cell: ({ row }) => {
        const carrier = row.original.carrierName
        return carrier ? carrier : <EmptyCell />
      },
    },
    {
      accessorKey: 'status',
      header: t('cross_border.shipments.list.columns.status'),
      meta: { priority: 3 },
      cell: ({ row }) => <ShipmentStatusBadge status={row.original.status} />,
    },
    {
      accessorKey: 'currentMilestone',
      header: t('cross_border.shipments.list.columns.milestone'),
      enableSorting: false,
      meta: { priority: 4 },
      cell: ({ row }) => {
        const milestone = row.original.currentMilestone
        return milestone ? shipmentMilestoneLabel(t, milestone) : <EmptyCell />
      },
    },
    {
      accessorKey: 'eta',
      header: t('cross_border.shipments.list.columns.eta'),
      enableSorting: false,
      meta: { priority: 5 },
      cell: ({ row }) => {
        const eta = formatShipmentDate(row.original.eta, locale)
        return eta ? eta : <EmptyCell />
      },
    },
  ]
}

export default function ShipmentsTable() {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const [search, setSearch] = React.useState('')
  const [status, setStatus] = React.useState<ShipmentStatus | typeof ALL_STATUSES>(ALL_STATUSES)
  const [page, setPage] = React.useState(1)

  // The shipments route orders by newest first itself; it exposes no sort parameters, so the
  // list asks for one page of the server's order rather than inventing a client-side one.
  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
    })
    const term = search.trim()
    if (term) params.set('search', term)
    if (status !== ALL_STATUSES) params.set('status', status)
    return params
  }, [page, search, status])

  const queryKey = React.useMemo(
    () => [QUERY_KEY_ROOT, queryParams.toString(), scopeVersion],
    [queryParams, scopeVersion],
  )

  const columns = React.useMemo(() => buildColumns(t, locale), [locale, t])

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>(
        SHIPMENTS_API_PATH,
        Object.fromEntries(queryParams),
      )
      return { ...payload, items: (payload.items ?? []).map(toShipmentRecord) }
    },
  })

  const rows = data?.items ?? []
  const total = data?.total ?? 0
  const listError = error
    ? (error instanceof Error && error.message ? error.message : t('cross_border.shipments.form.loadFailed'))
    : null

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const detailHref = React.useCallback(
    (row: ShipmentRecord) => `${SHIPMENTS_LIST_HREF}/${encodeURIComponent(row.id)}`,
    [],
  )

  return (
    <DataTable<ShipmentRecord>
      title={(
        <div className="flex flex-col gap-1">
          <h1 className="text-base font-semibold leading-tight">{t('cross_border.shipments.page.title')}</h1>
          <p className="text-sm font-normal text-muted-foreground">{t('cross_border.shipments.page.description')}</p>
        </div>
      )}
      columns={columns}
      data={rows}
      actions={(
        <Button asChild>
          <Link href={`${SHIPMENTS_LIST_HREF}/create`}>{t('cross_border.shipments.actions.create')}</Link>
        </Button>
      )}
      searchValue={search}
      onSearchChange={handleSearchChange}
      searchPlaceholder={t('cross_border.shipments.list.searchPlaceholder')}
      searchAlign="right"
      filters={[
        {
          id: 'status',
          label: t('cross_border.shipments.list.columns.status'),
          type: 'select',
          options: SHIPMENT_STATUSES.map((value) => ({ value, label: shipmentStatusLabel(t, value) })),
        },
      ]}
      filterValues={status === ALL_STATUSES ? {} : { status }}
      onFiltersApply={(values: FilterValues) => {
        const next = values.status
        setStatus(typeof next === 'string' && next.length ? (next as ShipmentStatus) : ALL_STATUSES)
        setPage(1)
      }}
      onFiltersClear={() => {
        setStatus(ALL_STATUSES)
        setPage(1)
      }}
      emptyState={(
        <ListEmptyState
          title={t('cross_border.shipments.list.empty')}
          createHref={`${SHIPMENTS_LIST_HREF}/create`}
          createLabel={t('cross_border.shipments.actions.create')}
        />
      )}
      rowActions={(row) => (
        <RowActions
          items={[
            {
              id: 'open',
              label: t('cross_border.shipments.actions.open'),
              onSelect: () => router.push(detailHref(row)),
            },
          ]}
        />
      )}
      pagination={{
        page,
        pageSize: PAGE_SIZE,
        total,
        totalPages: total > 0 ? Math.ceil(total / PAGE_SIZE) : 0,
        onPageChange: setPage,
      }}
      isLoading={isLoading}
      error={listError}
      onRowClick={(row) => router.push(detailHref(row))}
    />
  )
}
