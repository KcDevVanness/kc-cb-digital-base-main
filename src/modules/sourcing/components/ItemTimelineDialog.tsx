"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Badge } from '@open-mercato/ui/primitives/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { MoneyAmount } from '@/lib/money/MoneyAmount'
import type { ItemTimelineResponse, QuoteChangeKind } from '../types'

/**
 * One item's price over time, opened from any change row.
 *
 * The list is an ordered list, not a table: a price history is a sequence, and the sequence is the
 * point — the first entry is where the item appeared and the badge on every later entry is what
 * happened to it. The dialog also states whether the newest version still quotes the item and
 * whether the item has been entered in the supplier library / product master, because those are the
 * two facts that decide what the buyer does next.
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

export function ItemTimelineDialog({
  supplierId,
  sku,
  open,
  onOpenChange,
}: {
  supplierId: string | null
  sku: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useT()

  const query = useQuery({
    queryKey: ['sourcing-item-timeline', supplierId, sku],
    enabled: open && Boolean(supplierId) && Boolean(sku),
    queryFn: async () => {
      const params = new URLSearchParams({ supplierId: supplierId ?? '', sku: sku ?? '' })
      const response = await apiCall<ItemTimelineResponse>(
        `/api/sourcing/item-timeline?${params.toString()}`,
        undefined,
        { fallback: null },
      )
      if (!response.ok || !response.result) {
        throw new Error(t('sourcing.changes.timeline.error', 'The price history could not be loaded'))
      }
      return response.result
    },
  })

  const data = query.data ?? null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {t('sourcing.changes.timeline.title', 'Price history')}
            {sku ? ` · ${sku}` : ''}
          </DialogTitle>
          <DialogDescription>{data?.item.name ?? ''}</DialogDescription>
        </DialogHeader>

        {query.isError ? (
          <Alert status="error">
            <AlertTitle>{t('sourcing.changes.timeline.error', 'The price history could not be loaded')}</AlertTitle>
            <AlertDescription>{query.error instanceof Error ? query.error.message : ''}</AlertDescription>
          </Alert>
        ) : null}

        {data ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>
                {t('sourcing.changes.timeline.status.library', 'Supplier library')}:
                {' '}
                {data.item.library
                  ? data.item.library.supplierSku
                  : t('sourcing.changes.timeline.status.notInLibrary', 'not in the library')}
              </span>
              <span>
                {t('sourcing.changes.timeline.status.product', 'Product record')}:
                {' '}
                {data.item.purchase
                  ? `${data.item.purchase.productSku}`
                  : t('sourcing.changes.purchase.notCreated', 'No product record')}
              </span>
              {data.latestVersionDay ? (
                <span>
                  {data.reportedInLatestVersion
                    ? t('sourcing.changes.timeline.status.reported', 'quoted in the latest version')
                    : t('sourcing.changes.timeline.status.notReported', 'not quoted in the latest version')}
                </span>
              ) : null}
            </div>

            {data.points.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('sourcing.changes.timeline.empty', 'This item has no decided quotation yet.')}
              </p>
            ) : (
              <ol className="flex flex-col divide-y divide-border rounded-md border border-border">
                {data.points.map((point) => (
                  <li key={point.quoteId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="flex flex-col">
                      <span className="text-sm font-medium">{point.number ?? '—'}</span>
                      <span className="text-xs text-muted-foreground">{point.day}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      {point.unitCost === null ? (
                        <span className="text-xs text-muted-foreground">{t('sourcing.changes.noValue', '—')}</span>
                      ) : (
                        <MoneyAmount currencyCode={point.currencyCode ?? ''} amount={point.unitCost} kind="price" />
                      )}
                      {point.moqQuantity !== null && point.moqQuantity > 1 ? (
                        <span className="text-xs text-muted-foreground">MOQ {point.moqQuantity}</span>
                      ) : null}
                      {point.first ? (
                        <Badge variant="info">{t('sourcing.changes.timeline.first', 'First quoted')}</Badge>
                      ) : (
                        <Badge variant={KIND_TONE[point.kind]}>
                          {t(KIND_KEYS[point.kind], point.kind)}
                          {point.deltaPercent === null ? '' : ` ${point.deltaPercent > 0 ? '+' : ''}${point.deltaPercent.toFixed(2)}%`}
                        </Badge>
                      )}
                      {point.promotedProductId ? (
                        <Badge variant="success">{t('sourcing.changes.timeline.promoted', 'Promoted')}</Badge>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

export default ItemTimelineDialog
