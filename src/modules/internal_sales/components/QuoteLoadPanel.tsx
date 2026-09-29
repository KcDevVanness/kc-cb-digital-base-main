"use client"

/**
 * "从报价单载入" — the internal-sales order's reference-loading panel.
 *
 * Create mode: a button opens a quote picker; confirming reads the quote's head and lines through
 * `lib/quoteLoad.ts` and writes them into the form (one `setValue` per field) after a destructive
 * confirmation when the operator has already typed something. Edit mode: the same panel, read
 * only, shows which quote the order came from. Nothing here writes to the API — the order is
 * created by the form's own save, and the source quote is carried on `metadata`.
 */

import * as React from 'react'
import Link from 'next/link'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { FieldLabel } from '@open-mercato/ui/primitives/label'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { isUuid } from '../lib/buyer'
import type { InternalSalesFormValues, SourceQuoteRef } from '../lib/documentValues'
import { applyQuoteDraftToForm, hasOperatorInput, loadQuoteOptions } from '../lib/quoteLoad'

export default function QuoteLoadPanel({
  values,
  setValue,
  mode,
  autoLoadFrom,
  quoteEditHref,
}: {
  values: Record<string, unknown>
  setValue: (field: string, value: unknown) => void
  mode: 'create' | 'edit'
  /** `?fromQuote=<id>` — the quote-list row action's entry, loaded once on mount. */
  autoLoadFrom?: string | null
  quoteEditHref: (quoteId: string) => string
}) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [open, setOpen] = React.useState(false)
  const [quoteId, setQuoteId] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [inlineError, setInlineError] = React.useState<string | null>(null)
  const autoLoadedRef = React.useRef<string | null>(null)

  const currentValues = values as unknown as InternalSalesFormValues
  const sourceQuote: SourceQuoteRef | null = (currentValues.sourceQuote as SourceQuoteRef | null) ?? null

  const runLoad = React.useCallback(
    async (id: string, via: 'dialog' | 'auto') => {
      // Replacing unsaved input is destructive; an untouched form loads straight away.
      if (hasOperatorInput(currentValues)) {
        const proceed = await confirm({
          title: t('internal_sales.form.quoteLoad.confirmTitle', 'Replace what is in this form?'),
          description: t(
            'internal_sales.form.quoteLoad.confirmBody',
            'Loading overwrites the header and the lines currently in this form; unsaved input is lost.',
          ),
          confirmText: t('internal_sales.form.quoteLoad.confirm', 'Load'),
          variant: 'destructive',
        })
        if (!proceed) return
      }
      setBusy(true)
      setInlineError(null)
      try {
        const { number, lineCount } = await applyQuoteDraftToForm(id, setValue)
        flash(
          t('internal_sales.form.quoteLoad.done', 'Loaded from quote {number}', {
            number: number || id.slice(0, 8),
          }),
          'success',
        )
        if (lineCount === 0) {
          flash(
            t('internal_sales.form.quoteLoad.emptyLines', 'That quote has no lines — add them here.'),
            'error',
          )
        }
        setOpen(false)
      } catch (error) {
        const status = (error as { status?: number } | null)?.status
        const message = status === 403
          ? t('internal_sales.form.quoteLoad.forbidden', 'You do not have permission to read quotes.')
          : error instanceof Error && error.message
            ? error.message
            : t('internal_sales.form.quoteLoad.failed', 'Could not load the quote.')
        setInlineError(message)
        // The dialog shows the message in place; a silent auto-load needs the flash to be noticed.
        if (via === 'auto') flash(message, 'error')
      } finally {
        setBusy(false)
      }
    },
    [confirm, currentValues, setValue, t],
  )

  React.useEffect(() => {
    const id = autoLoadFrom?.trim()
    if (mode !== 'create' || !id || !isUuid(id)) return
    if (autoLoadedRef.current === id) return
    autoLoadedRef.current = id
    void runLoad(id, 'auto')
  }, [autoLoadFrom, mode, runLoad])

  const sourceLine = sourceQuote && (sourceQuote.number || sourceQuote.id) ? (
    <span className="text-sm text-muted-foreground">
      {t('internal_sales.form.sourceQuote.label', 'Source quote')}
      {': '}
      {sourceQuote.id ? (
        <Link className="underline underline-offset-2" href={quoteEditHref(sourceQuote.id)}>
          {sourceQuote.number || sourceQuote.id.slice(0, 8)}
        </Link>
      ) : (
        sourceQuote.number
      )}
    </span>
  ) : null

  if (mode === 'edit') return sourceLine

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          {t('internal_sales.form.quoteLoad.button', 'Load from a quote')}
        </Button>
        {sourceLine}
      </div>
      {inlineError ? <p className="text-sm text-destructive">{inlineError}</p> : null}
      <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next) }}>
        <DialogContent
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && quoteId.trim() && !busy) {
              event.preventDefault()
              void runLoad(quoteId.trim(), 'dialog')
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('internal_sales.form.quoteLoad.dialogTitle', 'Load from a quote')}</DialogTitle>
            <DialogDescription>
              {t(
                'internal_sales.form.quoteLoad.dialogBody',
                'Choose a quote to load its header and lines into this order in one go. Everything stays editable, and the saved order records its source quote.',
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <FieldLabel>
                {t('internal_sales.form.quoteLoad.quote', 'Quote')}
              </FieldLabel>
              <ComboboxInput
                value={quoteId}
                onChange={setQuoteId}
                placeholder={t('internal_sales.form.quoteLoad.placeholder', 'Search by quote number…')}
                loadSuggestions={async (query): Promise<ComboboxOption[]> => loadQuoteOptions(query)}
                allowCustomValues={false}
                clearable
              />
            </div>
            {inlineError ? <p className="text-sm text-destructive">{inlineError}</p> : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              {t('ui.actions.cancel', 'Cancel')}
            </Button>
            <Button
              type="button"
              disabled={busy || quoteId.trim().length === 0}
              onClick={() => void runLoad(quoteId.trim(), 'dialog')}
            >
              {busy
                ? t('internal_sales.form.quoteLoad.loading', 'Loading…')
                : t('internal_sales.form.quoteLoad.confirm', 'Load')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {ConfirmDialogElement}
    </div>
  )
}
