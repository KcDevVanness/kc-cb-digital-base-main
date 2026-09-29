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
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { loadShipmentCostTypeLabels, SHIPMENT_COSTS_API_PATH, SHIPMENT_COSTS_LIST_HREF } from './shipmentCostOptions'
import { toShipmentCostFormValues, type ShipmentCostRecord } from './ShipmentCostForm'

const PAGE_SIZE = 50
const QUERY_KEY_ROOT = 'finance-shipment-costs'

function buildColumns(t: TranslateFn, costTypeLabels: Record<string, string>): ColumnDef<ShipmentCostRecord>[] {
  return [
    {
      accessorKey: 'shipmentNumber',
      header: t('finance.shipmentCosts.list.columns.shipment'),
      enableSorting: false,
      meta: { priority: 1 },
      cell: ({ row }) => (
        <span className="font-medium">
          {row.original.shipmentNumber ?? row.original.shipmentId.slice(0, 8)}
        </span>
      ),
    },
    {
      accessorKey: 'costType',
      header: t('finance.shipmentCosts.list.columns.costType'),
      meta: { priority: 2 },
      // The stored value is a dictionary code; the column shows the dictionary's display name and
      // falls back to the code when the entry was removed after the row was written.
      cell: ({ row }) => <span>{costTypeLabels[row.original.costType] ?? row.original.costType}</span>,
    },
    {
      accessorKey: 'allocationBasis',
      header: t('finance.shipmentCosts.list.columns.allocationBasis'),
      enableSorting: false,
      meta: { priority: 5 },
      cell: ({ row }) => (
        <StatusBadge variant="neutral">
          {row.original.allocationBasis === 'quantity'
            ? t('finance.shipmentCosts.form.basis.quantity')
            : t('finance.shipmentCosts.form.basis.amount')}
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'amount',
      header: t('finance.shipmentCosts.list.columns.amount'),
      meta: { priority: 3 },
      cell: ({ row }) => (
        <span className="tabular-nums">
          {row.original.amount} {row.original.currencyCode}
        </span>
      ),
    },
    {
      accessorKey: 'exchangeRate',
      header: t('finance.shipmentCosts.list.columns.exchangeRate'),
      enableSorting: false,
      meta: { priority: 6 },
      cell: ({ row }) => (
        <span className="tabular-nums">
          {row.original.exchangeRate && row.original.exchangeRate.length > 0
            ? row.original.exchangeRate
            : t('finance.shipmentCosts.list.rateFromMaster')}
        </span>
      ),
    },
    {
      accessorKey: 'incurredAt',
      header: t('finance.shipmentCosts.list.columns.incurredAt'),
      meta: { priority: 4 },
      cell: ({ row }) => (
        <span className="tabular-nums">{row.original.incurredAt ? row.original.incurredAt.slice(0, 10) : '—'}</span>
      ),
    },
  ]
}

export default function ShipmentCostsTable() {
  const t = useT()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const scopeVersion = useOrganizationScopeVersion()
  const [search, setSearch] = React.useState('')
  const [costTypeLabels, setCostTypeLabels] = React.useState<Record<string, string>>({})
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'incurredAt', desc: true }])
  const [page, setPage] = React.useState(1)

  React.useEffect(() => {
    let cancelled = false
    loadShipmentCostTypeLabels()
      .then((labels) => {
        if (!cancelled) setCostTypeLabels(labels)
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
      sortField: sorting[0]?.id ?? 'incurred_at',
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
  const columns = React.useMemo(() => buildColumns(t, costTypeLabels), [costTypeLabels, t])

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>(
        SHIPMENT_COSTS_API_PATH,
        Object.fromEntries(queryParams),
      )
      return { ...payload, items: (payload.items ?? []).map(toShipmentCostFormValues) }
    },
  })

  const rows = data?.items ?? []
  const listError = error
    ? error instanceof Error && error.message
      ? error.message
      : t('finance.shipmentCosts.form.loadFailed')
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
    async (row: ShipmentCostRecord) => {
      const confirmed = await confirm({
        title: t('finance.shipmentCosts.actions.deleteConfirmTitle'),
        description: t('finance.shipmentCosts.actions.deleteConfirmBody'),
        confirmText: t('finance.shipmentCosts.actions.delete'),
        variant: 'destructive',
      })
      if (!confirmed) return
      try {
        // Row deletes carry the row's own optimistic-lock version, so a list rendered before
        // someone else edited the row fails with a 409 instead of deleting a row the user never saw.
        await withScopedApiRequestHeaders(buildOptimisticLockHeader(row.updatedAt), () =>
          deleteCrud(SHIPMENT_COSTS_API_PATH, { id: row.id }),
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
      <DataTable<ShipmentCostRecord>
        title={(
          <div className="flex flex-col gap-1">
            <h1 className="text-base font-semibold leading-tight">{t('finance.shipmentCosts.page.title')}</h1>
            <p className="text-sm font-normal text-muted-foreground">{t('finance.shipmentCosts.page.description')}</p>
          </div>
        )}
        columns={columns}
        data={rows}
        actions={(
          <Button asChild>
            <Link href={`${SHIPMENT_COSTS_LIST_HREF}/create`}>{t('finance.shipmentCosts.actions.create')}</Link>
          </Button>
        )}
        searchValue={search}
        onSearchChange={handleSearchChange}
        searchPlaceholder={t('finance.shipmentCosts.list.searchPlaceholder')}
        searchAlign="right"
        sortable
        sorting={sorting}
        onSortingChange={handleSortingChange}
        emptyState={(
          <ListEmptyState
            title={t('finance.shipmentCosts.list.empty')}
            createHref={`${SHIPMENT_COSTS_LIST_HREF}/create`}
            createLabel={t('finance.shipmentCosts.actions.create')}
          />
        )}
        rowActions={(row) => (
          <RowActions
            items={[
              {
                id: 'edit',
                label: t('finance.shipmentCosts.actions.edit'),
                href: `${SHIPMENT_COSTS_LIST_HREF}/${row.id}/edit`,
              },
              {
                id: 'delete',
                label: t('finance.shipmentCosts.actions.delete'),
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
        onRowClick={(row) => router.push(`${SHIPMENT_COSTS_LIST_HREF}/${row.id}/edit`)}
      />
      {ConfirmDialogElement}
    </>
  )
}
