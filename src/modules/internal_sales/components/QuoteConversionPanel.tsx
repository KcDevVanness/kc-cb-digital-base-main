"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ratePercent, type QuoteConversionReport } from '../lib/quoteConversion'

/**
 * 报价转化 — how many quotes of a period became orders.
 *
 * The panel prints the counts and **both** rates (over every quote, over the sent ones) and says why
 * they differ: the choice of denominator is a management statement, so the screen does not make it.
 * 「已发出」 comes from the sent timestamp, not a status word, so quotes written before Phase 1 are not
 * silently dropped from the stricter rate.
 */
const PERIOD_OPTIONS = [30, 90, 365] as const

const QUOTES_API = '/api/internal_sales/quote-conversion'

function formatDay(value: string | null): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toISOString().slice(0, 10)
}

export default function QuoteConversionPanel() {
  const t = useT()
  const [days, setDays] = React.useState<number>(90)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['internal_sales', 'quote-conversion', days],
    queryFn: async () => {
      const response = await apiCall<QuoteConversionReport & { period: { days: number; from: string } }>(
        `${QUOTES_API}?days=${days}`,
        { method: 'GET' },
      )
      if (!response.ok || !response.result) throw new Error('conversion-report-failed')
      return response.result
    },
  })

  const summary = data?.summary
  const rate = (value: number | null | undefined): string => {
    const percent = ratePercent(value ?? null)
    return percent === null ? '—' : `${percent}%`
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">{t('internal_sales.conversion.page.title', '报价转化')}</h1>
          <p className="text-sm text-muted-foreground">
            {t(
              'internal_sales.conversion.page.description',
              '统计期内创建的报价里，有多少已经变成订单。「已发出」按发送时间判断（不是状态词），历史数据不会被悄悄排除。',
            )}
          </p>
        </div>
        <div className="flex items-center gap-1" role="group" aria-label={t('internal_sales.conversion.period.label', '统计区间')}>
          {PERIOD_OPTIONS.map((option) => (
            <Button
              key={option}
              type="button"
              variant={option === days ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDays(option)}
            >
              {t('internal_sales.conversion.period.days', '{days} 天', { days: option })}
            </Button>
          ))}
        </div>
      </header>

      {isError ? (
        <Alert status="error">{t('internal_sales.conversion.loadFailed', '载入失败，请稍后重试。')}</Alert>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t('ui.common.loading', '载入中…')}
        </p>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-4">
            <Fact label={t('internal_sales.conversion.fact.quotes', '报价数')} value={summary?.quotes ?? 0} />
            <Fact label={t('internal_sales.conversion.fact.sent', '已发出')} value={summary?.sent ?? 0} />
            <Fact label={t('internal_sales.conversion.fact.converted', '已转化')} value={summary?.converted ?? 0} />
            <Fact
              label={t('internal_sales.conversion.fact.rates', '转化率（全部 / 已发出）')}
              value={`${rate(summary?.rateOverQuotes)} / ${rate(summary?.rateOverSent)}`}
            />
          </section>
          <p className="text-xs text-muted-foreground">
            {t(
              'internal_sales.conversion.rates.note',
              '两个分母口径不同，所以给出两个比率：全部报价 = 报价→订单的整体产出；已发出报价 = 发出之后拿下多少。哪个作为考核口径由业务决定。',
            )}
          </p>

          {(data?.ordersWithoutQuoteInPeriod ?? 0) > 0 ? (
            <p className="text-xs text-muted-foreground">
              {t(
                'internal_sales.conversion.outsidePeriod',
                '另有 {count} 张订单的报价不在本区间内，未计入转化。',
                { count: data?.ordersWithoutQuoteInPeriod ?? 0 },
              )}
            </p>
          ) : null}

          {(data?.quotes.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              {t('internal_sales.conversion.empty', '本区间没有报价。')}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
              {(data?.quotes ?? []).map((quote) => (
                <li key={quote.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
                  <Link
                    className="font-medium underline-offset-2 hover:underline"
                    href={`/backend/internal-sales/quotes/${quote.id}/edit`}
                  >
                    {quote.number ?? quote.id}
                  </Link>
                  <span className="text-sm text-muted-foreground">
                    {t(`sales.quote.status.${quote.status ?? 'unknown'}`, quote.status ?? '—')}
                  </span>
                  <span className="text-sm text-muted-foreground">{formatDay(quote.sentAt)}</span>
                  <span className="ml-auto text-sm">
                    {quote.converted
                      ? t('internal_sales.conversion.row.converted', '已转化 {count} 单', { count: quote.orderCount })
                      : t('internal_sales.conversion.row.open', '未转化')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  )
}
