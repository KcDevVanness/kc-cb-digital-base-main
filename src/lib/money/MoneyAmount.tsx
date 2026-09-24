"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { formatCurrency } from '@open-mercato/ui/utils/format'
import { formatCnyEquivalent, formatRateLine } from './format'
import { useCnyRates } from './useCnyRates'

/**
 * A money amount with its CNY equivalent underneath.
 *
 * The native amount is what the record says and stays exactly as it rendered before this component
 * existed; the `≈ ¥…` line is additive and appears only when the caller's organization actually has a
 * stored rate for that currency (REQ-CNY-003 — no rate, no line, never an invented figure). A CNY amount
 * never gets a second line.
 *
 * `showRate` prints the pair, the rate and its date beside the converted figure. Dense table cells keep
 * it off and carry it in the `title` instead; roomier surfaces (a form's price rows) turn it on, because
 * that is where a reader questions a number and needs the arithmetic in front of them.
 */
export function MoneyAmount({
  currencyCode,
  amount,
  className,
  amountClassName,
  showRate = false,
  suffix,
}: {
  currencyCode: string
  amount: string | number
  className?: string
  amountClassName?: string
  showRate?: boolean
  /** Appended to the native amount, e.g. a price ladder step (`(≥10)`). */
  suffix?: string
}) {
  const t = useT()
  const { rates } = useCnyRates()
  const code = currencyCode.trim().toUpperCase()
  const native = formatCurrency(amount, code) ?? String(amount)
  const entry = rates[code]

  if (!entry) {
    return (
      <span className={cn('tabular-nums', amountClassName, className)}>
        {native}
        {suffix ? ` ${suffix}` : ''}
      </span>
    )
  }

  const rateLine = formatRateLine(code, entry.rate, entry.date)
  return (
    <span className={cn('flex flex-col', className)}>
      <span className={cn('tabular-nums', amountClassName)}>
        {native}
        {suffix ? ` ${suffix}` : ''}
      </span>
      <span className="text-xs text-muted-foreground tabular-nums" title={rateLine}>
        {t('money.cnyEquivalent', '≈ {amount}', { amount: formatCnyEquivalent(amount, entry.rate) })}
        {showRate ? <span className="ml-1">· {rateLine}</span> : null}
      </span>
    </span>
  )
}
