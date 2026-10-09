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
import { Badge } from '@open-mercato/ui/primitives/badge'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { formatMoneyAmount } from '@/lib/money/format'
import type { CompanyOrderStageSummary } from '../lib/orderStages'
import { COMPANY_ORDER_STATUSES } from '../data/validators'
import OrderFieldsDrawer, { type OrderFieldsTarget } from './OrderFieldsDrawer'
import { toOrderWorkbenchRow, type OrderWorkbenchRow } from './companyOrderDisplay'

/**
 * The order workbench: one row per **company order** (`order_hub_company_orders`), the root that
 * gathers a trade's children — internal/external sales and its purchase orders — plus how far each
 * one has been filled in (采购 / 发运 / 单证 / 收汇·退税).
 *
 * The row prints the **root's own fields** — the same ones the order page's header card shows, in
 * the same order — so a reader can move from the table to `/backend/orders/<id>` without the columns
 * changing meaning. Child documents stay out of the row: their numbers and counterparties are the
 * order page's attach blocks' business, and printing the first one here would put a purchase order's
 * supplier in a column called 对方.
 *
 * One list read (`/api/order_hub/orders`) answers the root's own columns; the stages are a second,
 * batched read keyed by company-order id (`/api/order_hub/stages?ids=…`), so the number of round
 * trips stays flat as the page grows. A failed stage projection degrades to zero counts and empty
 * link facts rather than failing the whole screen.
 *
 * Every stage cell links to the branch that holds the records: `/backend/orders/<id>#purchasing`
 * etc. on the hub.
 */

const KIND_VALUES = ['all', 'internal_sales_order', 'external_sales_order', 'purchase_order'] as const
type KindFilter = (typeof KIND_VALUES)[number]

const STATUS_VARIANT: Record<string, StatusBadgeVariant> = {
  // The current vocabulary (2026-10-09), in the deal's own order: everything before the goods reach
  // the warehouse is in flight, and arrival is the success state.
  placed: 'info',
  in_production: 'info',
  factory_pickup: 'info',
  customs_declared: 'info',
  shipped: 'info',
  in_transit: 'info',
  warehoused: 'success',
  // Rows written before that vocabulary landed keep their own label and tone.
  draft: 'neutral',
  in_progress: 'info',
  completed: 'success',
  cancelled: 'error',
}

const PAGE_SIZE_OPTIONS = [20, 50, 100]
const DEFAULT_PAGE_SIZE = 20

/** The retired per-kind list URLs redirect here with `?type=`; map the token onto the API kind. */
const KIND_BY_TYPE_TOKEN: Record<string, KindFilter> = {
  internal: 'internal_sales_order',
  external: 'external_sales_order',
  purchase: 'purchase_order',
}

function isKindFilter(value: unknown): value is KindFilter {
  return typeof value === 'string' && (KIND_VALUES as readonly string[]).includes(value)
}

export default function OrderWorkbench() {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const searchParams = useSearchParams()
  const scopeVersion = useOrganizationScopeVersion()
  const { payload: chromePayload } = useBackendChrome()

  const [kind, setKind] = React.useState<KindFilter>(() => {
    const token = searchParams?.get('type')
    return (token && KIND_BY_TYPE_TOKEN[token]) || 'all'
  })
  const [status, setStatus] = React.useState<string>('all')
  const [search, setSearch] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(DEFAULT_PAGE_SIZE)
  const [fieldsTarget, setFieldsTarget] = React.useState<OrderFieldsTarget | null>(null)
  const [fieldsOpen, setFieldsOpen] = React.useState(false)

  const granted = React.useMemo(() => new Set(chromePayload?.grantedFeatures ?? []), [chromePayload?.grantedFeatures])
  // Before the chrome payload arrives the button stays visible: hiding a control the caller may hold
  // is worse than showing one the page gate would refuse anyway.
  const canManage = !chromePayload || granted.has('order_hub.manage')

  const orders = useQuery({
    queryKey: ['order-hub-orders', page, pageSize, kind, status, search, scopeVersion],
    queryFn: () => fetchCrudList<Record<string, unknown>>('order_hub/orders', {
      page,
      pageSize,
      ...(search ? { search } : {}),
      ...(status !== 'all' ? { status } : {}),
      ...(kind !== 'all' ? { kind } : {}),
    }),
  })

  const rows = React.useMemo<OrderWorkbenchRow[]>(
    () => (orders.data?.items ?? []).map(toOrderWorkbenchRow).filter((row) => row.id.length > 0),
    [orders.data],
  )

  const ids = React.useMemo(() => rows.map((row) => row.id), [rows])

  const stages = useQuery({
    queryKey: ['order-hub-stages', ids, scopeVersion],
    enabled: ids.length > 0,
    queryFn: () => readApiResultOrThrow<{ items: CompanyOrderStageSummary[] }>(
      `/api/order_hub/stages?ids=${encodeURIComponent(ids.join(','))}`,
    ),
  })

  // A failed projection yields no entries; the cells fall back to zero counts and empty link facts,
  // so the stage read never takes the list down with it.
  const stageById = React.useMemo(() => {
    const map = new Map<string, CompanyOrderStageSummary>()
    for (const item of stages.data?.items ?? []) map.set(item.id, item)
    return map
  }, [stages.data])

  const columns = React.useMemo<ColumnDef<OrderWorkbenchRow>[]>(() => {
    const countCell = (
      branch: 'purchasing' | 'shipments' | 'documents',
      pick: (stage: CompanyOrderStageSummary | undefined) => number,
    ) => ({ row }: { row: { original: OrderWorkbenchRow } }) => {
      const item = row.original
      const count = pick(stageById.get(item.id))
      return (
        <Link
          href={`/backend/orders/${encodeURIComponent(item.id)}#${branch}`}
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
        accessorKey: 'number',
        header: t('order_hub.workbench.columns.number'),
        cell: ({ row }) => (
          <span className="inline-flex flex-wrap items-center gap-2">
            <Link href={`/backend/orders/${encodeURIComponent(row.original.id)}`} className="underline">
              {row.original.number}
            </Link>
            {/* A row the caller sees as a collaborating organization, not as its owner: the marker
                is the row's own flag from the list read, so it needs no extra request and does not
                change any other column or filter. */}
            {row.original.viewerIsCollaborator ? (
              <Badge variant="info" size="sm" dot>
                {t('order_hub.workbench.collaborator')}
              </Badge>
            ) : null}
          </span>
        ),
      },
      {
        accessorKey: 'title',
        header: t('order_hub.workbench.columns.title'),
        enableSorting: false,
        cell: ({ row }) => row.original.title ?? '—',
      },
      {
        accessorKey: 'orderDate',
        header: t('order_hub.workbench.columns.orderedAt'),
        enableSorting: false,
        cell: ({ row }) => row.original.orderDate ?? '—',
      },
      {
        accessorKey: 'etaDate',
        header: t('order_hub.workbench.columns.etaDate'),
        enableSorting: false,
        cell: ({ row }) => row.original.etaDate ?? '—',
      },
      {
        accessorKey: 'status',
        header: t('order_hub.workbench.columns.status'),
        enableSorting: false,
        cell: ({ row }) => (
          <StatusBadge variant={STATUS_VARIANT[row.original.status] ?? 'neutral'}>
            {t(`order_hub.companyOrders.status.${row.original.status}`)}
          </StatusBadge>
        ),
      },
      {
        id: 'paymentStatus',
        header: t('order_hub.workbench.columns.paymentStatus'),
        enableSorting: false,
        // The root's own marker (第六轮): 已收全款 / 未收款, and `—` for a root that never recorded
        // it — the same answer the hub's header card gives, never a guess about its money.
        cell: ({ row }) => (
          row.original.paymentStatus
            ? t(`order_hub.companyOrders.paymentStatus.${row.original.paymentStatus}`, row.original.paymentStatus)
            : '—'
        ),
      },
      {
        id: 'customer',
        header: t('order_hub.workbench.columns.customer'),
        enableSorting: false,
        cell: ({ row }) => row.original.customerName ?? '—',
      },
      {
        id: 'supplier',
        header: t('order_hub.workbench.columns.supplier'),
        enableSorting: false,
        cell: ({ row }) => row.original.supplierName ?? '—',
      },
      {
        id: 'amount',
        header: t('order_hub.workbench.columns.amount'),
        enableSorting: false,
        cell: ({ row }) => {
          const amounts = stageById.get(row.original.id)?.amounts ?? []
          if (amounts.length === 0) return '—'
          // The money side of the deal: the sales figure, or the purchase figure when the order has
          // no sales child yet — each currency on its own (`¥` and `$` are never added together).
          return (
            <span className="tabular-nums">
              {amounts
                .map((amount) => {
                  const value = amount.sales !== '0.00' ? amount.sales : amount.purchase
                  return formatMoneyAmount(value, amount.currencyCode, locale) ?? `${amount.currencyCode} ${value}`
                })
                .join(' · ')}
            </span>
          )
        },
      },
      {
        id: 'procurement',
        header: t('order_hub.workbench.columns.procurement'),
        enableSorting: false,
        cell: countCell('purchasing', (stage) => stage?.procurementCount ?? 0),
      },
      {
        id: 'shipment',
        header: t('order_hub.workbench.columns.shipment'),
        enableSorting: false,
        cell: countCell('shipments', (stage) => stage?.shipmentCount ?? 0),
      },
      {
        id: 'documents',
        header: t('order_hub.workbench.columns.documents'),
        enableSorting: false,
        cell: countCell('documents', (stage) => stage?.documentCount ?? 0),
      },
      {
        id: 'money',
        header: t('order_hub.workbench.columns.money'),
        enableSorting: false,
        cell: ({ row }) => {
          const stage = stageById.get(row.original.id)
          const parts = [
            stage?.collected ? t('order_hub.workbench.cell.collected') : t('order_hub.workbench.cell.notCollected'),
            stage?.refunded ? t('order_hub.workbench.cell.refunded') : t('order_hub.workbench.cell.notRefunded'),
          ]
          return (
            <Link href={`/backend/orders/${encodeURIComponent(row.original.id)}#money`} className="underline">
              {parts.join(' · ')}
            </Link>
          )
        },
      },
    ]
  }, [stageById, t, locale])

  const statusOptions = React.useMemo(
    () => [
      { value: 'all', label: t('order_hub.workbench.filters.all') },
      ...COMPANY_ORDER_STATUSES.map((value) => ({
        value,
        label: t(`order_hub.companyOrders.status.${value}`),
      })),
    ],
    [t],
  )

  const total = orders.data?.total ?? 0
  const totalPages = orders.data?.totalPages ?? Math.max(1, Math.ceil(total / pageSize))

  return (
    <>
    <DataTable<OrderWorkbenchRow>
      title={(
        <div className="flex flex-col gap-1">
          <h1 className="text-base font-semibold leading-tight">{t('order_hub.workbench.title')}</h1>
          <p className="text-sm font-normal text-muted-foreground">{t('order_hub.workbench.description')}</p>
        </div>
      )}
      columns={columns}
      data={rows}
      entityId="order_hub:company_order"
      actions={canManage ? (
        <Button asChild>
          <Link href="/backend/orders/create">{t('order_hub.workbench.actions.createOrder')}</Link>
        </Button>
      ) : null}
      searchValue={search}
      onSearchChange={(value) => {
        setSearch(value)
        setPage(1)
      }}
      searchPlaceholder={t('order_hub.workbench.searchPlaceholder')}
      searchAlign="right"
      filters={[
        {
          id: 'kind',
          label: t('order_hub.workbench.filters.type'),
          type: 'select',
          options: [
            { value: 'all', label: t('order_hub.workbench.filters.all') },
            { value: 'internal_sales_order', label: t('order_hub.workbench.type.internalSales') },
            { value: 'external_sales_order', label: t('order_hub.workbench.type.externalSales') },
            { value: 'purchase_order', label: t('order_hub.workbench.type.purchase') },
          ],
        },
        {
          id: 'status',
          label: t('order_hub.workbench.filters.status'),
          type: 'select',
          options: statusOptions,
        },
      ]}
      filterValues={{ kind, status }}
      onFiltersApply={(values) => {
        setKind(isKindFilter(values.kind) ? values.kind : 'all')
        setStatus(typeof values.status === 'string' && values.status.length > 0 ? values.status : 'all')
        setPage(1)
      }}
      onFiltersClear={() => {
        setKind('all')
        setStatus('all')
        setPage(1)
      }}
      rowActions={(row) => {
        return (
          <RowActions
            items={[
              {
                id: 'open',
                label: t('order_hub.workbench.actions.openDetail'),
                onSelect: () => router.push(`/backend/orders/${encodeURIComponent(row.id)}`),
              },
              {
                id: 'fields',
                label: t('order_hub.workbench.actions.fields'),
                onSelect: () => {
                  setFieldsTarget({ id: row.id, number: row.number })
                  setFieldsOpen(true)
                },
              },
            ]}
          />
        )
      }}
      pagination={{
        page,
        pageSize,
        total,
        totalPages,
        onPageChange: setPage,
        onPageSizeChange: (next) => {
          setPageSize(next)
          setPage(1)
        },
        pageSizeOptions: PAGE_SIZE_OPTIONS,
      }}
      isLoading={orders.isLoading}
      error={orders.isError ? t('order_hub.workbench.loadFailed') : null}
      emptyState={<ListEmptyState title={t('order_hub.workbench.empty')} />}
    />
    <OrderFieldsDrawer target={fieldsTarget} open={fieldsOpen} onOpenChange={setFieldsOpen} />
    </>
  )
}
