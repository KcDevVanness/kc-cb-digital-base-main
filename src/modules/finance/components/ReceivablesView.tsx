"use client"

import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'

/**
 * 应收台账 — the three sources (出口收汇 / 平台结算 / 对内销售) in one row shape. Receipt is judged
 * by the receipt date, and the totals stay per currency: three currencies are not one number.
 */

type ReceivableKind = 'export_collection' | 'platform_settlement' | 'internal_sales'

type ReceivableRow = {
  kind: ReceivableKind
  reference: string
  counterpartyName: string | null
  currencyCode: string
  amount: string | null
  receivedAmount: string
  outstandingAmount: string | null
  occurredAt: string | null
  status: string
}

type ReceivableCurrencyTotal = {
  currencyCode: string
  receivedAmount: string
  outstandingAmount: string | null
  rowCount: number
}

type ReceivablesResult = { rows: ReceivableRow[]; totalsByCurrency: ReceivableCurrencyTotal[] }

const KIND_LABEL_KEYS: Record<ReceivableKind, string> = {
  export_collection: 'finance.receivables.kind.exportCollection',
  platform_settlement: 'finance.receivables.kind.platformSettlement',
  internal_sales: 'finance.receivables.kind.internalSales',
}

const ALL_KINDS = 'all' as const

function columns(t: TranslateFn): ColumnDef<ReceivableRow>[] {
  return [
    {
      accessorKey: 'kind',
      header: t('finance.receivables.columns.kind'),
      meta: { priority: 1 },
      cell: ({ row }) => <span>{t(KIND_LABEL_KEYS[row.original.kind])}</span>,
    },
    {
      accessorKey: 'reference',
      header: t('finance.receivables.columns.reference'),
      enableSorting: false,
      meta: { priority: 2 },
      cell: ({ row }) => <span className="font-medium">{row.original.reference}</span>,
    },
    {
      accessorKey: 'counterpartyName',
      header: t('finance.receivables.columns.counterparty'),
      enableSorting: false,
      meta: { priority: 7, truncate: true, maxWidth: 200 },
      cell: ({ row }) => <span>{row.original.counterpartyName ?? '—'}</span>,
    },
    {
      accessorKey: 'currencyCode',
      header: t('finance.receivables.columns.currency'),
      enableSorting: false,
      meta: { priority: 6 },
    },
    {
      accessorKey: 'amount',
      header: t('finance.receivables.columns.amount'),
      enableSorting: false,
      meta: { priority: 3, align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.amount ?? '—'}</span>,
    },
    {
      accessorKey: 'receivedAmount',
      header: t('finance.receivables.columns.received'),
      enableSorting: false,
      meta: { priority: 4, align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.receivedAmount}</span>,
    },
    {
      accessorKey: 'outstandingAmount',
      header: t('finance.receivables.columns.outstanding'),
      enableSorting: false,
      meta: { priority: 5, align: 'right' },
      cell: ({ row }) => <span className="tabular-nums font-medium">{row.original.outstandingAmount ?? '—'}</span>,
    },
    {
      accessorKey: 'occurredAt',
      header: t('finance.receivables.columns.occurredAt'),
      enableSorting: false,
      meta: { priority: 8 },
      cell: ({ row }) => <span className="tabular-nums">{row.original.occurredAt ?? '—'}</span>,
    },
  ]
}

export default function ReceivablesView() {
  const t = useT()
  const [kind, setKind] = React.useState<ReceivableKind | typeof ALL_KINDS>(ALL_KINDS)
  const [data, setData] = React.useState<ReceivablesResult | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const params = kind === ALL_KINDS ? '' : `?kind=${kind}`
        const payload = await readApiResultOrThrow<ReceivablesResult>(`/api/finance/receivables${params}`, undefined, {
          errorMessage: t('finance.receivables.loadFailed'),
        })
        if (!cancelled) setData(payload)
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error && loadError.message ? loadError.message : t('finance.receivables.loadFailed'),
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [kind, t])

  const columnDefs = React.useMemo(() => columns(t), [t])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-base font-semibold leading-tight">{t('finance.receivables.page.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('finance.receivables.page.description')}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex w-64 flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t('finance.receivables.filter.kind')}</span>
          <Select value={kind} onValueChange={(next) => setKind(next as ReceivableKind | typeof ALL_KINDS)}>
            <SelectTrigger aria-label={t('finance.receivables.filter.kind')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_KINDS}>{t('finance.receivables.filter.all')}</SelectItem>
              <SelectItem value="export_collection">{t(KIND_LABEL_KEYS.export_collection)}</SelectItem>
              <SelectItem value="platform_settlement">{t(KIND_LABEL_KEYS.platform_settlement)}</SelectItem>
              <SelectItem value="internal_sales">{t(KIND_LABEL_KEYS.internal_sales)}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {error ? <ErrorMessage label={error} /> : null}
      {loading ? <LoadingMessage label={t('finance.receivables.loading')} /> : null}

      {!loading && !error && data ? (
        <>
          {(data.totalsByCurrency?.length ?? 0) > 1 ? (
            <Alert variant="warning">{t('finance.receivables.alert.multiCurrency')}</Alert>
          ) : null}

          {data.totalsByCurrency.map((total) => (
            <div key={total.currencyCode} className="flex flex-wrap gap-3 text-sm">
              <span className="rounded-md border bg-card px-3 py-1.5">
                {t('finance.receivables.totals.currency')}: <span className="font-medium">{total.currencyCode}</span>
              </span>
              <span className="rounded-md border bg-card px-3 py-1.5">
                {t('finance.receivables.totals.received')}:{' '}
                <span className="tabular-nums font-medium">{total.receivedAmount}</span>
              </span>
              <span className="rounded-md border bg-card px-3 py-1.5">
                {t('finance.receivables.totals.outstanding')}:{' '}
                <span className="tabular-nums font-medium">{total.outstandingAmount ?? '—'}</span>
              </span>
            </div>
          ))}

          <DataTable<ReceivableRow>
            title={t('finance.receivables.section.rows')}
            columns={columnDefs}
            data={data.rows}
            entityId="finance:finance_shipment_cost"
            extensionTableId="finance.receivables.rows"
            embedded
          />
        </>
      ) : null}
    </div>
  )
}
