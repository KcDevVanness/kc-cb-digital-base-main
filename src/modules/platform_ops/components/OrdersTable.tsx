"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { formatDate } from '@open-mercato/ui/utils/format'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useLocale, useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { MoneyAmount } from '@/lib/money/MoneyAmount'
import { CHANNELS_API_PATH, toChannelFormValues } from './ChannelForm'

/**
 * The order mirror is a read-only copy of what the platform claims: the list exists so an
 * operator can compare a payout against it, never to edit it. Ingest happens through
 * `POST /api/platform_ops/orders/ingest`, so this surface offers no row actions.
 */

export const ORDERS_API_PATH = 'platform_ops/orders'

const PAGE_SIZE = 50
const QUERY_KEY_ROOT = 'platform-ops-orders'
const CHANNELS_QUERY_KEY_ROOT = 'platform-ops-orders-channels'
/** A channel picker only needs the storefronts that exist; the list is navigational, not paged data. */
const CHANNEL_OPTION_PAGE_SIZE = 100
const ALL_FILTER = 'all'

export type OrderMirrorRecord = {
  id: string
  channelId: string
  externalOrderId: string
  status: string
  currencyCode: string
  grossAmount: string
  feeAmount: string
  netAmount: string
  placedAt: string | null
  shipmentNumber: string
  syncedAt: string | null
}

function readText(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string') return value
  }
  return ''
}

/** Maps a list payload row into the record the table renders; amounts stay decimal strings. */
export function toOrderMirrorRecord(item: Record<string, unknown>): OrderMirrorRecord {
  const placedAt = item.placedAt ?? item.placed_at
  const syncedAt = item.syncedAt ?? item.synced_at
  return {
    id: readText(item, 'id'),
    channelId: readText(item, 'channelId', 'channel_id'),
    externalOrderId: readText(item, 'externalOrderId', 'external_order_id'),
    status: readText(item, 'status'),
    currencyCode: readText(item, 'currencyCode', 'currency_code'),
    grossAmount: readText(item, 'grossAmount', 'gross_amount'),
    feeAmount: readText(item, 'feeAmount', 'fee_amount'),
    netAmount: readText(item, 'netAmount', 'net_amount'),
    placedAt: typeof placedAt === 'string' && placedAt.length ? placedAt : null,
    shipmentNumber: readText(item, 'shipmentNumber', 'shipment_number'),
    syncedAt: typeof syncedAt === 'string' && syncedAt.length ? syncedAt : null,
  }
}

/** Sentinel cell for values the platform did not send (a pending order may carry no status). */
const EMPTY_CELL = <span className="text-xs text-muted-foreground">—</span>

/**
 * The order's amounts are stated in the currency the platform reported with them, so each one
 * carries its `≈ ¥…` line; an order the platform did not price keeps the em dash.
 */
function moneyCell(value: string, currencyCode: string): React.ReactNode {
  const text = value.trim()
  if (!text) return EMPTY_CELL
  return <MoneyAmount currencyCode={currencyCode} amount={text} />
}

function buildColumns(
  t: TranslateFn,
  locale: string,
  channelNameById: Map<string, string>,
): ColumnDef<OrderMirrorRecord>[] {
  return [
    {
      accessorKey: 'externalOrderId',
      header: t('platform_ops.orders.list.columns.externalOrderId'),
      meta: { priority: 1, truncate: true, maxWidth: 240 },
    },
    {
      accessorKey: 'channelId',
      header: t('platform_ops.orders.list.columns.channel'),
      enableSorting: false,
      meta: { priority: 2, truncate: true, maxWidth: 240 },
      cell: ({ row }) => channelNameById.get(row.original.channelId) ?? EMPTY_CELL,
    },
    {
      accessorKey: 'status',
      header: t('platform_ops.orders.list.columns.status'),
      enableSorting: false,
      meta: { priority: 3 },
      cell: ({ row }) => {
        const status = row.original.status.trim()
        return status.length ? status : EMPTY_CELL
      },
    },
    {
      accessorKey: 'grossAmount',
      header: t('platform_ops.orders.list.columns.gross'),
      enableSorting: false,
      meta: { priority: 4 },
      cell: ({ row }) => moneyCell(row.original.grossAmount, row.original.currencyCode),
    },
    {
      accessorKey: 'feeAmount',
      header: t('platform_ops.orders.list.columns.fee'),
      enableSorting: false,
      meta: { priority: 5 },
      cell: ({ row }) => moneyCell(row.original.feeAmount, row.original.currencyCode),
    },
    {
      accessorKey: 'netAmount',
      header: t('platform_ops.orders.list.columns.net'),
      enableSorting: false,
      meta: { priority: 6 },
      cell: ({ row }) => moneyCell(row.original.netAmount, row.original.currencyCode),
    },
    {
      accessorKey: 'placedAt',
      header: t('platform_ops.orders.list.columns.placedAt'),
      enableSorting: false,
      meta: { priority: 7 },
      cell: ({ row }) => {
        const placedAt = row.original.placedAt
        if (!placedAt) return EMPTY_CELL
        const formatted = formatDate(placedAt, locale)
        return formatted ?? EMPTY_CELL
      },
    },
  ]
}

export default function OrdersTable() {
  const t = useT()
  const locale = useLocale()
  const scopeVersion = useOrganizationScopeVersion()
  const [search, setSearch] = React.useState('')
  const [channelId, setChannelId] = React.useState('')
  const [status, setStatus] = React.useState('')
  const [page, setPage] = React.useState(1)

  // The orders route orders by newest sync first itself; it exposes no sort parameters, so the
  // list asks for one page of the server's order rather than inventing a client-side one.
  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
    })
    const term = search.trim()
    if (term) params.set('search', term)
    if (channelId) params.set('channelId', channelId)
    if (status.trim()) params.set('status', status.trim())
    return params
  }, [channelId, page, search, status])

  const queryKey = React.useMemo(
    () => [QUERY_KEY_ROOT, queryParams.toString(), scopeVersion],
    [queryParams, scopeVersion],
  )

  const channelsQuery = useQuery({
    queryKey: [CHANNELS_QUERY_KEY_ROOT, scopeVersion],
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>(CHANNELS_API_PATH, {
        page: 1,
        pageSize: CHANNEL_OPTION_PAGE_SIZE,
        sortField: 'name',
        sortDir: 'asc',
      })
      return (payload.items ?? []).map(toChannelFormValues)
    },
  })

  const channels = React.useMemo(() => channelsQuery.data ?? [], [channelsQuery.data])

  // One derivation feeds both the filter options and the name lookup, so a row can never show a
  // storefront the picker spells differently.
  const channelChoices = React.useMemo(
    () => channels.map((channel) => {
      const name = channel.name.trim()
      const code = channel.code.trim()
      return { value: channel.id, label: name && code ? `${name} — ${code}` : name || code || channel.id }
    }),
    [channels],
  )

  const channelNameById = React.useMemo(
    () => new Map(channelChoices.map((choice) => [choice.value, choice.label])),
    [channelChoices],
  )

  const columns = React.useMemo(
    () => buildColumns(t, locale, channelNameById),
    [channelNameById, locale, t],
  )

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>(
        ORDERS_API_PATH,
        Object.fromEntries(queryParams),
      )
      return { ...payload, items: (payload.items ?? []).map(toOrderMirrorRecord) }
    },
  })

  const rows = data?.items ?? []
  const total = data?.total ?? 0
  const listError = error
    ? (error instanceof Error && error.message ? error.message : t('ui.errors.defaultMessage'))
    : null

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  return (
    <DataTable<OrderMirrorRecord>
      title={(
        <div className="flex flex-col gap-1">
          <h1 className="text-base font-semibold leading-tight">{t('platform_ops.orders.page.title')}</h1>
          <p className="text-sm font-normal text-muted-foreground">{t('platform_ops.orders.page.description')}</p>
        </div>
      )}
      columns={columns}
      data={rows}
      searchValue={search}
      onSearchChange={handleSearchChange}
      searchPlaceholder={t('platform_ops.orders.list.searchPlaceholder')}
      searchAlign="right"
      filters={[
        {
          id: 'channelId',
          label: t('platform_ops.orders.list.columns.channel'),
          type: 'select',
          options: channelChoices,
        },
        {
          id: 'status',
          label: t('platform_ops.orders.list.columns.status'),
          type: 'text',
        },
      ]}
      filterValues={{
        ...(channelId ? { channelId } : {}),
        ...(status.trim() ? { status } : {}),
      }}
      onFiltersApply={(values: FilterValues) => {
        const nextChannel = values.channelId
        const nextStatus = values.status
        setChannelId(typeof nextChannel === 'string' ? nextChannel : '')
        setStatus(typeof nextStatus === 'string' ? nextStatus : '')
        setPage(1)
      }}
      onFiltersClear={() => {
        setChannelId('')
        setStatus('')
        setPage(1)
      }}
      emptyState={<ListEmptyState title={t('platform_ops.orders.list.empty')} />}
      pagination={{
        page,
        pageSize: PAGE_SIZE,
        total,
        totalPages: data?.totalPages ?? (total > 0 ? Math.ceil(total / PAGE_SIZE) : 0),
        totalIsCapped: data?.totalIsCapped === true,
        onPageChange: setPage,
      }}
      isLoading={isLoading}
      error={listError}
    />
  )
}
