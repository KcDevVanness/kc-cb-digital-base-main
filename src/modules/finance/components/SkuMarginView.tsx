"use client"

import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'

/**
 * SKU 毛利 — the RU snapshot row beside the CN landed cost. The two currencies are shown side by
 * side; a mixed margin appears only when a rate exists, and rows outside the tolerance are listed as
 * reconciliation candidates instead of being quietly adjusted.
 */

type SkuMarginRow = {
  sku: string
  quantity: string
  revenue: string | null
  currency: string
  platformCosts: string | null
  adSpend: string | null
  ruMarginPercent: string | null
  ruMarginAmount: string | null
  cnLandedUnitCostCny: string | null
  cnCostCny: string | null
  cnSource: 'landed' | 'price_tier' | 'missing'
  cnMarginAmount: string | null
  cnMarginPercent: string | null
  rateRuPerCny: string | null
  rateMissing: boolean
  discrepancy: { percentPoints: string | null; amount: string | null } | null
  outsideTolerance: boolean
}

type SkuMarginResult = {
  periodStart: string
  periodEnd: string
  asOf: string | null
  rows: SkuMarginRow[]
  reconciliation: Array<{ sku: string; reason: string }>
  notes: string[]
}

function columns(t: TranslateFn): ColumnDef<SkuMarginRow>[] {
  return [
    {
      accessorKey: 'sku',
      header: t('finance.skuMargin.columns.sku'),
      meta: { priority: 1 },
      cell: ({ row }) => (
        <span className="flex items-center gap-2 font-medium">
          {row.original.sku}
          {row.original.outsideTolerance ? <StatusBadge variant="warning" dot>{t('finance.skuMargin.flag')}</StatusBadge> : null}
        </span>
      ),
    },
    {
      accessorKey: 'quantity',
      header: t('finance.skuMargin.columns.quantity'),
      meta: { priority: 2, align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.quantity}</span>,
    },
    {
      accessorKey: 'revenue',
      header: t('finance.skuMargin.columns.revenue'),
      enableSorting: false,
      meta: { priority: 3, align: 'right' },
      cell: ({ row }) => (
        <span className="tabular-nums">
          {row.original.revenue === null ? '—' : `${row.original.revenue} ${row.original.currency}`}
        </span>
      ),
    },
    {
      accessorKey: 'ruMarginPercent',
      header: t('finance.skuMargin.columns.ruMargin'),
      enableSorting: false,
      meta: { priority: 4, align: 'right' },
      cell: ({ row }) => (
        <span className="tabular-nums">
          {row.original.ruMarginPercent === null ? '—' : `${row.original.ruMarginPercent}%`}
        </span>
      ),
    },
    {
      accessorKey: 'cnLandedUnitCostCny',
      header: t('finance.skuMargin.columns.cnLanded'),
      enableSorting: false,
      meta: { priority: 5, align: 'right' },
      cell: ({ row }) => (
        <span className="tabular-nums">
          {row.original.cnLandedUnitCostCny === null ? '—' : `${row.original.cnLandedUnitCostCny} CNY`}
        </span>
      ),
    },
    {
      accessorKey: 'cnSource',
      header: t('finance.skuMargin.columns.cnSource'),
      enableSorting: false,
      meta: { priority: 6 },
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {t(`finance.skuMargin.cnSource.${row.original.cnSource}`)}
        </span>
      ),
    },
    {
      accessorKey: 'discrepancy',
      header: t('finance.skuMargin.columns.discrepancy'),
      enableSorting: false,
      meta: { priority: 7 },
      cell: ({ row }) =>
        row.original.discrepancy === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="tabular-nums">
            {row.original.discrepancy.percentPoints ?? '—'} п.п.
            {row.original.discrepancy.amount ? ` / ${row.original.discrepancy.amount}` : ''}
          </span>
        ),
    },
  ]
}

export default function SkuMarginView() {
  const t = useT()
  const today = new Date().toISOString().slice(0, 10)
  const [periodStart, setPeriodStart] = React.useState(`${today.slice(0, 7)}-01`)
  const [periodEnd, setPeriodEnd] = React.useState(today)
  const [data, setData] = React.useState<SkuMarginResult | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ periodStart, periodEnd })
        const call = await apiCall<SkuMarginResult>(`/api/finance/sku-margin?${params.toString()}`)
        if (!call.ok || !call.result) throw new Error(t('finance.skuMargin.loadFailed'))
        if (!cancelled) setData(call.result)
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error && loadError.message ? loadError.message : t('finance.skuMargin.loadFailed'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [periodEnd, periodStart, t])

  const columnDefs = React.useMemo(() => columns(t), [t])
  const reconciliation = data?.reconciliation ?? []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-base font-semibold leading-tight">{t('finance.skuMargin.page.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('finance.skuMargin.page.description')}</p>
      </div>

      {error ? <ErrorMessage label={error} /> : null}
      {loading ? <LoadingMessage label={t('finance.skuMargin.loading')} /> : null}

      {!loading && !error && data ? (
        <>
          {data.notes.map((note) => (
            <Alert key={note} variant="warning">
              {note}
            </Alert>
          ))}
          {reconciliation.length > 0 ? (
            <Alert variant="destructive">
              {t('finance.skuMargin.alert.discrepancies', { count: String(reconciliation.length) })}:{' '}
              {reconciliation.map((entry) => `${entry.sku} (${entry.reason})`).join('; ')}
            </Alert>
          ) : null}

          <DataTable<SkuMarginRow>
            title={t('finance.skuMargin.section.rows')}
            columns={columnDefs}
            data={data.rows}
            entityId="finance:finance_expense"
            extensionTableId="finance.sku-margin.rows"
            embedded
          />
        </>
      ) : null}
    </div>
  )
}
