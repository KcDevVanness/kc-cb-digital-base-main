'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Input } from '@open-mercato/ui/primitives/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { createDictionaryMap, type DictionaryMap } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { MoneyAmount } from '@/lib/money/MoneyAmount'
import { isPurchaseOrderStatus, purchaseOrderStatusLabel } from '@/lib/orders/purchaseOrderStatus'
import { useTradeTypeChannels } from '../../internal_sales/lib/tradeTypeChannels'
import { useSalesStatusEntries } from '../../internal_sales/lib/salesStatusEntries'
import type { OrderStageItem } from '../lib/orderStages'
import { compareByCreatedAtDesc, isOrderPending } from '../lib/orderPending'
import OrderFieldsDrawer, { type OrderFieldsTarget } from './OrderFieldsDrawer'

/**
 * The order workbench: the three company-order kinds on one screen, each with how far it has been
 * filled in (采购 / 发运 / 单证 / 收汇·退税).
 *
 * The merge happens **here**, in the browser, on purpose: the buyer name is encrypted and only the
 * sales API decrypts it, so a server-side merge would either hand the browser ciphertext or move
 * decryption into an aggregation route that no module owns. Four sources are read independently —
 * the internal and external sales lists (each already narrowed to its trade-type channel), the
 * purchase order list, and the stage projection — and one of them failing leaves the others on
 * screen.
 *
 * Stage cells are links: a count opens the branch that holds the records, a zero opens the prefilled
 * create entry for that branch when the caller may write it.
 */

type WorkbenchKind = 'internal_sales' | 'external_sales' | 'purchase'
type TypeFilter = 'all' | WorkbenchKind

type WorkbenchRow = {
  id: string
  kind: WorkbenchKind
  number: string | null
  counterparty: string | null
  currencyCode: string
  total: string
  status: string | null
  createdAt: string | null
  lineCount: number
  stages: OrderStageItem | null
}

/** The label key of each kind: the i18n keys are camelCase, the row kind is snake_case. */
const TYPE_LABEL_KEYS: Record<WorkbenchKind, string> = {
  internal_sales: 'order_hub.workbench.type.internalSales',
  external_sales: 'order_hub.workbench.type.externalSales',
  purchase: 'order_hub.workbench.type.purchase',
}

const PAGE_SIZE = 50
/** Past this the operator is told to narrow the filters instead of scrolling forever. */
const ROW_CAP = 300

function readText(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return ''
}

/** A money column may arrive as a string or a number depending on the route; both read the same. */
function readAmount(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.length > 0) return value
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return '0'
}

function readNumber(source: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return 0
}

function snapshotName(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null
  const name = (snapshot as Record<string, unknown>).name
  return typeof name === 'string' && name.length > 0 ? name : null
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
  const entry = row.kind === 'external_sales' ? 'external-sales' : 'internal-sales'
  const orderKind = row.kind === 'external_sales' ? 'external_sales_order' : 'internal_sales_order'
  const detail = `/backend/${entry}/orders/${encodeURIComponent(row.id)}`
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

export default function OrderWorkbench() {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const { payload: chromePayload } = useBackendChrome()
  const { channels, hasAll: hasChannels, missingMessage } = useTradeTypeChannels('order')
  const { entries: salesStatusEntries } = useSalesStatusEntries()
  const statusDictionary = React.useMemo<DictionaryMap | null>(
    () => (salesStatusEntries.length > 0 ? createDictionaryMap(salesStatusEntries) : null),
    [salesStatusEntries],
  )

  const [typeFilter, setTypeFilter] = React.useState<TypeFilter>('all')
  const [statusFilter, setStatusFilter] = React.useState('all')
  const [search, setSearch] = React.useState('')
  const [pendingOnly, setPendingOnly] = React.useState(false)
  const [page, setPage] = React.useState(1)
  const [sourcePages, setSourcePages] = React.useState<Record<WorkbenchKind, number>>({
    internal_sales: 1,
    external_sales: 1,
    purchase: 1,
  })
  const [fieldsTarget, setFieldsTarget] = React.useState<OrderFieldsTarget | null>(null)
  const [fieldsOpen, setFieldsOpen] = React.useState(false)

  const granted = React.useMemo(() => new Set(chromePayload?.grantedFeatures ?? []), [chromePayload?.grantedFeatures])
  // Before the chrome payload arrives the buttons stay visible: hiding a control the caller may hold
  // is worse than showing one the page gate would refuse anyway.
  const chromeReady = Boolean(chromePayload)
  const canWriteSales = !chromeReady || granted.has('sales.orders.manage')
  const canWritePurchase = !chromeReady || granted.has('purchasing.orders.manage')
  const canSeeOrderFile = !chromeReady || granted.has('export_finance.orders.view')

  const sourceEnabled = (kind: WorkbenchKind): boolean => typeFilter === 'all' || typeFilter === kind

  const salesQuery = (kind: 'internal_sales' | 'external_sales') => {
    const channelId = kind === 'internal_sales' ? channels.internal : channels.external
    return {
      queryKey: ['order-hub', kind, channelId ?? null, sourcePages[kind], search, statusFilter, scopeVersion],
      enabled: sourceEnabled(kind) && Boolean(channelId) && (typeFilter === 'all' || typeFilter === kind),
      queryFn: async () => {
        const payload = await fetchCrudList<Record<string, unknown>>('sales/orders', {
          channelIds: channelId,
          page: String(sourcePages[kind]),
          pageSize: String(PAGE_SIZE),
          sortField: 'created_at',
          sortDir: 'desc',
          ...(search.trim() ? { search: search.trim() } : {}),
          ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        })
        return (payload.items ?? []).map((item) => ({
          id: String(item.id),
          kind,
          number: readText(item, 'orderNumber', 'order_number') || null,
          counterparty: snapshotName(item.customerSnapshot ?? item.customer_snapshot),
          currencyCode: readText(item, 'currencyCode', 'currency_code') || 'CNY',
          total: readAmount(item, 'grandTotalNetAmount', 'grand_total_net_amount', 'grandTotalGrossAmount'),
          status: readText(item, 'status') || null,
          createdAt: readText(item, 'createdAt', 'created_at') || null,
          lineCount: readNumber(item, 'lineItemCount', 'line_item_count'),
          stages: null,
        })) satisfies WorkbenchRow[]
      },
    }
  }

  const internal = useQuery(salesQuery('internal_sales'))
  const external = useQuery(salesQuery('external_sales'))

  const purchase = useQuery({
    queryKey: ['order-hub', 'purchase', sourcePages.purchase, search, statusFilter, scopeVersion],
    enabled: sourceEnabled('purchase'),
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>('purchasing/purchase-orders', {
        page: String(sourcePages.purchase),
        pageSize: String(PAGE_SIZE),
        sortField: 'created_at',
        sortDir: 'desc',
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(statusFilter !== 'all' && isPurchaseOrderStatus(statusFilter) ? { status: statusFilter } : {}),
      })
      return (payload.items ?? []).map((item) => ({
        id: String(item.id),
        kind: 'purchase' as const,
        number: readText(item, 'number') || null,
        counterparty: readText(item, 'supplierName', 'supplier_name') || null,
        currencyCode: readText(item, 'currencyCode', 'currency_code') || 'CNY',
        total: readAmount(item, 'total'),
        status: readText(item, 'status') || null,
        createdAt: readText(item, 'createdAt', 'created_at') || null,
        lineCount: 0,
        stages: null,
      })) satisfies WorkbenchRow[]
    },
  })

  const mergedRows = React.useMemo(() => {
    const byId = new Map<string, WorkbenchRow>()
    for (const row of [...(internal.data ?? []), ...(external.data ?? []), ...(purchase.data ?? [])]) {
      if (!byId.has(row.id)) byId.set(row.id, row)
    }
    return [...byId.values()].sort(compareByCreatedAtDesc)
  }, [external.data, internal.data, purchase.data])

  const stageIds = React.useMemo(() => mergedRows.map((row) => row.id).slice(0, ROW_CAP), [mergedRows])
  const stages = useQuery({
    queryKey: ['order-hub', 'stages', stageIds.join(','), scopeVersion],
    enabled: stageIds.length > 0,
    queryFn: async () => {
      // The route caps a batch at 200 ids; the workbench never asks for more than the row cap.
      const chunks: string[][] = []
      for (let index = 0; index < stageIds.length; index += 200) chunks.push(stageIds.slice(index, index + 200))
      const collected: OrderStageItem[] = []
      for (const chunk of chunks) {
        const payload = await readApiResultOrThrow<{ items?: OrderStageItem[] }>(
          `/api/order_hub/stages?ids=${encodeURIComponent(chunk.join(','))}`,
          undefined,
          { fallback: { items: [] }, errorMessage: 'order_hub.workbench.loadFailed' },
        )
        collected.push(...(payload.items ?? []))
      }
      return collected
    },
  })

  const stageById = React.useMemo(() => {
    const map = new Map<string, OrderStageItem>()
    for (const item of stages.data ?? []) map.set(item.id, item)
    return map
  }, [stages.data])

  const rows = React.useMemo(
    () => mergedRows.map((row) => ({ ...row, stages: stageById.get(row.id) ?? null })),
    [mergedRows, stageById],
  )

  const statusOptions = React.useMemo(() => {
    const seen = new Map<string, string>()
    for (const row of rows) {
      if (!row.status || seen.has(row.status)) continue
      seen.set(row.status, statusLabelFor(t, row, statusDictionary))
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label }))
  }, [rows, statusDictionary, t])

  const visibleRows = React.useMemo(
    () => (pendingOnly ? rows.filter(isOrderPending) : rows),
    [pendingOnly, rows],
  )

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

  const listError = internal.isError || external.isError || purchase.isError
  const isLoading = internal.isLoading || external.isLoading || purchase.isLoading
  const atCap = mergedRows.length >= ROW_CAP

  const loadMore = React.useCallback(() => {
    if (atCap) return
    // The oldest tail decides which source is asked for its next page: merging is newest-first, so the
    // last row on screen is the oldest thing loaded.
    const tail = mergedRows[mergedRows.length - 1]
    const nextKind: WorkbenchKind = tail?.kind ?? 'purchase'
    setSourcePages((prev) => ({ ...prev, [nextKind]: prev[nextKind] + 1 }))
  }, [atCap, mergedRows])

  const retryAll = React.useCallback(() => {
    void internal.refetch()
    void external.refetch()
    void purchase.refetch()
    void stages.refetch()
  }, [external, internal, purchase, stages])

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={pendingOnly} onCheckedChange={(checked) => { setPendingOnly(checked === true); setPage(1) }} />
          {t('order_hub.workbench.filters.pendingOnly')}
        </label>
        {!atCap ? (
          <Button type="button" variant="outline" size="sm" onClick={loadMore}>
            {t('order_hub.workbench.loadMore')}
          </Button>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {atCap ? t('order_hub.workbench.capReached') : t('order_hub.workbench.rowsLoaded', { count: mergedRows.length })}
        </span>
        {listError || stages.isError ? (
          <Button type="button" variant="ghost" size="sm" onClick={retryAll}>
            {t('order_hub.workbench.retry')}
          </Button>
        ) : null}
        {hasChannels ? null : <span className="text-xs text-muted-foreground">{missingMessage}</span>}
      </div>
      <DataTable<WorkbenchRow>
        title={(
          <div className="flex flex-col gap-1">
            <h1 className="text-base font-semibold leading-tight">{t('order_hub.workbench.title')}</h1>
            <p className="text-sm font-normal text-muted-foreground">{t('order_hub.workbench.description')}</p>
          </div>
        )}
        columns={columns}
        data={visibleRows}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            {canWriteSales ? (
              <>
                <Button asChild variant="outline">
                  <Link href="/backend/internal-sales/orders/create">{t('order_hub.workbench.actions.createInternal')}</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/backend/external-sales/orders/create">{t('order_hub.workbench.actions.createExternal')}</Link>
                </Button>
              </>
            ) : null}
            {canWritePurchase ? (
              <Button asChild variant="outline">
                <Link href="/backend/purchasing/orders/create">{t('order_hub.workbench.actions.createPurchase')}</Link>
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
              { value: 'internal_sales', label: t('order_hub.workbench.type.internalSales') },
              { value: 'external_sales', label: t('order_hub.workbench.type.externalSales') },
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
          const nextType = typeof values.type === 'string' && values.type.length > 0 ? (values.type as TypeFilter) : 'all'
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
          pageSize: PAGE_SIZE,
          total: visibleRows.length,
          totalPages: Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE)),
          onPageChange: setPage,
        }}
        isLoading={isLoading}
        error={listError ? t('order_hub.workbench.loadFailed') : null}
        emptyState={(
          <ListEmptyState
            title={t('order_hub.workbench.empty')}
            createHref={canWriteSales ? '/backend/internal-sales/orders/create' : undefined}
            createLabel={canWriteSales ? t('order_hub.workbench.actions.createInternal') : undefined}
          />
        )}
      />

      {canSeeOrderFile || fieldsTarget?.kind === 'sales' ? (
        <OrderFieldsDrawer target={fieldsTarget} open={fieldsOpen} onOpenChange={setFieldsOpen} />
      ) : null}
    </>
  )
}
