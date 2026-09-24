"use client"

import type { InjectionColumnWidget } from '@open-mercato/shared/modules/widgets/injection'
import { formatCurrency } from '@open-mercato/ui/utils/format'
import { formatRateLine } from '@/lib/money/format'
import type { CnyEquivalentValue } from '../../../data/enrichers'

/**
 * The CNY column on the installed sales-orders table.
 *
 * A headless column declaration, not a mounted component: the installed table exposes
 * `data-table:sales.orders:columns` as a column-widget host, and an injected column's cell receives only
 * `getValue()` — no row. That is why the conversion is computed server-side by
 * `data/enrichers.ts` and read here through the enriched path `_currency_policy.cnyEquivalent`
 * (`.ai/guides/extensions.md` → Response Enrichers + Widget Injection).
 *
 * The cell renders the converted amount with the shared framework formatter and prints the rate line
 * underneath, so a reader can audit the figure without leaving the list. A row whose currency has no
 * stored rate carries `null` and the column stays empty rather than inventing a number.
 */
const widget: InjectionColumnWidget = {
  metadata: {
    id: 'currency_policy.injection.sales-order-cny',
    requiredModules: ['sales'],
    priority: 60,
  },
  columns: [
    {
      id: 'currency_policy_sales_order_cny',
      // The DataTable host renders `t(definition.header, definition.header)`, so `header` must be the
      // translation key itself; the key lives in this module's i18n catalogs (zh 折合人民币 / en In CNY).
      headerKey: 'currency_policy.sales.orders.cnyColumn',
      header: 'currency_policy.sales.orders.cnyColumn',
      accessorKey: '_currency_policy.cnyEquivalent',
      sortable: false,
      size: 160,
      cell: ({ getValue }) => {
        const value = getValue() as CnyEquivalentValue | null | undefined
        if (!value || typeof value.amount !== 'string' || value.amount.length === 0) return null
        return (
          <span className="flex flex-col">
            <span className="tabular-nums">{formatCurrency(value.amount, 'CNY') ?? value.amount}</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatRateLine(value.currencyCode, value.rate, value.date)}
            </span>
          </span>
        )
      },
    },
  ],
}

export default widget
