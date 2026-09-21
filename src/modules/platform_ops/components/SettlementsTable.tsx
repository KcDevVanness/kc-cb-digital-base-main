"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ReceiptText } from 'lucide-react'
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
import SettlementImportDialog from './SettlementImportDialog'
import {
  SETTLEMENTS_API_PATH,
  SETTLEMENTS_LIST_HREF,
  SettlementStatusBadge,
  formatSettlementMoney,
  formatSettlementPeriod,
  loadChannelOptions,
  toSettlementRecord,
  useChannelNameMap,
  type SettlementRecord,
} from './SettlementImportDialog'

const PAGE_SIZE = 50
const QUERY_KEY_ROOT = 'platform-ops-settlements'

/** A statement carries no value for a period the platform did not report. */
function EmptyCell() {
  return <span className="text-xs text-muted-foreground">—</span>
}

function buildColumns(
  t: TranslateFn,
  locale: string,
  channelNames: Map<string, string>,
): ColumnDef<SettlementRecord>[] {
  return [
    {
      accessorKey: 'externalSettlementId',
      header: t('platform_ops.settlements.list.columns.externalSettlementId'),
      meta: { priority: 1, truncate: true, maxWidth: 280 },
      cell: ({ row }) => {
        const externalId = row.original.externalSettlementId
        return externalId ? externalId : <EmptyCell />
      },
    },
    {
      accessorKey: 'channelId',
      header: t('platform_ops.settlements.list.columns.channel'),
      enableSorting: false,
      meta: { priority: 2, truncate: true, maxWidth: 240 },
      // The statement route projects the channel's id only; a viewer without `channels.view`
      // cannot read its name, so the id stands in rather than the cell going blank.
      cell: ({ row }) => channelNames.get(row.original.channelId) ?? row.original.channelId,
    },
    {
      accessorKey: 'periodStart',
      header: t('platform_ops.settlements.list.columns.period'),
      enableSorting: false,
      meta: { priority: 3 },
      cell: ({ row }) => {
        const period = formatSettlementPeriod(row.original.periodStart, row.original.periodEnd, locale)
        return period ? period : <EmptyCell />
      },
    },
    {
      accessorKey: 'grossAmount',
      header: t('platform_ops.settlements.list.columns.gross'),
      enableSorting: false,
      meta: { priority: 4 },
      cell: ({ row }) => formatSettlementMoney(row.original.grossAmount, row.original.currencyCode, locale),
    },
    {
      accessorKey: 'feeAmount',
      header: t('platform_ops.settlements.list.columns.fee'),
      enableSorting: false,
      meta: { priority: 5 },
      cell: ({ row }) => formatSettlementMoney(row.original.feeAmount, row.original.currencyCode, locale),
    },
    {
      accessorKey: 'netAmount',
      header: t('platform_ops.settlements.list.columns.net'),
      enableSorting: false,
      meta: { priority: 6 },
      cell: ({ row }) => formatSettlementMoney(row.original.netAmount, row.original.currencyCode, locale),
    },
    {
      accessorKey: 'status',
      header: t('platform_ops.settlements.list.columns.status'),
      meta: { priority: 7 },
      cell: ({ row }) => <SettlementStatusBadge status={row.original.status} />,
    },
  ]
}

export default function SettlementsTable() {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const channelNames = useChannelNameMap()
  const [channelId, setChannelId] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [importOpen, setImportOpen] = React.useState(false)

  // The settlements route orders by newest first itself and exposes no sort parameters, so the
  // list asks for one page of the server's order rather than inventing a client-side one.
  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
    })
    if (channelId) params.set('channelId', channelId)
    return params
  }, [channelId, page])

  const queryKey = React.useMemo(
    () => [QUERY_KEY_ROOT, queryParams.toString(), scopeVersion],
    [queryParams, scopeVersion],
  )

  const columns = React.useMemo(() => buildColumns(t, locale, channelNames), [channelNames, locale, t])

  const { data, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>(
        SETTLEMENTS_API_PATH,
        Object.fromEntries(queryParams),
      )
      return { ...payload, items: (payload.items ?? []).map(toSettlementRecord) }
    },
  })

  const rows = data?.items ?? []
  const total = data?.total ?? 0
  const listError = error
    ? (error instanceof Error && error.message ? error.message : t('ui.errors.defaultMessage'))
    : null

  const detailHref = React.useCallback(
    (row: SettlementRecord) => `${SETTLEMENTS_LIST_HREF}/${encodeURIComponent(row.id)}`,
    [],
  )

  return (
    <>
      <DataTable<SettlementRecord>
        title={(
          <div className="flex flex-col gap-1">
            <h1 className="text-base font-semibold leading-tight">{t('platform_ops.settlements.page.title')}</h1>
            <p className="text-sm font-normal text-muted-foreground">{t('platform_ops.settlements.page.description')}</p>
          </div>
        )}
        columns={columns}
        data={rows}
        actions={(
          <Button type="button" onClick={() => setImportOpen(true)}>
            {t('platform_ops.settlements.import.action')}
          </Button>
        )}
        filters={[
          {
            id: 'channelId',
            label: t('platform_ops.settlements.list.columns.channel'),
            type: 'select',
            loadOptions: loadChannelOptions,
            // The active-filter chip reads this instead of the raw id: the select's options arrive
            // asynchronously, so a chip rendered before they land would otherwise show a uuid.
            formatValue: (value: string) => channelNames.get(value) ?? value,
          },
        ]}
        filterValues={channelId ? { channelId } : {}}
        onFiltersApply={(values: FilterValues) => {
          const next = values.channelId
          setChannelId(typeof next === 'string' ? next : '')
          setPage(1)
        }}
        onFiltersClear={() => {
          setChannelId('')
          setPage(1)
        }}
        emptyState={(
          <ListEmptyState
            title={t('platform_ops.settlements.list.empty')}
            icon={<ReceiptText className="size-7" aria-hidden />}
          />
        )}
        rowActions={(row) => (
          <RowActions
            items={[
              {
                id: 'open',
                label: t('common.open'),
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

      <SettlementImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => { void refetch() }}
      />
    </>
  )
}
