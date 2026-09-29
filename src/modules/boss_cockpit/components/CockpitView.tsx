"use client"

import * as React from 'react'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Alert } from '@open-mercato/ui/primitives/alert'
import Link from 'next/link'
import { KpiCard } from '@open-mercato/ui/backend/charts'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

/**
 * 老板驾驶舱 — the read-only page. Every figure shows the snapshot date it came from and the source
 * it was read from, because a number without those two is a number nobody can argue with.
 *
 * The page never hides a figure because it is old: it marks the whole page stale and keeps the
 * numbers, which is the honest version of "do not decide on these".
 */

type MoneyValue = { currencyCode: string; amount: string }

type Group<T> = { asOf: string | null; dataMissing: boolean; values: T }

type Summary = {
  asOf: string | null
  stale: boolean
  staleAfterHours: number
  supply: {
    gap: Group<MoneyValue[]>
    inTransitAmount: Group<MoneyValue[]>
    inTransitQuantity: Group<string | null>
    overstock: Group<MoneyValue[]>
    unrecognizedInbound: Group<{ rows: number; quantity: string }>
    planSkus: Group<number>
  }
  cash: {
    payablesOutstanding: MoneyValue[]
    receivablesOutstanding: MoneyValue[]
    inventoryValue: string
    inventoryValueAsOf: string
    inventoryUnpriced: string
  } | null
  sku: { mapped: number; unmapped: number; ignored: number; total: number; coveragePercent: number | null }
  drr: {
    asOf: string | null
    dataMissing: boolean
    values: {
      accruedPercent: number | null
      livePercent: number | null
      targetPercent: number
      periodStart: string | null
      periodEnd: string | null
    }
  }
  weekly: {
    asOf: string | null
    dataMissing: boolean
    values: {
      periodStart: string | null
      periodEnd: string | null
      sales: MoneyValue[]
      quantity: string
      adSpend: MoneyValue[]
      marginPercent: number | null
    }
  }
  profitLoss: { status: 'connected'; href: string; note: string }
  sources: Array<{ key: string; label: string; asOf: string | null; status: string }>
}

const SOURCE_STATUS_VARIANTS: StatusMap<string> = {
  ok: 'success',
  stale: 'warning',
  failing: 'error',
  never: 'neutral',
}

function moneyText(values: MoneyValue[] | undefined): string {
  if (!values || values.length === 0) return '—'
  return values.map((value) => `${Number(value.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${value.currencyCode}`).join(' · ')
}

/**
 * A money KPI's headline is its **first** currency group and the footer names every group, because
 * the page never adds two currencies together: showing one number here would be a fabricated total.
 */
function moneyHeadline(values: MoneyValue[] | undefined): { value: number | null; suffix: string | undefined } {
  const first = values?.[0]
  if (!first) return { value: null, suffix: undefined }
  const amount = Number.parseFloat(first.amount)
  return Number.isFinite(amount) ? { value: amount, suffix: first.currencyCode } : { value: null, suffix: undefined }
}

function toNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

export default function CockpitView() {
  const t = useT()
  const [data, setData] = React.useState<Summary | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const call = await apiCall<Summary>('/api/boss_cockpit/summary')
        if (!call.ok || !call.result) throw new Error(t('boss_cockpit.loadFailed'))
        if (!cancelled) setData(call.result)
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error && loadError.message ? loadError.message : t('boss_cockpit.loadFailed'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [t])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-base font-semibold leading-tight">{t('boss_cockpit.page.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('boss_cockpit.page.description')}</p>
      </div>

      {error ? <ErrorMessage label={error} /> : null}
      {loading ? <LoadingMessage label={t('boss_cockpit.loading')} /> : null}

      {!loading && !error && data ? (
        <>
          {data.stale ? (
            <Alert variant="destructive">
              {t('boss_cockpit.alert.stale', { hours: String(data.staleAfterHours) })}
            </Alert>
          ) : null}

          {data.supply.unrecognizedInbound.values.rows > 0 ? (
            <Alert variant="warning">
              {t('boss_cockpit.alert.unrecognized', {
                rows: String(data.supply.unrecognizedInbound.values.rows),
                qty: data.supply.unrecognizedInbound.values.quantity,
              })}
            </Alert>
          ) : null}

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">{t('boss_cockpit.section.supply')}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                title={t('boss_cockpit.kpi.gap')}
                {...moneyHeadline(data.supply.gap.values)}
                prefix=""
                footer={moneyText(data.supply.gap.values)}
                headerAction={data.supply.gap.dataMissing ? undefined : <span className="text-xs text-muted-foreground">{data.supply.gap.asOf}</span>}
              />
              <KpiCard
                title={t('boss_cockpit.kpi.inTransit')}
                value={toNumber(data.supply.inTransitQuantity.values)}
                footer={moneyText(data.supply.inTransitAmount.values)}
                headerAction={data.supply.inTransitAmount.dataMissing ? undefined : <span className="text-xs text-muted-foreground">{data.supply.inTransitAmount.asOf}</span>}
              />
              <KpiCard
                title={t('boss_cockpit.kpi.overstock')}
                {...moneyHeadline(data.supply.overstock.values)}
                footer={moneyText(data.supply.overstock.values)}
                headerAction={data.supply.overstock.dataMissing ? undefined : <span className="text-xs text-muted-foreground">{data.supply.overstock.asOf}</span>}
              />
              <KpiCard
                title={t('boss_cockpit.kpi.drr')}
                value={data.drr.values.accruedPercent}
                suffix="%"
                footer={
                  <>
                    <span>
                      {t('boss_cockpit.drr.live')}:{' '}
                      {data.drr.values.livePercent === null ? '—' : `${data.drr.values.livePercent}%`}
                    </span>
                    <span className="ml-2 text-muted-foreground">
                      {t('boss_cockpit.drr.target', { target: String(data.drr.values.targetPercent) })}
                    </span>
                  </>
                }
                headerAction={
                  data.drr.dataMissing ? undefined : <span className="text-xs text-muted-foreground">{data.drr.asOf}</span>
                }
              />
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">{t('boss_cockpit.section.weekly')}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <KpiCard
                title={t('boss_cockpit.weekly.sales')}
                {...moneyHeadline(data.weekly.values.sales)}
                footer={`${moneyText(data.weekly.values.sales)} · ${data.weekly.values.quantity}`}
                headerAction={
                  data.weekly.dataMissing ? undefined : (
                    <span className="text-xs text-muted-foreground">
                      {data.weekly.values.periodStart ?? '—'}~{data.weekly.values.periodEnd ?? '—'}
                    </span>
                  )
                }
              />
              <KpiCard
                title={t('boss_cockpit.weekly.margin')}
                value={data.weekly.values.marginPercent}
                suffix="%"
                footer={t('boss_cockpit.weekly.marginNote')}
              />
              <KpiCard
                title={t('boss_cockpit.weekly.adSpend')}
                {...moneyHeadline(data.weekly.values.adSpend)}
                footer={moneyText(data.weekly.values.adSpend)}
              />
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">{t('boss_cockpit.section.cash')}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <KpiCard
                title={t('boss_cockpit.kpi.payables')}
                {...moneyHeadline(data.cash?.payablesOutstanding)}
                footer={moneyText(data.cash?.payablesOutstanding)}
              />
              <KpiCard
                title={t('boss_cockpit.kpi.receivables')}
                {...moneyHeadline(data.cash?.receivablesOutstanding)}
                footer={moneyText(data.cash?.receivablesOutstanding)}
              />
              <KpiCard
                title={t('boss_cockpit.kpi.inventory')}
                value={toNumber(data.cash?.inventoryValue)}
                footer={t('boss_cockpit.kpi.inventoryFooter', {
                  asOf: data.cash?.inventoryValueAsOf ?? '—',
                  unpriced: data.cash?.inventoryUnpriced ?? '0.0000',
                })}
              />
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">{t('boss_cockpit.section.data')}</h2>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="rounded-md border bg-card px-3 py-1.5">
                {t('boss_cockpit.sku.coverage', {
                  mapped: String(data.sku.mapped),
                  total: String(data.sku.total),
                  percent: data.sku.coveragePercent === null ? '—' : String(data.sku.coveragePercent),
                })}
              </span>
              {data.sku.unmapped > 0 ? (
                <span className="rounded-md border bg-card px-3 py-1.5">
                  {t('boss_cockpit.sku.unmapped', { count: String(data.sku.unmapped) })}
                </span>
              ) : null}
              <span className="rounded-md border bg-card px-3 py-1.5">
                {t('boss_cockpit.planSkus', { count: String(data.supply.planSkus.values) })}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {data.sources.map((source) => (
                <span key={source.key} className="flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-xs">
                  <StatusBadge variant={SOURCE_STATUS_VARIANTS[source.status] ?? 'neutral'} dot>
                    {source.status}
                  </StatusBadge>
                  <span className="text-muted-foreground">{source.label}</span>
                  <span className="tabular-nums">{source.asOf ?? '—'}</span>
                </span>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {data.profitLoss.note}{' '}
              <Link href={data.profitLoss.href} className="underline">
                {t('boss_cockpit.profitLoss.open')}
              </Link>
            </p>
          </section>
        </>
      ) : null}
    </div>
  )
}
