"use client"

import * as React from 'react'
import { KpiCard } from '@open-mercato/ui/backend/charts'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

/**
 * One cockpit figure as a dashboard widget. All four widgets read the same summary endpoint the
 * cockpit page reads, so a widget can never disagree with the page it mirrors — and the figure keeps
 * the snapshot date it came from, which is the difference between a KPI and a decoration.
 *
 * The figure is the card's **value**, never its footer: a card whose value is `null` renders a bare
 * `--` and drops the footer, which would hide exactly the number the widget exists to show.
 */

export type CockpitMetric = 'supply-gap' | 'in-transit' | 'overstock' | 'drr'

type MoneyValue = { currencyCode: string; amount: string }
type Group<T> = { asOf: string | null; dataMissing: boolean; values: T }

type Summary = {
  stale: boolean
  staleAfterHours: number
  supply: {
    gap: Group<MoneyValue[]>
    inTransitAmount: Group<MoneyValue[]>
    inTransitQuantity: Group<string | null>
    overstock: Group<MoneyValue[]>
  }
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
}

function moneyText(values: MoneyValue[] | undefined): string {
  if (!values || values.length === 0) return '—'
  return values
    .map(
      (value) =>
        `${Number(value.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${value.currencyCode}`,
    )
    .join(' · ')
}

/** The headline is the first currency group; the footer names every group, never a summed total. */
function moneyHeadline(values: MoneyValue[] | undefined): { value: number | null; suffix: string | undefined } {
  const first = values?.[0]
  if (!first) return { value: null, suffix: undefined }
  const amount = Number.parseFloat(first.amount)
  return Number.isFinite(amount) ? { value: amount, suffix: first.currencyCode } : { value: null, suffix: undefined }
}

export default function CockpitKpiWidget({ metric, refreshToken }: { metric: CockpitMetric; refreshToken?: number }) {
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
  }, [refreshToken, t])

  // ДРР is reported in both calibers with the target line — the same three numbers the page shows,
  // because "ad spend over sales" has more than one honest answer and the reader has to see which.
  if (metric === 'drr') {
    const drr = data?.drr
    return (
      <KpiCard
        title={t('boss_cockpit.kpi.drr')}
        value={drr?.values.accruedPercent ?? null}
        suffix="%"
        loading={loading}
        error={error}
        footer={
          <>
            <span>
              {t('boss_cockpit.drr.live')}:{' '}
              {drr?.values.livePercent === null || drr?.values.livePercent === undefined
                ? '—'
                : `${drr.values.livePercent}%`}
            </span>
            <span className="ml-2 text-muted-foreground">
              {t('boss_cockpit.drr.target', { target: String(drr?.values.targetPercent ?? '') })}
            </span>
            {data?.stale ? <span className="ml-2 text-status-warning-text">{t('boss_cockpit.widget.stale')}</span> : null}
            {drr?.asOf ? <span className="ml-2 text-muted-foreground">{drr.asOf}</span> : null}
          </>
        }
      />
    )
  }

  const group =
    metric === 'supply-gap'
      ? data?.supply.gap
      : metric === 'overstock'
        ? data?.supply.overstock
        : data?.supply.inTransitAmount

  const headline = moneyHeadline(group?.values)
  const footer =
    metric === 'in-transit'
      ? `${moneyText(data?.supply.inTransitAmount.values)} · ${data?.supply.inTransitQuantity.values ?? '—'}`
      : moneyText(group?.values)

  return (
    <KpiCard
      title={
        metric === 'supply-gap'
          ? t('boss_cockpit.kpi.gap')
          : metric === 'overstock'
            ? t('boss_cockpit.kpi.overstock')
            : t('boss_cockpit.kpi.inTransit')
      }
      {...headline}
      loading={loading}
      error={error}
      footer={
        <>
          <span>{group?.dataMissing ? t('boss_cockpit.widget.noData') : footer}</span>
          {data?.stale ? <span className="ml-2 text-status-warning-text">{t('boss_cockpit.widget.stale')}</span> : null}
          {group?.asOf ? <span className="ml-2 text-muted-foreground">{group.asOf}</span> : null}
        </>
      }
    />
  )
}
