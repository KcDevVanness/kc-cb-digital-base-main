"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
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
import { MoneyAmount } from '@/lib/money/MoneyAmount'
import {
  ORDERS_API_PATH,
  ORDERS_LIST_HREF,
  ORDER_STATUSES,
  formatOrderDate,
  toPurchaseOrderRecord,
  type OrderStatus,
  type PurchaseOrderRecord,
} from './PurchaseOrderForm'
import {
  PurchaseOrderStatusBadge,
  purchaseOrderStatusLabel as orderStatusLabel,
} from '@/lib/orders/purchaseOrderStatus'

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
      cell: ({ row }) => (
        <MoneyAmount
          currencyCode={row.original.currencyCode}
          amount={row.original.total}
          className="items-end"
        />
      ),
    },
    {
      // 预付款金额: what has actually been registered at the `deposit` stage, not the planned term.
      accessorKey: 'paidDeposit',
      header: t('purchasing.orders.list.columns.paidDeposit'),
      enableSorting: false,
      meta: { priority: 5, align: 'right' },
      cell: ({ row }) => (
        <MoneyAmount
          currencyCode={row.original.currencyCode}
          amount={row.original.paidDeposit}
          className="items-end"
        />
      ),
    },
    {
      // 尾款金额: what has actually been registered at the `balance` stage.
      accessorKey: 'paidBalance',
      header: t('purchasing.orders.list.columns.paidBalance'),
      enableSorting: false,
      meta: { priority: 6, align: 'right' },
      cell: ({ row }) => (
        <MoneyAmount
          currencyCode={row.original.currencyCode}
          amount={row.original.paidBalance}
          className="items-end"
        />
      ),
    },
    {
      accessorKey: 'expectedShipAt',
      header: t('purchasing.orders.list.columns.expectedShipAt'),
      enableSorting: false,
      meta: { priority: 7 },
      cell: ({ row }) => {
        const expected = formatOrderDate(row.original.expectedShipAt, locale)
        return expected ? expected : <EmptyCell />
      },
    },
  ]
}

export default function PurchaseOrdersTable() {
  const searchParams = useSearchParams()
  /**
   * `?sourceSalesOrderId=` — arriving from an order hub or the order workbench narrows the list to
   * the purchase orders raised for that sales order. The banner below names the source and offers a
   * one-click way out of the filter, so a narrowed list never looks like an empty module.
   */
  const sourceSalesOrderId = searchParams.get('sourceSalesOrderId')?.trim() ?? ''
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
    if (sourceSalesOrderId) params.set('sourceSalesOrderId', sourceSalesOrderId)
    return params
  }, [page, search, sorting, sourceSalesOrderId, status])

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

  /**
   * Which of this page's orders already sit on a company order — **one batched reverse lookup**, so
   * the row says 「打开公司订单」 or 「未关联公司订单」 up front instead of discovering the answer when
   * the operator clicks (owner 2026-10-10: the click-first flow was 很傻很差). Deliberate states:
   *   - a Map  — the answer is in; each row shows the jump (linked) or a greyed hint (unlinked);
   *   - `null` — the lookup failed (a role without `order_hub.view` gets a 403 here): the row offers
   *     no company-order slot at all rather than a wrong state, and the list itself never breaks.
   */
  const rowIds = rows.map((row) => row.id)
  const companyOrdersQuery = useQuery({
    queryKey: ['purchasing-order-company-orders', rowIds.join(','), scopeVersion],
    enabled: rowIds.length > 0,
    queryFn: async (): Promise<Map<string, string> | null> => {
      try {
        const payload = await fetchCrudList<Record<string, unknown>>('order_hub/orders/links', {
          refIds: rowIds.join(','),
          kind: 'purchase_order',
          pageSize: 200,
        })
        const byRefId = new Map<string, string>()
        for (const item of payload.items ?? []) {
          const refId = String(item.refId ?? '')
          const companyOrderId = String(item.companyOrderId ?? '')
          if (refId && companyOrderId) byRefId.set(refId, companyOrderId)
        }
        return byRefId
      } catch {
        return null
      }
    },
  })
  const companyOrders = companyOrdersQuery.data

  const openCompanyOrder = React.useCallback(
    (companyOrderId: string) => {
      router.push(`/backend/orders/${encodeURIComponent(companyOrderId)}`)
    },
    [router],
  )

  // The rows themselves carry the frozen source number, so naming the filter costs no extra request.
  const sourceOrderNumber = sourceSalesOrderId
    ? rows.find((row) => row.sourceSalesOrderNumber)?.sourceSalesOrderNumber ?? null
    : null

  return (
    <>
      {sourceSalesOrderId ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            {sourceOrderNumber
              ? t('purchasing.orders.list.sourceOrderFilter', { number: sourceOrderNumber })
              : t('purchasing.orders.list.sourceOrderFilterUnknown')}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={() => router.replace(ORDERS_LIST_HREF)}>
            {t('purchasing.orders.list.clearSourceOrderFilter')}
          </Button>
        </div>
      ) : null}
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
      rowActions={(row) => {
        const companyOrderId = companyOrders?.get(row.id) ?? null
        return (
          // The company-order slot is a **state**, not a discovery (owner 2026-10-10): a linked row
          // links straight through, an unlinked row says so and stays inert, and a viewer the batched
          // lookup could not answer for gets no slot at all — never a click that reveals bad news.
          <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
            <RowActions
              items={[
                {
                  id: 'open',
                  label: t('purchasing.orders.actions.open'),
                  onSelect: () => router.push(detailHref(row)),
                },
              ]}
            />
            {companyOrders === undefined || companyOrders === null ? null : companyOrderId ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => openCompanyOrder(companyOrderId)}>
                {t('purchasing.orders.list.actions.openCompanyOrder')}
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled
                className="text-muted-foreground"
                title={t('purchasing.orders.list.actions.noCompanyOrder')}
              >
                {t('purchasing.orders.list.actions.noCompanyOrder')}
              </Button>
            )}
          </div>
        )
      }}
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
    </>
  )
}
