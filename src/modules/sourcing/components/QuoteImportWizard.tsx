"use client"

import * as React from 'react'
import { Check, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { FileUploadArea } from '@open-mercato/ui/primitives/file-upload'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { cn } from '@open-mercato/shared/lib/utils'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ColumnMappingTable } from './ColumnMappingTable'
import { QuoteLinesGrid, buildLineDrafts, type LineDraftState } from './QuoteLinesGrid'
import type { AiStatus, ParseOutcome, PromotionResult, QuoteLineRow } from '../types'

/**
 * The import flow: upload → column mapping → review.
 *
 * Parsing, mapping and line building all happen on the server; this component only moves the
 * operator's decisions across the wire (the file, the confirmed mapping, the profile name, the
 * promotion selection) and shows what came back. Step 1 also creates the draft quotation when the
 * host does not have one yet, because the attachment has to be bound to a quotation record before
 * it can be read back.
 */

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
const LINES_PAGE_SIZE = 200

type WizardStep = 1 | 2 | 3

function StepIndicator({ step }: { step: WizardStep }) {
  const t = useT()
  const steps: WizardStep[] = [1, 2, 3]
  return (
    <div className="flex items-center gap-2" aria-label={`Step ${step} of 3`}>
      {steps.map((stepNumber, index) => (
        <React.Fragment key={stepNumber}>
          {index > 0 ? <div className={cn('h-0.5 w-6', stepNumber <= step ? 'bg-foreground' : 'bg-border')} aria-hidden="true" /> : null}
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'flex size-5 items-center justify-center rounded-full text-xs font-semibold',
                stepNumber <= step ? 'bg-foreground text-primary-foreground' : 'bg-muted text-muted-foreground',
              )}
              aria-current={stepNumber === step ? 'step' : undefined}
            >
              {stepNumber < step ? <Check className="size-3" aria-hidden="true" /> : stepNumber}
            </span>
            <span className={cn('text-xs', stepNumber === step ? 'font-medium text-foreground' : 'text-muted-foreground')}>
              {t(`sourcing.wizard.step.${stepNumber === 1 ? 'upload' : stepNumber === 2 ? 'mapping' : 'review'}`, String(stepNumber))}
            </span>
          </div>
        </React.Fragment>
      ))}
    </div>
  )
}

export function QuoteImportWizard({
  quoteId: initialQuoteId,
  defaultSupplierId,
  defaultCurrencyCode = 'CNY',
  initialStep = 1,
  onCompleted,
  onReviewReady,
}: {
  quoteId?: string | null
  defaultSupplierId?: string | null
  defaultCurrencyCode?: string
  initialStep?: WizardStep
  /** Fired as soon as a quotation exists (created or parsed) — the host may refresh, not navigate. */
  onCompleted?: (quoteId: string) => void
  /**
   * Fired when the confirmed mapping has rebuilt the lines and the review step is reachable.
   * The create page navigates here, so the operator always sees the mapping before the grid.
   */
  onReviewReady?: (quoteId: string) => void
}) {
  const t = useT()
  const [quoteId, setQuoteId] = React.useState<string | null>(initialQuoteId ?? null)
  const [step, setStep] = React.useState<WizardStep>(initialStep)
  const [outcome, setOutcome] = React.useState<ParseOutcome | null>(null)
  const [columns, setColumns] = React.useState<ParseOutcome['columns']>([])
  const [sheetName, setSheetName] = React.useState<string>('')
  const [headerRowIndex, setHeaderRowIndex] = React.useState<number>(0)
  const [saveProfile, setSaveProfile] = React.useState(false)
  const [profileName, setProfileName] = React.useState('')
  const [sendHeadersOnly, setSendHeadersOnly] = React.useState(false)
  const [aiNotes, setAiNotes] = React.useState<string | null>(null)
  const [aiSent, setAiSent] = React.useState<{ headers: number; sampleRows: number } | null>(null)
  const [busy, setBusy] = React.useState<'upload' | 'remap' | 'ai' | null>(null)
  const [lines, setLines] = React.useState<QuoteLineRow[]>([])
  const [drafts, setDrafts] = React.useState<LineDraftState>({})
  const [promotions, setPromotions] = React.useState<string[]>([])
  const { runMutation } = useGuardedMutation({ contextId: 'sourcing-import' })

  const quoteStatusQuery = useQuery({
    queryKey: ['sourcing-quote-status', quoteId],
    enabled: Boolean(quoteId),
    queryFn: async () => {
      const response = await apiCall<{ item: { status: string } }>(`/api/sourcing/quotes/${quoteId}`)
      return response.ok && response.result?.item ? response.result.item.status : null
    },
  })
  const quoteStatus = quoteStatusQuery.data ?? outcome?.quote.status ?? 'draft'

  const aiStatusQuery = useQuery({
    queryKey: ['sourcing-ai-status'],
    queryFn: async () => (await apiCall<AiStatus>('/api/sourcing/ai-status')).result ?? { available: false, provider: null, model: null },
    staleTime: 60_000,
  })
  const aiStatus: AiStatus = aiStatusQuery.data ?? { available: false, provider: null, model: null }

  const reloadLines = React.useCallback(async () => {
    if (!quoteId) return
    const response = await fetchCrudList<QuoteLineRow>('sourcing/quote-lines', { quoteId, pageSize: LINES_PAGE_SIZE })
    setLines(response.items)
    setDrafts(buildLineDrafts(response.items))
  }, [quoteId])

  React.useEffect(() => {
    if (step === 3) void reloadLines()
  }, [reloadLines, step])

  const applyOutcome = React.useCallback((next: ParseOutcome) => {
    setOutcome(next)
    setColumns(next.columns)
    setSheetName(next.sheetName)
    setHeaderRowIndex(next.headerRowIndex)
    setQuoteId(next.quote.id)
    onCompleted?.(next.quote.id)
  }, [onCompleted])

  const createQuoteIfNeeded = React.useCallback(async (): Promise<string | null> => {
    if (quoteId) return quoteId
    const response = await apiCall<{ id: string }>('/api/sourcing/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        supplierId: defaultSupplierId ?? null,
        currencyCode: defaultCurrencyCode,
        sourceKind: 'excel_import',
      }),
    })
    if (!response.ok || !response.result?.id) {
      flash(t('sourcing.errors.saveFailed', 'Saving failed'), 'error')
      return null
    }
    setQuoteId(response.result.id)
    return response.result.id
  }, [defaultCurrencyCode, defaultSupplierId, quoteId, t])

  const handleFile = React.useCallback(async (file: File) => {
    setBusy('upload')
    try {
      const targetQuoteId = await createQuoteIfNeeded()
      if (!targetQuoteId) return
      const body = new FormData()
      body.set('entityId', 'sourcing:sourcing_quote')
      body.set('recordId', targetQuoteId)
      body.set('partitionCode', 'privateAttachments')
      body.set('file', file)
      const upload = await apiCall<{ item?: { id?: string } }>('/api/attachments', { method: 'POST', body }, { fallback: null })
      const attachmentId = upload.ok && upload.result?.item?.id ? upload.result.item.id : ''
      if (!attachmentId) {
        flash(t('sourcing.errors.uploadFailed', 'Upload failed'), 'error')
        return
      }
      const parsed = await runMutation({
        operation: () =>
          apiCall<ParseOutcome>('/api/sourcing/quotes/parse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ quoteId: targetQuoteId, attachmentId }),
          }),
        context: { retryLastMutation: () => undefined },
        mutationPayload: { quoteId: targetQuoteId, attachmentId },
      })
      if (!parsed.ok || !parsed.result) {
        const message = typeof parsed.result === 'object' && parsed.result !== null && 'error' in parsed.result
          ? String((parsed.result as { error?: unknown }).error ?? '')
          : ''
        flash(message || t('sourcing.errors.parseFailed', 'Parsing failed'), 'error')
        return
      }
      applyOutcome(parsed.result)
      setStep(2)
      onCompleted?.(targetQuoteId)
    } finally {
      setBusy(null)
    }
  }, [applyOutcome, createQuoteIfNeeded, onCompleted, runMutation, t])

  const handleRemap = React.useCallback(async () => {
    if (!quoteId) return
    setBusy('remap')
    try {
      const columnMap: Record<string, { sourceIndex: number; sourceHeader: string }> = {}
      for (const column of columns) {
        if (column.targetField) columnMap[column.targetField] = { sourceIndex: column.sourceIndex, sourceHeader: column.sourceHeader }
      }
      const response = await apiCall<ParseOutcome>('/api/sourcing/quotes/remap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteId,
          sheetName,
          headerRowIndex,
          columnMap,
          saveProfile,
          profileName: saveProfile ? profileName.trim() || undefined : undefined,
        }),
      })
      if (!response.ok || !response.result) {
        const message = typeof response.result === 'object' && response.result !== null && 'error' in response.result
          ? String((response.result as { error?: unknown }).error ?? '')
          : ''
        flash(message || t('sourcing.errors.parseFailed', 'Parsing failed'), 'error')
        return
      }
      applyOutcome(response.result)
      flash(t('sourcing.wizard.mapping.applied', 'Rebuilt {count} lines from the current mapping', { count: response.result.lineCount }), 'success')
      setStep(3)
      onReviewReady?.(quoteId)
    } finally {
      setBusy(null)
    }
  }, [applyOutcome, columns, headerRowIndex, onReviewReady, profileName, quoteId, saveProfile, sheetName, t])

  const handleAiMapping = React.useCallback(async () => {
    if (!quoteId) return
    setBusy('ai')
    try {
      const response = await apiCall<{ columns: ParseOutcome['columns']; notes: string | null; sent: { headers: number; sampleRows: number } }>(
        '/api/sourcing/quotes/ai-mapping',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quoteId, sheetName, headerRowIndex, includeSampleRows: !sendHeadersOnly }),
        },
      )
      if (!response.ok || !response.result) {
        const message = typeof response.result === 'object' && response.result !== null && 'error' in response.result
          ? String((response.result as { error?: unknown }).error ?? '')
          : ''
        flash(t('sourcing.mapping.ai.failed', 'AI mapping failed: {message}', { message: message || '—' }), 'error')
        return
      }
      setColumns(response.result.columns)
      setAiNotes(response.result.notes)
      setAiSent(response.result.sent)
      flash(t('sourcing.mapping.ai.applied', 'AI suggestion applied — check it, then click Apply mapping'), 'success')
    } finally {
      setBusy(null)
    }
  }, [headerRowIndex, quoteId, sendHeadersOnly, sheetName, t])

  const handlePromoted = React.useCallback((result: PromotionResult) => {
    setPromotions([
      t('sourcing.promote.result', 'Promotion finished: {created} created, {updated} updated, {skipped} skipped, {failed} failed', {
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        failed: result.failed.length,
      }),
      ...result.failed.map((failure) =>
        t('sourcing.promote.failedLine', 'Row {line}: {message}', { line: failure.lineNumber, message: failure.message }),
      ),
    ])
  }, [t])

  // The wizard is inline rather than a dialog, so `Esc` steps back instead of closing an overlay
  // and the primary action of the current step is reachable from the keyboard with ⌘/Ctrl+Enter.
  const handleStepKey = useDialogKeyHandler({
    onConfirm: step === 2 ? () => { void handleRemap() } : undefined,
    onCancel: step === 2 ? () => setStep(1) : step === 3 ? () => setStep(2) : undefined,
    disabled: busy !== null,
  })

  const mappedCount = columns.filter((column) => column.status === 'mapped').length
  const ignoredCount = columns.filter((column) => column.status === 'ignored').length
  const unmappedCount = columns.filter((column) => column.status === 'unmapped').length
  const aiPayloadPreview = JSON.stringify(
    {
      headers: outcome?.headerCells ?? [],
      sampleRows: sendHeadersOnly ? [] : outcome?.sampleRows ?? [],
    },
    null,
    2,
  )

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-4" onKeyDown={handleStepKey}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StepIndicator step={step} />
        <span className="text-xs text-muted-foreground">{t('sourcing.wizard.description', 'Supports .xls / .xlsx / .csv')}</span>
      </div>

      {step === 1 ? (
        <FileUploadArea
          accept=".xls,.xlsx,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          multiple={false}
          maxSizeBytes={MAX_UPLOAD_BYTES}
          disabled={busy !== null}
          heading={t('sourcing.wizard.upload.heading', 'Choose the supplier quotation workbook')}
          description={t('sourcing.wizard.upload.description', 'Drop the file here or click to choose.')}
          browseLabel={t('sourcing.wizard.upload.browse', 'Choose file')}
          onFilesSelected={(files) => {
            const file = files[0]
            if (file) void handleFile(file)
          }}
          onFilesRejected={() => flash(t('sourcing.wizard.upload.fileTooLarge', 'The file exceeds the 25 MB limit.'), 'error')}
        />
      ) : null}

      {step === 2 && outcome ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="neutral">{outcome.sheetName}</Badge>
            <span>
              {t('sourcing.wizard.upload.headerRow', 'Header row')}: {outcome.headerRowIndex + 1}
            </span>
            <span>
              {t('sourcing.wizard.upload.dataRows', 'Data rows')}: {outcome.dataRowCount}
            </span>
            <span>
              {t('sourcing.wizard.mapping.summary', '{mapped} mapped, {ignored} ignored, {unmapped} unmapped', {
                mapped: mappedCount,
                ignored: ignoredCount,
                unmapped: unmappedCount,
              })}
            </span>
            {outcome.templateMatched ? (
              <Badge variant="success">
                {t('sourcing.wizard.mapping.templateMatched', 'Recognized as the standard template', {
                  mapped: mappedCount,
                  total: columns.length,
                })}
              </Badge>
            ) : null}
            {outcome.matchedProfileId ? (
              <Badge variant="info">
                {t('sourcing.wizard.mapping.profileMatched', 'Mapping template applied: {name}', {
                  name: outcome.matchedProfileName ?? outcome.matchedProfileId,
                })}
              </Badge>
            ) : null}
          </div>
          <ColumnMappingTable columns={columns} onChange={setColumns} disabled={busy !== null} />
          <div className="flex flex-col gap-2 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={!aiStatus.available || busy !== null}
                onClick={() => { void handleAiMapping() }}
              >
                <Sparkles className="size-4" aria-hidden="true" />
                {t('sourcing.mapping.ai.button', 'Ask AI to map the columns')}
              </Button>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={sendHeadersOnly} onCheckedChange={setSendHeadersOnly} aria-label={t('sourcing.mapping.ai.sendHeadersOnly', 'Send the header row only')} />
                {t('sourcing.mapping.ai.sendHeadersOnly', 'Send the header row only (no data rows)')}
              </label>
              {!aiStatus.available ? (
                <span className="text-xs text-muted-foreground">{t('sourcing.mapping.ai.notConfigured', 'AI is not configured')}</span>
              ) : null}
            </div>
            <details className="text-xs text-muted-foreground">
              <summary>{t('sourcing.mapping.ai.payloadPreview', 'What will be sent')}</summary>
              <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted p-2">{aiPayloadPreview}</pre>
            </details>
            {aiSent ? (
              <span className="text-xs text-muted-foreground">
                {t('sourcing.mapping.ai.sentRows', 'Sent {headers} header cells and {rows} sample rows', {
                  headers: aiSent.headers,
                  rows: aiSent.sampleRows,
                })}
              </span>
            ) : null}
            {aiNotes ? <span className="text-xs text-muted-foreground">{t('sourcing.mapping.ai.notes', 'AI note: {notes}', { notes: aiNotes })}</span> : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={saveProfile} onCheckedChange={setSaveProfile} aria-label={t('sourcing.wizard.mapping.saveProfile', 'Save as mapping template')} />
              {t('sourcing.wizard.mapping.saveProfile', 'Save as mapping template')}
            </label>
            {saveProfile ? (
              <Input
                className="w-72"
                value={profileName}
                placeholder={t('sourcing.wizard.mapping.profileNamePlaceholder', 'e.g. Petkit 2026 quotation')}
                aria-label={t('sourcing.wizard.mapping.profileName', 'Template name')}
                onChange={(event) => setProfileName(event.target.value)}
              />
            ) : null}
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setStep(1)} disabled={busy !== null}>
                <ChevronLeft className="size-4" aria-hidden="true" />
                {t('sourcing.common.back', 'Back')}
              </Button>
              <Button onClick={() => { void handleRemap() }} disabled={busy !== null || unmappedCount === columns.length}>
                {t('sourcing.wizard.mapping.apply', 'Apply mapping and rebuild lines')}
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="flex flex-col gap-3">
          {lines.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              {t('sourcing.lines.empty', 'No data rows were parsed')}
            </div>
          ) : (
            <QuoteLinesGrid
              quoteId={quoteId ?? ''}
              status={quoteStatus}
              lines={lines}
              drafts={drafts}
              onDraftsChange={setDrafts}
              onReload={() => {
                void reloadLines()
                void quoteStatusQuery.refetch()
                if (quoteId) onCompleted?.(quoteId)
              }}
              onPromoted={handlePromoted}
              promotions={promotions}
            />
          )}
          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep(2)}>
              <ChevronLeft className="size-4" aria-hidden="true" />
              {t('sourcing.common.back', 'Back')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default QuoteImportWizard
