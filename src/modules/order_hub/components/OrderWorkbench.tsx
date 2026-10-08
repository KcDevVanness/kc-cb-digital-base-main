'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { createDictionaryMap, type DictionaryMap } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { MoneyAmount } from '@/lib/money/MoneyAmount'
import { PURCHASE_ORDER_STATUSES, isPurchaseOrderStatus, purchaseOrderStatusLabel } from '@/lib/orders/purchaseOrderStatus'
import { useTradeTypeChannels } from '../../internal_sales/lib/tradeTypeChannels'
import { useSalesStatusEntries } from '../../internal_sales/lib/salesStatusEntries'
import type { OrderRow, OrderRowSource } from '../lib/mergeOrders'
import OrderFieldsDrawer, { type OrderFieldsTarget } from './OrderFieldsDrawer'

/**
 * The order workbench: the three company-order kinds on one screen, each with how far it has been
 * filled in (采购 / 发运 / 单证 / 收汇·退税).
 *
 * One read, not three: the aggregate route (`/api/order_hub/orders`) forwards the caller's
 * credentials to each module's own list route, so the buyer name is decrypted where it is owned and
 * never reaches this component as ciphertext, and the merge, the stage projection and the total all
 * happen server-side on real pages.
 *
 * Stage cells are links: a count opens the branch that holds the records, a zero opens the prefilled
 * create entry for that branch when the caller may write it.
 */

type WorkbenchKind = 'internal_sales' | 'external_sales' | 'purchase'
type TypeFilter = 'all' | 'internal' | 'external' | 'purchase'

/** A merged row plus the kind the columns branch on; the route's `source` maps onto it. */
type WorkbenchRow = OrderRow & { kind: WorkbenchKind }

const KIND_BY_SOURCE: Record<OrderRowSource, WorkbenchKind> = {
  internal_sales: 'internal_sales',
  external_sales: 'external_sales',
  purchase_order: 'purchase',
}

/** The label key of each kind: the i18n keys are camelCase, the row kind is snake_case. */
const TYPE_LABEL_KEYS: Record<WorkbenchKind, string> = {
  internal_sales: 'order_hub.workbench.type.internalSales',
  external_sales: 'order_hub.workbench.type.externalSales',
  purchase: 'order_hub.workbench.type.purchase',
}

const PAGE_SIZE_OPTIONS = [20, 50, 100]
const DEFAULT_PAGE_SIZE = 20

function isTypeFilter(value: unknown): value is TypeFilter {
  return value === 'all' || value === 'internal' || value === 'external' || value === 'purchase'
}

/** The kinds a row's branch links point at. */
function hrefsFor(row: WorkbenchRow): {
  detail: string
  procurement: string
  shipment: string
  documents: string
  money: string
} {
  if (row.kind === 'purchase') {
    return {
      detail: `/backend/purchasing/orders/${encodeURIComponent(row.id)}`,
      procurement: `/backend/purchasing/orders/${encodeURIComponent(row.id)}`,
      shipment: `/backend/purchasing/orders/${encodeURIComponent(row.id)}`,
      documents: `/backend/purchasing/orders/${encodeURIComponent(row.id)}`,
      money: `/backend/export-finance/orders/${encodeURIComponent(row.id)}`,
    }
  }
  const detail = `/backend/orders/${encodeURIComponent(row.id)}`
  return {
    detail,
    procurement: `${detail}#purchasing`,
    shipment: `${detail}#shipments`,
    documents: `${detail}#documents`,
    money: `${detail}#money`,
  }
}

function createHrefFor(row: WorkbenchRow, branch: 'procurement' | 'shipment' | 'documents'): string {
  const orderKind = row.kind === 'purchase'
    ? 'purchase_order'
    : row.kind === 'external_sales'
      ? 'external_sales_order'
      : 'internal_sales_order'
  const base = {
    procurement: '/backend/purchasing/orders/create',
    shipment: '/backend/cross_border/shipments/create',
    documents: '/backend/trade-docs/proformas/create',
  }[branch]
  if (row.kind === 'purchase') return base
  return `${base}?orderKind=${orderKind}&orderId=${encodeURIComponent(row.id)}`
}

function statusLabelFor(
  t: TranslateFn,
  row: WorkbenchRow,
  dictionary: DictionaryMap | null,
): string {
  if (row.kind === 'purchase') {
    return isPurchaseOrderStatus(row.status) ? purchaseOrderStatusLabel(t, row.status) : (row.status ?? '—')
  }
  if (!row.status) return '—'
  return dictionary?.[row.status]?.label ?? row.status
}

/** The aggregate route's response, as this screen reads it. */
type OrdersResponse = {
  items: OrderRow[]
  total: number
  page: number
  pageSize: number
  totalIsCapped?: boolean
  unavailableSources?: OrderRowSource[]
}

export default function OrderWorkbench() {
  const t = useT()
  const router = useRouter()
  // The retired per-trade-type list URLs redirect here with `?type=`, so the workbench opens
  // pre-filtered; anything else (or no token) falls back to `all`.
  const searchParams = useSearchParams()
  const scopeVersion = useOrganizationScopeVersion()
  const { payload: chromePayload } = useBackendChrome()
  const { hasAll: hasChannels, missingMessage } = useTradeTypeChannels('order')
  const { entries: salesStatusEntries } = useSalesStatusEntries()
  const statusDictionary = React.useMemo<DictionaryMap | null>(
    () => (salesStatusEntries.length > 0 ? createDictionaryMap(salesStatusEntries) : null),
    [salesStatusEntries],
  )

  const [typeFilter, setTypeFilter] = React.useState<TypeFilter>(() => {
    const token = searchParams?.get('type')
    return isTypeFilter(token) ? token : 'all'
  })
  const [statusFilter, setStatusFilter] = React.useState('all')
  const [search, setSearch] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(DEFAULT_PAGE_SIZE)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [fieldsTarget, setFieldsTarget] = React.useState<OrderFieldsTarget | null>(null)
  const [fieldsOpen, setFieldsOpen] = React.useState(false)

  const granted = React.useMemo(() => new Set(chromePayload?.grantedFeatures ?? []), [chromePayload?.grantedFeatures])
  // Before the chrome payload arrives the buttons stay visible: hiding a control the caller may hold
  // is worse than showing one the page gate would refuse anyway.
  const chromeReady = Boolean(chromePayload)
  const canWriteSales = !chromeReady || granted.has('sales.orders.manage')
  const canSeeOrderFile = !chromeReady || granted.has('export_finance.orders.view')

  const orders = useQuery({
    queryKey: ['order-hub-orders', page, pageSize, typeFilter, statusFilter, search, scopeVersion],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        type: typeFilter,
      })
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const term = search.trim()
      if (term) params.set('search', term)
      return readApiResultOrThrow<OrdersResponse>(
        `/api/order_hub/orders?${params.toString()}`,
        undefined,
        { errorMessage: 'order_hub.workbench.loadFailed' },
      )
    },
  })

  const rows = React.useMemo<WorkbenchRow[]>(
    () => (orders.data?.items ?? []).map((row) => ({ ...row, kind: KIND_BY_SOURCE[row.source] })),
    [orders.data],
  )

  const total = orders.data?.total ?? 0
  const totalIsCapped = orders.data?.totalIsCapped === true
  const unavailableSources = orders.data?.unavailableSources ?? []

  // The page no longer holds every status, so the options are the tenant's dictionary plus the fixed
  // purchase vocabulary — not the values this page happens to contain.
  const statusOptions = React.useMemo(() => {
    const seen = new Map<string, string>()
    for (const entry of salesStatusEntries) {
      if (!seen.has(entry.value)) seen.set(entry.value, entry.label)
    }
    for (const status of PURCHASE_ORDER_STATUSES) {
      if (!seen.has(status)) seen.set(status, purchaseOrderStatusLabel(t, status))
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label }))
  }, [salesStatusEntries, t])

  const columns = React.useMemo<ColumnDef<WorkbenchRow>[]>(() => {
    const stageCell = (branch: 'procurement' | 'shipment' | 'documents') => ({ row }: { row: { original: WorkbenchRow } }) => {
      const item = row.original
      const hrefs = hrefsFor(item)
      const count = branch === 'procurement'
        ? item.stages?.procurementCount ?? 0
        : branch === 'shipment'
          ? item.stages?.shipmentCount ?? 0
          : item.stages?.documentCount ?? 0
      // A purchase order has no procurement branch of its own: it *is* the procurement.
      if (branch === 'procurement' && item.kind === 'purchase') {
        return <span className="text-xs text-muted-foreground">{t('order_hub.workbench.cell.notApplicable')}</span>
      }
      const target = count > 0
        ? hrefs[branch]
        : item.kind === 'purchase'
          ? hrefs.detail
          : createHrefFor(item, branch)
      return (
        <Link
          href={target}
          className="underline"
          aria-label={
            count > 0
              ? t('order_hub.workbench.cell.countAria', { count })
              : t('order_hub.workbench.cell.missingAria')
          }
        >
          {count}
        </Link>
      )
    }

    return [
      {
        accessorKey: 'kind',
        header: t('order_hub.workbench.columns.type'),
        cell: ({ row }) => t(TYPE_LABEL_KEYS[row.original.kind]),
      },
      {
        accessorKey: 'number',
        header: t('order_hub.workbench.columns.number'),
        cell: ({ row }) => (
          <Link href={hrefsFor(row.original).detail} className="underline">
            {row.original.number ?? row.original.id.slice(0, 8)}
          </Link>
        ),
      },
      {
        accessorKey: 'counterparty',
        header: t('order_hub.workbench.columns.counterparty'),
        enableSorting: false,
        cell: ({ row }) => row.original.counterparty ?? '—',
      },
      {
        accessorKey: 'currencyCode',
        header: t('order_hub.workbench.columns.currency'),
        enableSorting: false,
      },
      {
        accessorKey: 'total',
        header: t('order_hub.workbench.columns.total'),
        enableSorting: false,
        cell: ({ row }) => (
          <MoneyAmount currencyCode={row.original.currencyCode} amount={row.original.total} />
        ),
      },
      {
        accessorKey: 'status',
        header: t('order_hub.workbench.columns.status'),
        enableSorting: false,
        cell: ({ row }) => statusLabelFor(t, row.original, statusDictionary),
      },
      { id: 'procurement', header: t('order_hub.workbench.columns.procurement'), enableSorting: false, cell: stageCell('procurement') },
      { id: 'shipment', header: t('order_hub.workbench.columns.shipment'), enableSorting: false, cell: stageCell('shipment') },
      { id: 'documents', header: t('order_hub.workbench.columns.documents'), enableSorting: false, cell: stageCell('documents') },
      {
        id: 'money',
        header: t('order_hub.workbench.columns.money'),
        enableSorting: false,
        cell: ({ row }) => {
          const item = row.original
          if (!item.stages) return <span className="text-xs text-muted-foreground">{t('order_hub.workbench.cell.notApplicable')}</span>
          const parts: string[] = []
          if (item.kind !== 'external_sales') {
            parts.push(item.stages.collected ? t('order_hub.workbench.cell.collected') : t('order_hub.workbench.cell.notCollected'))
          }
          if (item.kind === 'purchase') {
            parts.push(item.stages.refunded ? t('order_hub.workbench.cell.refunded') : t('order_hub.workbench.cell.notRefunded'))
          }
          if (parts.length === 0) return <span className="text-xs text-muted-foreground">{t('order_hub.workbench.cell.notApplicable')}</span>
          return (
            <Link href={hrefsFor(item).money} className="underline">
              {parts.join(' · ')}
            </Link>
          )
        },
      },
      {
        accessorKey: 'createdAt',
        header: t('order_hub.workbench.columns.orderedAt'),
        enableSorting: false,
        cell: ({ row }) => (row.original.createdAt ? row.original.createdAt.slice(0, 10) : '—'),
      },
    ]
  }, [statusDictionary, t])

  const listError = orders.isError
  const isLoading = orders.isLoading

  const retryAll = React.useCallback(() => {
    void orders.refetch()
  }, [orders])

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {totalIsCapped ? <span className="text-xs text-muted-foreground">{t('order_hub.workbench.capReached')}</span> : null}
        {listError ? (
          <Button type="button" variant="ghost" size="sm" onClick={retryAll}>
            {t('order_hub.workbench.retry')}
          </Button>
        ) : null}
        {hasChannels ? null : <span className="text-xs text-muted-foreground">{missingMessage}</span>}
        {unavailableSources.length > 0 ? (
          <span className="text-xs text-muted-foreground">
            {t('order_hub.workbench.sourceUnavailable', {
              sources: unavailableSources.map((source) => t(TYPE_LABEL_KEYS[KIND_BY_SOURCE[source]])).join(' / '),
            })}
          </span>
        ) : null}
      </div>
      <DataTable<WorkbenchRow>
        title={(
          <div className="flex flex-col gap-1">
            <h1 className="text-base font-semibold leading-tight">{t('order_hub.workbench.title')}</h1>
            <p className="text-sm font-normal text-muted-foreground">{t('order_hub.workbench.description')}</p>
          </div>
        )}
        columns={columns}
        data={rows}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            {canWriteSales ? (
              <Button type="button" variant="outline" onClick={() => setCreateOpen(true)}>
                {t('order_hub.workbench.actions.createOrder')}
              </Button>
            ) : null}
          </div>
        )}
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPage(1)
        }}
        searchPlaceholder={t('order_hub.workbench.searchPlaceholder')}
        searchAlign="right"
        filters={[
          {
            id: 'type',
            label: t('order_hub.workbench.filters.type'),
            type: 'select',
            options: [
              { value: 'all', label: t('order_hub.workbench.filters.all') },
              { value: 'internal', label: t('order_hub.workbench.type.internalSales') },
              { value: 'external', label: t('order_hub.workbench.type.externalSales') },
              { value: 'purchase', label: t('order_hub.workbench.type.purchase') },
            ],
          },
          {
            id: 'status',
            label: t('order_hub.workbench.filters.status'),
            type: 'select',
            options: [{ value: 'all', label: t('order_hub.workbench.filters.all') }, ...statusOptions],
          },
        ]}
        filterValues={{ type: typeFilter, status: statusFilter }}
        onFiltersApply={(values) => {
          const nextType = isTypeFilter(values.type) ? values.type : 'all'
          const nextStatus = typeof values.status === 'string' && values.status.length > 0 ? values.status : 'all'
          if (nextType !== typeFilter) setStatusFilter('all')
          else setStatusFilter(nextStatus)
          setTypeFilter(nextType)
          setPage(1)
        }}
        onFiltersClear={() => {
          setTypeFilter('all')
          setStatusFilter('all')
          setPage(1)
        }}
        rowActions={(row) => (
          <RowActions
            items={[
              {
                id: 'fields',
                label: t('order_hub.workbench.actions.fields'),
                onSelect: () => {
                  setFieldsTarget(
                    row.kind === 'purchase'
                      ? { kind: 'purchase', id: row.id, number: row.number }
                      : {
                          kind: 'sales',
                          id: row.id,
                          number: row.number,
                          tradeType: row.kind === 'external_sales' ? 'external' : 'internal',
                          head: {
                            buyer: row.counterparty,
                            currencyCode: row.currencyCode,
                            total: row.total,
                            status: row.status,
                            orderedAt: row.createdAt,
                            lineCount: row.lineCount,
                          },
                          stages: row.stages,
                        },
                  )
                  setFieldsOpen(true)
                },
              },
              {
                id: 'open',
                label: t('order_hub.workbench.actions.openDetail'),
                onSelect: () => router.push(hrefsFor(row).detail),
              },
            ]}
          />
        )}
        pagination={{
          page,
          pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
          totalIsCapped,
          onPageChange: setPage,
          onPageSizeChange: (next) => {
            setPageSize(next)
            setPage(1)
          },
          pageSizeOptions: PAGE_SIZE_OPTIONS,
        }}
        isLoading={isLoading}
        error={listError ? t('order_hub.workbench.loadFailed') : null}
        emptyState={(
          <ListEmptyState
            title={t('order_hub.workbench.empty')}
            onCreate={canWriteSales ? () => setCreateOpen(true) : undefined}
            createLabel={canWriteSales ? t('order_hub.workbench.actions.createOrder') : undefined}
          />
        )}
      />

      {/* One create entry, two trade types: a purchase order is raised from the purchase ledger page
          or from an order's procurement block, not from here (D7). */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{t('order_hub.workbench.createDialog.title')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setCreateOpen(false)
                router.push('/backend/internal-sales/orders/create')
              }}
            >
              {t('order_hub.workbench.type.internalSales')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setCreateOpen(false)
                router.push('/backend/external-sales/orders/create')
              }}
            >
              {t('order_hub.workbench.type.externalSales')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {canSeeOrderFile || fieldsTarget?.kind === 'sales' ? (
        <OrderFieldsDrawer target={fieldsTarget} open={fieldsOpen} onOpenChange={setFieldsOpen} />
      ) : null}
    </>
  )
}
