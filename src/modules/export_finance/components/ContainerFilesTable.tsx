"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { buildCrudExportUrl, fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { Button } from '@open-mercato/ui/primitives/button'
import { formatDisplayDate } from '@open-mercato/ui/primitives/date-format'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useLocale, useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { ExportFinanceTaxRefundStatus } from '../data/validators'
import type { ShipmentStatus } from '../../cross_border/data/validators'
import { downloadApiFile } from '../../trade_docs/components/downloadFile'
import {
  CONTAINER_EXPORT_CHECKLIST_KEYS,
  CONTAINER_REFUND_CHECKLIST_KEYS,
  sumAllocationShares,
  type ContainerChecklistKey,
  type ContainerFileRow,
} from '../lib/fileRules'
import {
  CONTAINER_CHECKLIST_LABEL_KEYS,
  REFUND_STATUS_LABEL_KEYS,
  REFUND_STATUS_OPTIONS,
  SHIPMENT_MILESTONE_LABEL_KEYS,
  SHIPMENT_STATUS_LABEL_KEYS,
  SHIPMENT_STATUS_OPTIONS,
  checklistCounter,
} from './labels'

/**
 * 柜档案 list — one row per container, seen as the tax-refund unit.
 *
 * The row is the read-only projection of the container (`loadContainerFiles`): the shipment facts,
 * the orders inside it with their allocated shares, the refund record and the two document
 * checklists. Nothing on this page writes: the refund record is registered on the detail page,
 * and the export documents belong to the shipment.
 */

const API_PATH = 'export_finance/container-files'
const CONTAINERS_LIST_HREF = '/backend/export-finance/containers'
const PAGE_SIZE = 50
const QUERY_KEY_ROOT = 'export-finance-container-files'

/** The filter's "no restriction" entry: the query simply omits the key when it is selected. */
const ALL_VALUE = 'all'

/**
 * Only the columns the endpoint can order by are sortable — `sortField` is a closed enum server
 * side, so a free-form column id would answer 400 instead of reordering.
 */
const SORT_FIELDS: Record<string, 'departed_at' | 'eta' | 'number'> = {
  shipmentNumber: 'number',
  departedAt: 'departed_at',
  eta: 'eta',
}

const SHIPMENT_STATUS_VARIANTS: StatusMap<ShipmentStatus> = {
  draft: 'neutral',
  in_transit: 'info',
  received: 'success',
  cancelled: 'error',
}

/** Ascending completion: a filed declaration is a success, a missing one a warning, never an error. */
const REFUND_STATUS_VARIANTS: StatusMap<ExportFinanceTaxRefundStatus> = {
  completed: 'success',
  applied: 'info',
  not_started: 'warning',
  unknown: 'neutral',
}

const EMPTY_CELL = '—'

function EmptyCell() {
  return <span className="text-xs text-muted-foreground">{EMPTY_CELL}</span>
}

/**
 * The stored `numeric(18,4)` amount at the two decimals this business reads. The widening goes
 * through the module's money engine (`sumAllocationShares` parses exactly and renders at 2 places),
 * never through a float.
 */
function formatRefundAmount(value: string | null): string | null {
  if (!value) return null
  return sumAllocationShares([value])
}

function shipmentStatusLabel(t: TranslateFn, status: string): string {
  const key = SHIPMENT_STATUS_LABEL_KEYS[status as ShipmentStatus]
  return key ? t(key) : status
}

function refundStatusLabel(t: TranslateFn, status: string): string {
  const key = REFUND_STATUS_LABEL_KEYS[status as ExportFinanceTaxRefundStatus]
  return key ? t(key) : status
}

function milestoneLabel(t: TranslateFn, milestone: string | null): string | null {
  if (!milestone) return null
  const key = SHIPMENT_MILESTONE_LABEL_KEYS[milestone as keyof typeof SHIPMENT_MILESTONE_LABEL_KEYS]
  return key ? t(key) : milestone
}

/**
 * `n/total` for one checklist class. The tooltip names what is still missing, because the number
 * alone cannot tell an operator which file to chase.
 */
function checklistCell(
  t: TranslateFn,
  checklist: ContainerFileRow['checklist'],
  keys: readonly ContainerChecklistKey[],
): React.ReactElement {
  const { hits, total } = checklistCounter(checklist, keys)
  const missing = keys.filter((key) => !checklist[key])
  const hint = missing.length
    ? t('export_finance.cabinets.checklist.missingHint', 'Missing: {items}', {
        items: missing.map((key) => t(CONTAINER_CHECKLIST_LABEL_KEYS[key], key)).join(', '),
      })
    : undefined
  return (
    <span
      className={hits === total ? 'text-sm text-status-success-text' : 'text-sm text-muted-foreground'}
      title={hint}
    >
      {`${hits}/${total}`}
    </span>
  )
}

function buildColumns(t: TranslateFn, locale: string): ColumnDef<ContainerFileRow>[] {
  return [
    {
      accessorKey: 'shipmentNumber',
      header: t('export_finance.cabinets.columns.number'),
      meta: { priority: 1 },
      cell: ({ row }) => {
        const number = row.original.shipmentNumber
        if (number) return number
        // A container that has not departed has no `SHP-…` number yet. Its status is the honest
        // label; its id never belongs on screen.
        return (
          <span className="text-xs text-muted-foreground">
            {shipmentStatusLabel(t, 'draft')}
          </span>
        )
      },
    },
    {
      accessorKey: 'containerType',
      header: t('export_finance.cabinets.columns.containerType'),
      enableSorting: false,
      meta: { priority: 2 },
      cell: ({ row }) => row.original.containerType ?? <EmptyCell />,
    },
    {
      accessorKey: 'containerNumber',
      header: t('export_finance.cabinets.columns.containerNumber'),
      enableSorting: false,
      meta: { priority: 3 },
      cell: ({ row }) => row.original.containerNumber ?? <EmptyCell />,
    },
    {
      accessorKey: 'sealNumber',
      header: t('export_finance.cabinets.columns.sealNumber'),
      enableSorting: false,
      meta: { priority: 4 },
      cell: ({ row }) => row.original.sealNumber ?? <EmptyCell />,
    },
    {
      accessorKey: 'bookingNumber',
      header: t('export_finance.cabinets.columns.bookingNumber'),
      enableSorting: false,
      meta: { priority: 5, truncate: true, maxWidth: 200 },
      cell: ({ row }) => row.original.bookingNumber ?? <EmptyCell />,
    },
    {
      accessorKey: 'shipmentStatus',
      header: t('export_finance.cabinets.columns.status'),
      enableSorting: false,
      meta: { priority: 6 },
      cell: ({ row }) => {
        const status = row.original.shipmentStatus
        const variant = SHIPMENT_STATUS_VARIANTS[status as ShipmentStatus]
        if (!variant) return <EmptyCell />
        return (
          <StatusBadge variant={variant} dot>
            {shipmentStatusLabel(t, status)}
          </StatusBadge>
        )
      },
    },
    {
      accessorKey: 'currentMilestone',
      header: t('export_finance.cabinets.columns.milestone'),
      enableSorting: false,
      meta: { priority: 7 },
      cell: ({ row }) => {
        const label = milestoneLabel(t, row.original.currentMilestone)
        return label ?? <EmptyCell />
      },
    },
    {
      accessorKey: 'departedAt',
      header: t('export_finance.cabinets.columns.departedAt'),
      meta: { priority: 8 },
      cell: ({ row }) => {
        const departed = formatDisplayDate(row.original.departedAt, locale)
        return departed ?? <EmptyCell />
      },
    },
    {
      accessorKey: 'eta',
      header: t('export_finance.cabinets.columns.eta'),
      meta: { priority: 9 },
      cell: ({ row }) => {
        const eta = formatDisplayDate(row.original.eta, locale)
        return eta ?? <EmptyCell />
      },
    },
    {
      accessorKey: 'orders',
      header: t('export_finance.cabinets.columns.orders'),
      enableSorting: false,
      meta: { priority: 10, truncate: true, maxWidth: 260 },
      cell: ({ row }) => {
        const orders = row.original.orders
        if (orders.length === 0) return <EmptyCell />
        // Stored order numbers only — a draft order has none, and its id is not a name.
        const numbers = orders
          .map((order) => order.number ?? order.businessNumber)
          .filter((value): value is string => Boolean(value))
        return (
          <div className="flex flex-col">
            <span className="truncate">{numbers.length ? numbers.join(', ') : EMPTY_CELL}</span>
            <span className="text-xs text-muted-foreground">
              {t('export_finance.cabinets.columns.ordersCount', '{count} orders', { count: orders.length })}
            </span>
          </div>
        )
      },
    },
    {
      accessorKey: 'taxRefundStatus',
      header: t('export_finance.cabinets.columns.refundStatus'),
      enableSorting: false,
      meta: { priority: 11 },
      cell: ({ row }) => {
        const status = row.original.taxRefundStatus
        const variant = REFUND_STATUS_VARIANTS[status as ExportFinanceTaxRefundStatus]
        if (!variant) return <EmptyCell />
        return (
          <StatusBadge variant={variant} dot>
            {refundStatusLabel(t, status)}
          </StatusBadge>
        )
      },
    },
    {
      accessorKey: 'taxRefundAmount',
      header: t('export_finance.cabinets.columns.refundAmount'),
      enableSorting: false,
      meta: { priority: 12, align: 'right' },
      cell: ({ row }) => {
        const amount = formatRefundAmount(row.original.taxRefundAmount)
        return amount ?? <EmptyCell />
      },
    },
    {
      accessorKey: 'exportChecklist',
      header: t('export_finance.cabinets.columns.exportChecklist'),
      enableSorting: false,
      meta: { priority: 13 },
      cell: ({ row }) => checklistCell(t, row.original.checklist, CONTAINER_EXPORT_CHECKLIST_KEYS),
    },
    {
      accessorKey: 'refundChecklist',
      header: t('export_finance.cabinets.columns.refundChecklist'),
      enableSorting: false,
      meta: { priority: 14 },
      cell: ({ row }) => checklistCell(t, row.original.checklist, CONTAINER_REFUND_CHECKLIST_KEYS),
    },
  ]
}

export default function ContainerFilesTable() {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const [search, setSearch] = React.useState('')
  const [status, setStatus] = React.useState<string>(ALL_VALUE)
  const [taxRefundStatus, setTaxRefundStatus] = React.useState<string>(ALL_VALUE)
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [page, setPage] = React.useState(1)
  const [isExporting, setIsExporting] = React.useState(false)

  const queryParams = React.useMemo(() => {
    const activeSort = sorting[0]
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sortField: (activeSort && SORT_FIELDS[activeSort.id]) || 'departed_at',
      sortDir: activeSort ? (activeSort.desc ? 'desc' : 'asc') : 'desc',
    })
    const term = search.trim()
    if (term) params.set('search', term)
    if (status !== ALL_VALUE) params.set('status', status)
    if (taxRefundStatus !== ALL_VALUE) params.set('taxRefundStatus', taxRefundStatus)
    return params
  }, [page, search, sorting, status, taxRefundStatus])

  const queryKey = React.useMemo(
    () => [QUERY_KEY_ROOT, queryParams.toString(), scopeVersion],
    [queryParams, scopeVersion],
  )

  const columns = React.useMemo(() => buildColumns(t, locale), [locale, t])

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => fetchCrudList<ContainerFileRow>(API_PATH, Object.fromEntries(queryParams)),
  })

  const rows = data?.items ?? []
  const total = data?.total ?? 0
  const listError = error
    ? (error instanceof Error && error.message ? error.message : t('export_finance.cabinets.list.loadFailed'))
    : null

  const handleSortingChange = React.useCallback((next: SortingState) => {
    setSorting(next)
    setPage(1)
  }, [])

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const handleExport = React.useCallback(async () => {
    setIsExporting(true)
    try {
      await downloadApiFile({
        url: buildCrudExportUrl(API_PATH, Object.fromEntries(queryParams), 'csv'),
        expectedContentType: 'text/csv',
        fallbackName: 'container-files.csv',
        errorMessage: t('export_finance.cabinets.actions.exportFailed', 'Could not export the container file'),
      })
    } catch (exportError) {
      flash(
        exportError instanceof Error && exportError.message
          ? exportError.message
          : t('export_finance.cabinets.actions.exportFailed', 'Could not export the container file'),
        'error',
      )
    } finally {
      setIsExporting(false)
    }
  }, [queryParams, t])

  const detailHref = React.useCallback(
    (row: ContainerFileRow) => `${CONTAINERS_LIST_HREF}/${encodeURIComponent(row.shipmentId)}`,
    [],
  )

  const filterValues = React.useMemo<FilterValues>(() => {
    const values: FilterValues = {}
    if (status !== ALL_VALUE) values.status = status
    if (taxRefundStatus !== ALL_VALUE) values.taxRefundStatus = taxRefundStatus
    return values
  }, [status, taxRefundStatus])

  return (
    <DataTable<ContainerFileRow>
      title={(
        <div className="flex flex-col gap-1">
          <h1 className="text-base font-semibold leading-tight">{t('export_finance.cabinets.page.title')}</h1>
          <p className="text-sm font-normal text-muted-foreground">{t('export_finance.cabinets.page.description')}</p>
        </div>
      )}
      columns={columns}
      data={rows}
      actions={(
        <Button type="button" variant="outline" disabled={isExporting} onClick={() => { void handleExport() }}>
          {t('export_finance.cabinets.actions.export')}
        </Button>
      )}
      searchValue={search}
      onSearchChange={handleSearchChange}
      searchPlaceholder={t('export_finance.cabinets.list.searchPlaceholder')}
      searchAlign="right"
      filters={[
        {
          id: 'status',
          label: t('export_finance.cabinets.filters.status'),
          type: 'select',
          options: [
            { value: ALL_VALUE, label: t('export_finance.cabinets.filters.all') },
            ...SHIPMENT_STATUS_OPTIONS.map((value) => ({ value, label: shipmentStatusLabel(t, value) })),
          ],
        },
        {
          id: 'taxRefundStatus',
          label: t('export_finance.cabinets.filters.refundStatus'),
          type: 'select',
          options: [
            { value: ALL_VALUE, label: t('export_finance.cabinets.filters.all') },
            ...REFUND_STATUS_OPTIONS.map((value) => ({ value, label: refundStatusLabel(t, value) })),
          ],
        },
      ]}
      filterValues={filterValues}
      onFiltersApply={(values: FilterValues) => {
        const nextStatus = values.status
        const nextRefundStatus = values.taxRefundStatus
        setStatus(typeof nextStatus === 'string' && nextStatus.length ? nextStatus : ALL_VALUE)
        setTaxRefundStatus(
          typeof nextRefundStatus === 'string' && nextRefundStatus.length ? nextRefundStatus : ALL_VALUE,
        )
        setPage(1)
      }}
      onFiltersClear={() => {
        setStatus(ALL_VALUE)
        setTaxRefundStatus(ALL_VALUE)
        setPage(1)
      }}
      sortable
      manualSorting
      sorting={sorting}
      onSortingChange={handleSortingChange}
      emptyState={<ListEmptyState title={t('export_finance.cabinets.list.empty')} />}
      rowActions={(row) => (
        <RowActions
          items={[
            {
              id: 'open',
              label: t('export_finance.cabinets.actions.open'),
              onSelect: () => router.push(detailHref(row)),
            },
          ]}
        />
      )}
      pagination={{
        page,
        pageSize: PAGE_SIZE,
        total,
        // The aggregate endpoint answers `{ items, total, page, pageSize }` only, so the page
        // count is derived here rather than trusted from a field the response does not carry.
        totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
        onPageChange: setPage,
      }}
      isLoading={isLoading}
      error={listError}
      onRowClick={(row) => router.push(detailHref(row))}
    />
  )
}
