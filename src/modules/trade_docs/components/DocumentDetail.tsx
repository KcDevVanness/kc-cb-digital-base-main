"use client"

import * as React from 'react'
import Link from 'next/link'
import { Search, Trash2, Upload } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Input } from '@open-mercato/ui/primitives/input'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { AttachmentPreviewLink } from '@/lib/attachments/AttachmentPreview'
import { MoneyAmount } from '@/lib/money/MoneyAmount'
import {
  documentDirectionLabel,
  documentKindLabel,
  documentListHref,
  documentSourceKindLabel,
  documentStatusLabel,
  type DocumentKind,
  type DocumentStatus,
} from './DocumentsTable'
import { loadDocumentOptions, type DocumentOption } from './formOptions'
import { downloadApiFile } from './downloadFile'

const DOCUMENTS_API_PATH = 'trade_docs/documents'
const DOCUMENT_LINES_API_PATH = 'trade_docs/documents/lines'
const DOCUMENT_TRANSITIONS_URL = '/api/trade_docs/documents/transitions'
const DOCUMENT_ATTACH_API_PATH = 'trade_docs/documents/attach'
const DOCUMENT_FILE_API_PATH = '/api/trade_docs/documents'

/**
 * Attachment assignment entity id of the uploaded replacement; resolves to the platform's private
 * default partition, exactly like the contract scan.
 */
const ATTACHMENT_ENTITY_ID = 'trade_docs:trade_docs_documents'

/** The content type the generated document is served with; the download verifies it. */
const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const STATUS_VARIANT: StatusMap<DocumentStatus> = {
  draft: 'neutral',
  issued: 'info',
  void: 'error',
}

type DocumentHead = {
  id: string
  kind: string
  number: string | null
  direction: string
  status: DocumentStatus
  counterpartyName: string | null
  currencyCode: string
  exchangeRate: string | null
  subtotal: string
  total: string
  paymentTerms: string | null
  incoterms: string | null
  validUntil: string | null
  deliveryDate: string | null
  notes: string | null
  sourceKind: string | null
  sourceId: string | null
  sourceSnapshot: Record<string, unknown> | null
  issuedAt: string | null
  generatedAttachmentId: string | null
  attachmentId: string | null
  updatedAt: string | null
  counterpartySnapshot: Record<string, unknown> | null
  ourPartySnapshot: Record<string, unknown> | null
  consigneeSnapshot: Record<string, unknown> | null
  notifyPartySnapshot: Record<string, unknown> | null
}

type DocumentLineRecord = {
  id: string
  lineNumber: number
  name: string | null
  sku: string | null
  model: string | null
  spec: string | null
  unit: string | null
  quantity: string
  unitPrice: string
  amount: string
  sourceSnapshot: Record<string, unknown> | null
}

/** Which transitions the current status allows — mirrors the command's table, never widens it. */
const ALLOWED_ACTIONS: Record<DocumentStatus, Array<'issue' | 'void'>> = {
  draft: ['issue'],
  issued: ['void'],
  void: [],
}

function snapshotTextValue(snapshot: Record<string, unknown> | null, key: string): string | null {
  if (!snapshot) return null
  const value = snapshot[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/**
 * The family of a copied source document, read from the frozen `sourceSnapshot`. A copy writes it as
 * `documentKind` (`proforma` / `commercial`); anything else (a legacy or hand-written snapshot)
 * yields null so the reader prints the snapshot text instead of a link to a guessed route.
 */
function readSourceDocumentKind(snapshot: Record<string, unknown> | null): DocumentKind | null {
  const value = snapshotTextValue(snapshot, 'documentKind')
  return value === 'proforma' || value === 'commercial' ? value : null
}

function toHead(item: Record<string, unknown>): DocumentHead {
  const status = String(item.status ?? 'draft')
  return {
    id: String(item.id),
    kind: String(item.kind ?? 'proforma'),
    number: (item.number ?? null) as string | null,
    direction: String(item.direction ?? 'sales'),
    status: (['draft', 'issued', 'void'] as string[]).includes(status) ? (status as DocumentStatus) : 'draft',
    counterpartyName: (item.counterpartyName ?? null) as string | null,
    currencyCode: String(item.currencyCode ?? item.currency_code ?? 'CNY'),
    exchangeRate: (item.exchangeRate ?? item.exchange_rate ?? null) as string | null,
    subtotal: String(item.subtotal ?? '0'),
    total: String(item.total ?? '0'),
    paymentTerms: (item.paymentTerms ?? null) as string | null,
    incoterms: (item.incoterms ?? null) as string | null,
    validUntil: (item.validUntil ?? null) as string | null,
    deliveryDate: (item.deliveryDate ?? null) as string | null,
    notes: (item.notes ?? null) as string | null,
    sourceKind: (item.sourceKind ?? item.source_kind ?? null) as string | null,
    sourceId: (item.sourceId ?? item.source_id ?? null) as string | null,
    sourceSnapshot: (item.sourceSnapshot ?? item.source_snapshot ?? null) as Record<string, unknown> | null,
    issuedAt: (item.issuedAt ?? null) as string | null,
    generatedAttachmentId: (item.generatedAttachmentId ?? null) as string | null,
    attachmentId: (item.attachmentId ?? null) as string | null,
    updatedAt: (item.updatedAt ?? null) as string | null,
    counterpartySnapshot: (item.counterpartySnapshot ?? null) as Record<string, unknown> | null,
    ourPartySnapshot: (item.ourPartySnapshot ?? null) as Record<string, unknown> | null,
    consigneeSnapshot: (item.consigneeSnapshot ?? item.consignee_snapshot ?? null) as Record<string, unknown> | null,
    notifyPartySnapshot: (item.notifyPartySnapshot ?? item.notify_party_snapshot ?? null) as Record<string, unknown> | null,
  }
}

function toLine(item: Record<string, unknown>): DocumentLineRecord {
  return {
    id: String(item.id),
    lineNumber: Number(item.lineNumber ?? item.line_number ?? 0),
    name: (item.name ?? null) as string | null,
    sku: (item.sku ?? null) as string | null,
    model: (item.model ?? null) as string | null,
    spec: (item.spec ?? null) as string | null,
    unit: (item.unit ?? null) as string | null,
    quantity: String(item.quantity ?? '0'),
    unitPrice: String(item.unitPrice ?? item.unit_price ?? '0'),
    amount: String(item.amount ?? '0'),
    sourceSnapshot: (item.sourceSnapshot ?? item.source_snapshot ?? null) as Record<string, unknown> | null,
  }
}

function SummaryField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  )
}

function buildLineColumns(t: TranslateFn, currencyCode: string): ColumnDef<DocumentLineRecord>[] {
  return [
    { accessorKey: 'lineNumber', header: '#', meta: { priority: 1 } },
    {
      accessorKey: 'name',
      header: t('trade_docs.documents.form.lines.name', '品名'),
      meta: { priority: 2, truncate: true, maxWidth: 260 },
      cell: ({ row }) => row.original.name ?? '—',
    },
    {
      accessorKey: 'model',
      header: t('trade_docs.documents.form.lines.model', '型号'),
      enableSorting: false,
      meta: { priority: 3 },
      cell: ({ row }) => row.original.model ?? '—',
    },
    {
      accessorKey: 'spec',
      header: t('trade_docs.documents.form.lines.spec', '规格'),
      enableSorting: false,
      meta: { priority: 4, truncate: true, maxWidth: 220 },
      cell: ({ row }) => row.original.spec ?? '—',
    },
    {
      accessorKey: 'unit',
      header: t('trade_docs.documents.form.lines.unit', '单位'),
      enableSorting: false,
      meta: { priority: 5 },
      cell: ({ row }) => row.original.unit ?? '—',
    },
    {
      accessorKey: 'quantity',
      header: t('trade_docs.documents.form.lines.quantity', '数量'),
      enableSorting: false,
      meta: { priority: 6 },
      cell: ({ row }) => <span className="tabular-nums">{row.original.quantity}</span>,
    },
    {
      accessorKey: 'unitPrice',
      header: t('trade_docs.documents.form.lines.unitPrice', '单价'),
      enableSorting: false,
      meta: { priority: 7 },
      cell: ({ row }) => <span className="tabular-nums">{row.original.unitPrice}</span>,
    },
    {
      accessorKey: 'amount',
      header: t('trade_docs.documents.form.lines.amount', '金额'),
      enableSorting: false,
      meta: { priority: 8 },
      cell: ({ row }) => <MoneyAmount currencyCode={currencyCode} amount={row.original.amount} />,
    },
    {
      id: 'source',
      header: t('trade_docs.documents.detail.columns.source', '来源'),
      enableSorting: false,
      meta: { priority: 9 },
      cell: ({ row }) => {
        const snapshot = row.original.sourceSnapshot
        return snapshotTextValue(snapshot, 'kind') === 'order_line'
          ? t('trade_docs.documents.detail.sourceLine.orderLine', '订单行')
          : <span className="text-xs text-muted-foreground">—</span>
      },
    },
  ]
}

/**
 * A server refusal (missing feature) is reported as the module's own "no access" copy instead of
 * the raw HTTP text; `raiseCrudError` attaches the status to the thrown error.
 */
function isHttpStatusError(error: unknown, status: number): boolean {
  if (!error || typeof error !== 'object' || !('status' in error)) return false
  return typeof error.status === 'number' && error.status === status
}

/**
 * How a document's copy destination names its source family: a CI copies a PI, a tax invoice copies
 * a CI. Kept as the two document families rather than a free string so a typo can't point the
 * picker at the wrong route.
 */
export type DocumentCopySourceKind = 'proforma' | 'commercial'

export type DocumentCopyFromDialogProps = {
  open: boolean
  sourceKind: DocumentCopySourceKind
  title: string
  description: string
  searchPlaceholder: string
  confirmLabel: string
  onOpenChange: (open: boolean) => void
  onSubmit: (sourceDocumentId: string) => Promise<void>
}

/**
 * The one-shot "从上一张单据复制" picker shared by the CI and tax-invoice detail screens. It searches
 * the source family's own list route (`loadDocumentOptions`), shows `number ?? draft` + counterparty,
 * and confirms the pick with a deliberate second action — never on the row click — because a copy
 * replaces the target's lines. Cmd/Ctrl+Enter confirms the selected row and Escape closes, the same
 * gestures every dialog in this app supports, and every trigger is disabled while the copy is in
 * flight. A failed copy keeps the dialog open so the commit can be retried without re-picking.
 */
export function DocumentCopyFromDialog({
  open,
  sourceKind,
  title,
  description,
  searchPlaceholder,
  confirmLabel,
  onOpenChange,
  onSubmit,
}: DocumentCopyFromDialogProps) {
  const t = useT()
  const [search, setSearch] = React.useState('')
  const [selectedId, setSelectedId] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)

  // A fresh open must not inherit the previous query or pick.
  React.useEffect(() => {
    if (open) {
      setSearch('')
      setSelectedId('')
    }
  }, [open])

  const optionsQuery = useQuery({
    queryKey: ['trade-docs-copy-options', sourceKind, search.trim()],
    enabled: open,
    queryFn: () => loadDocumentOptions(sourceKind, search),
  })
  const options = optionsQuery.data ?? []

  const draftLabel = t('trade_docs.documents.detail.copy.draft', '（草稿）')
  const optionLabel = React.useCallback(
    (option: DocumentOption) => {
      const number = option.number && option.number.trim().length > 0 ? option.number : draftLabel
      return option.counterpartyName ? `${number} — ${option.counterpartyName}` : number
    },
    [draftLabel],
  )

  const submit = React.useCallback(async () => {
    if (submitting || !selectedId) return
    setSubmitting(true)
    try {
      await onSubmit(selectedId)
      onOpenChange(false)
    } catch {
      // The caller already surfaced the failure; keep the dialog open for a retry.
    } finally {
      setSubmitting(false)
    }
  }, [onOpenChange, onSubmit, selectedId, submitting])

  const handleKeyDown = useDialogKeyHandler({
    onConfirm: () => void submit(),
    onCancel: () => onOpenChange(false),
    disabled: submitting,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={searchPlaceholder}
          leftIcon={<Search className="size-4" />}
          aria-label={searchPlaceholder}
        />
        <div className="max-h-72 overflow-y-auto rounded-md border">
          {optionsQuery.isLoading ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t('ui.dataTable.loading', '正在加载表格…')}
            </p>
          ) : optionsQuery.error ? (
            <p className="px-3 py-6 text-center text-sm text-destructive">
              {t('trade_docs.documents.detail.copy.loadFailed', '加载可复制的单据失败')}
            </p>
          ) : options.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t('trade_docs.documents.detail.copy.empty', '没有找到可复制的单据。')}
            </p>
          ) : (
            <ul className="divide-y">
              {options.map((option) => (
                <li key={option.value}>
                  <button
                    type="button"
                    className={
                      option.value === selectedId
                        ? 'flex w-full items-center gap-3 bg-muted px-3 py-2 text-left text-sm focus-visible:outline-none'
                        : 'flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none'
                    }
                    aria-pressed={option.value === selectedId}
                    disabled={submitting}
                    onClick={() => setSelectedId(option.value)}
                  >
                    <span className="truncate">{optionLabel(option)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            {t('ui.forms.actions.cancel', '取消')}
          </Button>
          <Button type="button" disabled={submitting || !selectedId} onClick={() => void submit()}>
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

type DocumentFileSectionProps = {
  documentId: string
  attachmentId: string | null
  onChanged: () => Promise<void>
}

/**
 * Upload-then-bind, exactly like the contract scan: the file is uploaded against the platform's
 * attachment route, and only then is the pointer recorded through `trade_docs/documents/attach`. A
 * failed upload never loses the previously bound file, and the section keeps offering a retry.
 */
function DocumentFileSection({ documentId, attachmentId, onChanged }: DocumentFileSectionProps) {
  const t = useT()
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const [isUploading, setIsUploading] = React.useState(false)
  const [isRemoving, setIsRemoving] = React.useState(false)

  const flashFailure = React.useCallback(
    (error: unknown, fallbackKey: string, fallback: string) => {
      if (isHttpStatusError(error, 403)) {
        flash(t('trade_docs.common.notAuthorized', '你没有访问该功能的权限，请联系管理员开通。'), 'error')
        return
      }
      flash(error instanceof Error && error.message ? error.message : t(fallbackKey, fallback), 'error')
    },
    [t],
  )

  const handleFile = React.useCallback(
    async (files: FileList | null) => {
      const file = files?.[0]
      if (inputRef.current) inputRef.current.value = ''
      if (!file) return
      setIsUploading(true)
      try {
        const body = new FormData()
        body.set('entityId', ATTACHMENT_ENTITY_ID)
        body.set('recordId', documentId)
        body.set('file', file)
        const upload = await apiCall<{ item?: { id?: string }; error?: string }>(
          '/api/attachments',
          { method: 'POST', body },
          { fallback: null },
        )
        const uploadedId = upload.ok && typeof upload.result?.item?.id === 'string' ? upload.result.item.id : ''
        if (!uploadedId) {
          flash(upload.result?.error || t('trade_docs.documents.attach.failed', '上传失败，可重试'), 'error')
          return
        }
        try {
          await updateCrud(
            DOCUMENT_ATTACH_API_PATH,
            { id: documentId, attachmentId: uploadedId },
            { errorMessage: t('trade_docs.documents.attach.bindFailed', '绑定替换件失败') },
          )
          flash(t('trade_docs.documents.attach.uploaded', '替换件已上传'), 'success')
          await onChanged()
        } catch (bindError) {
          flashFailure(bindError, 'trade_docs.documents.attach.bindFailed', '绑定替换件失败')
        }
      } catch {
        flash(t('trade_docs.documents.attach.failed', '上传失败，可重试'), 'error')
      } finally {
        setIsUploading(false)
      }
    },
    [documentId, flashFailure, onChanged, t],
  )

  const handleRemove = React.useCallback(async () => {
    setIsRemoving(true)
    try {
      await updateCrud(
        DOCUMENT_ATTACH_API_PATH,
        { id: documentId, attachmentId: null },
        { errorMessage: t('trade_docs.documents.attach.removeFailed', '移除替换件失败') },
      )
      flash(t('trade_docs.documents.attach.removed', '替换件已移除'), 'success')
      await onChanged()
    } catch (removeError) {
      flashFailure(removeError, 'trade_docs.documents.attach.removeFailed', '移除替换件失败')
    } finally {
      setIsRemoving(false)
    }
  }, [documentId, flashFailure, onChanged, t])

  return (
    <section className="space-y-3">
      <SectionHeader title={t('trade_docs.documents.detail.attach.title', '上传替换件')} />
      <p className="text-xs text-muted-foreground">
        {t('trade_docs.documents.attach.hint', '对方回签/盖章或报关后的替代文件；与系统生成的文件相互独立，重新生成不会覆盖它。')}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={isUploading || isRemoving}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="size-4" aria-hidden="true" />
          {attachmentId
            ? t('trade_docs.documents.attach.retry', '重新上传')
            : t('trade_docs.documents.attach.upload', '上传替换件')}
        </Button>
        {attachmentId ? (
          <>
            <AttachmentPreviewLink attachmentId={attachmentId} label={t('trade_docs.documents.attach.preview', '预览')} />
            <a
              className="text-sm font-medium hover:underline"
              href={`/api/attachments/file/${encodeURIComponent(attachmentId)}?download=1`}
              target="_blank"
              rel="noreferrer"
            >
              {t('trade_docs.documents.attach.download', '下载')}
            </a>
            <Button
              type="button"
              variant="outline"
              disabled={isUploading || isRemoving}
              onClick={() => void handleRemove()}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              {t('trade_docs.documents.attach.remove', '移除')}
            </Button>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">
            {t('trade_docs.documents.attach.empty', '还没有上传替换件。')}
          </span>
        )}
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(event) => void handleFile(event.target.files)}
        />
      </div>
    </section>
  )
}

export default function DocumentDetail({ kind, documentId }: { kind: DocumentKind; documentId: string }) {
  const t = useT()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const listHref = documentListHref(kind)
  const [isMutating, setIsMutating] = React.useState(false)
  const [isGenerating, setIsGenerating] = React.useState(false)
  const [isDownloading, setIsDownloading] = React.useState(false)
  const [isAggregating, setIsAggregating] = React.useState(false)
  const [copyOpen, setCopyOpen] = React.useState(false)

  const headQuery = useQuery({
    queryKey: ['trade-docs-document', documentId],
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>(DOCUMENTS_API_PATH, {
        ids: documentId,
        pageSize: 1,
      })
      const item = payload.items?.[0]
      return item ? toHead(item) : null
    },
  })

  const linesQuery = useQuery({
    queryKey: ['trade-docs-document-lines', documentId],
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>(DOCUMENT_LINES_API_PATH, {
        documentId,
        pageSize: 100,
      })
      return (payload.items ?? []).map(toLine)
    },
  })

  const head = headQuery.data ?? null
  const lines = linesQuery.data ?? []
  const columns = React.useMemo(
    () => buildLineColumns(t, head?.currencyCode ?? 'CNY'),
    [head?.currencyCode, t],
  )

  const runTransition = React.useCallback(
    async (action: 'issue' | 'void', reason?: string) => {
      setIsMutating(true)
      try {
        await apiCallOrThrow(
          DOCUMENT_TRANSITIONS_URL,
          {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: documentId, action, ...(reason ? { reason } : {}) }),
          },
          { errorMessage: t('trade_docs.documents.transitions.failed', '状态变更失败') },
        )
        await queryClient.invalidateQueries({ queryKey: ['trade-docs-document', documentId] })
        await queryClient.invalidateQueries({ queryKey: ['trade-docs-documents'] })
        await queryClient.invalidateQueries({ queryKey: ['trade-docs-document-lines', documentId] })
      } catch (error) {
        flash(
          error instanceof Error && error.message
            ? error.message
            : t('trade_docs.documents.transitions.failed', '状态变更失败'),
          'error',
        )
      } finally {
        setIsMutating(false)
      }
    },
    [documentId, queryClient, t],
  )

  /** Renders the document on the server and refreshes the head so the download button appears. */
  const handleGenerate = React.useCallback(async () => {
    setIsGenerating(true)
    try {
      await apiCallOrThrow(
        `${DOCUMENT_FILE_API_PATH}/${encodeURIComponent(documentId)}/generate`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        },
        { errorMessage: t('trade_docs.documents.detail.file.failed', '生成单据失败') },
      )
      flash(t('trade_docs.documents.detail.file.generated', '单据文件已生成'), 'success')
      await queryClient.invalidateQueries({ queryKey: ['trade-docs-document', documentId] })
    } catch (error) {
      flash(
        error instanceof Error && error.message
          ? error.message
          : t('trade_docs.documents.detail.file.failed', '生成单据失败'),
        'error',
      )
    } finally {
      setIsGenerating(false)
    }
  }, [documentId, queryClient, t])

  const handleDownload = React.useCallback(async () => {
    setIsDownloading(true)
    try {
      await downloadApiFile({
        url: `${DOCUMENT_FILE_API_PATH}/${encodeURIComponent(documentId)}/document`,
        expectedContentType: XLSX_CONTENT_TYPE,
        fallbackName: `${head?.number ?? 'document'}.xlsx`,
        errorMessage: t('trade_docs.documents.detail.file.notReady', '该单据还没有生成文件，请先点“生成单据”。'),
      })
    } catch (error) {
      flash(
        error instanceof Error && error.message
          ? error.message
          : t('trade_docs.documents.detail.file.notReady', '该单据还没有生成文件，请先点“生成单据”。'),
        'error',
      )
    } finally {
      setIsDownloading(false)
    }
  }, [documentId, head?.number, t])

  /**
   * One-shot roll-up of the shipment's allocations into this draft's lines. Confirmed first because
   * it replaces every line; the command refuses an issued document, and nothing here subscribes to
   * later shipment changes.
   */
  const handleAggregate = React.useCallback(async () => {
    const confirmed = await confirm({
      title: t('trade_docs.documents.detail.aggregate.confirmTitle', '从发运单汇总明细？'),
      description: t('trade_docs.documents.detail.aggregate.confirmBody', '会用发运单的分摊行替换当前明细；发运单之后再改不会自动同步。'),
      confirmText: t('trade_docs.documents.detail.aggregate.action', '从发运单汇总'),
    })
    if (!confirmed) return
    setIsAggregating(true)
    try {
      await apiCallOrThrow<{ ok: true; lineCount: number }>(
        `${DOCUMENT_FILE_API_PATH}/${encodeURIComponent(documentId)}/aggregate-lines`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(head?.sourceId ? { sourceId: head.sourceId } : {}),
        },
        { errorMessage: t('trade_docs.documents.detail.aggregate.failed', '从发运单汇总失败') },
      )
      flash(
        t('trade_docs.documents.detail.aggregate.success', '已从发运单汇总明细'),
        'success',
      )
      await queryClient.invalidateQueries({ queryKey: ['trade-docs-document', documentId] })
      await queryClient.invalidateQueries({ queryKey: ['trade-docs-document-lines', documentId] })
      await queryClient.invalidateQueries({ queryKey: ['trade-docs-documents'] })
    } catch (error) {
      flash(
        error instanceof Error && error.message
          ? error.message
          : t('trade_docs.documents.detail.aggregate.failed', '从发运单汇总失败'),
        'error',
      )
    } finally {
      setIsAggregating(false)
    }
  }, [confirm, documentId, head?.sourceId, queryClient, t])

  /**
   * One-shot copy of another document's head + lines into this draft CI — the "从形式发票复制"
   * flow. The command replaces the target's lines and freezes a link back; nothing syncs afterwards,
   * so the detail is simply refreshed and a second run replaces the lines again (no duplicates).
   */
  const handleCopyFrom = React.useCallback(
    async (sourceDocumentId: string) => {
      try {
        await apiCallOrThrow<{ ok: true; lineCount: number }>(
          `${DOCUMENT_FILE_API_PATH}/${encodeURIComponent(documentId)}/copy-from`,
          {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sourceDocumentId }),
          },
          { errorMessage: t('trade_docs.documents.detail.copy.failed', '复制失败') },
        )
        flash(t('trade_docs.documents.detail.copy.success', '已复制来源单据的抬头与明细'), 'success')
        await queryClient.invalidateQueries({ queryKey: ['trade-docs-document', documentId] })
        await queryClient.invalidateQueries({ queryKey: ['trade-docs-document-lines', documentId] })
        await queryClient.invalidateQueries({ queryKey: ['trade-docs-documents'] })
      } catch (error) {
        flash(
          error instanceof Error && error.message
            ? error.message
            : t('trade_docs.documents.detail.copy.failed', '复制失败'),
          'error',
        )
        throw error
      }
    },
    [documentId, queryClient, t],
  )

  const handleAction = React.useCallback(
    async (action: 'issue' | 'void') => {
      if (action === 'issue') {
        const confirmed = await confirm({
          title: t('trade_docs.documents.transitions.issue', '签发'),
          description: t('trade_docs.documents.transitions.issueConfirmBody', '签发后分配单据号并冻结明细，之后只能作废。'),
          confirmText: t('trade_docs.documents.transitions.issue', '签发'),
        })
        if (!confirmed) return
        await runTransition('issue')
        return
      }
      const confirmed = await confirm({
        title: t('trade_docs.documents.transitions.voidConfirmTitle', '确认作废该单据？'),
        description: t('trade_docs.documents.transitions.voidConfirmBody', '单据会保留记录，但不能再编辑或使用。'),
        confirmText: t('trade_docs.documents.transitions.void', '作废'),
        variant: 'destructive',
      })
      if (!confirmed) return
      await runTransition('void')
    },
    [confirm, runTransition, t],
  )

  if (headQuery.isLoading) return <LoadingMessage label={t('trade_docs.common.loading', '加载中…')} />
  if (headQuery.error) {
    const status = (headQuery.error as { status?: number }).status
    if (status === 404) {
      return <RecordNotFoundState label={t('trade_docs.documents.form.notFound', '未找到该单据，或你没有访问权限。')} backHref={listHref} />
    }
    return <ErrorMessage label={t('trade_docs.documents.form.loadFailed', '单据加载失败')} />
  }
  if (!head) {
    return <RecordNotFoundState label={t('trade_docs.documents.form.notFound', '未找到该单据，或你没有访问权限。')} backHref={listHref} />
  }

  const actions = ALLOWED_ACTIONS[head.status]

  // A trade-document source is linked by its frozen family + number; when the number is absent (the
  // source is still a draft) the snapshot's family label stands in, and a snapshot without a known
  // family (legacy/manual) degrades to the plain snapshot text.
  const sourceNumber = snapshotTextValue(head.sourceSnapshot, 'number')
  const sourceDocumentKind = head.sourceKind === 'trade_document' ? readSourceDocumentKind(head.sourceSnapshot) : null
  const sourceHref =
    sourceDocumentKind && head.sourceId
      ? `${documentListHref(sourceDocumentKind)}/${encodeURIComponent(head.sourceId)}`
      : null
  const sourceLabel = sourceDocumentKind
    ? [documentKindLabel(t, sourceDocumentKind), sourceNumber].filter(Boolean).join(' ')
    : (sourceNumber ?? '—')

  return (
    <div className="space-y-6">
      <FormHeader
        mode="detail"
        backHref={listHref}
        entityTypeLabel={documentKindLabel(t, kind)}
        title={head.number ?? documentStatusLabel(t, head.status)}
        statusBadge={(
          <StatusBadge variant={STATUS_VARIANT[head.status]} dot>
            {documentStatusLabel(t, head.status)}
          </StatusBadge>
        )}
        actionsContent={(
          <div className="flex flex-wrap items-center gap-2">
            {actions.map((action) => (
              <Button
                key={action}
                type="button"
                variant={action === 'void' ? 'outline' : 'default'}
                disabled={isMutating}
                onClick={() => void handleAction(action)}
              >
                {t(`trade_docs.documents.transitions.${action}`, action === 'issue' ? '签发' : '作废')}
              </Button>
            ))}
            {head.status === 'draft' ? (
              <Button asChild variant="outline">
                <Link href={`${listHref}/${head.id}/edit`}>{t('trade_docs.documents.actions.edit', '编辑')}</Link>
              </Button>
            ) : null}
            {kind === 'commercial' && head.status === 'draft' && head.sourceKind === 'shipment' && head.sourceId ? (
              <Button type="button" variant="outline" disabled={isAggregating} onClick={() => void handleAggregate()}>
                {t('trade_docs.documents.detail.aggregate.action', '从发运单汇总')}
              </Button>
            ) : null}
            {kind === 'commercial' && head.status === 'draft' ? (
              <Button type="button" variant="outline" onClick={() => setCopyOpen(true)}>
                {t('trade_docs.documents.detail.copy.action', '从形式发票复制')}
              </Button>
            ) : null}
          </div>
        )}
      />

      <section className="space-y-3">
        <SectionHeader title={t('trade_docs.documents.detail.head.title', '单据信息')} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SummaryField label={t('trade_docs.documents.form.field.direction', '方向')}>
            {documentDirectionLabel(t, head.direction)}
          </SummaryField>
          <SummaryField label={t('trade_docs.documents.list.columns.counterparty', '对方')}>
            {head.counterpartyName ?? snapshotTextValue(head.counterpartySnapshot, 'name') ?? '—'}
          </SummaryField>
          <SummaryField label={t('trade_docs.documents.form.field.currencyCode', '币种')}>{head.currencyCode}</SummaryField>
          <SummaryField label={t('trade_docs.documents.form.field.exchangeRate', '汇率（快照）')}>
            {head.exchangeRate ?? '—'}
          </SummaryField>
          <SummaryField label={t('trade_docs.documents.list.columns.issuedAt', '签发日')}>{head.issuedAt ?? '—'}</SummaryField>
          <SummaryField label={t('trade_docs.documents.list.columns.total', '合计')}>
            <MoneyAmount currencyCode={head.currencyCode} amount={head.total} className="text-lg font-semibold" />
          </SummaryField>
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeader title={t('trade_docs.documents.detail.terms.title', '条款')} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SummaryField label={t('trade_docs.documents.form.field.paymentTerms', '付款方式')}>
            {head.paymentTerms ?? '—'}
          </SummaryField>
          <SummaryField label={t('trade_docs.documents.form.field.incoterms', '贸易术语')}>
            {head.incoterms ?? '—'}
          </SummaryField>
          <SummaryField label={t('trade_docs.documents.form.field.validUntil', '有效期')}>
            {head.validUntil ?? '—'}
          </SummaryField>
          <SummaryField label={t('trade_docs.documents.form.field.deliveryDate', '交期')}>
            {head.deliveryDate ?? '—'}
          </SummaryField>
          <SummaryField label={t('trade_docs.documents.form.field.notes', '备注')}>{head.notes ?? '—'}</SummaryField>
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeader title={t('trade_docs.documents.detail.party.title', '对方与我方')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1 rounded-lg border border-border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('trade_docs.documents.detail.counterparty', '对方')}
            </p>
            <p className="text-sm">{snapshotTextValue(head.counterpartySnapshot, 'name') ?? head.counterpartyName ?? '—'}</p>
            <p className="text-sm text-muted-foreground">{snapshotTextValue(head.counterpartySnapshot, 'address') ?? ''}</p>
            <p className="text-sm text-muted-foreground">{snapshotTextValue(head.counterpartySnapshot, 'contact') ?? ''}</p>
            <p className="text-sm text-muted-foreground">{snapshotTextValue(head.counterpartySnapshot, 'bank') ?? ''}</p>
          </div>
          <div className="space-y-1 rounded-lg border border-border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('trade_docs.documents.detail.ourParty', '我方主体')}
            </p>
            <p className="text-sm">{snapshotTextValue(head.ourPartySnapshot, 'name') ?? '—'}</p>
            <p className="text-sm text-muted-foreground">{snapshotTextValue(head.ourPartySnapshot, 'address') ?? ''}</p>
            <p className="text-sm text-muted-foreground">{snapshotTextValue(head.ourPartySnapshot, 'contact') ?? ''}</p>
            <p className="text-sm text-muted-foreground">{snapshotTextValue(head.ourPartySnapshot, 'bank') ?? ''}</p>
          </div>
          {kind === 'commercial' ? (
            <>
              <div className="space-y-1 rounded-lg border border-border p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('trade_docs.documents.detail.consignee', '收货人')}
                </p>
                <p className="text-sm">{snapshotTextValue(head.consigneeSnapshot, 'name') ?? '—'}</p>
                <p className="text-sm text-muted-foreground">{snapshotTextValue(head.consigneeSnapshot, 'address') ?? ''}</p>
              </div>
              <div className="space-y-1 rounded-lg border border-border p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('trade_docs.documents.detail.notifyParty', '通知方')}
                </p>
                <p className="text-sm">{snapshotTextValue(head.notifyPartySnapshot, 'name') ?? '—'}</p>
                <p className="text-sm text-muted-foreground">{snapshotTextValue(head.notifyPartySnapshot, 'address') ?? ''}</p>
              </div>
            </>
          ) : null}
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeader title={t('trade_docs.documents.detail.lines.title', '单据明细')} />
        <DataTable<DocumentLineRecord>
          columns={columns}
          data={lines}
          emptyState={<EmptyState title={t('trade_docs.documents.form.lines.empty', '还没有明细。添加一行或从订单复制行。')} />}
          isLoading={linesQuery.isLoading}
          error={linesQuery.error ? t('trade_docs.documents.form.loadFailed', '单据加载失败') : null}
        />
      </section>

      <section className="space-y-3">
        <SectionHeader title={t('trade_docs.documents.detail.source.title', '来源单据')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SummaryField label={t('trade_docs.documents.form.field.sourceKind', '来源单据')}>
            {documentSourceKindLabel(t, head.sourceKind)}
          </SummaryField>
          <SummaryField label={t('trade_docs.documents.form.field.sourceId', '来源单号')}>
            {sourceHref ? (
              <Link className="hover:underline" href={sourceHref}>
                {sourceLabel}
              </Link>
            ) : (
              sourceLabel
            )}
          </SummaryField>
          <SummaryField label={t('trade_docs.documents.detail.source.counterparty', '来源对方')}>
            {snapshotTextValue(head.sourceSnapshot, 'counterparty') ?? '—'}
          </SummaryField>
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeader title={t('trade_docs.documents.detail.file.title', '单据文件')} />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={isGenerating || head.status !== 'issued'}
            onClick={() => void handleGenerate()}
          >
            {t('trade_docs.documents.detail.file.generate', '生成单据')}
          </Button>
          {head.generatedAttachmentId ? (
            <Button type="button" variant="outline" disabled={isDownloading} onClick={() => void handleDownload()}>
              {t('trade_docs.documents.detail.file.download', '下载')}
            </Button>
          ) : (
            <span className="text-sm text-muted-foreground">
              {t('trade_docs.documents.detail.file.none', '还没有生成单据文件。')}
            </span>
          )}
        </div>
      </section>

      <DocumentFileSection
        documentId={head.id}
        attachmentId={head.attachmentId}
        onChanged={async () => {
          await queryClient.invalidateQueries({ queryKey: ['trade-docs-document', documentId] })
          await queryClient.invalidateQueries({ queryKey: ['trade-docs-documents'] })
        }}
      />

      <DocumentCopyFromDialog
        open={copyOpen}
        sourceKind="proforma"
        title={t('trade_docs.documents.detail.copy.title', '从形式发票复制')}
        description={t(
          'trade_docs.documents.detail.copy.description',
          '一次性把所选形式发票的抬头与明细复制到本单据；复制后两张单据各自独立，之后互不同步。',
        )}
        searchPlaceholder={t('trade_docs.documents.detail.copy.searchPlaceholder', '按编号搜索形式发票')}
        confirmLabel={t('trade_docs.documents.detail.copy.confirm', '复制')}
        onOpenChange={setCopyOpen}
        onSubmit={handleCopyFrom}
      />

      {ConfirmDialogElement}
    </div>
  )
}
