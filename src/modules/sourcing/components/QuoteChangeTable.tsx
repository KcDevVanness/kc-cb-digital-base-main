"use client"

import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { MoneyAmount } from '@/lib/money/MoneyAmount'
import type { QuoteChangeKind, QuoteChangeRow } from '../types'

/**
 * The change table itself — the four decisions, the two prices and the difference.
 *
 * Shared by the quotation detail page ("compared with the previous version") and the changes tab of
 * the list page ("this version against its predecessor"), so the columns, the badge tones and the
 * "not comparable" wording can only ever say one thing. The timeline action is a callback rather
 * than a built-in dialog: the table stays a pure renderer of rows it is given.
 */

const KIND_TONE: Record<QuoteChangeKind, 'info' | 'warning' | 'error' | 'success' | 'neutral'> = {
  added: 'info',
  removed: 'warning',
  up: 'error',
  down: 'success',
  same: 'neutral',
  currency_mismatch: 'warning',
  no_price: 'neutral',
}

const KIND_KEYS: Record<QuoteChangeKind, string> = {
  added: 'sourcing.changes.kind.added',
  removed: 'sourcing.changes.kind.removed',
  up: 'sourcing.changes.kind.up',
  down: 'sourcing.changes.kind.down',
  same: 'sourcing.changes.kind.same',
  currency_mismatch: 'sourcing.changes.kind.currency_mismatch',
  no_price: 'sourcing.changes.kind.no_price',
}

export function buildChangeColumns(
  t: TranslateFn,
  options: { onOpenTimeline?: (row: QuoteChangeRow) => void } = {},
): ColumnDef<QuoteChangeRow>[] {
  const columns: ColumnDef<QuoteChangeRow>[] = [
    {
      accessorKey: 'kind',
      header: t('sourcing.changes.columns.kind', 'Change'),
      enableSorting: false,
      meta: { priority: 1 },
      cell: ({ row }) => (
        <Badge variant={KIND_TONE[row.original.kind]}>
          {t(KIND_KEYS[row.original.kind], row.original.kind)}
        </Badge>
      ),
    },
    {
      accessorKey: 'key',
      header: t('sourcing.changes.columns.item', 'Item'),
      enableSorting: false,
      meta: { priority: 2, truncate: true, maxWidth: 200 },
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.key ?? row.original.itemNo ?? '—'}</span>
      ),
    },
    {
      accessorKey: 'name',
      header: t('sourcing.changes.columns.name', 'Name'),
      enableSorting: false,
      meta: { priority: 3, truncate: true, maxWidth: 280 },
      cell: ({ row }) => <span className="text-sm">{row.original.name ?? '—'}</span>,
    },
    {
      id: 'basePrice',
      header: t('sourcing.changes.columns.basePrice', 'Previous'),
      enableSorting: false,
      meta: { priority: 4 },
      cell: ({ row }) =>
        row.original.baseUnitCost === null ? (
          <span className="text-xs text-muted-foreground">{t('sourcing.changes.noValue', '—')}</span>
        ) : (
          <MoneyAmount currencyCode={row.original.baseCurrencyCode ?? ''} amount={row.original.baseUnitCost} kind="price" />
        ),
    },
    {
      id: 'targetPrice',
      header: t('sourcing.changes.columns.targetPrice', 'This version'),
      enableSorting: false,
      meta: { priority: 5 },
      cell: ({ row }) =>
        row.original.targetUnitCost === null ? (
          <span className="text-xs text-muted-foreground">{t('sourcing.changes.noValue', '—')}</span>
        ) : (
          <MoneyAmount currencyCode={row.original.targetCurrencyCode ?? ''} amount={row.original.targetUnitCost} kind="price" />
        ),
    },
    {
      id: 'delta',
      header: t('sourcing.changes.columns.delta', 'Difference'),
      enableSorting: false,
      meta: { priority: 6 },
      cell: ({ row }) => {
        const { deltaAmount, deltaPercent, kind } = row.original
        if (deltaAmount === null) {
          return (
            <span className="text-xs text-muted-foreground">
              {kind === 'currency_mismatch'
                ? t('sourcing.changes.kind.currency_mismatch', 'Currency differs')
                : t('sourcing.changes.noValue', '—')}
            </span>
          )
        }
        if (kind === 'same') {
          return <span className="text-xs text-muted-foreground">0</span>
        }
        const percent =
          deltaPercent === null ? null : `${deltaPercent > 0 ? '+' : ''}${deltaPercent.toFixed(2)}%`
        return (
          <Badge variant={kind === 'up' ? 'error' : 'success'}>
            {deltaAmount}
            {percent ? ` (${percent})` : ''}
          </Badge>
        )
      },
    },
    {
      id: 'purchase',
      header: t('sourcing.changes.columns.purchase', 'Our cost'),
      enableSorting: false,
      meta: { priority: 7 },
      cell: ({ row }) =>
        row.original.purchase ? (
          <MoneyAmount currencyCode={row.original.purchase.currencyCode} amount={row.original.purchase.unitPrice} kind="price" />
        ) : (
          <span className="text-xs text-muted-foreground">
            {t('sourcing.changes.purchase.notCreated', 'No product record')}
          </span>
        ),
    },
  ]

  if (options.onOpenTimeline) {
    const onOpenTimeline = options.onOpenTimeline
    columns.push({
      id: 'timeline',
      header: t('sourcing.changes.columns.timeline', 'Price history'),
      enableSorting: false,
      meta: { priority: 8 },
      cell: ({ row }) => (
        // An inline control inside a table row must not let the click reach the row itself.
        <Button
          variant="secondary"
          size="sm"
          onClick={(event) => {
            event.stopPropagation()
            onOpenTimeline(row.original)
          }}
        >
          {t('sourcing.changes.actions.timeline', 'History')}
        </Button>
      ),
    })
  }

  return columns
}

export function QuoteChangeTable({
  rows,
  page,
  pageSize,
  totalCount,
  isLoading,
  emptyTitle,
  onPageChange,
  onOpenTimeline,
}: {
  rows: QuoteChangeRow[]
  page: number
  pageSize: number
  totalCount: number
  isLoading?: boolean
  emptyTitle: string
  onPageChange: (page: number) => void
  onOpenTimeline?: (row: QuoteChangeRow) => void
}) {
  const t = useT()
  const columns = React.useMemo(
    () => buildChangeColumns(t, onOpenTimeline ? { onOpenTimeline } : {}),
    [onOpenTimeline, t],
  )

  return (
    <DataTable<QuoteChangeRow>
      columns={columns}
      data={rows}
      emptyState={<ListEmptyState title={emptyTitle} />}
      pagination={{
        page,
        pageSize,
        total: totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
        onPageChange,
      }}
      isLoading={isLoading === true}
      error={null}
    />
  )
}

export default QuoteChangeTable
