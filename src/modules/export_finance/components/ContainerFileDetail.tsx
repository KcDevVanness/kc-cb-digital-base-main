"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Upload } from 'lucide-react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { parseExactDecimal } from '@open-mercato/core/modules/dashboards/lib/exactDecimal'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import {
  CrudForm,
  type CrudCustomFieldRenderProps,
  type CrudField,
  type CrudFormGroup,
} from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, deleteCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
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
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { formatDisplayDate, toUtcDateInputValue } from '@open-mercato/ui/primitives/date-format'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useLocale, useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { quantizeExactDecimal, subtractExactDecimal, toAmountString } from '../../trade_docs/lib/money'
import type { ShipmentStatus } from '../../cross_border/data/validators'
import { REFUND_DOC_TYPES, type ExportFinanceTaxRefundStatus } from '../data/validators'
import {
  CONTAINER_EXPORT_CHECKLIST_KEYS,
  sumAllocationShares,
  type ContainerChecklistKey,
  type ContainerFileRow,
  type ContainerOrderRow,
} from '../lib/fileRules'
import {
  CONTAINER_CHECKLIST_LABEL_KEYS,
  REFUND_STATUS_LABEL_KEYS,
  REFUND_STATUS_OPTIONS,
  SHIPMENT_MILESTONE_LABEL_KEYS,
  SHIPMENT_STATUS_LABEL_KEYS,
} from './labels'

/**
 * 柜档案 detail — one container: the container facts, the 出口退税 record it is filed under, the
 * orders inside it with their allocated share of that refund, the refund-application files, and the
 * read-only view of the export documents that live on the shipment.
 *
 * The refund amount is filed **once per container** and never stored per order: the shares below are
 * the read-time projection, so the reconciliation row is a check on the data, not on this page.
 */

const API_PATH = 'export_finance/container-files'
const REFUND_API_PATH = 'export_finance/refunds'
const REFUND_DOCUMENTS_API_PATH = 'export_finance/refund-documents'
const REFUND_ATTACHMENT_ENTITY_ID = 'export_finance:export_finance_refund'
const CONTAINERS_LIST_HREF = '/backend/export-finance/containers'
const ORDERS_LIST_HREF = '/backend/export-finance/orders'
const SHIPMENTS_LIST_HREF = '/backend/cross_border/shipments'
const DOCUMENT_PAGE_SIZE = 100
const EMPTY_CELL = '—'

/** The entity default, used until a refund record carries a currency of its own. */
const DEFAULT_CURRENCY_CODE = 'CNY'

const SHIPMENT_STATUS_VARIANTS: StatusMap<ShipmentStatus> = {
  draft: 'neutral',
  in_transit: 'info',
  received: 'success',
  cancelled: 'error',
}

const REFUND_STATUS_VARIANTS: StatusMap<ExportFinanceTaxRefundStatus> = {
  completed: 'success',
  applied: 'info',
  not_started: 'warning',
  unknown: 'neutral',
}

type RefundRecord = {
  id: string
  shipmentId: string
  shipmentNumber: string | null
  currencyCode: string
  taxRefundStatus: ExportFinanceTaxRefundStatus
  taxRefundAmount: string | null
  taxRefundNote: string | null
  updatedAt: string | null
}

type RefundDocumentRecord = {
  id: string
  refundId: string
  docType: string
  issuedAt: string | null
  attachmentId: string | null
  note: string | null
}

type RefundDocumentFormValues = {
  docType: string
  issuedAt: string
  attachmentId: string
  note: string
}

type RefundFormValues = {
  status: ExportFinanceTaxRefundStatus
  amount: string
  note: string
}

type ChecklistRow = {
  key: ContainerChecklistKey
  hit: boolean
}

function EmptyCell() {
  return <span className="text-xs text-muted-foreground">{EMPTY_CELL}</span>
}

function SummaryField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  )
}

function errorMessageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function errorStatusOf(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' ? status : null
}

function readOptionalText(item: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = item[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

function toRefundRecord(item: Record<string, unknown>): RefundRecord {
  const status = readOptionalText(item, 'taxRefundStatus', 'tax_refund_status') ?? 'unknown'
  return {
    id: String(item.id ?? ''),
    shipmentId: readOptionalText(item, 'shipmentId', 'shipment_id') ?? '',
    shipmentNumber: readOptionalText(item, 'shipmentNumber', 'shipment_number'),
    currencyCode: readOptionalText(item, 'currencyCode', 'currency_code') ?? DEFAULT_CURRENCY_CODE,
    taxRefundStatus: (REFUND_STATUS_LABEL_KEYS as Record<string, string>)[status]
      ? (status as ExportFinanceTaxRefundStatus)
      : 'unknown',
    taxRefundAmount: readOptionalText(item, 'taxRefundAmount', 'tax_refund_amount'),
    taxRefundNote: readOptionalText(item, 'taxRefundNote', 'tax_refund_note'),
    updatedAt: readOptionalText(item, 'updatedAt', 'updated_at'),
  }
}

function toRefundDocumentRecord(item: Record<string, unknown>): RefundDocumentRecord {
  const docType = readOptionalText(item, 'docType', 'doc_type') ?? 'other'
  return {
    id: String(item.id ?? ''),
    refundId: readOptionalText(item, 'refundId', 'refund_id') ?? '',
    docType,
    issuedAt: readOptionalText(item, 'issuedAt', 'issued_at'),
    attachmentId: readOptionalText(item, 'attachmentId', 'attachment_id'),
    note: readOptionalText(item, 'note'),
  }
}

function shipmentStatusLabel(t: TranslateFn, status: string): string {
  const key = SHIPMENT_STATUS_LABEL_KEYS[status as ShipmentStatus]
  return key ? t(key) : status
}

function refundStatusLabel(t: TranslateFn, status: string): string {
  const key = REFUND_STATUS_LABEL_KEYS[status as ExportFinanceTaxRefundStatus]
  return key ? t(key) : status
}

function milestoneLabel(t: TranslateFn, milestone: string | null): string | null {
  if (!milestone) return null
  const key = SHIPMENT_MILESTONE_LABEL_KEYS[milestone as keyof typeof SHIPMENT_MILESTONE_LABEL_KEYS]
  return key ? t(key) : milestone
}

function refundDocumentTypeLabel(t: TranslateFn, docType: string): string {
  return t(`export_finance.cabinets.detail.documents.docType.${docType}`, docType)
}

/** The two decimals this business reads, through the module's money engine — never a float. */
function formatAmount(value: string | null): string | null {
  if (!value) return null
  return sumAllocationShares([value])
}

/**
 * `container − allocated`, or `null` when they reconcile (and when either side is unknown).
 * Both sides are already quantized amounts, so this is exact subtraction at two decimals.
 */
function differenceOf(containerAmount: string, allocatedTotal: string): string | null {
  const container = parseExactDecimal(containerAmount)
  const allocated = parseExactDecimal(allocatedTotal)
  if (!container || !allocated) return null
  const difference = quantizeExactDecimal(subtractExactDecimal(container, allocated), 2)
  return difference.units === 0n ? null : toAmountString(difference, 2)
}

function toOptionalText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function buildRefundDocumentPayload(values: RefundDocumentFormValues): Record<string, unknown> {
  const docType = REFUND_DOC_TYPES.includes(values.docType as (typeof REFUND_DOC_TYPES)[number])
    ? values.docType
    : 'other'
  return {
    docType,
    issuedAt: toOptionalText(values.issuedAt),
    attachmentId: toOptionalText(values.attachmentId),
    note: toOptionalText(values.note),
  }
}

/**
 * The upload control for one refund file. It talks to the shared attachments endpoint (multipart)
 * and hands the returned id back to the form — the document command stores that id, never a byte.
 */
function RefundDocumentAttachmentField({
  value,
  setValue,
  disabled,
  refundId,
}: CrudCustomFieldRenderProps & { refundId: string }) {
  const t = useT()
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const [fileName, setFileName] = React.useState<string | null>(null)
  const [isUploading, setIsUploading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const attachmentId = typeof value === 'string' ? value : ''

  const acceptFile = React.useCallback(async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setError(null)
    setIsUploading(true)
    try {
      const body = new FormData()
      body.set('entityId', REFUND_ATTACHMENT_ENTITY_ID)
      body.set('recordId', refundId)
      body.set('file', file)
      const call = await apiCall<{ item?: { id?: string }; error?: string }>(
        '/api/attachments',
        { method: 'POST', body },
        { fallback: null },
      )
      const uploadedId = call.ok && typeof call.result?.item?.id === 'string' ? call.result.item.id : ''
      if (!uploadedId) {
        throw new Error(call.result?.error || t('export_finance.cabinets.detail.documents.uploadFailed'))
      }
      setValue(uploadedId)
      setFileName(file.name)
    } catch (cause) {
      setError(errorMessageOf(cause, t('export_finance.cabinets.detail.documents.uploadFailed')))
    } finally {
      setIsUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }, [refundId, setValue, t])

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={disabled || isUploading}
          onClick={() => inputRef.current?.click()}
        >
          {isUploading
            ? <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            : <Upload className="size-4" aria-hidden="true" />}
          {t('export_finance.cabinets.detail.documents.field.attachmentId')}
        </Button>
        {attachmentId ? (
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              setValue('')
              setFileName(null)
            }}
          >
            {t('export_finance.cabinets.detail.documents.delete')}
          </Button>
        ) : null}
      </div>
      {fileName ? <p className="text-xs text-muted-foreground">{fileName}</p> : null}
      {error ? <p className="text-xs font-medium text-status-error-text" role="alert">{error}</p> : null}
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(event) => { void acceptFile(event.target.files) }}
      />
    </div>
  )
}

function RefundDocumentsSection({
  refundId,
  documents,
  readOnly,
  loadFailed,
  onChanged,
  onForbidden,
}: {
  refundId: string
  documents: RefundDocumentRecord[]
  readOnly: boolean
  loadFailed: boolean
  onChanged: () => Promise<void>
  onForbidden: () => void
}) {
  const t = useT()
  const locale = useLocale()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [dialogMode, setDialogMode] = React.useState<'create' | 'edit' | null>(null)
  const [editing, setEditing] = React.useState<RefundDocumentRecord | null>(null)
  const dialogContentRef = React.useRef<HTMLDivElement | null>(null)

  const mutationContextId = React.useMemo(() => `export_finance.refund-document:${refundId}`, [refundId])
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId?: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: mutationContextId })

  const mutationContext = React.useMemo(() => ({
    formId: mutationContextId,
    resourceKind: 'export_finance.refund_document',
    resourceId: refundId,
    retryLastMutation,
  }), [mutationContextId, refundId, retryLastMutation])

  // The type is deliberately not pre-filled: guessing the paperwork an operator is filing would
  // record the wrong type silently, and the select is required besides.
  const initialValues = React.useMemo<RefundDocumentFormValues>(() => {
    if (dialogMode === 'edit' && editing) {
      return {
        docType: editing.docType,
        issuedAt: toUtcDateInputValue(editing.issuedAt) ?? '',
        attachmentId: editing.attachmentId ?? '',
        note: editing.note ?? '',
      }
    }
    return { docType: '', issuedAt: '', attachmentId: '', note: '' }
  }, [dialogMode, editing])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'docType',
      label: t('export_finance.cabinets.detail.documents.field.docType'),
      type: 'select',
      required: true,
      options: REFUND_DOC_TYPES.map((value) => ({ value, label: refundDocumentTypeLabel(t, value) })),
    },
    {
      id: 'issuedAt',
      label: t('export_finance.cabinets.detail.documents.field.issuedAt'),
      type: 'date',
    },
    {
      id: 'attachmentId',
      label: t('export_finance.cabinets.detail.documents.field.attachmentId'),
      type: 'custom',
      rendersOwnError: true,
      component: (props) => <RefundDocumentAttachmentField {...props} refundId={refundId} />,
    },
    {
      id: 'note',
      label: t('export_finance.cabinets.detail.documents.field.note'),
      type: 'textarea',
    },
  ], [refundId, t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'documentFile', column: 1, fields: ['docType', 'attachmentId'] },
    { id: 'documentStamp', column: 2, fields: ['issuedAt', 'note'] },
  ], [])

  const handleSubmit = React.useCallback(async (values: RefundDocumentFormValues) => {
    const payload = buildRefundDocumentPayload(values)
    const isEdit = dialogMode === 'edit' && editing !== null
    try {
      await runMutation({
        operation: () => (isEdit
          ? updateCrud(
              REFUND_DOCUMENTS_API_PATH,
              { id: editing.id, ...payload },
              { errorMessage: t('export_finance.cabinets.detail.documents.saveFailed') },
            )
          : createCrud(
              REFUND_DOCUMENTS_API_PATH,
              { refundId, ...payload },
              { errorMessage: t('export_finance.cabinets.detail.documents.saveFailed') },
            )),
        context: mutationContext,
        mutationPayload: isEdit ? { id: editing.id, ...payload } : { refundId, ...payload },
      })
    } catch (error) {
      if (errorStatusOf(error) === 403) onForbidden()
      surfaceRecordConflict(error, t, { onRefresh: () => void onChanged() })
      throw error
    }
    flash(t('ui.forms.flash.saveSuccess', 'Saved successfully.'), 'success')
    setDialogMode(null)
    setEditing(null)
    await onChanged()
  }, [dialogMode, editing, mutationContext, onChanged, onForbidden, refundId, runMutation, t])

  const handleRemove = React.useCallback(async (document: RefundDocumentRecord) => {
    const confirmed = await confirm({
      title: t('export_finance.cabinets.detail.documents.deleteConfirmTitle'),
      text: t('export_finance.cabinets.detail.documents.deleteConfirmBody'),
      confirmText: t('export_finance.cabinets.detail.documents.delete'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await runMutation({
        operation: () => deleteCrud(
          REFUND_DOCUMENTS_API_PATH,
          { id: document.id, errorMessage: t('export_finance.cabinets.detail.documents.deleteFailed') },
        ),
        context: mutationContext,
        mutationPayload: { id: document.id },
      })
    } catch (error) {
      if (errorStatusOf(error) === 403) onForbidden()
      if (surfaceRecordConflict(error, t, { onRefresh: () => void onChanged() })) return
      flash(errorMessageOf(error, t('export_finance.cabinets.detail.documents.deleteFailed')), 'error')
      return
    }
    flash(t('ui.forms.flash.deleteSuccess', 'Record deleted'), 'success')
    await onChanged()
  }, [confirm, mutationContext, onChanged, onForbidden, runMutation, t])

  const columns = React.useMemo<ColumnDef<RefundDocumentRecord>[]>(() => [
    {
      accessorKey: 'docType',
      header: t('export_finance.cabinets.detail.documents.columns.type'),
      enableSorting: false,
      meta: { priority: 1 },
      cell: ({ row }) => refundDocumentTypeLabel(t, row.original.docType),
    },
    {
      accessorKey: 'issuedAt',
      header: t('export_finance.cabinets.detail.documents.columns.issuedAt'),
      enableSorting: false,
      meta: { priority: 2 },
      cell: ({ row }) => {
        const issued = formatDisplayDate(row.original.issuedAt, locale)
        return issued ?? <EmptyCell />
      },
    },
    {
      accessorKey: 'attachmentId',
      header: t('export_finance.cabinets.detail.documents.columns.attachment'),
      enableSorting: false,
      meta: { priority: 3 },
      cell: ({ row }) => {
        const attachmentId = row.original.attachmentId
        if (!attachmentId) return <EmptyCell />
        return (
          <Link
            href={`/api/attachments/file/${encodeURIComponent(attachmentId)}?download=1`}
            className="text-sm text-primary hover:underline"
          >
            {t('export_finance.cabinets.detail.documents.download')}
          </Link>
        )
      },
    },
    {
      accessorKey: 'note',
      header: t('export_finance.cabinets.detail.documents.columns.note'),
      enableSorting: false,
      meta: { priority: 4, truncate: true, maxWidth: 240 },
      cell: ({ row }) => row.original.note ?? <EmptyCell />,
    },
  ], [locale, t])

  const handleSubmitForm = React.useCallback(() => {
    dialogContentRef.current?.querySelector('form')?.requestSubmit()
  }, [])
  const handleDialogKeyDown = useDialogKeyHandler({
    onConfirm: handleSubmitForm,
    onCancel: () => {
      setDialogMode(null)
      setEditing(null)
    },
  })

  return (
    <>
      <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
        <SectionHeader
          title={t('export_finance.cabinets.detail.documents.title')}
          count={documents.length}
          action={(
            <Button
              type="button"
              variant="outline"
              disabled={readOnly}
              onClick={() => {
                setEditing(null)
                setDialogMode('create')
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t('export_finance.cabinets.detail.documents.add')}
            </Button>
          )}
        />
        {loadFailed ? (
          <p className="text-sm font-medium text-status-error-text" role="alert">
            {t('export_finance.cabinets.detail.documents.loadFailed')}
          </p>
        ) : null}
        <DataTable<RefundDocumentRecord>
          embedded
          columns={columns}
          data={documents}
          disableRowClick
          emptyState={<EmptyState variant="subtle" size="sm" title={t('export_finance.cabinets.detail.documents.empty')} />}
          // Without the manage feature the files stay readable but not editable, so the row menu
          // is simply absent rather than offering actions the server would refuse.
          rowActions={readOnly ? undefined : (row) => (
            <RowActions
              items={[
                {
                  id: 'edit',
                  label: t('export_finance.cabinets.detail.documents.edit'),
                  onSelect: () => {
                    setEditing(row)
                    setDialogMode('edit')
                  },
                },
                {
                  id: 'delete',
                  label: t('export_finance.cabinets.detail.documents.delete'),
                  destructive: true,
                  onSelect: () => { void handleRemove(row) },
                },
              ]}
            />
          )}
        />
      </div>

      <Dialog
        open={dialogMode !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDialogMode(null)
            setEditing(null)
          }
        }}
      >
        <DialogContent ref={dialogContentRef} onKeyDown={handleDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>
              {dialogMode === 'edit'
                ? t('export_finance.cabinets.detail.documents.dialog.editTitle')
                : t('export_finance.cabinets.detail.documents.dialog.createTitle')}
            </DialogTitle>
            <DialogDescription>{t('export_finance.cabinets.detail.documents.title')}</DialogDescription>
          </DialogHeader>
          <CrudForm<RefundDocumentFormValues>
            embedded
            fields={fields}
            groups={groups}
            initialValues={initialValues}
            submitLabel={t('export_finance.cabinets.detail.documents.add')}
            onSubmit={handleSubmit}
          />
        </DialogContent>
      </Dialog>

      {ConfirmDialogElement}
    </>
  )
}

export default function ContainerFileDetail({ shipmentId }: { shipmentId: string }) {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const [row, setRow] = React.useState<ContainerFileRow | null>(null)
  const [refund, setRefund] = React.useState<RefundRecord | null>(null)
  const [documents, setDocuments] = React.useState<RefundDocumentRecord[]>([])
  const [documentsLoadFailed, setDocumentsLoadFailed] = React.useState(false)
  const [form, setForm] = React.useState<RefundFormValues>({ status: 'unknown', amount: '', note: '' })
  const [readOnly, setReadOnly] = React.useState(false)
  const [refundError, setRefundError] = React.useState<string | null>(null)
  const [isSaving, setIsSaving] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)

  const mutationContextId = React.useMemo(() => `export_finance.container-file:${shipmentId}`, [shipmentId])
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId?: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: mutationContextId })

  const mutationContext = React.useMemo(() => ({
    formId: mutationContextId,
    resourceKind: 'export_finance.refund',
    resourceId: shipmentId,
    retryLastMutation,
  }), [mutationContextId, retryLastMutation, shipmentId])

  const load = React.useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    setNotFound(false)
    try {
      const [containerPayload, refundPayload] = await Promise.all([
        fetchCrudList<ContainerFileRow>(API_PATH, { shipmentId, pageSize: 1 }),
        readApiResultOrThrow<{ item: Record<string, unknown> | null }>(
          `/api/${REFUND_API_PATH}?shipmentId=${encodeURIComponent(shipmentId)}`,
          undefined,
          { allowNullResult: true, errorMessage: t('export_finance.cabinets.errors.loadFailed') },
        ),
      ])
      const container = containerPayload.items?.[0]
      if (!container) {
        setRow(null)
        setRefund(null)
        setDocuments([])
        setNotFound(true)
        return
      }
      const record = refundPayload?.item ? toRefundRecord(refundPayload.item) : null
      setRow(container)
      setRefund(record)
      setForm({
        status: record?.taxRefundStatus ?? 'unknown',
        amount: formatAmount(record?.taxRefundAmount ?? null) ?? '',
        note: record?.taxRefundNote ?? '',
      })
    } catch {
      setLoadError(t('export_finance.cabinets.errors.loadFailed'))
      return
    } finally {
      setLoading(false)
    }
    // The files load on their own: a documents failure names itself inside its own section instead
    // of taking the container down with it. Without a refund record there is nothing to hang them
    // on yet — the section says so and the form creates the record.
    // `scopeVersion` is not read inside the callback on purpose: it is the organization-scope
    // generation, and bumping it must rebuild this callback so the effect below refetches after an
    // organization switch. The rule cannot see that intent, so the dependency is explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate scope-change refetch
  }, [shipmentId, scopeVersion, t])

  const loadDocuments = React.useCallback(async (refundId: string | null) => {
    if (!refundId) {
      setDocuments([])
      setDocumentsLoadFailed(false)
      return
    }
    try {
      const payload = await fetchCrudList<Record<string, unknown>>(REFUND_DOCUMENTS_API_PATH, {
        refundId,
        pageSize: DOCUMENT_PAGE_SIZE,
      })
      setDocuments((payload.items ?? []).map(toRefundDocumentRecord))
      setDocumentsLoadFailed(false)
    } catch {
      setDocuments([])
      setDocumentsLoadFailed(true)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const refundId = refund?.id ?? null

  React.useEffect(() => {
    void loadDocuments(refundId)
  }, [loadDocuments, refundId])

  /**
   * A document write changes the refund's checklist as well as the file list, so both halves are
   * refetched together — the container row carries the 齐套 flags the page renders.
   */
  const refreshAfterDocumentChange = React.useCallback(async () => {
    await Promise.all([load(), loadDocuments(refundId)])
  }, [load, loadDocuments, refundId])

  const handleSaveRefund = React.useCallback(async () => {
    setIsSaving(true)
    setRefundError(null)
    const payload = {
      shipmentId,
      shipmentNumber: row?.shipmentNumber ?? refund?.shipmentNumber ?? null,
      currencyCode: refund?.currencyCode ?? DEFAULT_CURRENCY_CODE,
      taxRefundStatus: form.status,
      taxRefundAmount: toOptionalText(form.amount),
      taxRefundNote: toOptionalText(form.note),
      updatedAt: refund?.updatedAt ?? undefined,
    }
    try {
      await runMutation({
        operation: () => updateCrud<{ id: string }>(
          REFUND_API_PATH,
          payload,
          { errorMessage: t('export_finance.cabinets.detail.refund.saveFailed') },
        ),
        context: mutationContext,
        mutationPayload: payload,
      })
    } catch (error) {
      const status = errorStatusOf(error)
      if (status === 403) {
        setReadOnly(true)
        setRefundError(t('export_finance.cabinets.detail.refund.readOnly'))
        return
      }
      if (status === 409) {
        // The row was changed under this form: the version it holds is stale, so the message says
        // what to do about it instead of reporting a generic failure.
        surfaceRecordConflict(error, t, { onRefresh: () => void load() })
        setRefundError(t('export_finance.cabinets.detail.refund.conflict'))
        return
      }
      setRefundError(t('export_finance.cabinets.detail.refund.saveFailed'))
      return
    } finally {
      setIsSaving(false)
    }
    flash(t('export_finance.cabinets.detail.refund.saved'), 'success')
    // The container row carries the derived per-order shares, so it is refetched together with the
    // record: a changed amount changes every share on this page.
    await load()
  }, [form, load, mutationContext, refund, row, runMutation, shipmentId, t])

  const handleForbidden = React.useCallback(() => {
    setReadOnly(true)
    setRefundError(t('export_finance.cabinets.detail.refund.readOnly'))
  }, [t])

  const orderColumns = React.useMemo<ColumnDef<ContainerOrderRow>[]>(() => [
    {
      accessorKey: 'number',
      header: t('export_finance.cabinets.detail.orders.columns.number'),
      enableSorting: false,
      meta: { priority: 1 },
      cell: ({ row: orderRow }) => orderRow.original.number ?? orderRow.original.businessNumber ?? <EmptyCell />,
    },
    {
      accessorKey: 'businessNumber',
      header: t('export_finance.cabinets.detail.orders.columns.businessNumber'),
      enableSorting: false,
      meta: { priority: 2 },
      cell: ({ row: orderRow }) => orderRow.original.businessNumber ?? <EmptyCell />,
    },
    {
      accessorKey: 'ownerName',
      header: t('export_finance.cabinets.detail.orders.columns.owner'),
      enableSorting: false,
      meta: { priority: 3 },
      cell: ({ row: orderRow }) => orderRow.original.ownerName ?? <EmptyCell />,
    },
    {
      accessorKey: 'customerName',
      header: t('export_finance.cabinets.detail.orders.columns.customer'),
      enableSorting: false,
      meta: { priority: 4, truncate: true, maxWidth: 240 },
      cell: ({ row: orderRow }) => orderRow.original.customerName ?? <EmptyCell />,
    },
    {
      accessorKey: 'total',
      header: t('export_finance.cabinets.detail.orders.columns.total'),
      enableSorting: false,
      meta: { priority: 5, align: 'right' },
      cell: ({ row: orderRow }) => formatAmount(orderRow.original.total) ?? <EmptyCell />,
    },
    {
      accessorKey: 'sharePercent',
      header: t('export_finance.cabinets.detail.orders.columns.share'),
      enableSorting: false,
      meta: { priority: 6, align: 'right' },
      cell: ({ row: orderRow }) => {
        const share = orderRow.original.sharePercent
        return share ? `${share}%` : <EmptyCell />
      },
    },
    {
      accessorKey: 'allocatedRefundAmount',
      header: t('export_finance.cabinets.detail.orders.columns.allocated'),
      enableSorting: false,
      meta: { priority: 7, align: 'right' },
      cell: ({ row: orderRow }) => {
        // A share that could not be derived is unknown, not zero: a zero here would claim the order
        // carries nothing of the container's refund.
        const allocated = formatAmount(orderRow.original.allocatedRefundAmount)
        return allocated ?? <EmptyCell />
      },
    },
  ], [t])

  const exportDocumentRows = React.useMemo<ChecklistRow[]>(
    () => CONTAINER_EXPORT_CHECKLIST_KEYS.map((key) => ({
      key,
      hit: row?.checklist[key] === true,
    })),
    [row],
  )

  const exportDocumentColumns = React.useMemo<ColumnDef<ChecklistRow>[]>(() => [
    {
      accessorKey: 'key',
      header: t('export_finance.cabinets.detail.exportDocuments.columns.type'),
      enableSorting: false,
      meta: { priority: 1 },
      cell: ({ row: checklistRow }) => t(CONTAINER_CHECKLIST_LABEL_KEYS[checklistRow.original.key]),
    },
    {
      accessorKey: 'hit',
      header: t('export_finance.cabinets.detail.exportDocuments.columns.attachment'),
      enableSorting: false,
      meta: { priority: 2 },
      cell: ({ row: checklistRow }) => (
        <StatusBadge variant={checklistRow.original.hit ? 'success' : 'warning'} dot>
          {checklistRow.original.hit
            ? t('export_finance.cabinets.detail.exportDocuments.hit')
            : t('export_finance.cabinets.detail.exportDocuments.missing')}
        </StatusBadge>
      ),
    },
  ], [t])

  if (loading && !row) return <LoadingMessage label={t('export_finance.cabinets.errors.loadFailed')} />

  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('export_finance.cabinets.errors.notFound')}
        backHref={CONTAINERS_LIST_HREF}
      />
    )
  }

  if (loadError || !row) {
    return <ErrorMessage label={loadError ?? t('export_finance.cabinets.errors.loadFailed')} />
  }

  const shipmentHref = `${SHIPMENTS_LIST_HREF}/${encodeURIComponent(row.shipmentId)}`
  const statusVariant = SHIPMENT_STATUS_VARIANTS[row.shipmentStatus as ShipmentStatus]
  const refundStatusVariant = REFUND_STATUS_VARIANTS[row.taxRefundStatus as ExportFinanceTaxRefundStatus]
  const milestone = milestoneLabel(t, row.currentMilestone)
  const allocatedTotal = sumAllocationShares(row.orders.map((order) => order.allocatedRefundAmount))
  const containerAmount = formatAmount(row.taxRefundAmount)
  const difference = allocatedTotal !== null && containerAmount !== null
    ? differenceOf(containerAmount, allocatedTotal)
    : null

  return (
    <>
      <FormHeader
        mode="detail"
        backHref={CONTAINERS_LIST_HREF}
        entityTypeLabel={t('export_finance.cabinets.detail.title')}
        title={row.shipmentNumber ?? shipmentStatusLabel(t, 'draft')}
        statusBadge={statusVariant ? (
          <StatusBadge variant={statusVariant} dot>
            {shipmentStatusLabel(t, row.shipmentStatus)}
          </StatusBadge>
        ) : undefined}
      />

      <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
        <SectionHeader
          title={t('export_finance.cabinets.detail.section.summary')}
          action={(
            <Button variant="outline" asChild>
              <Link href={shipmentHref}>{t('export_finance.cabinets.detail.shipmentOpen')}</Link>
            </Button>
          )}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
          <SummaryField label={t('export_finance.cabinets.detail.field.number')}>
            {row.shipmentNumber ?? shipmentStatusLabel(t, 'draft')}
          </SummaryField>
          <SummaryField label={t('export_finance.cabinets.detail.field.containerType')}>
            {row.containerType ?? EMPTY_CELL}
          </SummaryField>
          <SummaryField label={t('export_finance.cabinets.detail.field.containerNumber')}>
            {row.containerNumber ?? EMPTY_CELL}
          </SummaryField>
          <SummaryField label={t('export_finance.cabinets.detail.field.sealNumber')}>
            {row.sealNumber ?? EMPTY_CELL}
          </SummaryField>
          <SummaryField label={t('export_finance.cabinets.detail.field.bookingNumber')}>
            {row.bookingNumber ?? EMPTY_CELL}
          </SummaryField>
          <SummaryField label={t('export_finance.cabinets.detail.field.carrier')}>
            {row.carrierName ?? EMPTY_CELL}
          </SummaryField>
          <SummaryField label={t('export_finance.cabinets.detail.field.departurePort')}>
            {row.departurePort ?? EMPTY_CELL}
          </SummaryField>
          <SummaryField label={t('export_finance.cabinets.detail.field.status')}>
            {shipmentStatusLabel(t, row.shipmentStatus)}
          </SummaryField>
          <SummaryField label={t('export_finance.cabinets.detail.field.milestone')}>
            {milestone ?? EMPTY_CELL}
          </SummaryField>
          <SummaryField label={t('export_finance.cabinets.columns.refundStatus')}>
            {refundStatusVariant ? (
              <StatusBadge variant={refundStatusVariant} dot>
                {refundStatusLabel(t, row.taxRefundStatus)}
              </StatusBadge>
            ) : EMPTY_CELL}
          </SummaryField>
          <SummaryField label={t('export_finance.cabinets.detail.field.etd')}>
            {formatDisplayDate(row.etd, locale) ?? EMPTY_CELL}
          </SummaryField>
          <SummaryField label={t('export_finance.cabinets.detail.field.eta')}>
            {formatDisplayDate(row.eta, locale) ?? EMPTY_CELL}
          </SummaryField>
          <SummaryField label={t('export_finance.cabinets.detail.field.departedAt')}>
            {formatDisplayDate(row.departedAt, locale) ?? EMPTY_CELL}
          </SummaryField>
          <SummaryField label={t('export_finance.cabinets.detail.field.receivedAt')}>
            {formatDisplayDate(row.receivedAt, locale) ?? EMPTY_CELL}
          </SummaryField>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
        <SectionHeader title={t('export_finance.cabinets.detail.refund.title')} />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="container-refund-status">
              {t('export_finance.cabinets.detail.refund.field.status')}
            </Label>
            <Select
              value={form.status}
              disabled={readOnly || isSaving}
              onValueChange={(next) => setForm((current) => ({ ...current, status: next as ExportFinanceTaxRefundStatus }))}
            >
              <SelectTrigger id="container-refund-status">
                <SelectValue placeholder={EMPTY_CELL} />
              </SelectTrigger>
              <SelectContent>
                {REFUND_STATUS_OPTIONS.map((value) => (
                  <SelectItem key={value} value={value}>{refundStatusLabel(t, value)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="container-refund-amount">
              {t('export_finance.cabinets.detail.refund.field.amount')}
            </Label>
            <Input
              id="container-refund-amount"
              inputMode="decimal"
              value={form.amount}
              disabled={readOnly || isSaving}
              onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5 md:col-span-3">
            <Label htmlFor="container-refund-note">
              {t('export_finance.cabinets.detail.refund.field.note')}
            </Label>
            <Textarea
              id="container-refund-note"
              value={form.note}
              disabled={readOnly || isSaving}
              onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t('export_finance.cabinets.detail.refund.amountHint')}</p>
        {refundError ? (
          <p className="text-sm font-medium text-status-error-text" role="alert">{refundError}</p>
        ) : null}
        {!refund ? (
          <p className="text-sm text-muted-foreground">{t('export_finance.cabinets.detail.refund.empty')}</p>
        ) : null}
        <div>
          <Button type="button" disabled={readOnly || isSaving} onClick={() => { void handleSaveRefund() }}>
            {isSaving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {t('export_finance.cabinets.detail.refund.save')}
          </Button>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
        <SectionHeader
          title={t('export_finance.cabinets.detail.orders.title')}
          count={row.orders.length}
        />
        <DataTable<ContainerOrderRow>
          embedded
          columns={orderColumns}
          data={row.orders}
          emptyState={<EmptyState variant="subtle" size="sm" title={t('export_finance.cabinets.detail.orders.empty')} />}
          rowActions={(orderRow) => (
            <RowActions
              items={[
                {
                  id: 'open',
                  label: t('export_finance.cabinets.detail.orders.columns.open'),
                  onSelect: () => router.push(`${ORDERS_LIST_HREF}/${encodeURIComponent(orderRow.purchaseOrderId)}`),
                },
              ]}
            />
          )}
          onRowClick={(orderRow) => router.push(`${ORDERS_LIST_HREF}/${encodeURIComponent(orderRow.purchaseOrderId)}`)}
        />
        <div className="space-y-1 border-t border-border pt-3">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-muted-foreground">{t('export_finance.cabinets.detail.orders.totalRow')}</span>
            <span className="font-medium tabular-nums">{allocatedTotal ?? EMPTY_CELL}</span>
          </div>
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-muted-foreground">{t('export_finance.cabinets.detail.refund.field.amount')}</span>
            <span className="tabular-nums">{containerAmount ?? EMPTY_CELL}</span>
          </div>
          {difference ? (
            <div className="flex items-center justify-between gap-4 text-sm font-medium text-status-warning-text">
              <span>{t('export_finance.cabinets.detail.orders.differenceRow')}</span>
              <span className="tabular-nums">{difference}</span>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {containerAmount === null
              ? t('export_finance.cabinets.detail.refund.empty')
              : t('export_finance.cabinets.detail.orders.reconcileHint')}
          </p>
        </div>
      </div>

      {refundId ? (
        <RefundDocumentsSection
          refundId={refundId}
          documents={documents}
          readOnly={readOnly}
          loadFailed={documentsLoadFailed}
          onChanged={refreshAfterDocumentChange}
          onForbidden={handleForbidden}
        />
      ) : (
        <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
          <SectionHeader title={t('export_finance.cabinets.detail.section.documents')} />
          <EmptyState
            variant="subtle"
            size="sm"
            title={t('export_finance.cabinets.detail.refund.empty')}
            description={t('export_finance.cabinets.detail.documents.empty')}
          />
        </div>
      )}

      <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
        <SectionHeader
          title={t('export_finance.cabinets.detail.exportDocuments.title')}
          action={(
            <Button variant="outline" asChild>
              <Link href={shipmentHref}>{t('export_finance.cabinets.detail.exportDocuments.openShipment')}</Link>
            </Button>
          )}
        />
        <p className="text-xs text-muted-foreground">
          {t('export_finance.cabinets.detail.exportDocuments.hint')}
        </p>
        <DataTable<ChecklistRow>
          embedded
          columns={exportDocumentColumns}
          data={exportDocumentRows}
          disableRowClick
        />
      </div>
    </>
  )
}
