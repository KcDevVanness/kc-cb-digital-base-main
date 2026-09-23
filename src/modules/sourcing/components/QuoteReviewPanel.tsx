"use client"

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, CheckCircle2, Trash2 } from 'lucide-react'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { withCurrentCurrency, useCurrencyOptions } from './currencyOptions'
import { QuoteImportWizard } from './QuoteImportWizard'
import { fetchSupplierRows, SUPPLIER_OPTIONS_QUERY_KEY } from './supplierOptions'
import type { QuoteDetail, QuoteStatus } from '../types'

/**
 * The review console: one quotation's header, its import wizard and its actions.
 *
 * Approval is the gate the rest of the module keys on — the number is assigned here, the supplier
 * name is frozen, and promotion is refused until it has happened. The header stays editable while
 * the quotation is a draft (with the row's own optimistic-lock version), and the source workbook can
 * be deleted without touching the quotation itself.
 */

const QUOTE_STATUS_MAP: StatusMap<QuoteStatus> = {
  draft: 'neutral',
  approved: 'success',
  archived: 'info',
  cancelled: 'warning',
}

export function QuoteReviewPanel({ quoteId }: { quoteId: string }) {
  const t = useT()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [busy, setBusy] = React.useState(false)
  const [supplierId, setSupplierId] = React.useState('')
  const [quoteDate, setQuoteDate] = React.useState('')
  const [currencyCode, setCurrencyCode] = React.useState('CNY')
  const [notes, setNotes] = React.useState('')
  const [headerDirty, setHeaderDirty] = React.useState(false)

  const quoteQuery = useQuery({
    queryKey: ['sourcing-quote', quoteId],
    queryFn: async () => {
      const response = await fetchCrudList<QuoteDetail>('sourcing/quotes', { id: quoteId, pageSize: 1 })
      return response.items[0] ?? null
    },
  })
  const quote = quoteQuery.data ?? null

  const linesQuery = useQuery({
    queryKey: ['sourcing-quote-line-count', quoteId],
    queryFn: () => fetchCrudList<{ id: string }>('sourcing/quote-lines', { quoteId, pageSize: 1 }),
  })
  const lineCount = linesQuery.data?.total ?? quote?.lineCount ?? 0

  const suppliersQuery = useQuery({
    queryKey: SUPPLIER_OPTIONS_QUERY_KEY,
    queryFn: fetchSupplierRows,
    staleTime: 60_000,
  })
  const suppliers = suppliersQuery.data ?? []

  // Same list the create panel offers: the currency dictionary, plus whatever code the quotation
  // already carries so an older record never renders with an empty trigger.
  const dictionaryCurrencies = useCurrencyOptions(t)
  const currencyOptions = React.useMemo(
    () => withCurrentCurrency(dictionaryCurrencies, currencyCode),
    [currencyCode, dictionaryCurrencies],
  )

  React.useEffect(() => {
    if (!quote || headerDirty) return
    setSupplierId(quote.supplierId ?? '')
    setQuoteDate(quote.quoteDate ?? '')
    setCurrencyCode(quote.currencyCode)
    setNotes(quote.notes ?? '')
  }, [headerDirty, quote])

  const reload = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['sourcing-quote', quoteId] })
    void queryClient.invalidateQueries({ queryKey: ['sourcing-quote-line-count', quoteId] })
    void queryClient.invalidateQueries({ queryKey: ['sourcing-quote-status', quoteId] })
  }, [queryClient, quoteId])

  const saveHeader = React.useCallback(async () => {
    if (!quote) return
    setBusy(true)
    try {
      const response = await withScopedApiRequestHeaders(buildOptimisticLockHeader(quote.updatedAt), () =>
        apiCall('/api/sourcing/quotes', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: quote.id,
            supplierId: supplierId || null,
            quoteDate: quoteDate || null,
            currencyCode,
            notes: notes.trim() || null,
          }),
        }),
      )
      if (!response.ok) {
        if (!surfaceRecordConflict(response.result, t)) flash(t('sourcing.errors.saveFailed', 'Saving failed'), 'error')
        return
      }
      setHeaderDirty(false)
      flash(t('sourcing.lines.actions.saved', 'Saved {count} lines', { count: 1 }), 'success')
      reload()
    } finally {
      setBusy(false)
    }
  }, [currencyCode, notes, quote, quoteDate, reload, supplierId, t])

  const approve = React.useCallback(async () => {
    if (!quote) return
    setBusy(true)
    try {
      const response = await withScopedApiRequestHeaders(buildOptimisticLockHeader(quote.updatedAt), () =>
        apiCall<{ number: string | null }>('/api/sourcing/quotes/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: quote.id }),
        }),
      )
      if (!response.ok) {
        const message = typeof response.result === 'object' && response.result !== null && 'error' in response.result
          ? String((response.result as { error?: unknown }).error ?? '')
          : ''
        flash(message || t('sourcing.errors.approveFailed', 'Approval failed'), 'error')
        return
      }
      flash(`${t('sourcing.quotes.status.approved', 'Approved')}: ${response.result?.number ?? ''}`, 'success')
      reload()
    } finally {
      setBusy(false)
    }
  }, [quote, reload, t])

  const archive = React.useCallback(async () => {
    if (!quote) return
    setBusy(true)
    try {
      const response = await withScopedApiRequestHeaders(buildOptimisticLockHeader(quote.updatedAt), () =>
        apiCall('/api/sourcing/quotes/archive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: quote.id }),
        }),
      )
      if (!response.ok) {
        flash(t('sourcing.errors.saveFailed', 'Saving failed'), 'error')
        return
      }
      reload()
    } finally {
      setBusy(false)
    }
  }, [quote, reload, t])

  const deleteSourceFile = React.useCallback(async () => {
    if (!quote?.sourceAttachmentId) return
    const confirmed = await confirm({
      title: t('sourcing.quotes.deleteSourceFileConfirmTitle', 'Delete the source file?'),
      description: t('sourcing.quotes.deleteSourceFileConfirmBody', 'The attachment is deleted permanently; the quotation stays.'),
      confirmText: t('sourcing.quotes.actions.deleteSourceFile', 'Delete source file'),
      variant: 'destructive',
    })
    if (!confirmed) return
    setBusy(true)
    try {
      const response = await apiCall(`/api/attachments?id=${encodeURIComponent(quote.sourceAttachmentId)}`, { method: 'DELETE' })
      if (!response.ok) {
        flash(t('sourcing.errors.saveFailed', 'Saving failed'), 'error')
        return
      }
      reload()
    } finally {
      setBusy(false)
    }
  }, [confirm, quote, reload, t])

  if (quoteQuery.isLoading) return <p className="text-sm text-muted-foreground">{t('sourcing.common.loading', 'Loading…')}</p>
  if (quoteQuery.error) {
    return <p className="text-sm text-destructive">{t('sourcing.errors.loadFailed', 'Loading failed')}</p>
  }
  if (!quote) {
    return <p className="text-sm text-muted-foreground">{t('sourcing.common.notAuthorized', 'You do not have access to this content')}</p>
  }

  const isDraft = quote.status === 'draft'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base font-semibold leading-tight">{quote.number ?? t('sourcing.quotes.status.draft', 'Draft')}</h1>
            <StatusBadge variant={QUOTE_STATUS_MAP[quote.status]} dot>
              {t(`sourcing.quotes.status.${quote.status}`, quote.status)}
            </StatusBadge>
            <Badge variant="neutral">{quote.currencyCode}</Badge>
            {quote.sourceSheetName ? <Badge variant="neutral">{quote.sourceSheetName}</Badge> : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {t('sourcing.quotes.detail.summary.lines', 'Lines')}: {lineCount} ·{' '}
            {t('sourcing.quotes.detail.summary.promoted', 'Promoted')}: {quote.promotedCount}
            {quote.sourceFileName ? ` · ${quote.sourceFileName}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {quote.sourceAttachmentId ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => { void deleteSourceFile() }}>
              <Trash2 className="size-4" aria-hidden="true" />
              {t('sourcing.quotes.actions.deleteSourceFile', 'Delete source file')}
            </Button>
          ) : null}
          {isDraft ? (
            <Button disabled={busy || lineCount === 0} onClick={() => { void approve() }}>
              <CheckCircle2 className="size-4" aria-hidden="true" />
              {t('sourcing.quotes.actions.approve', 'Approve quotation')}
            </Button>
          ) : quote.status === 'approved' ? (
            <Button variant="secondary" disabled={busy} onClick={() => { void archive() }}>
              <Archive className="size-4" aria-hidden="true" />
              {t('sourcing.quotes.actions.archive', 'Archive')}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-lg border border-border p-4 md:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="review-supplier">{t('sourcing.quotes.list.columns.supplier', 'Supplier')}</Label>
          <Select
            value={supplierId}
            disabled={!isDraft}
            onValueChange={(next) => {
              setSupplierId(next)
              setHeaderDirty(true)
            }}
          >
            <SelectTrigger id="review-supplier">
              <SelectValue placeholder={t('sourcing.lines.noValue', '—')} />
            </SelectTrigger>
            <SelectContent>
              {suppliers.map((supplier) => (
                <SelectItem key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {suppliersQuery.isError ? (
            <p className="text-xs text-status-error-text" role="alert">
              {t('sourcing.errors.supplierOptionsFailed', 'Could not load the supplier list')}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="review-date">{t('sourcing.quotes.list.columns.quoteDate', 'Quote date')}</Label>
          <Input
            id="review-date"
            type="date"
            value={quoteDate}
            disabled={!isDraft}
            onChange={(event) => {
              setQuoteDate(event.target.value)
              setHeaderDirty(true)
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="review-currency">{t('sourcing.quotes.list.columns.currency', 'Currency')}</Label>
          <Select
            value={currencyCode}
            disabled={!isDraft}
            onValueChange={(next) => {
              setCurrencyCode(next)
              setHeaderDirty(true)
            }}
          >
            <SelectTrigger id="review-currency">
              <SelectValue placeholder={t('sourcing.lines.noValue', '—')} />
            </SelectTrigger>
            <SelectContent>
              {currencyOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="review-notes">{t('sourcing.quotes.list.columns.notes', 'Notes')}</Label>
          <div className="flex items-center gap-2">
            <Input
              id="review-notes"
              value={notes}
              disabled={!isDraft}
              onChange={(event) => {
                setNotes(event.target.value)
                setHeaderDirty(true)
              }}
            />
            <Button variant="secondary" disabled={!isDraft || !headerDirty || busy} onClick={() => { void saveHeader() }}>
              {t('sourcing.lines.actions.save', 'Save changes')}
            </Button>
          </div>
        </div>
      </div>

      <QuoteImportWizard
        quoteId={quote.id}
        initialStep={lineCount > 0 ? 3 : 1}
        onCompleted={reload}
      />
      {ConfirmDialogElement}
    </div>
  )
}

export default QuoteReviewPanel
