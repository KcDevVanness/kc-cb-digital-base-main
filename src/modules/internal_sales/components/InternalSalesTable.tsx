"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { formatDate } from '@open-mercato/ui/utils/format'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { useLocale, useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { createDictionaryMap, DictionaryValue, type DictionaryMap } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { loadDictionaryEntriesByKey } from '@open-mercato/core/modules/dictionaries/lib/clientEntries'
import { MoneyAmount } from '@/lib/money/MoneyAmount'
import type { InternalSalesKind } from './InternalSalesForm'
import { documentEditHref, listHrefFor } from './InternalSalesForm'

/**
 * App-owned list for the internal-sales documents.
 *
 * The installed lists are the platform's own view; this one belongs to the module so the whole
 * flow — list, create, edit — stays inside the app-owned surface. It reads the installed list API,
 * which already projects the document head (number, currency, totals, customer snapshot), and its
 * row action opens this module's own edit page.
 */

const PAGE_SIZE = 50

/** The installed sales chain keeps order and quote statuses in this dictionary. */
const SALES_STATUS_DICTIONARY_KEY = 'sales.order_status'

type DocumentRecord = {
  id: string
  number: string | null
  currencyCode: string
  total: string
  customerName: string | null
  status: string | null
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
    status: readText(item, 'status') || null,
    lineItemCount: Number(item.lineItemCount ?? item.line_item_count ?? 0),
    createdAt: (item.createdAt ?? item.created_at ?? null) as string | null,
  }
}

function buildColumns(
  t: TranslateFn,
  locale: string,
  kind: InternalSalesKind,
  statusMap: DictionaryMap | null,
): ColumnDef<DocumentRecord>[] {
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
      accessorKey: 'status',
      header: t('internal_sales.list.columns.status'),
      enableSorting: false,
      cell: ({ row }) => (
        <DictionaryValue
          value={row.original.status}
          map={statusMap}
          fallback={<span className="text-xs text-muted-foreground">—</span>}
          colorClassName="h-3 w-3 rounded-full"
        />
      ),
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
  // Create/edit are gated server-side by the document's manage feature; hide the controls from a
  // read-only operator (same pattern as the products list and the purchasing supplier library).
  // Nothing is hidden while the chrome payload loads, so a permitted operator never sees flicker.
  const { payload: chromePayload, isReady: chromeReady } = useBackendChrome()
  const manageFeature = kind === 'quote' ? 'sales.quotes.manage' : 'sales.orders.manage'
  const canManage = !chromeReady || hasFeature(chromePayload?.grantedFeatures, manageFeature)
  // Both quote→order actions write an order (convert converts the quote in place; the loader
  // creates a new one), so both need the order's manage feature on top of the quote's: hide them
  // from an operator who holds only one of the two.
  const canOrderFromQuote = kind === 'quote'
    && canManage
    && (!chromeReady || hasFeature(chromePayload?.grantedFeatures, 'sales.orders.manage'))

  const listHref = listHrefFor(kind)
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
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  /**
   * Converts the quote into an order through the engine's own route.
   *
   * The engine converts **in place**: the document keeps its id, its lines and its buyer snapshot
   * and comes back as an order with a new number, so the quote stops existing. That is why the
   * confirm dialog spells the irreversibility out, why the list is invalidated afterwards (the row
   * would otherwise still be listed as a quote), and why the redirect goes to this module's *order*
   * edit page for the returned id.
   */
  const handleConvertToOrder = React.useCallback(async (row: DocumentRecord) => {
    const confirmed = await confirm({
      title: t('internal_sales.list.actions.convertConfirmTitle'),
      description: t('internal_sales.list.actions.convertConfirmBody'),
      confirmText: t('internal_sales.list.actions.convert'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      const result = await readApiResultOrThrow<{ orderId?: string }>(
        '/api/sales/quotes/convert',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ quoteId: row.id }),
        },
        { errorMessage: t('internal_sales.list.actions.convertFailed') },
      )
      const orderId = typeof result?.orderId === 'string' && result.orderId ? result.orderId : row.id
      flash(t('internal_sales.list.actions.convertDone'), 'success')
      await queryClient.invalidateQueries({ queryKey })
      // The converted document is an order now, so it opens on this module's order edit page —
      // built from the shared helper rather than by hand, so a route move cannot drift here.
      router.push(documentEditHref('order', orderId))
    } catch (conversionError) {
      const message = conversionError instanceof Error && conversionError.message
        ? conversionError.message
        : t('internal_sales.list.actions.convertFailed')
      flash(message, 'error')
    }
  }, [confirm, queryClient, queryKey, router, t])
  // Statuses are the tenant's own dictionary, so the column resolves labels from it rather than
  // hard-coding the seeded values. An unreadable dictionary degrades to a dash / raw code.
  const { data: salesStatusEntries } = useQuery({
    queryKey: ['internal-sales-status-options', scopeVersion],
    queryFn: () => loadDictionaryEntriesByKey(SALES_STATUS_DICTIONARY_KEY),
    staleTime: 5 * 60 * 1000,
  })
  const statusMap = React.useMemo(
    () => (salesStatusEntries ? createDictionaryMap(salesStatusEntries) : null),
    [salesStatusEntries],
  )
  const columns = React.useMemo(() => buildColumns(t, locale, kind, statusMap), [kind, locale, statusMap, t])

  return (
    <>
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
          canManage ? (
            <Button asChild>
              <Link href={`${listHref}/create`}>
                {t(kind === 'quote' ? 'internal_sales.form.quote.createTitle' : 'internal_sales.form.order.createTitle')}
              </Link>
            </Button>
          ) : null
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
            {...(canManage
              ? {
                  createHref: `${listHref}/create`,
                  createLabel: t(kind === 'quote' ? 'internal_sales.form.quote.createTitle' : 'internal_sales.form.order.createTitle'),
                }
              : {})}
          />
      )}
      rowActions={(row) => (
        <RowActions
          items={[
            ...(canManage
              ? [{ id: 'edit', label: t('internal_sales.list.actions.edit'), href: `${listHref}/${row.id}/edit` }]
              : []),
            ...(canOrderFromQuote
              ? [
                  {
                    id: 'new-order-from-quote',
                    label: t('internal_sales.list.actions.newOrderFromQuote'),
                    href: `/backend/internal-sales/orders/create?fromQuote=${row.id}`,
                  },
                  {
                    id: 'convert-to-order',
                    label: t('internal_sales.list.actions.convert'),
                    onSelect: () => { void handleConvertToOrder(row) },
                  },
                ]
              : []),
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
      {ConfirmDialogElement}
    </>
  )
}
