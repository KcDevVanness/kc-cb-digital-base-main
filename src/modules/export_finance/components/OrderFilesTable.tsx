"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { Button } from '@open-mercato/ui/primitives/button'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { formatDisplayDate, toUtcDateInputValue } from '@open-mercato/ui/primitives/date-format'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useLocale, useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { downloadApiFile } from '../../trade_docs/components/downloadFile'
import type {
  ExportFinanceCollectionStatus,
  ExportFinanceTaxRefundStatus,
  OrderFileStatus,
  OrderFileView,
} from '../data/validators'
import {
  ORDER_EXPORT_CHECKLIST_KEYS,
  ORDER_PURCHASE_CHECKLIST_KEYS,
  type OrderChecklistKey,
  type OrderFileRow,
} from '../lib/orderFileProjection'
import {
  BUSINESS_STATUS_LABEL_KEYS,
  COLLECTION_STATUS_LABEL_KEYS,
  COLLECTION_STATUS_OPTIONS,
  ORDER_CHECKLIST_LABEL_KEYS,
  ORDER_STATUS_OPTIONS,
  REFUND_STATUS_LABEL_KEYS,
  REFUND_STATUS_OPTIONS,
  checklistCounter,
} from './labels'

/** The 订单档案 projection, in both of its views. One row per purchase order. */
const ORDER_FILES_API_PATH = 'export_finance/order-files'
export const ORDER_FILES_LIST_HREF = '/backend/export-finance/orders'

const PAGE_SIZE = 50
const QUERY_KEY_ROOT = 'export-finance-order-files'
/** Sentinel filter value: the query simply omits the key, so the server applies no filter. */
const ALL = 'all'

/** The only sort keys the endpoint accepts, mapped from the column that sorts by them. */
const SORT_FIELD_BY_COLUMN: Record<string, 'placed_at' | 'expected_delivery' | 'total'> = {
  placedAt: 'placed_at',
  expectedDeliveryAt: 'expected_delivery',
  orderAmount: 'total',
}

const BUSINESS_STATUS_VARIANTS: StatusMap<OrderFileStatus> = {
  draft: 'neutral',
  placed: 'info',
  factory_pickup: 'info',
  shipped: 'info',
  received: 'success',
  closed: 'neutral',
  cancelled: 'error',
}

const COLLECTION_STATUS_VARIANTS: StatusMap<ExportFinanceCollectionStatus> = {
  received: 'success',
  not_received: 'warning',
  unknown: 'neutral',
}

const REFUND_STATUS_VARIANTS: StatusMap<ExportFinanceTaxRefundStatus> = {
  completed: 'success',
  applied: 'info',
  not_started: 'warning',
  unknown: 'neutral',
}

function EmptyCell() {
  return <span className="text-xs text-muted-foreground">—</span>
}

function TextCell({ value }: { value: string | null | undefined }) {
  return value ? <>{value}</> : <EmptyCell />
}

/** Date-only columns are written as UTC midnight, so their day is read in the frame it was written in. */
function DateCell({ value, locale }: { value: string | null; locale: string }) {
  const day = toUtcDateInputValue(value)
  const formatted = day ? formatDisplayDate(day, locale) : null
  return formatted ? <>{formatted}</> : <EmptyCell />
}

/** Amounts arrive already quantized to the currency scale — they are rendered, never re-rounded. */
function AmountCell({ value, currency }: { value: string | null; currency?: string | null }) {
  if (value === null) return <EmptyCell />
  return (
    <span className="tabular-nums">
      {currency ? `${value} ${currency}` : value}
    </span>
  )
}

function BusinessStatusBadge({ status }: { status: OrderFileStatus }) {
  const t = useT()
  return (
    <StatusBadge variant={BUSINESS_STATUS_VARIANTS[status]} dot>
      {t(BUSINESS_STATUS_LABEL_KEYS[status])}
    </StatusBadge>
  )
}

function CollectionStatusBadge({ status }: { status: string }) {
  const t = useT()
  const key = status as ExportFinanceCollectionStatus
  return (
    <StatusBadge variant={COLLECTION_STATUS_VARIANTS[key] ?? 'neutral'} dot>
      {t(COLLECTION_STATUS_LABEL_KEYS[key] ?? 'export_finance.collection.status.unknown')}
    </StatusBadge>
  )
}

function RefundStatusBadge({ status }: { status: string }) {
  const t = useT()
  const key = status as ExportFinanceTaxRefundStatus
  return (
    <StatusBadge variant={REFUND_STATUS_VARIANTS[key] ?? 'neutral'} dot>
      {t(REFUND_STATUS_LABEL_KEYS[key] ?? 'export_finance.refund.status.unknown')}
    </StatusBadge>
  )
}

/**
 * `n/7` (or `n/5`) with the missing documents named on hover: the count says how complete the
 * file is, the tooltip says what to chase. A complete class has nothing to hover, so it renders
 * the bare counter.
 */
function ChecklistCell({
  row,
  keys,
  t,
}: {
  row: OrderFileRow
  keys: readonly OrderChecklistKey[]
  t: TranslateFn
}) {
  const { hits, total } = checklistCounter(row.checklist, keys)
  const missing = keys.filter((key) => !row.checklist[key])
  const hint = missing.length
    ? t('export_finance.orders.checklist.missingHint', {
        items: missing.map((key) => t(ORDER_CHECKLIST_LABEL_KEYS[key])).join('、'),
      })
    : null

  return (
    <SimpleTooltip content={hint}>
      <span className="text-sm tabular-nums">{`${hits}/${total}`}</span>
    </SimpleTooltip>
  )
}

/** The containers an order belongs to; the refund note of each one is the tooltip. */
function ContainersCell({ row }: { row: OrderFileRow }) {
  const numbers = row.containers.map((container) => container.shipmentNumber ?? '—').join('、')
  const notes = row.containers
    .filter((container) => container.taxRefundNote)
    .map((container) => `${container.shipmentNumber ?? '—'}：${container.taxRefundNote}`)

  return (
    <SimpleTooltip content={notes.length ? notes.join('\n') : null}>
      <span className="text-sm">{numbers || <EmptyCell />}</span>
    </SimpleTooltip>
  )
}

function buildBusinessColumns(t: TranslateFn, locale: string): ColumnDef<OrderFileRow>[] {
  return [
    {
      accessorKey: 'businessNumber',
      header: t('export_finance.orders.columns.businessNumber'),
      enableSorting: false,
      meta: { priority: 1 },
      cell: ({ row }) => <TextCell value={row.original.businessNumber} />,
    },
    {
      accessorKey: 'number',
      header: t('export_finance.orders.columns.number'),
      enableSorting: false,
      meta: { priority: 2 },
      cell: ({ row }) => <TextCell value={row.original.number} />,
    },
    {
      accessorKey: 'supplierName',
      header: t('export_finance.orders.columns.supplier'),
      enableSorting: false,
      meta: { priority: 3, truncate: true, maxWidth: 240 },
      cell: ({ row }) => <TextCell value={row.original.supplierName} />,
    },
    {
      accessorKey: 'customerName',
      header: t('export_finance.orders.columns.customer'),
      enableSorting: false,
      meta: { priority: 4, truncate: true, maxWidth: 240 },
      cell: ({ row }) => <TextCell value={row.original.customerName} />,
    },
    {
      accessorKey: 'ownerName',
      header: t('export_finance.orders.columns.owner'),
      enableSorting: false,
      meta: { priority: 5, truncate: true, maxWidth: 200 },
      cell: ({ row }) => <TextCell value={row.original.ownerName} />,
    },
    {
      accessorKey: 'businessStatus',
      header: t('export_finance.orders.columns.status'),
      enableSorting: false,
      meta: { priority: 6 },
      cell: ({ row }) => <BusinessStatusBadge status={row.original.businessStatus} />,
    },
    {
      accessorKey: 'placedAt',
      header: t('export_finance.orders.columns.placedAt'),
      meta: { priority: 7 },
      cell: ({ row }) => <DateCell value={row.original.placedAt} locale={locale} />,
    },
    {
      accessorKey: 'expectedDeliveryAt',
      header: t('export_finance.orders.columns.expectedDeliveryAt'),
      meta: { priority: 8 },
      cell: ({ row }) => <DateCell value={row.original.expectedDeliveryAt} locale={locale} />,
    },
    {
      accessorKey: 'shipmentDepartedAt',
      header: t('export_finance.orders.columns.departedAt'),
      enableSorting: false,
      meta: { priority: 9 },
      cell: ({ row }) => <DateCell value={row.original.shipmentDepartedAt} locale={locale} />,
    },
    {
      accessorKey: 'containerType',
      header: t('export_finance.orders.columns.containerType'),
      enableSorting: false,
      meta: { priority: 10 },
      cell: ({ row }) => <TextCell value={row.original.containerType} />,
    },
    {
      accessorKey: 'containerNumber',
      header: t('export_finance.orders.columns.containerNumber'),
      enableSorting: false,
      meta: { priority: 11 },
      cell: ({ row }) => <TextCell value={row.original.containerNumber} />,
    },
    {
      accessorKey: 'sealNumber',
      header: t('export_finance.orders.columns.sealNumber'),
      enableSorting: false,
      meta: { priority: 12 },
      cell: ({ row }) => <TextCell value={row.original.sealNumber} />,
    },
    {
      accessorKey: 'bookingNumber',
      header: t('export_finance.orders.columns.bookingNumber'),
      enableSorting: false,
      meta: { priority: 13 },
      cell: ({ row }) => <TextCell value={row.original.bookingNumber} />,
    },
    {
      accessorKey: 'purchaseChecklist',
      header: t('export_finance.orders.columns.purchaseChecklist'),
      enableSorting: false,
      meta: { priority: 14 },
      cell: ({ row }) => (
        <ChecklistCell row={row.original} keys={ORDER_PURCHASE_CHECKLIST_KEYS} t={t} />
      ),
    },
    {
      accessorKey: 'exportChecklist',
      header: t('export_finance.orders.columns.exportChecklist'),
      enableSorting: false,
      meta: { priority: 15 },
      cell: ({ row }) => (
        <ChecklistCell row={row.original} keys={ORDER_EXPORT_CHECKLIST_KEYS} t={t} />
      ),
    },
  ]
}

function buildFinanceColumns(t: TranslateFn, locale: string): ColumnDef<OrderFileRow>[] {
  return [
    {
      accessorKey: 'number',
      header: t('export_finance.orders.columns.number'),
      enableSorting: false,
      meta: { priority: 1 },
      cell: ({ row }) => <TextCell value={row.original.number} />,
    },
    {
      accessorKey: 'businessNumber',
      header: t('export_finance.orders.columns.businessNumber'),
      enableSorting: false,
      meta: { priority: 2 },
      cell: ({ row }) => <TextCell value={row.original.businessNumber} />,
    },
    {
      accessorKey: 'orderAmount',
      header: t('export_finance.orders.columns.orderAmount'),
      meta: { priority: 3, align: 'right' },
      cell: ({ row }) => <AmountCell value={row.original.finance.orderAmount} />,
    },
    {
      accessorKey: 'depositPlanned',
      header: t('export_finance.orders.columns.depositPlanned'),
      enableSorting: false,
      meta: { priority: 4, align: 'right' },
      cell: ({ row }) => <AmountCell value={row.original.finance.depositPlanned} />,
    },
    {
      accessorKey: 'balancePlanned',
      header: t('export_finance.orders.columns.balancePlanned'),
      enableSorting: false,
      meta: { priority: 5, align: 'right' },
      cell: ({ row }) => <AmountCell value={row.original.finance.balancePlanned} />,
    },
    {
      accessorKey: 'paidAmount',
      header: t('export_finance.orders.columns.paidAmount'),
      enableSorting: false,
      meta: { priority: 6, align: 'right' },
      cell: ({ row }) => <AmountCell value={row.original.finance.paidAmount} />,
    },
    {
      accessorKey: 'outstandingAmount',
      header: t('export_finance.orders.columns.outstandingAmount'),
      enableSorting: false,
      meta: { priority: 7, align: 'right' },
      cell: ({ row }) => <AmountCell value={row.original.finance.outstandingAmount} />,
    },
    {
      accessorKey: 'kcPrice',
      header: t('export_finance.orders.columns.kcPrice'),
      enableSorting: false,
      meta: { priority: 8, align: 'right' },
      cell: ({ row }) => (
        <AmountCell
          value={row.original.finance.kcPriceAmount}
          currency={row.original.finance.kcPriceCurrency}
        />
      ),
    },
    {
      accessorKey: 'subsidiaryInvoice',
      header: t('export_finance.orders.columns.subsidiaryInvoice'),
      enableSorting: false,
      meta: { priority: 9, align: 'right' },
      cell: ({ row }) => (
        <AmountCell
          value={row.original.finance.subsidiaryInvoiceAmount}
          currency={row.original.finance.subsidiaryInvoiceCurrency}
        />
      ),
    },
    {
      accessorKey: 'collectionStatus',
      header: t('export_finance.orders.columns.collectionStatus'),
      enableSorting: false,
      meta: { priority: 10 },
      cell: ({ row }) => <CollectionStatusBadge status={row.original.collectionStatus} />,
    },
    {
      accessorKey: 'refundStatus',
      header: t('export_finance.orders.columns.refundStatus'),
      enableSorting: false,
      meta: { priority: 11 },
      cell: ({ row }) => <RefundStatusBadge status={row.original.refundStatus} />,
    },
    {
      accessorKey: 'allocatedRefundAmount',
      header: t('export_finance.orders.columns.allocatedRefund'),
      enableSorting: false,
      meta: { priority: 12, align: 'right' },
      cell: ({ row }) => <AmountCell value={row.original.allocatedRefundAmount} />,
    },
    {
      accessorKey: 'containers',
      header: t('export_finance.orders.columns.containers'),
      enableSorting: false,
      meta: { priority: 13, truncate: true, maxWidth: 240 },
      cell: ({ row }) => <ContainersCell row={row.original} />,
    },
  ]
}

export default function OrderFilesTable() {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const searchParams = useSearchParams()
  const scopeVersion = useOrganizationScopeVersion()
  const [search, setSearch] = React.useState('')
  const [status, setStatus] = React.useState<OrderFileStatus | typeof ALL>(ALL)
  const [collectionStatus, setCollectionStatus] = React.useState<ExportFinanceCollectionStatus | typeof ALL>(ALL)
  const [taxRefundStatus, setTaxRefundStatus] = React.useState<ExportFinanceTaxRefundStatus | typeof ALL>(ALL)
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [page, setPage] = React.useState(1)
  const [isExporting, setIsExporting] = React.useState(false)

  // The view is URL state, not component state: a tab is a link someone can send, and the
  // browser's back button walks the tabs they visited.
  const viewParam = searchParams?.get('view')
  const view: OrderFileView = viewParam === 'finance' ? 'finance' : 'business'

  const queryParams = React.useMemo(() => {
    const activeSort = sorting[0]
    const sortField = activeSort ? SORT_FIELD_BY_COLUMN[activeSort.id] : undefined
    const params = new URLSearchParams({
      view,
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sortField: sortField ?? 'placed_at',
      sortDir: sortField ? (activeSort?.desc ? 'desc' : 'asc') : 'desc',
    })
    const term = search.trim()
    if (term) params.set('search', term)
    if (status !== ALL) params.set('status', status)
    if (collectionStatus !== ALL) params.set('collectionStatus', collectionStatus)
    if (taxRefundStatus !== ALL) params.set('taxRefundStatus', taxRefundStatus)
    return params
  }, [collectionStatus, page, search, sorting, status, taxRefundStatus, view])

  const queryKey = React.useMemo(
    () => [QUERY_KEY_ROOT, queryParams.toString(), scopeVersion],
    [queryParams, scopeVersion],
  )

  const columns = React.useMemo(
    () => (view === 'finance' ? buildFinanceColumns(t, locale) : buildBusinessColumns(t, locale)),
    [locale, t, view],
  )

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const payload = await fetchCrudList<OrderFileRow>(
        ORDER_FILES_API_PATH,
        Object.fromEntries(queryParams),
      )
      return { ...payload, items: payload.items ?? [] }
    },
  })

  const rows = data?.items ?? []
  const total = data?.total ?? 0
  const listError = error
    ? (error instanceof Error && error.message ? error.message : t('export_finance.orders.list.loadFailed'))
    : null

  const handleViewChange = React.useCallback((next: string) => {
    if (next !== 'business' && next !== 'finance') return
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    if (next === 'finance') params.set('view', next)
    else params.delete('view')
    const query = params.toString()
    router.replace(query ? `${ORDER_FILES_LIST_HREF}?${query}` : ORDER_FILES_LIST_HREF, { scroll: false })
    // The two views have different columns, so a sort chosen in one of them cannot carry over.
    setSorting([])
    setPage(1)
  }, [router, searchParams])

  const handleSortingChange = React.useCallback((next: SortingState) => {
    setSorting(next)
    setPage(1)
  }, [])

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  /** Exports the current filter set — every matching order, not just the visible page. */
  const handleExport = React.useCallback(async () => {
    setIsExporting(true)
    try {
      const params = new URLSearchParams(queryParams)
      params.delete('page')
      params.delete('pageSize')
      params.set('format', 'csv')
      await downloadApiFile({
        url: `/api/${ORDER_FILES_API_PATH}?${params.toString()}`,
        expectedContentType: 'text/csv',
        fallbackName: view === 'finance' ? 'order-files-finance.csv' : 'order-files-business.csv',
        errorMessage: t('export_finance.orders.list.loadFailed'),
      })
    } catch (exportError) {
      flash(
        exportError instanceof Error && exportError.message
          ? exportError.message
          : t('export_finance.orders.list.loadFailed'),
        'error',
      )
    } finally {
      setIsExporting(false)
    }
  }, [queryParams, t, view])

  const detailHref = React.useCallback(
    (row: OrderFileRow) => `${ORDER_FILES_LIST_HREF}/${encodeURIComponent(row.purchaseOrderId)}`,
    [],
  )

  const filterValues = React.useMemo<FilterValues>(() => ({
    status,
    collectionStatus,
    taxRefundStatus,
  }), [collectionStatus, status, taxRefundStatus])

  const resetFilters = React.useCallback(() => {
    setStatus(ALL)
    setCollectionStatus(ALL)
    setTaxRefundStatus(ALL)
    setPage(1)
  }, [])

  return (
    <DataTable<OrderFileRow>
      title={(
        <div className="flex flex-col gap-1">
          <h1 className="text-base font-semibold leading-tight">{t('export_finance.orders.page.title')}</h1>
          <p className="text-sm font-normal text-muted-foreground">{t('export_finance.orders.page.description')}</p>
        </div>
      )}
      columns={columns}
      data={rows}
      actions={(
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl value={view} onValueChange={handleViewChange} aria-label={t('export_finance.orders.page.title')}>
            <SegmentedControlItem value="business">
              {t('export_finance.orders.page.tab.business')}
            </SegmentedControlItem>
            <SegmentedControlItem value="finance">
              {t('export_finance.orders.page.tab.finance')}
            </SegmentedControlItem>
          </SegmentedControl>
          <Button type="button" variant="outline" disabled={isExporting} onClick={() => { void handleExport() }}>
            {t('export_finance.orders.page.export')}
          </Button>
        </div>
      )}
      searchValue={search}
      onSearchChange={handleSearchChange}
      searchPlaceholder={t('export_finance.orders.list.searchPlaceholder')}
      searchAlign="right"
      filters={[
        {
          id: 'status',
          label: t('export_finance.orders.filters.status'),
          type: 'select',
          options: [
            { value: ALL, label: t('export_finance.orders.filters.all') },
            ...ORDER_STATUS_OPTIONS.map((value) => ({ value, label: t(BUSINESS_STATUS_LABEL_KEYS[value]) })),
          ],
        },
        {
          id: 'collectionStatus',
          label: t('export_finance.orders.filters.collectionStatus'),
          type: 'select',
          options: [
            { value: ALL, label: t('export_finance.orders.filters.all') },
            ...COLLECTION_STATUS_OPTIONS.map((value) => ({ value, label: t(COLLECTION_STATUS_LABEL_KEYS[value]) })),
          ],
        },
        {
          id: 'taxRefundStatus',
          label: t('export_finance.orders.filters.refundStatus'),
          type: 'select',
          options: [
            { value: ALL, label: t('export_finance.orders.filters.all') },
            ...REFUND_STATUS_OPTIONS.map((value) => ({ value, label: t(REFUND_STATUS_LABEL_KEYS[value]) })),
          ],
        },
      ]}
      filterValues={filterValues}
      onFiltersApply={(values: FilterValues) => {
        const nextStatus = values.status
        const nextCollection = values.collectionStatus
        const nextRefund = values.taxRefundStatus
        setStatus(typeof nextStatus === 'string' && nextStatus !== ALL ? (nextStatus as OrderFileStatus) : ALL)
        setCollectionStatus(
          typeof nextCollection === 'string' && nextCollection !== ALL
            ? (nextCollection as ExportFinanceCollectionStatus)
            : ALL,
        )
        setTaxRefundStatus(
          typeof nextRefund === 'string' && nextRefund !== ALL
            ? (nextRefund as ExportFinanceTaxRefundStatus)
            : ALL,
        )
        setPage(1)
      }}
      onFiltersClear={resetFilters}
      sortable
      manualSorting
      sorting={sorting}
      onSortingChange={handleSortingChange}
      emptyState={(
        <ListEmptyState title={t('export_finance.orders.list.empty')} />
      )}
      rowActions={(row) => (
        <RowActions
          items={[
            {
              id: 'open',
              label: t('export_finance.orders.actions.open'),
              onSelect: () => router.push(detailHref(row)),
            },
          ]}
        />
      )}
      pagination={{
        page,
        pageSize: PAGE_SIZE,
        total,
        totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
        onPageChange: setPage,
      }}
      isLoading={isLoading}
      error={listError}
      onRowClick={(row) => router.push(detailHref(row))}
    />
  )
}
