"use client"

/**
 * "从报价单载入" — the internal-sales order's reference-loading panel.
 *
 * Create mode: a button opens a quote picker; confirming reads the quote's head and lines through
 * `lib/quoteLoad.ts` and writes them into the form (one `setValue` per field) after a destructive
 * confirmation when the operator has already typed something. Edit mode: the same panel, read
 * only, shows which quote the order came from. Nothing here writes to the API — the order is
 * created by the form's own save, and the source quote is carried on `metadata`.
 *
 * Both modes render the source quote as a **preview**, not as a link out: clicking the number opens
 * a right-side `Drawer` with the quote's head and lines read through the same loader. Leaving for
 * the quote's own edit page would drop the operator's unsaved order, which is exactly what a
 * "which quote was this?" glance must not do; the drawer's footer keeps the real navigation as an
 * explicit button.
 */

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { FileText } from 'lucide-react'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@open-mercato/ui/primitives/drawer'
import { Button } from '@open-mercato/ui/primitives/button'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import { FieldLabel } from '@open-mercato/ui/primitives/label'
import { ErrorMessage } from '@open-mercato/ui/backend/detail/ErrorMessage'
import { LoadingMessage } from '@open-mercato/ui/backend/detail/LoadingMessage'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import {
  createDictionaryMap,
  DictionaryValue,
  type DictionaryMap,
} from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { loadDictionaryEntriesByKey } from '@open-mercato/core/modules/dictionaries/lib/clientEntries'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { MoneyAmount } from '@/lib/money/MoneyAmount'
import { isUuid } from '../lib/buyer'
import { channelIdForTradeType } from '../lib/tradeType'
import type { TradeTypeChannelMap } from '../lib/tradeTypeChannels'
import type { InternalSalesFormValues, SourceQuoteRef } from '../lib/documentValues'
import { SALES_STATUS_DICTIONARY_KEY } from '../lib/salesStatus'
import {
  applyQuoteDraftToForm,
  hasOperatorInput,
  loadQuoteDraft,
  loadQuoteOptions,
  resolveQuoteLabel,
  sourceQuotePreviewFromDraft,
  type SourceQuotePreview,
} from '../lib/quoteLoad'

/** What a read-only preview field shows when the projection carries nothing. */
const EMPTY_CELL = '—'

export default function QuoteLoadPanel({
  values,
  setValue,
  mode,
  autoLoadFrom,
  quoteEditHref,
  channelIds,
  adoptQuoteType,
}: {
  values: Record<string, unknown>
  setValue: (field: string, value: unknown) => void
  mode: 'create' | 'edit'
  /** `?fromQuote=<id>` — the quote-list row action's entry, loaded once on mount. */
  autoLoadFrom?: string | null
  quoteEditHref: (quoteId: string) => string
  /** The organization's trade-type channels, so the picker offers the order's own type. */
  channelIds: TradeTypeChannelMap
  /** Whether loading may move this form's trade type to the quote's — false on a locked entry. */
  adoptQuoteType: boolean
}) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [open, setOpen] = React.useState(false)
  const [quoteId, setQuoteId] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [inlineError, setInlineError] = React.useState<string | null>(null)
  const autoLoadedRef = React.useRef<string | null>(null)

  /**
   * The source-quote preview drawer. Deliberately separate from the load dialog: previewing never
   * touches the form, which is the whole point — the operator can read the quote without losing
   * what they have already typed here.
   */
  const [previewOpen, setPreviewOpen] = React.useState(false)
  const [preview, setPreview] = React.useState<SourceQuotePreview | null>(null)
  const [previewBusy, setPreviewBusy] = React.useState(false)
  const [previewError, setPreviewError] = React.useState<string | null>(null)

  const openPreview = React.useCallback(
    async (id: string) => {
      setPreviewOpen(true)
      setPreviewBusy(true)
      setPreviewError(null)
      try {
        const draft = await loadQuoteDraft(id)
        setPreview(sourceQuotePreviewFromDraft(draft))
      } catch (error) {
        const status = (error as { status?: number } | null)?.status
        setPreviewError(
          status === 403
            ? t('internal_sales.form.quoteLoad.forbidden', 'You do not have permission to read quotes.')
            : status === 404
              ? t('internal_sales.form.sourceQuote.previewMissing', 'That quote is no longer there.')
              : t('internal_sales.form.sourceQuote.previewFailed', 'Could not load the quote preview.'),
        )
      } finally {
        setPreviewBusy(false)
      }
    },
    [t],
  )

  const closePreview = React.useCallback(() => {
    setPreviewOpen(false)
    setPreview(null)
    setPreviewError(null)
  }, [])

  // Fetched only while the drawer is open: an order page must not pay for the status vocabulary.
  const scopeVersion = useOrganizationScopeVersion()
  const { data: salesStatusEntries } = useQuery({
    queryKey: ['internal-sales-status-options', scopeVersion],
    queryFn: () => loadDictionaryEntriesByKey(SALES_STATUS_DICTIONARY_KEY),
    staleTime: 5 * 60 * 1000,
    enabled: previewOpen,
  })
  const statusMap = React.useMemo<DictionaryMap | null>(
    () => (salesStatusEntries ? createDictionaryMap(salesStatusEntries) : null),
    [salesStatusEntries],
  )

  const currentValues = values as unknown as InternalSalesFormValues
  const sourceQuote: SourceQuoteRef | null = (currentValues.sourceQuote as SourceQuoteRef | null) ?? null
  // The picker follows the form's own trade type: an internal order may load an internal quote,
  // an external order an external one.
  const quoteChannelId = channelIdForTradeType(currentValues.tradeType, channelIds)

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
        const { number, lineCount } = await applyQuoteDraftToForm(id, setValue, { adoptQuoteType })
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
    [adoptQuoteType, confirm, currentValues, setValue, t],
  )

  React.useEffect(() => {
    const id = autoLoadFrom?.trim()
    if (mode !== 'create' || !id || !isUuid(id)) return
    if (autoLoadedRef.current === id) return
    autoLoadedRef.current = id
    void runLoad(id, 'auto')
  }, [autoLoadFrom, mode, runLoad])

  const sourceLabel = sourceQuote?.number || (sourceQuote?.id ? sourceQuote.id.slice(0, 8) : '')

  /**
   * The preview drawer. Rendered in both modes: on the create page it shows what 「从报价单载入」
   * would bring in, and on the edit page it is the read-only view of the source quote the order
   * keeps (this module has no quote detail page of its own, and leaving for the quote's edit page
   * would drop whatever the operator has already typed here).
   */
  const previewDrawer = (
    <Drawer
      open={previewOpen}
      onOpenChange={(next) => {
        if (next) setPreviewOpen(true)
        else closePreview()
      }}
    >
      <DrawerContent closeAriaLabel={t('common.close', 'Close')}>
        <DrawerHeader leading={<FileText aria-hidden="true" className="size-4" />}>
          <DrawerTitle>{t('internal_sales.form.sourceQuote.label', 'Source quote')}</DrawerTitle>
          <DrawerDescription>{preview?.number || sourceLabel || EMPTY_CELL}</DrawerDescription>
        </DrawerHeader>
        <DrawerBody>
          {previewBusy ? (
            <LoadingMessage label={t('internal_sales.form.sourceQuote.previewLoading', 'Loading the quote…')} />
          ) : previewError ? (
            <ErrorMessage label={previewError} />
          ) : preview ? (
            <div className="flex flex-col gap-5">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <PreviewField label={t('internal_sales.list.columns.quoteNumber', 'Quote number')}>
                  {preview.number || EMPTY_CELL}
                </PreviewField>
                <PreviewField label={t('internal_sales.list.columns.customer', 'Buyer')}>
                  {preview.buyerName || EMPTY_CELL}
                </PreviewField>
                <PreviewField label={t('internal_sales.form.field.currency', 'Currency')}>
                  {preview.currencyCode || EMPTY_CELL}
                </PreviewField>
                <PreviewField label={t('internal_sales.list.columns.status', 'Status')}>
                  <DictionaryValue
                    value={preview.status}
                    map={statusMap}
                    fallback={<span className="text-muted-foreground">{EMPTY_CELL}</span>}
                    colorClassName="h-3 w-3 rounded-full"
                  />
                </PreviewField>
                <PreviewField label={t('internal_sales.list.columns.total', 'Amount (net)')}>
                  {preview.total ? (
                    <MoneyAmount currencyCode={preview.currencyCode} amount={preview.total} />
                  ) : (
                    EMPTY_CELL
                  )}
                </PreviewField>
                <PreviewField label={t('internal_sales.list.columns.lines', 'Lines')}>
                  {String(preview.lines.length)}
                </PreviewField>
                {preview.customerReference ? (
                  <PreviewField label={t('internal_sales.form.field.customerReference', 'Customer reference')}>
                    {preview.customerReference}
                  </PreviewField>
                ) : null}
                {preview.comments ? (
                  <PreviewField label={t('internal_sales.form.field.comments', 'Notes')}>
                    {preview.comments}
                  </PreviewField>
                ) : null}
              </dl>
              <section className="flex flex-col gap-2">
                <SectionHeader title={t('internal_sales.form.sourceQuote.previewLines', 'Quote lines')} />
                {preview.lines.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t('internal_sales.form.sourceQuote.noLines', 'This quote has no lines.')}
                  </p>
                ) : (
                  <ul className="flex flex-col divide-y divide-border">
                    {preview.lines.map((line, index) => (
                      <li key={line.key || String(index)} className="flex flex-col gap-1 py-2">
                        <span className="text-sm font-medium">{line.name || EMPTY_CELL}</span>
                        {line.sku || line.spec ? (
                          <span className="text-xs text-muted-foreground">
                            {[line.sku, line.spec].filter((part) => part.trim().length > 0).join(' · ')}
                          </span>
                        ) : null}
                        <span className="text-sm text-muted-foreground">
                          {line.quantity || '0'}
                          {' × '}
                          <MoneyAmount
                            currencyCode={preview.currencyCode}
                            amount={line.unitPriceNet || '0'}
                            kind="price"
                          />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          ) : null}
        </DrawerBody>
        <DrawerFooter>
          <DrawerClose asChild>
            <Button variant="outline">{t('common.close', 'Close')}</Button>
          </DrawerClose>
          {preview ? (
            <Button asChild>
              <Link href={quoteEditHref(preview.id)}>
                {t('internal_sales.form.sourceQuote.previewOpen', 'Open the quote')}
              </Link>
            </Button>
          ) : null}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )

  const sourceLine = sourceQuote && sourceLabel ? (
    <span className="text-sm text-muted-foreground">
      {t('internal_sales.form.sourceQuote.label', 'Source quote')}
      {': '}
      {sourceQuote.id ? (
        <LinkButton
          variant="primary"
          underline="always"
          aria-label={t('internal_sales.form.sourceQuote.previewAria', 'Preview source quote {number}', {
            number: sourceLabel,
          })}
          onClick={() => {
            void openPreview(sourceQuote.id)
          }}
        >
          {sourceLabel}
        </LinkButton>
      ) : (
        sourceLabel
      )}
    </span>
  ) : null

  if (mode === 'edit') {
    return (
      <>
        {sourceLine}
        {previewDrawer}
      </>
    )
  }

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
                loadSuggestions={async (query): Promise<ComboboxOption[]> => loadQuoteOptions(query, quoteChannelId)}
                resolveLabel={async (value) => resolveQuoteLabel(value)}
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
      {previewDrawer}
      {ConfirmDialogElement}
    </div>
  )
}

/** One read-only label/value pair in the preview drawer. */
function PreviewField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium break-words">{children}</dd>
    </div>
  )
}
