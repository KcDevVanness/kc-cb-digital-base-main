"use client"

import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'

/**
 * 月损益 — the ОПИУ lines with the CN cost row beside them. Every row shows its caliber and source,
 * and the fact/forecast switch is the only thing that changes what is read: the two are never shown
 * as one column.
 */

type ProfitLossBasis = 'fact' | 'forecast'

type ProfitLossRow = {
  line: string
  label: string
  amount: string | null
  percent: string | null
  currency: string | null
  source: string
  caliber: ProfitLossBasis
  months: string[]
}

type ProfitLossResult = {
  periodStart: string
  periodEnd: string
  channel: string
  basis: ProfitLossBasis
  asOf: string | null
  rows: ProfitLossRow[]
  totalsByCurrency: Array<{ currencyCode: string; amount: string }>
  notes: string[]
}

const SOURCE_LABEL_KEYS: Record<string, string> = {
  ru_snapshot: 'finance.profitLoss.source.ruSnapshot',
  cn_landed: 'finance.profitLoss.source.cnLanded',
  cn_price_tier: 'finance.profitLoss.source.cnPriceTier',
  cn_missing: 'finance.profitLoss.source.cnMissing',
  not_connected: 'finance.profitLoss.source.notConnected',
}

function columns(t: TranslateFn): ColumnDef<ProfitLossRow>[] {
  return [
    {
      accessorKey: 'line',
      header: t('finance.profitLoss.columns.line'),
      meta: { priority: 1 },
      cell: ({ row }) => <span className="font-medium">{row.original.label}</span>,
    },
    {
      accessorKey: 'amount',
      header: t('finance.profitLoss.columns.amount'),
      enableSorting: false,
      meta: { priority: 2, align: 'right' },
      cell: ({ row }) => (
        <span className="tabular-nums">
          {row.original.amount === null ? '—' : `${row.original.amount} ${row.original.currency ?? ''}`.trim()}
        </span>
      ),
    },
    {
      accessorKey: 'percent',
      header: t('finance.profitLoss.columns.percent'),
      enableSorting: false,
      meta: { priority: 3, align: 'right' },
      cell: ({ row }) => (
        <span className="tabular-nums">{row.original.percent === null ? '—' : `${row.original.percent}%`}</span>
      ),
    },
    {
      accessorKey: 'caliber',
      header: t('finance.profitLoss.columns.caliber'),
      enableSorting: false,
      meta: { priority: 4 },
      cell: ({ row }) => (
        <span>
          {row.original.caliber === 'fact'
            ? t('finance.profitLoss.caliber.fact')
            : t('finance.profitLoss.caliber.forecast')}
        </span>
      ),
    },
    {
      accessorKey: 'source',
      header: t('finance.profitLoss.columns.source'),
      enableSorting: false,
      meta: { priority: 5 },
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{t(SOURCE_LABEL_KEYS[row.original.source] ?? row.original.source)}</span>,
    },
  ]
}

export default function ProfitLossView() {
  const t = useT()
  const today = new Date().toISOString().slice(0, 10)
  const monthStart = `${today.slice(0, 7)}-01`
  const [periodStart, setPeriodStart] = React.useState(monthStart)
  const [periodEnd, setPeriodEnd] = React.useState(today)
  const [basis, setBasis] = React.useState<ProfitLossBasis>('fact')
  const [channel, setChannel] = React.useState('total')
  const [data, setData] = React.useState<ProfitLossResult | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ periodStart, periodEnd, basis, channel })
      const call = await apiCall<ProfitLossResult>(`/api/finance/profit-loss?${params.toString()}`)
      if (!call.ok || !call.result) throw new Error(t('finance.profitLoss.loadFailed'))
      setData(call.result)
    } catch (loadError) {
      setError(loadError instanceof Error && loadError.message ? loadError.message : t('finance.profitLoss.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [basis, channel, periodEnd, periodStart, t])

  React.useEffect(() => {
    void load()
  }, [load])

  const columnDefs = React.useMemo(() => columns(t), [t])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-base font-semibold leading-tight">{t('finance.profitLoss.page.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('finance.profitLoss.page.description')}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex w-40 flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t('finance.profitLoss.filter.periodStart')}</span>
          <Input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} />
        </div>
        <div className="flex w-40 flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t('finance.profitLoss.filter.periodEnd')}</span>
          <Input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
        </div>
        <div className="flex w-40 flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t('finance.profitLoss.filter.basis')}</span>
          <Select value={basis} onValueChange={(next) => setBasis(next as ProfitLossBasis)}>
            <SelectTrigger aria-label={t('finance.profitLoss.filter.basis')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fact">{t('finance.profitLoss.caliber.fact')}</SelectItem>
              <SelectItem value="forecast">{t('finance.profitLoss.caliber.forecast')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex w-40 flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t('finance.profitLoss.filter.channel')}</span>
          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger aria-label={t('finance.profitLoss.filter.channel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="total">{t('finance.profitLoss.channel.total')}</SelectItem>
              <SelectItem value="ozon">Ozon</SelectItem>
              <SelectItem value="yandex_market">Yandex Market</SelectItem>
              <SelectItem value="kit">Site (Kit)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          {t('finance.profitLoss.refresh')}
        </Button>
      </div>

      {error ? <ErrorMessage label={error} /> : null}
      {loading ? <LoadingMessage label={t('finance.profitLoss.loading')} /> : null}

      {!loading && !error && data ? (
        <>
          {data.notes.map((note) => (
            <Alert key={note} variant="info">
              {note}
            </Alert>
          ))}
          <div className="flex flex-wrap gap-3 text-sm">
            {data.totalsByCurrency.map((total) => (
              <span key={total.currencyCode} className="rounded-md border bg-card px-3 py-1.5">
                {total.currencyCode}: <span className="tabular-nums font-medium">{total.amount}</span>
              </span>
            ))}
            {data.asOf ? (
              <span className="rounded-md border bg-card px-3 py-1.5">
                {t('finance.profitLoss.asOf')}: <span className="font-medium">{data.asOf}</span>
              </span>
            ) : null}
          </div>

          <DataTable<ProfitLossRow>
            title={t('finance.profitLoss.section.rows')}
            columns={columnDefs}
            data={data.rows}
            entityId="finance:finance_expense"
            extensionTableId="finance.profit-loss.rows"
            embedded
          />
        </>
      ) : null}
    </div>
  )
}
