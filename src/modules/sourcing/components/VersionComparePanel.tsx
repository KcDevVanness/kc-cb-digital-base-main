"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ItemTimelineDialog } from './ItemTimelineDialog'
import { QuoteChangeTable } from './QuoteChangeTable'
import type { QuoteChangeRow, QuoteChangesResponse } from '../types'

/**
 * "What changed since the last version?" — the panel the buyer opens right after importing a new
 * workbook.
 *
 * The comparison itself is computed server-side in one request; this component owns only the two
 * choices the operator makes (which version to compare against, whether unchanged rows are shown)
 * plus the drill-down into one item's history. The default base is whatever the server picks — the
 * previous version of the same layout — so opening the panel is already the answer.
 */

const PAGE_SIZE = 50
const AUTO_BASE = 'auto'

export function VersionComparePanel({ quoteId }: { quoteId: string }) {
  const t = useT()
  const [baseQuoteId, setBaseQuoteId] = React.useState<string>(AUTO_BASE)
  const [onlyChanged, setOnlyChanged] = React.useState(true)
  const [page, setPage] = React.useState(1)
  const [timelineRow, setTimelineRow] = React.useState<QuoteChangeRow | null>(null)

  const query = useQuery({
    queryKey: ['sourcing-quote-changes', quoteId, baseQuoteId, onlyChanged, page],
    queryFn: async () => {
      const params = new URLSearchParams({ quoteId, page: String(page), pageSize: String(PAGE_SIZE) })
      if (baseQuoteId !== AUTO_BASE) params.set('baseQuoteId', baseQuoteId)
      if (onlyChanged) params.set('onlyChanged', 'true')
      const response = await apiCall<QuoteChangesResponse>(
        `/api/sourcing/quote-changes?${params.toString()}`,
        undefined,
        { fallback: null },
      )
      if (!response.ok || !response.result) {
        throw new Error(t('sourcing.changes.error', 'The comparison could not be loaded'))
      }
      return response.result
    },
  })

  const data = query.data ?? null
  const candidates = data?.candidates ?? []
  const openTimeline = React.useCallback((row: QuoteChangeRow) => setTimelineRow(row), [])

  return (
    <section className="flex flex-col gap-3" aria-labelledby="quote-changes-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="quote-changes-heading" className="text-base font-semibold">
            {t('sourcing.changes.title', 'Compared with the previous version')}
          </h2>
          {data ? (
            <p className="text-xs text-muted-foreground">
              {[data.target.number ?? t('sourcing.quotes.status.draft', 'Draft'), data.target.day ?? '', data.target.fileName ?? '']
                .filter((part) => part.length > 0)
                .join(' · ')}{' '}
              · {t('sourcing.changes.rowsCompared', '{count} rows compared', { count: data.summary.total })}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="quote-changes-base" className="text-xs text-muted-foreground">
              {t('sourcing.changes.base.label', 'Compare against')}
            </Label>
            <Select
              value={baseQuoteId}
              onValueChange={(value) => {
                setBaseQuoteId(value)
                setPage(1)
              }}
            >
              <SelectTrigger
                id="quote-changes-base"
                className="w-72"
                aria-label={t('sourcing.changes.base.label', 'Compare against')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO_BASE}>
                  {t('sourcing.changes.base.auto', 'Previous version (automatic)')}
                </SelectItem>
                {candidates.map((candidate) => (
                  <SelectItem key={candidate.quoteId} value={candidate.quoteId}>
                    {[candidate.number ?? t('sourcing.quotes.status.draft', 'Draft'), candidate.day ?? '', candidate.fileName ?? '']
                      .filter((part) => part.length > 0)
                      .join(' · ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="quote-changes-only-changed"
              checked={onlyChanged}
              onCheckedChange={(value) => {
                setOnlyChanged(value === true)
                setPage(1)
              }}
            />
            <Label htmlFor="quote-changes-only-changed" className="text-xs">
              {t('sourcing.changes.onlyChanged', 'Only rows that changed')}
            </Label>
          </div>
        </div>
      </div>

      {query.isError ? (
        <Alert status="error">
          <AlertTitle>{t('sourcing.changes.error', 'The comparison could not be loaded')}</AlertTitle>
          <AlertDescription>
            {query.error instanceof Error ? query.error.message : ''}
          </AlertDescription>
        </Alert>
      ) : null}

      {!query.isLoading && !query.isError && data && data.base === null ? (
        <Alert status="information">
          <AlertTitle>{t('sourcing.changes.empty.firstVersion', 'This is the first version of its layout')}</AlertTitle>
          <AlertDescription>
            {t(
              'sourcing.changes.empty.firstVersionHint',
              'Import the next workbook of this layout and this panel will show what changed.',
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      {data && data.base !== null ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="info">
              {t('sourcing.changes.summary.added', 'Added {count}', { count: data.summary.added })}
            </Badge>
            <Badge variant="warning">
              {t('sourcing.changes.summary.removed', 'Gone {count}', { count: data.summary.removed })}
            </Badge>
            <Badge variant="error">
              {t('sourcing.changes.summary.up', 'Up {count}', { count: data.summary.up })}
            </Badge>
            <Badge variant="success">
              {t('sourcing.changes.summary.down', 'Down {count}', { count: data.summary.down })}
            </Badge>
            {!onlyChanged ? (
              <Badge variant="neutral">
                {t('sourcing.changes.summary.same', 'Unchanged {count}', { count: data.summary.same })}
              </Badge>
            ) : null}
            {data.summary.currencyMismatch > 0 ? (
              <Badge variant="warning">
                {t('sourcing.changes.summary.currencyMismatch', 'Currency differs {count}', {
                  count: data.summary.currencyMismatch,
                })}
              </Badge>
            ) : null}
            {data.summary.noPrice > 0 ? (
              <Badge variant="neutral">
                {t('sourcing.changes.summary.noPrice', 'No price {count}', { count: data.summary.noPrice })}
              </Badge>
            ) : null}
            {data.summary.unmatched > 0 ? (
              <Badge variant="neutral">
                {t('sourcing.changes.summary.unmatched', 'Unmatched rows {count}', {
                  count: data.summary.unmatched,
                })}
              </Badge>
            ) : null}
          </div>

          <QuoteChangeTable
            rows={data.items}
            page={data.page}
            pageSize={data.pageSize}
            totalCount={data.totalCount}
            isLoading={query.isLoading}
            emptyTitle={t('sourcing.changes.empty.noChanges', 'This version is identical to the previous one')}
            onPageChange={setPage}
            onOpenTimeline={openTimeline}
          />
        </>
      ) : null}

      <ItemTimelineDialog
        supplierId={data?.target.supplierId ?? null}
        sku={timelineRow?.key ?? null}
        open={timelineRow !== null}
        onOpenChange={(open) => {
          if (!open) setTimelineRow(null)
        }}
      />
    </section>
  )
}

export default VersionComparePanel
