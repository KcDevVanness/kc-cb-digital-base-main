"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { formatDate } from '@open-mercato/ui/utils/format'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useLocale, useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { MoneyAmount } from '@/lib/money/MoneyAmount'
import type { InternalSalesKind } from './InternalSalesForm'

/**
 * App-owned list for the internal-sales documents.
 *
 * The installed lists are the platform's own view; this one belongs to the module so the whole
 * flow — list, create, edit — stays inside the app-owned surface. It reads the installed list API,
 * which already projects the document head (number, currency, totals, customer snapshot), and its
 * row action opens this module's own edit page.
 */

const PAGE_SIZE = 50

type DocumentRecord = {
  id: string
  number: string | null
  currencyCode: string
  total: string
  customerName: string | null
  lineItemCount: number
  createdAt: string | null
}

function readText(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string') return value
  }
  return ''
}

function toDocumentRecord(item: Record<string, unknown>, kind: InternalSalesKind): DocumentRecord {
  const snapshot = item.customerSnapshot ?? item.customer_snapshot
  const customerName = snapshot && typeof snapshot === 'object'
    ? readText(snapshot as Record<string, unknown>, 'name') || null
    : null
  const total = item.grandTotalNetAmount ?? item.grand_total_net_amount ?? item.grandTotalGrossAmount
  return {
    id: String(item.id),
    number: readText(item, kind === 'quote' ? 'quoteNumber' : 'orderNumber') || null,
    currencyCode: readText(item, 'currencyCode', 'currency_code') || 'CNY',
    total: typeof total === 'number' ? String(total) : typeof total === 'string' ? total : '0',
    customerName,
    lineItemCount: Number(item.lineItemCount ?? item.line_item_count ?? 0),
    createdAt: (item.createdAt ?? item.created_at ?? null) as string | null,
  }
}

function buildColumns(t: TranslateFn, locale: string, kind: InternalSalesKind): ColumnDef<DocumentRecord>[] {
  return [
    {
      accessorKey: 'number',
      header: t(kind === 'quote' ? 'internal_sales.list.columns.quoteNumber' : 'internal_sales.list.columns.orderNumber'),
      cell: ({ row }) => row.original.number ?? <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      accessorKey: 'customerName',
      header: t('internal_sales.list.columns.customer'),
      enableSorting: false,
      meta: { truncate: true, maxWidth: 280 },
      cell: ({ row }) => row.original.customerName ?? <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      accessorKey: 'total',
      header: t('internal_sales.list.columns.total'),
      enableSorting: false,
      cell: ({ row }) => (
        <MoneyAmount currencyCode={row.original.currencyCode} amount={row.original.total} />
      ),
    },
    {
      id: 'lineItemCount',
      header: t('internal_sales.list.columns.lines'),
      enableSorting: false,
      cell: ({ row }) => <span className="tabular-nums">{row.original.lineItemCount}</span>,
    },
    {
      accessorKey: 'createdAt',
      header: t('internal_sales.list.columns.createdAt'),
      enableSorting: false,
      cell: ({ row }) => formatDate(row.original.createdAt, locale) ?? '—',
    },
  ]
}

export default function InternalSalesTable({ kind }: { kind: InternalSalesKind }) {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const [search, setSearch] = React.useState('')
  const [page, setPage] = React.useState(1)

  const listHref = kind === 'quote' ? '/backend/internal-sales/quotes' : '/backend/internal-sales/orders'
  const apiPath = kind === 'quote' ? 'sales/quotes' : 'sales/orders'

  const queryKey = React.useMemo(
    () => [`internal-sales-${kind}`, page, search, scopeVersion],
    [kind, page, scopeVersion, search],
  )

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), sortField: 'created_at', sortDir: 'desc' })
      const term = search.trim()
      if (term) params.set('search', term)
      const payload = await fetchCrudList<Record<string, unknown>>(apiPath, Object.fromEntries(params))
      return { ...payload, items: (payload.items ?? []).map((item) => toDocumentRecord(item, kind)) }
    },
  })

  const rows = data?.items ?? []
  const listError = error
    ? (error instanceof Error && error.message ? error.message : t('internal_sales.form.loadFailed'))
    : null
  const columns = React.useMemo(() => buildColumns(t, locale, kind), [kind, locale, t])

  return (
    <DataTable<DocumentRecord>
      title={(
        <div className="flex flex-col gap-1">
          <h1 className="text-base font-semibold leading-tight">
            {t(kind === 'quote' ? 'internal_sales.list.quote.title' : 'internal_sales.list.order.title')}
          </h1>
          <p className="text-sm font-normal text-muted-foreground">
            {t(kind === 'quote' ? 'internal_sales.list.quote.description' : 'internal_sales.list.order.description')}
          </p>
        </div>
      )}
      columns={columns}
      data={rows}
      actions={(
        <Button asChild>
          <Link href={`${listHref}/create`}>
            {t(kind === 'quote' ? 'internal_sales.form.quote.createTitle' : 'internal_sales.form.order.createTitle')}
          </Link>
        </Button>
      )}
      searchValue={search}
      onSearchChange={(value) => {
        setSearch(value)
        setPage(1)
      }}
      searchPlaceholder={t('internal_sales.list.searchPlaceholder')}
      searchAlign="right"
      emptyState={(
        <ListEmptyState
          title={t(kind === 'quote' ? 'internal_sales.list.quote.empty' : 'internal_sales.list.order.empty')}
          createHref={`${listHref}/create`}
          createLabel={t(kind === 'quote' ? 'internal_sales.form.quote.createTitle' : 'internal_sales.form.order.createTitle')}
        />
      )}
      rowActions={(row) => (
        <RowActions
          items={[
            { id: 'edit', label: t('internal_sales.list.actions.edit'), href: `${listHref}/${row.id}/edit` },
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
      onRowClick={(row) => router.push(`${listHref}/${row.id}/edit`)}
    />
  )
}
