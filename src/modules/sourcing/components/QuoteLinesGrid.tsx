"use client"

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { ComboboxInput } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { Input } from '@open-mercato/ui/primitives/input'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { loadQuoteSectionOptions } from './quoteSectionOptions'
import type { PromotionResult, QuoteLineRow, QuoteLineStatus } from '../types'
// The supplier library moved to `purchasing`, so the action's route and payload shape live there;
// a type-only import asserts the response without pulling a value across the module boundary.
import type { SupplierProductImportResult } from '../../purchasing/types'

/**
 * The review grid: the operator's replacement for deleting rows in a spreadsheet.
 *
 * Selection decides what gets promoted, warnings say what still needs a decision, and the
 * current-price column shows what the product master already holds so a price change is visible in
 * the same glance as the import. Edits are collected into a draft and saved in one request; every
 * saved row carries the `updatedAt` it was rendered with, so a colleague's concurrent edit turns
 * into a 409 instead of a silent overwrite.
 */

const LINES_API_PATH = 'sourcing/quote-lines'
const PAGE_SIZE = 200

const LINE_STATUS_MAP: StatusMap<QuoteLineStatus> = {
  staged: 'neutral',
  ready: 'success',
  invalid: 'error',
  skipped: 'warning',
  promoted: 'info',
}

type EditableField = 'derivedSku' | 'productName' | 'moqQuantity' | 'unitCost' | 'sectionLabel'

type PriceRow = { productId: string; currencyCode: string; minQuantity: number; unitPrice: string; isActive: boolean }
type ProductRow = { id: string; sku: string }

export type LineDraftState = Record<string, { id: string; updatedAt: string; derivedSku: string; productName: string; moqQuantity: string; unitCost: string; sectionLabel: string }>

function draftFromLines(lines: readonly QuoteLineRow[]): LineDraftState {
  const drafts: LineDraftState = {}
  for (const line of lines) {
    drafts[line.id] = {
      id: line.id,
      updatedAt: line.updatedAt ?? '',
      derivedSku: line.derivedSku ?? '',
      productName: line.productName ?? '',
      moqQuantity: line.moqQuantity === null || line.moqQuantity === undefined ? '' : String(line.moqQuantity),
      unitCost: line.unitCost ?? '',
      sectionLabel: line.sectionLabel ?? '',
    }
  }
  return drafts
}

function formatPacking(line: QuoteLineRow): string {
  const packing = line.outerPacking ?? line.innerPacking
  if (!packing) return ''
  const { length, width, height, unit } = packing as { length?: unknown; width?: unknown; height?: unknown; unit?: unknown }
  const parts = [length, width, height].filter((value) => value !== undefined && value !== null && value !== '')
  if (parts.length === 0) return ''
  return `${parts.join('*')}${unit ? ` ${String(unit)}` : ''}`
}

function warningLabel(t: TranslateFn, warning: string): string {
  return t(`sourcing.lines.warning.${warning}`, warning)
}

export function QuoteLinesGrid({
  quoteId,
  status,
  lines,
  drafts,
  onDraftsChange,
  onReload,
  onPromoted,
  promotions,
}: {
  quoteId: string
  status: string
  lines: readonly QuoteLineRow[]
  drafts: LineDraftState
  onDraftsChange: (next: LineDraftState) => void
  onReload: () => void
  onPromoted: (result: PromotionResult) => void
  promotions: readonly string[]
}) {
  const t = useT()
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const [saving, setSaving] = React.useState(false)
  const [promoting, setPromoting] = React.useState(false)
  const [importing, setImporting] = React.useState(false)

  // Current `purchase` prices, indexed by SKU: the products module keys prices by product id, and
  // the grid knows SKUs. The window is one page of prices (200) — the column is a reading aid, and
  // a product outside the window simply shows as "not in the master".
  const priceQuery = useQuery({
    queryKey: ['sourcing-current-purchase-prices', scopeVersion],
    queryFn: async () => {
      const prices = await fetchCrudList<PriceRow>('products/prices', {
        priceTier: 'purchase',
        isActive: 'true',
        pageSize: PAGE_SIZE,
        sortField: 'created_at',
        sortDir: 'desc',
      })
      const productIds = Array.from(new Set(prices.items.map((row) => row.productId)))
      if (productIds.length === 0) return {} as Record<string, PriceRow>
      const products = await fetchCrudList<ProductRow>('products/items', {
        ids: productIds.join(','),
        status: 'all',
        pageSize: PAGE_SIZE,
      })
      const skuById = new Map(products.items.map((row) => [row.id, row.sku]))
      const bySku: Record<string, PriceRow> = {}
      for (const price of prices.items) {
        const sku = skuById.get(price.productId)
        if (sku) bySku[sku.toUpperCase()] = price
      }
      return bySku
    },
    staleTime: 30_000,
  })

  const priceBySku = React.useMemo(() => priceQuery.data ?? {}, [priceQuery.data])

  const editedIds = React.useMemo(() => {
    const ids = new Set<string>()
    for (const line of lines) {
      const draft = drafts[line.id]
      if (!draft) continue
      if (
        draft.derivedSku !== (line.derivedSku ?? '') ||
        draft.productName !== (line.productName ?? '') ||
        draft.moqQuantity !== (line.moqQuantity === null || line.moqQuantity === undefined ? '' : String(line.moqQuantity)) ||
        draft.unitCost !== (line.unitCost ?? '') ||
        draft.sectionLabel !== (line.sectionLabel ?? '')
      ) {
        ids.add(line.id)
      }
    }
    return ids
  }, [drafts, lines])

  const saveDrafts = React.useCallback(async (): Promise<boolean> => {
    if (editedIds.size === 0) return true
    setSaving(true)
    try {
      const rows = Array.from(editedIds).map((id) => {
        const draft = drafts[id]
        return {
          id,
          updatedAt: draft.updatedAt,
          derivedSku: draft.derivedSku.trim().length > 0 ? draft.derivedSku.trim() : null,
          productName: draft.productName.trim().length > 0 ? draft.productName.trim() : null,
          moqQuantity: draft.moqQuantity.trim().length > 0 ? Number(draft.moqQuantity) : null,
          unitCost: draft.unitCost.trim().length > 0 ? draft.unitCost.trim() : null,
          sectionLabel: draft.sectionLabel.trim().length > 0 ? draft.sectionLabel.trim() : null,
        }
      })
      const response = await apiCall<{ updated: number }>(`/api/${LINES_API_PATH}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteId, rows }),
      })
      if (!response.ok) {
        // The server answers a stale row with the platform's optimistic-lock body, so the shared
        // conflict bar renders (with a refresh that reloads the rows the operator can no longer
        // trust) instead of a message this module would have to invent.
        if (surfaceRecordConflict({ status: response.status, body: response.result }, t, { onRefresh: () => onReload() })) {
          onReload()
          return false
        }
        const message = typeof response.result === 'object' && response.result !== null && 'error' in response.result
          ? String((response.result as { error?: unknown }).error ?? '')
          : ''
        flash(message || t('sourcing.errors.saveFailed', 'Saving failed'), 'error')
        return false
      }
      flash(t('sourcing.lines.actions.saved', 'Saved {count} lines', { count: rows.length }), 'success')
      onReload()
      return true
    } finally {
      setSaving(false)
    }
  }, [drafts, editedIds, onReload, quoteId, t])

  /**
   * Flips the server-side `selected` flag of the given rows. `selected` is what `approve` counts
   * ("at least one selected ready line"), so skipping rows is a persisted decision rather than a
   * client-side filter.
   */
  const setRowsSelected = React.useCallback(async (selectedRows: readonly QuoteLineRow[], selected: boolean) => {
    if (selectedRows.length === 0) return
    const response = await apiCall<{ updated: number }>(`/api/${LINES_API_PATH}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteId,
        rows: selectedRows.map((row) => ({ id: row.id, updatedAt: row.updatedAt ?? '', selected })),
      }),
    })
    if (!response.ok) {
      flash(t('sourcing.errors.saveFailed', 'Saving failed'), 'error')
      return
    }
    onReload()
  }, [onReload, quoteId, t])

  const promoteSelection = React.useCallback(async (selectedRows: readonly QuoteLineRow[]) => {
    if (status !== 'approved') {
      flash(t('sourcing.promote.approveFirst', 'Approve the quotation before promoting its lines.'), 'error')
      return
    }
    const ids = selectedRows.filter((line) => line.rowStatus !== 'promoted').map((line) => line.id)
    if (ids.length === 0) {
      flash(t('sourcing.promote.noneSelected', 'Select the lines you want to promote first.'), 'error')
      return
    }
    setPromoting(true)
    try {
      const saved = await saveDrafts()
      if (!saved) return
      const response = await apiCall<PromotionResult>('/api/sourcing/quotes/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteId, lineIds: ids }),
      })
      if (!response.ok || !response.result) {
        const message = typeof response.result === 'object' && response.result !== null && 'error' in response.result
          ? String((response.result as { error?: unknown }).error ?? '')
          : ''
        flash(message || t('sourcing.errors.promoteFailed', 'Promotion failed'), 'error')
        return
      }
      const result = response.result
      flash(
        t('sourcing.promote.result', 'Promotion finished: {created} created, {updated} updated, {skipped} skipped, {failed} failed', {
          created: result.created,
          updated: result.updated,
          skipped: result.skipped,
          failed: result.failed.length,
        }),
        result.failed.length > 0 ? 'error' : 'success',
      )
      onPromoted(result)
      onReload()
      void queryClient.invalidateQueries({ queryKey: ['sourcing-current-purchase-prices'] })
    } finally {
      setPromoting(false)
    }
  }, [onPromoted, onReload, queryClient, quoteId, saveDrafts, status, t])

  /**
   * Feeds the selected lines into the quotation's supplier library.
   *
   * Not gated on `approved`: the library is supplier-side goods data, not the frozen master write
   * that approval exists to authorize — the only precondition is that the quotation names a
   * supplier, and the command answers `quote_supplier_required` (422) when it does not. Unsaved grid
   * edits are written first, because the import reads the stored line values.
   */
  const addToLibrarySelection = React.useCallback(async (selectedRows: readonly QuoteLineRow[]) => {
    if (importing) return
    const ids = selectedRows.map((line) => line.id)
    if (ids.length === 0) {
      flash(t('sourcing.supplierProducts.import.noneSelected', 'Select the lines to add first.'), 'error')
      return
    }
    setImporting(true)
    try {
      const saved = await saveDrafts()
      if (!saved) return
      const response = await apiCall<SupplierProductImportResult>('/api/purchasing/supplier-products/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteId, lineIds: ids }),
      })
      if (!response.ok || !response.result) {
        const message = typeof response.result === 'object' && response.result !== null && 'error' in response.result
          ? String((response.result as { error?: unknown }).error ?? '')
          : ''
        flash(message || t('sourcing.supplierProducts.import.failed', 'Adding to the supplier library failed'), 'error')
        return
      }
      const result = response.result
      flash(
        t(
          'sourcing.supplierProducts.import.result',
          'Library updated: {created} added, {updated} updated, {skipped} unchanged, {failed} failed',
          { created: result.created, updated: result.updated, skipped: result.skipped, failed: result.failed.length },
        ),
        result.failed.length > 0 ? 'error' : 'success',
      )
      // Name the rows that failed so the operator repairs those lines instead of re-running the
      // import; a run is bounded to 200 lines, and a wall of flashes would be unreadable.
      for (const failure of result.failed.slice(0, 5)) {
        flash(
          t('sourcing.supplierProducts.import.failedLine', 'Line {line}: {message}', {
            line: failure.lineNumber,
            message: failure.message,
          }),
          'error',
        )
      }
      onReload()
    } finally {
      setImporting(false)
    }
  }, [importing, onReload, quoteId, saveDrafts, t])

  const columns = React.useMemo<ColumnDef<QuoteLineRow>[]>(() => {
    const updateDraft = (id: string, field: EditableField, value: string) => {
      onDraftsChange({ ...drafts, [id]: { ...drafts[id], [field]: value } })
    }
    const editable = (line: QuoteLineRow, field: EditableField, type: 'text' | 'number' = 'text', className = '') => (
      <Input
        value={drafts[line.id]?.[field] ?? ''}
        type={type}
        className={className}
        aria-label={t(`sourcing.lines.column.${field === 'derivedSku' ? 'sku' : field === 'productName' ? 'productName' : field === 'moqQuantity' ? 'moq' : field === 'unitCost' ? 'unitCost' : 'section'}`, field)}
        onChange={(event) => updateDraft(line.id, field, event.target.value)}
      />
    )
    return [
      {
        accessorKey: 'sourceRowNumber',
        header: t('sourcing.lines.column.row', 'Row'),
        enableSorting: false,
        meta: { priority: 1 },
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.sourceRowNumber === null ? '' : row.original.sourceRowNumber + 1}</span>,
      },
      {
        accessorKey: 'sectionLabel',
        header: t('sourcing.lines.column.section', 'Section'),
        enableSorting: false,
        meta: { priority: 2 },
        // Section banners come from the `quote_section` dictionary as suggestions and stay typable:
        // a workbook brings its own banners, and the operator edits rather than transcribes codes.
        cell: ({ row }) => (
          <ComboboxInput
            value={drafts[row.original.id]?.sectionLabel ?? ''}
            placeholder={t('sourcing.lines.column.section', 'Section')}
            onChange={(next) => updateDraft(row.original.id, 'sectionLabel', next)}
            loadSuggestions={loadQuoteSectionOptions}
            resolveLabel={(value) => value}
          />
        ),
      },
      {
        accessorKey: 'itemNo',
        header: t('sourcing.lines.column.itemNo', 'Item No.'),
        enableSorting: false,
        meta: { priority: 3 },
      },
      {
        accessorKey: 'productName',
        header: t('sourcing.lines.column.productName', 'Product'),
        enableSorting: false,
        meta: { priority: 4, truncate: true, maxWidth: 260 },
        cell: ({ row }) => editable(row.original, 'productName'),
      },
      {
        accessorKey: 'derivedSku',
        header: t('sourcing.lines.column.sku', 'SKU (editable)'),
        enableSorting: false,
        meta: { priority: 5 },
        cell: ({ row }) => {
          const line = row.original
          const generated = line.warnings.includes('sku_from_name') || line.warnings.includes('duplicate_sku_in_file')
          return (
            <div className="flex items-center gap-1">
              {editable(line, 'derivedSku')}
              {generated ? <Badge variant="warning">{t('sourcing.lines.warning.sku_from_name', 'generated')}</Badge> : null}
            </div>
          )
        },
      },
      {
        accessorKey: 'hsCode',
        header: t('sourcing.lines.column.hsCode', 'HS code'),
        enableSorting: false,
        meta: { priority: 6 },
      },
      {
        id: 'packing',
        header: t('sourcing.lines.column.packing', 'Carton'),
        enableSorting: false,
        meta: { priority: 7 },
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatPacking(row.original)}</span>,
      },
      {
        accessorKey: 'unitCost',
        header: t('sourcing.lines.column.unitCost', 'Unit cost'),
        enableSorting: false,
        meta: { priority: 8 },
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            {editable(row.original, 'unitCost', 'text', 'w-24')}
            <span className="text-xs text-muted-foreground">{row.original.currencyCode ?? ''}</span>
          </div>
        ),
      },
      {
        accessorKey: 'moqQuantity',
        header: t('sourcing.lines.column.moq', 'MOQ'),
        enableSorting: false,
        meta: { priority: 9 },
        cell: ({ row }) => editable(row.original, 'moqQuantity', 'text', 'w-20'),
      },
      {
        id: 'currentPrice',
        header: t('sourcing.lines.column.currentPrice', 'Current price / delta'),
        enableSorting: false,
        meta: { priority: 10 },
        cell: ({ row }) => {
          const sku = (drafts[row.original.id]?.derivedSku ?? row.original.derivedSku ?? '').toUpperCase()
          const price = sku ? priceBySku[sku] : undefined
          if (!price) return <span className="text-xs text-muted-foreground">{t('sourcing.lines.notPromoted', 'Not in the master')}</span>
          const quoted = Number(drafts[row.original.id]?.unitCost ?? row.original.unitCost ?? '')
          const stored = Number(price.unitPrice)
          const delta = Number.isFinite(quoted) && Number.isFinite(stored) ? quoted - stored : null
          return (
            <span className="text-xs">
              {price.unitPrice} {price.currencyCode}
              {delta === null || delta === 0 ? (
                <span className="text-muted-foreground"> · 0</span>
              ) : (
                <Badge variant={delta > 0 ? 'error' : 'success'}>
                  {delta > 0 ? '+' : ''}
                  {delta.toFixed(2)}
                </Badge>
              )}
            </span>
          )
        },
      },
      {
        accessorKey: 'rowStatus',
        header: t('sourcing.lines.column.status', 'Status'),
        enableSorting: false,
        meta: { priority: 11 },
        cell: ({ row }) => (
          <StatusBadge variant={LINE_STATUS_MAP[row.original.rowStatus]} dot>
            {t(`sourcing.lines.status.${row.original.rowStatus}`, row.original.rowStatus)}
          </StatusBadge>
        ),
      },
      {
        id: 'warnings',
        header: t('sourcing.lines.column.warnings', 'Warnings'),
        enableSorting: false,
        meta: { priority: 12, truncate: true, maxWidth: 260 },
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.warnings.map((warning) => (
              <Badge key={warning} variant="warning">
                {warningLabel(t, warning)}
              </Badge>
            ))}
          </div>
        ),
      },
    ]
  }, [drafts, onDraftsChange, priceBySku, t])

  return (
    <div className="flex flex-col gap-3">
      <DataTable<QuoteLineRow>
        columns={columns}
        data={lines as QuoteLineRow[]}
        bulkActions={[
          {
            id: 'mark-skipped',
            label: t('sourcing.lines.actions.markSkipped', 'Mark skipped'),
            onExecute: (selectedRows) => {
              void setRowsSelected(selectedRows, false)
              return true
            },
          },
          {
            id: 'mark-selected',
            label: t('sourcing.lines.actions.markReady', 'Restore selection'),
            onExecute: (selectedRows) => {
              void setRowsSelected(selectedRows, true)
              return true
            },
          },
          {
            id: 'add-to-library',
            // The bulk-action contract has no disabled flag, so the running state is carried by the
            // label; a second click while it runs is ignored by the callback itself.
            label: importing
              ? t('sourcing.supplierProducts.import.running', 'Adding to the library…')
              : t('sourcing.supplierProducts.actions.import', 'Add to supplier library'),
            onExecute: (selectedRows) => {
              void addToLibrarySelection(selectedRows)
              return true
            },
          },
          {
            id: 'promote',
            label: t('sourcing.lines.actions.promoteSelected', 'Promote selected to products'),
            onExecute: (selectedRows) => {
              void promoteSelection(selectedRows)
              return true
            },
          },
        ]}
        emptyState={<ListEmptyState title={t('sourcing.lines.empty', 'No data rows were parsed')} />}
        pagination={{
          page: 1,
          pageSize: PAGE_SIZE,
          total: lines.length,
          totalPages: 1,
          onPageChange: () => undefined,
        }}
        isLoading={false}
        error={null}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {t('sourcing.lines.unsaved', 'Unsaved changes')}: {editedIds.size}
        </span>
        <Button variant="secondary" onClick={() => { void saveDrafts() }} disabled={saving || editedIds.size === 0}>
          {t('sourcing.lines.actions.save', 'Save changes')}
        </Button>
      </div>
      {promotions.length > 0 ? (
        <div className="flex flex-col gap-1 rounded-md border border-border bg-muted px-3 py-2 text-xs">
          {promotions.map((message) => (
            <span key={message}>{message}</span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function buildLineDrafts(lines: readonly QuoteLineRow[]): LineDraftState {
  return draftFromLines(lines)
}

export default QuoteLinesGrid
