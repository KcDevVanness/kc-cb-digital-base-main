"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
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
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { fetchSupplierRows, SUPPLIER_OPTIONS_QUERY_KEY } from './supplierOptions'
import { ItemTimelineDialog } from './ItemTimelineDialog'
import { QuoteChangeTable } from './QuoteChangeTable'
import type { QuoteChangeRow, QuoteChangesResponse, QuoteStatus, QuoteVersionRow } from '../types'

/**
 * The changes tab: pick a supplier, see its version chain, click a version to see what it changed.
 *
 * The chain table answers "what has this supplier been doing lately?" at a glance, and the diff
 * table below it reuses the same comparison the quotation detail page shows — same endpoint, same
 * columns, same wording — so the two surfaces can never disagree about what "added" means.
 */

const PAGE_SIZE = 50

const STATUS_MAP: StatusMap<QuoteStatus> = {
  draft: 'neutral',
  approved: 'success',
  archived: 'info',
  cancelled: 'warning',
}

function buildVersionColumns(t: TranslateFn): ColumnDef<QuoteVersionRow>[] {
  return [
    {
      accessorKey: 'number',
      header: t('sourcing.changes.versions.columns.number', 'Version'),
      enableSorting: false,
      meta: { priority: 1 },
      cell: ({ row }) => (
        <span className="flex items-center gap-2">
          <span className="font-medium">{row.original.number ?? '—'}</span>
          {row.original.collapsedCount > 0 ? (
            <Badge variant="neutral">
              {t('sourcing.changes.versions.collapsed', '+{count} more imports that day', {
                count: row.original.collapsedCount,
              })}
            </Badge>
          ) : null}
        </span>
      ),
    },
    { accessorKey: 'day', header: t('sourcing.changes.versions.columns.day', 'Date'), enableSorting: false, meta: { priority: 2 } },
    {
      accessorKey: 'fileName',
      header: t('sourcing.changes.versions.columns.file', 'Source file'),
      enableSorting: false,
      meta: { priority: 3, truncate: true, maxWidth: 240 },
      cell: ({ row }) => <span className="text-xs">{row.original.fileName ?? '—'}</span>,
    },
    {
      accessorKey: 'lineCount',
      header: t('sourcing.changes.versions.columns.lines', 'Rows'),
      enableSorting: false,
      meta: { priority: 4 },
    },
    {
      accessorKey: 'promotedCount',
      header: t('sourcing.changes.versions.columns.promoted', 'Promoted'),
      enableSorting: false,
      meta: { priority: 5 },
    },
    {
      id: 'summary',
      header: t('sourcing.changes.versions.columns.summary', 'Change'),
      enableSorting: false,
      meta: { priority: 6 },
      cell: ({ row }) => {
        const summary = row.original.summary
        if (!summary) {
          return (
            <span className="text-xs text-muted-foreground">
              {t('sourcing.changes.versions.firstVersion', 'First version')}
            </span>
          )
        }
        return (
          <span className="flex flex-wrap items-center gap-1">
            {summary.added > 0 ? <Badge variant="info">{`+${summary.added}`}</Badge> : null}
            {summary.removed > 0 ? <Badge variant="warning">{`−${summary.removed}`}</Badge> : null}
            {summary.up > 0 ? <Badge variant="error">{`↑${summary.up}`}</Badge> : null}
            {summary.down > 0 ? <Badge variant="success">{`↓${summary.down}`}</Badge> : null}
            {summary.added + summary.removed + summary.up + summary.down === 0 ? (
              <span className="text-xs text-muted-foreground">
                {t('sourcing.changes.versions.noChanges', 'No change')}
              </span>
            ) : null}
          </span>
        )
      },
    },
    {
      accessorKey: 'status',
      header: t('sourcing.changes.versions.columns.status', 'Status'),
      enableSorting: false,
      meta: { priority: 7 },
      cell: ({ row }) => (
        <StatusBadge variant={STATUS_MAP[row.original.status as QuoteStatus] ?? 'neutral'} dot>
          {t(`sourcing.quotes.status.${row.original.status}`, row.original.status)}
        </StatusBadge>
      ),
    },
  ]
}

export function QuoteChangesPanel() {
  const t = useT()
  const [supplierId, setSupplierId] = React.useState('')
  const [selectedQuoteId, setSelectedQuoteId] = React.useState<string | null>(null)
  const [onlyChanged, setOnlyChanged] = React.useState(true)
  const [page, setPage] = React.useState(1)
  const [comparePage, setComparePage] = React.useState(1)
  const [timelineRow, setTimelineRow] = React.useState<QuoteChangeRow | null>(null)

  const suppliersQuery = useQuery({
    queryKey: SUPPLIER_OPTIONS_QUERY_KEY,
    queryFn: fetchSupplierRows,
    staleTime: 60_000,
  })
  const suppliers = suppliersQuery.data ?? []

  const versionsQuery = useQuery({
    queryKey: ['sourcing-quote-versions', supplierId, page],
    enabled: Boolean(supplierId),
    queryFn: async () => {
      const params = new URLSearchParams({ supplierId, page: String(page), pageSize: String(PAGE_SIZE) })
      const response = await apiCall<QuoteVersionChainResponse>(
        `/api/sourcing/quote-changes/versions?${params.toString()}`,
        undefined,
        { fallback: null },
      )
      if (!response.ok || !response.result) {
        throw new Error(t('sourcing.changes.versions.error', 'The version list could not be loaded'))
      }
      return response.result
    },
  })

  const versions = versionsQuery.data?.items ?? []
  const activeQuoteId = selectedQuoteId ?? versions[0]?.quoteId ?? null

  const compareQuery = useQuery({
    queryKey: ['sourcing-quote-changes', activeQuoteId, onlyChanged, comparePage],
    enabled: Boolean(activeQuoteId),
    queryFn: async () => {
      const params = new URLSearchParams({ quoteId: String(activeQuoteId), page: String(comparePage) })
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

  const versionColumns = React.useMemo(() => buildVersionColumns(t), [t])
  const compare = compareQuery.data ?? null
  const openTimeline = React.useCallback((row: QuoteChangeRow) => setTimelineRow(row), [])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Label htmlFor="quote-changes-supplier" className="text-xs text-muted-foreground">
            {t('sourcing.changes.versions.supplier', 'Supplier')}
          </Label>
          <Select
            value={supplierId}
            onValueChange={(value) => {
              setSupplierId(value)
              setSelectedQuoteId(null)
              setPage(1)
            }}
          >
            <SelectTrigger
              id="quote-changes-supplier"
              className="w-80"
              aria-label={t('sourcing.changes.versions.supplier', 'Supplier')}
            >
              <SelectValue placeholder={t('sourcing.changes.versions.supplierPlaceholder', 'Select a supplier')} />
            </SelectTrigger>
            <SelectContent>
              {suppliers.map((supplier) => (
                <SelectItem key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="text-xs text-muted-foreground">
          {t('sourcing.changes.versions.orderNote', 'Ordered by the quotation date, or by import time when it is empty.')}
        </span>
      </div>

      {versionsQuery.isError ? (
        <Alert status="error">
          <AlertTitle>{t('sourcing.changes.versions.error', 'The version list could not be loaded')}</AlertTitle>
          <AlertDescription>
            {versionsQuery.error instanceof Error ? versionsQuery.error.message : ''}
          </AlertDescription>
        </Alert>
      ) : null}

      {!supplierId ? (
        <Alert status="information">
          <AlertTitle>{t('sourcing.changes.versions.pickSupplier', 'Pick a supplier to see its versions')}</AlertTitle>
          <AlertDescription>
            {t('sourcing.changes.versions.pickSupplierHint', 'One entry per layout per day, newest first.')}
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <DataTable<QuoteVersionRow>
            columns={versionColumns}
            data={versions}
            onRowClick={(row) => {
              setSelectedQuoteId(row.quoteId)
              setComparePage(1)
            }}
            emptyState={
              <ListEmptyState
                title={t('sourcing.changes.versions.empty', 'This supplier has no decided quotation yet')}
              />
            }
            pagination={{
              page: versionsQuery.data?.page ?? page,
              pageSize: versionsQuery.data?.pageSize ?? PAGE_SIZE,
              total: versionsQuery.data?.totalCount ?? 0,
              totalPages: Math.max(1, Math.ceil((versionsQuery.data?.totalCount ?? 0) / PAGE_SIZE)),
              onPageChange: setPage,
            }}
            isLoading={versionsQuery.isLoading}
            error={null}
          />

          {versionsQuery.data?.truncated ? (
            <p className="text-xs text-muted-foreground">
              {t('sourcing.changes.versions.truncated', 'Only the newest versions are listed.')}
            </p>
          ) : null}

          {activeQuoteId ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">
                  {compare?.target
                    ? t('sourcing.changes.versions.diffTitle', '{number}: changes against the previous version', {
                        number:
                          compare.target.number ??
                          t('sourcing.quotes.status.draft', 'Draft'),
                      })
                    : ''}
                </h3>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="quote-changes-version-only-changed"
                    checked={onlyChanged}
                    onCheckedChange={(value) => {
                      setOnlyChanged(value === true)
                      setComparePage(1)
                    }}
                  />
                  <Label htmlFor="quote-changes-version-only-changed" className="text-xs">
                    {t('sourcing.changes.onlyChanged', 'Only rows that changed')}
                  </Label>
                </div>
              </div>

              {compare && compare.base === null ? (
                <Alert status="information">
                  <AlertTitle>
                    {t('sourcing.changes.empty.firstVersion', 'This is the first version of its layout')}
                  </AlertTitle>
                  <AlertDescription>
                    {t(
                      'sourcing.changes.empty.firstVersionHint',
                      'Import the next workbook of this layout and this panel will show what changed.',
                    )}
                  </AlertDescription>
                </Alert>
              ) : null}

              {compare && compare.base !== null ? (
                <QuoteChangeTable
                  rows={compare.items}
                  page={compare.page}
                  pageSize={compare.pageSize}
                  totalCount={compare.totalCount}
                  isLoading={compareQuery.isLoading}
                  emptyTitle={t('sourcing.changes.empty.noChanges', 'This version is identical to the previous one')}
                  onPageChange={setComparePage}
                  onOpenTimeline={openTimeline}
                />
              ) : null}
            </div>
          ) : null}
        </>
      )}

      <ItemTimelineDialog
        supplierId={supplierId}
        sku={timelineRow?.key ?? null}
        open={timelineRow !== null}
        onOpenChange={(open) => {
          if (!open) setTimelineRow(null)
        }}
      />
    </div>
  )
}

type QuoteVersionChainResponse = {
  supplierId: string
  items: QuoteVersionRow[]
  totalCount: number
  truncated: boolean
  page: number
  pageSize: number
}

export default QuoteChangesPanel
