"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Plus, Upload } from 'lucide-react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
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
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
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
import { Label } from '@open-mercato/ui/primitives/label'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { formatDisplayDate, toUtcDateInputValue } from '@open-mercato/ui/primitives/date-format'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import type {
  CollectionDocType,
  ExportFinanceCollectionStatus,
  ExportFinanceTaxRefundStatus,
  OrderFileStatus,
} from '../data/validators'
import type { ShipmentMilestone } from '../../cross_border/data/validators'
import {
  ORDER_EXPORT_CHECKLIST_KEYS,
  ORDER_PURCHASE_CHECKLIST_KEYS,
  type OrderChecklistKey,
  type OrderFileRow,
} from '../lib/orderFileProjection'
import {
  BUSINESS_STATUS_LABEL_KEYS,
  COLLECTION_STATUS_LABEL_KEYS,
  COLLECTION_STATUS_OPTIONS,
  ORDER_CHECKLIST_LABEL_KEYS,
  REFUND_STATUS_LABEL_KEYS,
  SHIPMENT_MILESTONE_LABEL_KEYS,
  SHIPMENT_STATUS_LABEL_KEYS,
  checklistCounter,
} from './labels'

const ORDER_FILES_API_PATH = 'export_finance/order-files'
const COLLECTIONS_API_PATH = 'export_finance/collections'
const COLLECTION_DOCUMENTS_API_PATH = 'export_finance/collection-documents'
export const ORDER_FILES_LIST_HREF = '/backend/export-finance/orders'
const CONTAINERS_LIST_HREF = '/backend/export-finance/containers'
const SHIPMENTS_LIST_HREF = '/backend/cross_border/shipments'

/** Attachments entity id for a collection document: the file is filed against the order's 收汇档案. */
const COLLECTION_ATTACHMENT_ENTITY_ID = 'export_finance:export_finance_collection'

/** The feature that gates every write on this page; a reader without it gets the read-only form. */
const MANAGE_FEATURE = 'export_finance.manage'

const DOCUMENT_PAGE_SIZE = 100
const EMPTY_CELL = '—'
/** The collection column's own default, used only until a record carries its own currency. */
const DEFAULT_CURRENCY_CODE = 'CNY'

const BUSINESS_STATUS_VARIANTS: StatusMap<OrderFileStatus> = {
  draft: 'neutral',
  placed: 'info',
  factory_pickup: 'info',
  shipped: 'info',
  received: 'success',
  closed: 'neutral',
  cancelled: 'error',
}

const COLLECTION_STATUS_VARIANTS: StatusMap<ExportFinanceCollectionStatus> = {
  received: 'success',
  not_received: 'warning',
  unknown: 'neutral',
}

const REFUND_STATUS_VARIANTS: StatusMap<ExportFinanceTaxRefundStatus> = {
  completed: 'success',
  applied: 'info',
  not_started: 'warning',
  unknown: 'neutral',
}

const COLLECTION_DOC_TYPES: readonly CollectionDocType[] = ['foreign_income_certificate', 'other']

const COLLECTION_DOC_TYPE_LABEL_KEYS: Record<CollectionDocType, string> = {
  foreign_income_certificate: 'export_finance.orders.collection.documents.docType.foreign_income_certificate',
  other: 'export_finance.orders.collection.documents.docType.other',
}

/** The twelve documents of an order file, in two classes, in the order the list counts them. */
const CHECKLIST_CLASSES: ReadonlyArray<{
  id: string
  titleKey: string
  keys: readonly OrderChecklistKey[]
}> = [
  {
    id: 'purchase',
    titleKey: 'export_finance.orders.columns.purchaseChecklist',
    keys: ORDER_PURCHASE_CHECKLIST_KEYS,
  },
  {
    id: 'export',
    titleKey: 'export_finance.orders.columns.exportChecklist',
    keys: ORDER_EXPORT_CHECKLIST_KEYS,
  },
]

/** A 收汇档案 as `GET /api/export_finance/collections` returns it. */
type CollectionRecord = {
  id: string
  purchaseOrderId: string
  purchaseOrderNumber: string | null
  currencyCode: string
  collectionStatus: ExportFinanceCollectionStatus
  updatedAt: string | null
}

/** A 收汇单证 as `/api/export_finance/collection-documents` projects it. */
type CollectionDocumentRecord = {
  id: string
  collectionId: string
  docType: CollectionDocType
  issuedAt: string | null
  attachmentId: string | null
  note: string | null
}

function toCollectionRecord(item: Record<string, unknown> | null | undefined): CollectionRecord | null {
  if (!item || typeof item.id !== 'string') return null
  const status = item.collectionStatus
  return {
    id: item.id,
    purchaseOrderId: typeof item.purchaseOrderId === 'string' ? item.purchaseOrderId : '',
    purchaseOrderNumber: typeof item.purchaseOrderNumber === 'string' ? item.purchaseOrderNumber : null,
    currencyCode: typeof item.currencyCode === 'string' ? item.currencyCode : DEFAULT_CURRENCY_CODE,
    collectionStatus: COLLECTION_STATUS_OPTIONS.includes(status as ExportFinanceCollectionStatus)
      ? (status as ExportFinanceCollectionStatus)
      : 'unknown',
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : null,
  }
}

function toCollectionDocumentRecord(item: Record<string, unknown>): CollectionDocumentRecord {
  const docType = item.docType
  return {
    id: String(item.id ?? ''),
    collectionId: String(item.collectionId ?? ''),
    docType: COLLECTION_DOC_TYPES.includes(docType as CollectionDocType) ? (docType as CollectionDocType) : 'other',
    issuedAt: typeof item.issuedAt === 'string' ? item.issuedAt : null,
    attachmentId: typeof item.attachmentId === 'string' ? item.attachmentId : null,
    note: typeof item.note === 'string' ? item.note : null,
  }
}

/**
 * A server refusal (missing feature) is reported as the module's own read-only copy instead of
 * the raw HTTP text; `raiseCrudError` attaches the status to the thrown error.
 */
function isHttpStatusError(error: unknown, status: number): boolean {
  if (!error || typeof error !== 'object' || !('status' in error)) return false
  return typeof error.status === 'number' && error.status === status
}

function mutationErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length) return error.message
  return fallback
}

function SummaryField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  )
}

function TextValue({ value }: { value: string | null | undefined }) {
  return value ? <>{value}</> : <span className="text-xs text-muted-foreground">{EMPTY_CELL}</span>
}

/** Amounts arrive already quantized to the currency scale — they are rendered, never re-rounded. */
function AmountValue({ value, currency }: { value: string | null; currency?: string | null }) {
  if (value === null) return <span className="text-xs text-muted-foreground">{EMPTY_CELL}</span>
  return (
    <span className="tabular-nums">
      {currency ? `${value} ${currency}` : value}
    </span>
  )
}

/** Date-only columns are written as UTC midnight, so their day is read in the frame it was written in. */
function DateValue({ value, locale }: { value: string | null; locale: string }) {
  const day = toUtcDateInputValue(value)
  const formatted = day ? formatDisplayDate(day, locale) : null
  return formatted ? <>{formatted}</> : <span className="text-xs text-muted-foreground">{EMPTY_CELL}</span>
}

function BusinessStatusBadge({ status }: { status: OrderFileStatus }) {
  const t = useT()
  return (
    <StatusBadge variant={BUSINESS_STATUS_VARIANTS[status]} dot>
      {t(BUSINESS_STATUS_LABEL_KEYS[status])}
    </StatusBadge>
  )
}

function CollectionStatusBadge({ status }: { status: string }) {
  const t = useT()
  const key = status as ExportFinanceCollectionStatus
  return (
    <StatusBadge variant={COLLECTION_STATUS_VARIANTS[key] ?? 'neutral'} dot>
      {t(COLLECTION_STATUS_LABEL_KEYS[key] ?? 'export_finance.collection.status.unknown')}
    </StatusBadge>
  )
}

function RefundStatusBadge({ status }: { status: string }) {
  const t = useT()
  const key = status as ExportFinanceTaxRefundStatus
  return (
    <StatusBadge variant={REFUND_STATUS_VARIANTS[key] ?? 'neutral'} dot>
      {t(REFUND_STATUS_LABEL_KEYS[key] ?? 'export_finance.refund.status.unknown')}
    </StatusBadge>
  )
}

function ShipmentStatusBadge({ status }: { status: string }) {
  const t = useT()
  const key = status as keyof typeof SHIPMENT_STATUS_LABEL_KEYS
  return (
    <StatusBadge variant="neutral" dot>
      {t(SHIPMENT_STATUS_LABEL_KEYS[key] ?? 'cross_border.shipments.status.draft')}
    </StatusBadge>
  )
}

/**
 * 单证齐套: all twelve documents, in their two classes, each marked 已有/缺. Nothing is filtered
 * out — the list of what is missing is the whole point of the block.
 */
function OrderChecklistSection({ row }: { row: OrderFileRow }) {
  const t = useT()
  const hits = checklistCounter(row.checklist, [...ORDER_PURCHASE_CHECKLIST_KEYS, ...ORDER_EXPORT_CHECKLIST_KEYS])

  return (
    <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
      <SectionHeader title={t('export_finance.orders.detail.section.checklist')} count={hits.total} />
      {hits.hits === 0 ? (
        <p className="text-sm text-muted-foreground">{t('export_finance.orders.detail.checklist.empty')}</p>
      ) : null}
      <div className="space-y-4">
        {CHECKLIST_CLASSES.map((checklistClass) => {
          const counter = checklistCounter(row.checklist, checklistClass.keys)
          return (
            <div key={checklistClass.id} className="space-y-2">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-medium">{t(checklistClass.titleKey)}</h4>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {`${counter.hits}/${counter.total}`}
                </span>
              </div>
              <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {checklistClass.keys.map((key) => {
                  const hit = row.checklist[key]
                  return (
                    <li
                      key={key}
                      className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5"
                    >
                      <span className="text-sm">{t(ORDER_CHECKLIST_LABEL_KEYS[key])}</span>
                      <StatusBadge variant={hit ? 'success' : 'warning'} dot>
                        {t(hit ? 'export_finance.orders.detail.checklist.hit' : 'export_finance.orders.detail.checklist.missing')}
                      </StatusBadge>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 所属柜 — the containers this order travels in, each linking to the shipment that owns it. */
function OrderContainersSection({ row }: { row: OrderFileRow }) {
  const t = useT()
  const locale = useLocale()

  const columns = React.useMemo<ColumnDef<OrderFileRow['containers'][number]>[]>(() => [
    {
      accessorKey: 'shipmentNumber',
      header: t('export_finance.orders.detail.containers.number'),
      enableSorting: false,
      meta: { priority: 1 },
      cell: ({ row: tableRow }) => {
        const container = tableRow.original
        const label = container.shipmentNumber ?? t('cross_border.shipments.status.draft')
        return (
          <Link
            href={`${SHIPMENTS_LIST_HREF}/${encodeURIComponent(container.shipmentId)}`}
            className="text-sm text-primary hover:underline"
          >
            {label}
          </Link>
        )
      },
    },
    {
      accessorKey: 'status',
      header: t('export_finance.orders.detail.containers.status'),
      enableSorting: false,
      meta: { priority: 2 },
      cell: ({ row: tableRow }) => <ShipmentStatusBadge status={tableRow.original.status} />,
    },
    {
      accessorKey: 'currentMilestone',
      header: t('export_finance.cabinets.columns.milestone'),
      enableSorting: false,
      meta: { priority: 3 },
      cell: ({ row: tableRow }) => {
        const milestone = tableRow.original.currentMilestone
        const label = milestone
          ? t(SHIPMENT_MILESTONE_LABEL_KEYS[milestone as ShipmentMilestone] ?? milestone, milestone)
          : null
        return <TextValue value={label} />
      },
    },
    {
      accessorKey: 'containerNumber',
      header: t('export_finance.orders.detail.containers.containerNumber'),
      enableSorting: false,
      meta: { priority: 4 },
      cell: ({ row: tableRow }) => <TextValue value={tableRow.original.containerNumber} />,
    },
    {
      accessorKey: 'departedAt',
      header: t('export_finance.orders.detail.containers.departedAt'),
      enableSorting: false,
      meta: { priority: 5 },
      cell: ({ row: tableRow }) => <DateValue value={tableRow.original.departedAt} locale={locale} />,
    },
    {
      accessorKey: 'receivedAt',
      header: t('export_finance.orders.detail.field.receivedAt'),
      enableSorting: false,
      meta: { priority: 6 },
      cell: ({ row: tableRow }) => <DateValue value={tableRow.original.receivedAt} locale={locale} />,
    },
    {
      accessorKey: 'taxRefundStatus',
      header: t('export_finance.orders.detail.containers.refundStatus'),
      enableSorting: false,
      meta: { priority: 7 },
      cell: ({ row: tableRow }) => <RefundStatusBadge status={tableRow.original.taxRefundStatus} />,
    },
    {
      accessorKey: 'taxRefundAmount',
      header: t('export_finance.orders.detail.containers.refundAmount'),
      enableSorting: false,
      meta: { priority: 8, align: 'right' },
      cell: ({ row: tableRow }) => <AmountValue value={tableRow.original.taxRefundAmount} />,
    },
    {
      accessorKey: 'taxRefundNote',
      header: t('export_finance.orders.detail.containers.refundNote'),
      enableSorting: false,
      meta: { priority: 9, truncate: true, maxWidth: 240 },
      cell: ({ row: tableRow }) => <TextValue value={tableRow.original.taxRefundNote} />,
    },
  ], [locale, t])

  return (
    <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
      <SectionHeader
        title={t('export_finance.orders.detail.section.containers')}
        count={row.containers.length}
      />
      <DataTable<OrderFileRow['containers'][number]>
        embedded
        columns={columns}
        data={row.containers}
        disableRowClick
      />
    </div>
  )
}

/**
 * The upload control for a 涉外收入证明. It talks to the shared attachments endpoint
 * (`POST /api/attachments`, multipart) exactly as the installed attachment surfaces do, and hands
 * the returned id back to the form — the document command stores that id, never a byte of file.
 */
function CollectionDocumentAttachmentField({
  value,
  setValue,
  disabled,
  collectionId,
  onForbidden,
}: CrudCustomFieldRenderProps & { collectionId: string; onForbidden: () => void }) {
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
      body.set('entityId', COLLECTION_ATTACHMENT_ENTITY_ID)
      body.set('recordId', collectionId)
      body.set('file', file)
      const call = await apiCall<{ item?: { id?: string }; error?: string }>(
        '/api/attachments',
        { method: 'POST', body },
        { fallback: null },
      )
      if (call.status === 403) {
        onForbidden()
        throw new Error(t('export_finance.orders.collection.readOnly'))
      }
      const uploadedId = call.ok && typeof call.result?.item?.id === 'string' ? call.result.item.id : ''
      if (!uploadedId) {
        throw new Error(call.result?.error || t('export_finance.orders.collection.documents.uploadFailed'))
      }
      setValue(uploadedId)
      setFileName(file.name)
    } catch (cause) {
      setError(mutationErrorMessage(cause, t('export_finance.orders.collection.documents.uploadFailed')))
    } finally {
      setIsUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }, [collectionId, onForbidden, setValue, t])

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
          {t('export_finance.orders.collection.documents.field.attachmentId')}
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
            {t('export_finance.orders.collection.documents.remove')}
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

type CollectionDocumentFormValues = {
  docType: string
  issuedAt: string
  attachmentId: string
  note: string
}

const EMPTY_DOCUMENT_VALUES: CollectionDocumentFormValues = {
  docType: '',
  issuedAt: '',
  attachmentId: '',
  note: '',
}

function toOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

/**
 * 收汇 — the order-level anchor. Saving creates the record on first use (the upsert is keyed by
 * the order), so the form is the record's only entry point; the 涉外收入证明 table appears once it
 * exists. Every write needs `export_finance.manage`: without it the form is read-only and says so.
 */
function OrderCollectionSection({
  purchaseOrderId,
  purchaseOrderNumber,
  canManage,
  onForbidden,
}: {
  purchaseOrderId: string
  purchaseOrderNumber: string | null
  canManage: boolean
  onForbidden: () => void
}) {
  const t = useT()
  const locale = useLocale()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [collection, setCollection] = React.useState<CollectionRecord | null>(null)
  const [statusValue, setStatusValue] = React.useState<ExportFinanceCollectionStatus>('unknown')
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [isSaving, setIsSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [documents, setDocuments] = React.useState<CollectionDocumentRecord[]>([])
  const [documentsLoadFailed, setDocumentsLoadFailed] = React.useState(false)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<CollectionDocumentRecord | null>(null)
  const [formKey, setFormKey] = React.useState(0)
  const dialogContentRef = React.useRef<HTMLDivElement | null>(null)

  const collectionId = collection?.id ?? null

  const mutationContextId = React.useMemo(
    () => `export_finance.collection:${purchaseOrderId}`,
    [purchaseOrderId],
  )
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId?: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: mutationContextId })

  const mutationContext = React.useMemo(() => ({
    formId: mutationContextId,
    resourceKind: 'export_finance.collection',
    resourceId: purchaseOrderId,
    retryLastMutation,
  }), [mutationContextId, purchaseOrderId, retryLastMutation])

  const loadCollection = React.useCallback(async () => {
    setIsLoading(true)
    setLoadFailed(false)
    try {
      const call = await apiCall<{ item?: Record<string, unknown> | null }>(
        `/api/${COLLECTIONS_API_PATH}?purchaseOrderId=${encodeURIComponent(purchaseOrderId)}`,
        { method: 'GET' },
        { fallback: null },
      )
      if (!call.ok) {
        if (call.status === 403) onForbidden()
        throw new Error(t('export_finance.orders.collection.loadFailed'))
      }
      const item = toCollectionRecord(call.result?.item ?? null)
      setCollection(item)
      setStatusValue(item?.collectionStatus ?? 'unknown')
    } catch {
      setCollection(null)
      setLoadFailed(true)
    } finally {
      setIsLoading(false)
    }
    // `scopeVersion` is not read inside the callback on purpose: it is the organization-scope
    // generation, and bumping it must rebuild this callback so the effect below refetches after
    // an organization switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate scope-change refetch
  }, [onForbidden, purchaseOrderId, t, scopeVersion])

  React.useEffect(() => {
    void loadCollection()
  }, [loadCollection])

  const loadDocuments = React.useCallback(async (id: string) => {
    try {
      const payload = await fetchCrudList<Record<string, unknown>>(COLLECTION_DOCUMENTS_API_PATH, {
        collectionId: id,
        pageSize: DOCUMENT_PAGE_SIZE,
      })
      setDocuments((payload.items ?? []).map(toCollectionDocumentRecord))
      setDocumentsLoadFailed(false)
    } catch {
      setDocuments([])
      setDocumentsLoadFailed(true)
    }
  }, [])

  React.useEffect(() => {
    if (!collectionId) {
      setDocuments([])
      setDocumentsLoadFailed(false)
      return
    }
    void loadDocuments(collectionId)
  }, [collectionId, loadDocuments])

  const handleSave = React.useCallback(async () => {
    setIsSaving(true)
    setSaveError(null)
    const payload: Record<string, unknown> = {
      purchaseOrderId,
      purchaseOrderNumber,
      currencyCode: collection?.currencyCode ?? DEFAULT_CURRENCY_CODE,
      collectionStatus: statusValue,
      ...(collection?.updatedAt ? { updatedAt: collection.updatedAt } : {}),
    }
    try {
      await runMutation({
        operation: () => updateCrud<{ id?: string }>(COLLECTIONS_API_PATH, payload, {
          errorMessage: t('export_finance.orders.collection.saveFailed'),
        }),
        context: mutationContext,
        mutationPayload: payload,
      })
      flash(t('export_finance.orders.collection.saved'), 'success')
      // Reload rather than trusting the response: the save returns the id only, and the next save
      // needs the version the server just stamped.
      await loadCollection()
    } catch (error) {
      if (isHttpStatusError(error, 403)) {
        onForbidden()
        setSaveError(t('export_finance.orders.collection.readOnly'))
      } else if (isHttpStatusError(error, 409)) {
        setSaveError(t('export_finance.orders.collection.conflict'))
      } else {
        setSaveError(mutationErrorMessage(error, t('export_finance.orders.collection.saveFailed')))
      }
    } finally {
      setIsSaving(false)
    }
  }, [collection, loadCollection, mutationContext, onForbidden, purchaseOrderId, purchaseOrderNumber, runMutation, statusValue, t])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'docType',
      label: t('export_finance.orders.collection.documents.field.docType'),
      type: 'select',
      required: true,
      options: COLLECTION_DOC_TYPES.map((value) => ({
        value,
        label: t(COLLECTION_DOC_TYPE_LABEL_KEYS[value]),
      })),
    },
    {
      id: 'issuedAt',
      label: t('export_finance.orders.collection.documents.field.issuedAt'),
      type: 'date',
    },
    {
      id: 'attachmentId',
      label: t('export_finance.orders.collection.documents.field.attachmentId'),
      type: 'custom',
      rendersOwnError: true,
      component: (props) => (
        <CollectionDocumentAttachmentField
          {...props}
          collectionId={collectionId ?? ''}
          onForbidden={onForbidden}
        />
      ),
    },
    {
      id: 'note',
      label: t('export_finance.orders.collection.documents.field.note'),
      type: 'textarea',
    },
  ], [collectionId, onForbidden, t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'documentDetails', column: 1, fields: ['docType', 'issuedAt', 'attachmentId'] },
    { id: 'documentNote', column: 2, fields: ['note'] },
  ], [])

  const initialValues = React.useMemo<CollectionDocumentFormValues>(() => {
    if (!editing) return EMPTY_DOCUMENT_VALUES
    return {
      docType: editing.docType,
      issuedAt: editing.issuedAt ? (toUtcDateInputValue(editing.issuedAt) ?? '') : '',
      attachmentId: editing.attachmentId ?? '',
      note: editing.note ?? '',
    }
  }, [editing])

  const handleSubmit = React.useCallback(async (values: CollectionDocumentFormValues) => {
    if (!collectionId) return
    const payload = {
      docType: COLLECTION_DOC_TYPES.includes(values.docType as CollectionDocType) ? values.docType : 'other',
      issuedAt: toOptionalText(values.issuedAt),
      attachmentId: toOptionalText(values.attachmentId),
      note: toOptionalText(values.note),
    }
    try {
      await runMutation({
        operation: () => (editing
          ? updateCrud(COLLECTION_DOCUMENTS_API_PATH, { id: editing.id, ...payload }, {
              errorMessage: t('export_finance.orders.collection.documents.saveFailed'),
            })
          : createCrud(COLLECTION_DOCUMENTS_API_PATH, { collectionId, ...payload }, {
              errorMessage: t('export_finance.orders.collection.documents.saveFailed'),
            })),
        context: mutationContext,
        mutationPayload: editing ? { id: editing.id, ...payload } : { collectionId, ...payload },
      })
    } catch (error) {
      if (isHttpStatusError(error, 403)) onForbidden()
      flash(mutationErrorMessage(error, t('export_finance.orders.collection.documents.saveFailed')), 'error')
      throw error
    }
    setDialogOpen(false)
    setEditing(null)
    await loadDocuments(collectionId)
  }, [collectionId, editing, loadDocuments, mutationContext, onForbidden, runMutation, t])

  const handleRemove = React.useCallback(async (document: CollectionDocumentRecord) => {
    const confirmed = await confirm({
      title: t('export_finance.orders.collection.documents.deleteConfirmTitle'),
      description: t('export_finance.orders.collection.documents.deleteConfirmBody'),
      confirmText: t('export_finance.orders.collection.documents.delete'),
      variant: 'destructive',
    })
    if (!confirmed || !collectionId) return
    try {
      await runMutation({
        operation: () => deleteCrud(COLLECTION_DOCUMENTS_API_PATH, {
          id: document.id,
          errorMessage: t('export_finance.orders.collection.documents.deleteFailed'),
        }),
        context: mutationContext,
        mutationPayload: { id: document.id },
      })
      await loadDocuments(collectionId)
    } catch (error) {
      if (isHttpStatusError(error, 403)) onForbidden()
      flash(mutationErrorMessage(error, t('export_finance.orders.collection.documents.deleteFailed')), 'error')
    }
  }, [collectionId, confirm, loadDocuments, mutationContext, onForbidden, runMutation, t])

  const columns = React.useMemo<ColumnDef<CollectionDocumentRecord>[]>(() => [
    {
      accessorKey: 'docType',
      header: t('export_finance.orders.collection.documents.columns.type'),
      enableSorting: false,
      meta: { priority: 1 },
      cell: ({ row }) => t(COLLECTION_DOC_TYPE_LABEL_KEYS[row.original.docType]),
    },
    {
      accessorKey: 'issuedAt',
      header: t('export_finance.orders.collection.documents.columns.issuedAt'),
      enableSorting: false,
      meta: { priority: 2 },
      cell: ({ row }) => (
        <DateValue value={row.original.issuedAt ? row.original.issuedAt.slice(0, 10) : null} locale={locale} />
      ),
    },
    {
      accessorKey: 'attachmentId',
      header: t('export_finance.orders.collection.documents.columns.attachment'),
      enableSorting: false,
      meta: { priority: 3 },
      cell: ({ row }) => {
        const attachmentId = row.original.attachmentId
        if (!attachmentId) return <span className="text-xs text-muted-foreground">{EMPTY_CELL}</span>
        return (
          <Link
            href={`/api/attachments/file/${encodeURIComponent(attachmentId)}?download=1`}
            className="text-sm text-primary hover:underline"
          >
            {t('export_finance.orders.collection.documents.download')}
          </Link>
        )
      },
    },
    {
      accessorKey: 'note',
      header: t('export_finance.orders.collection.documents.columns.note'),
      enableSorting: false,
      meta: { priority: 4, truncate: true, maxWidth: 240 },
      cell: ({ row }) => <TextValue value={row.original.note} />,
    },
  ], [locale, t])

  const handleSubmitForm = React.useCallback(() => {
    dialogContentRef.current?.querySelector('form')?.requestSubmit()
  }, [])
  const handleDialogKeyDown = useDialogKeyHandler({
    onConfirm: handleSubmitForm,
    onCancel: () => {
      setDialogOpen(false)
      setEditing(null)
    },
  })

  return (
    <>
      <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
        <SectionHeader title={t('export_finance.orders.collection.title')} />
        {isLoading ? (
          <LoadingMessage label={t('export_finance.orders.collection.loadFailed')} />
        ) : loadFailed ? (
          <ErrorMessage label={t('export_finance.orders.collection.loadFailed')} />
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-full space-y-1 sm:w-64">
                <Label htmlFor="collection-status">{t('export_finance.orders.collection.field.status')}</Label>
                <Select
                  value={statusValue}
                  disabled={!canManage || isSaving}
                  onValueChange={(next) => setStatusValue(next as ExportFinanceCollectionStatus)}
                >
                  <SelectTrigger id="collection-status" size="lg">
                    <SelectValue placeholder={EMPTY_CELL} />
                  </SelectTrigger>
                  <SelectContent>
                    {COLLECTION_STATUS_OPTIONS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(COLLECTION_STATUS_LABEL_KEYS[value])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {canManage ? (
                <Button type="button" disabled={isSaving} onClick={() => { void handleSave() }}>
                  {isSaving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                  {t('export_finance.orders.collection.save')}
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground" role="status">
                  {t('export_finance.orders.collection.readOnly')}
                </p>
              )}
            </div>
            {saveError ? (
              <p className="text-sm text-status-error-text" role="alert">{saveError}</p>
            ) : null}
            {!collection ? (
              <p className="text-sm text-muted-foreground">{t('export_finance.orders.collection.empty')}</p>
            ) : null}
          </>
        )}
      </div>

      {collectionId ? (
        <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
          <SectionHeader
            title={t('export_finance.orders.collection.documents.title')}
            count={documents.length}
            action={canManage ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditing(null)
                  setFormKey((previous) => previous + 1)
                  setDialogOpen(true)
                }}
              >
                <Plus className="size-4" aria-hidden="true" />
                {t('export_finance.orders.collection.documents.add')}
              </Button>
            ) : null}
          />
          {documentsLoadFailed ? (
            <p className="text-sm text-status-error-text" role="alert">
              {t('export_finance.orders.collection.documents.loadFailed')}
            </p>
          ) : (
            <DataTable<CollectionDocumentRecord>
              embedded
              columns={columns}
              data={documents}
              disableRowClick
              emptyState={(
                <EmptyState
                  variant="subtle"
                  size="sm"
                  title={t('export_finance.orders.collection.documents.empty')}
                />
              )}
              rowActions={(row) => (
                <RowActions
                  items={[
                    ...(row.attachmentId ? [{
                      id: 'download',
                      label: t('export_finance.orders.collection.documents.download'),
                      href: `/api/attachments/file/${encodeURIComponent(row.attachmentId)}?download=1`,
                    }] : []),
                    ...(canManage ? [{
                      id: 'edit',
                      label: t('export_finance.orders.collection.documents.edit'),
                      onSelect: () => {
                        setEditing(row)
                        setFormKey((previous) => previous + 1)
                        setDialogOpen(true)
                      },
                    }, {
                      id: 'delete',
                      label: t('export_finance.orders.collection.documents.delete'),
                      destructive: true,
                      onSelect: () => { void handleRemove(row) },
                    }] : []),
                  ]}
                />
              )}
            />
          )}
        </div>
      ) : null}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent ref={dialogContentRef} onKeyDown={handleDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>
              {t(editing
                ? 'export_finance.orders.collection.documents.dialog.editTitle'
                : 'export_finance.orders.collection.documents.dialog.createTitle')}
            </DialogTitle>
            <DialogDescription>{t('export_finance.orders.collection.documents.title')}</DialogDescription>
          </DialogHeader>
          <CrudForm<CollectionDocumentFormValues>
            key={`${editing?.id ?? 'new'}-${formKey}`}
            embedded
            fields={fields}
            groups={groups}
            initialValues={initialValues}
            submitLabel={t('export_finance.orders.collection.save')}
            onSubmit={handleSubmit}
          />
        </DialogContent>
      </Dialog>

      {ConfirmDialogElement}
    </>
  )
}

/**
 * 出口退税 is declared per container, so this block is read-only: it shows where each container
 * stands and sends the operator to the container file to register the amount.
 */
function OrderRefundNoteSection({ row }: { row: OrderFileRow }) {
  const t = useT()

  return (
    <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
      <SectionHeader title={t('export_finance.orders.detail.section.refundNote')} />
      <p className="text-sm text-muted-foreground">{t('export_finance.orders.detail.refundNote.hint')}</p>
      {row.containers.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('export_finance.orders.detail.refundNote.empty')}</p>
      ) : (
        <ul className="space-y-1.5">
          {row.containers.map((container) => (
            <li
              key={container.shipmentId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  {container.shipmentNumber ?? t('cross_border.shipments.status.draft')}
                </span>
                <RefundStatusBadge status={container.taxRefundStatus} />
                <AmountValue value={container.taxRefundAmount} />
                {container.taxRefundNote ? (
                  <span className="text-sm text-muted-foreground">{container.taxRefundNote}</span>
                ) : null}
              </div>
              <Link
                href={`${CONTAINERS_LIST_HREF}/${encodeURIComponent(container.shipmentId)}`}
                className="text-sm text-primary hover:underline"
              >
                {t('export_finance.orders.detail.checklist.goToContainer')}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function OrderFileDetail({ purchaseOrderId }: { purchaseOrderId: string }) {
  const t = useT()
  const locale = useLocale()
  const scopeVersion = useOrganizationScopeVersion()
  const [activeTab, setActiveTab] = React.useState<'business' | 'finance'>('business')
  // Optimistic until the capability probe answers: a failed probe must never lock a manager out.
  const [canManage, setCanManage] = React.useState(true)

  const { data, isLoading, error } = useQuery({
    queryKey: ['export-finance-order-file', purchaseOrderId, scopeVersion],
    queryFn: async () => {
      const payload = await fetchCrudList<OrderFileRow>(ORDER_FILES_API_PATH, {
        purchaseOrderId,
        pageSize: 1,
      })
      return payload.items?.[0] ?? null
    },
  })

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const call = await apiCall<{ granted?: string[] }>(
        '/api/auth/feature-check',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: [MANAGE_FEATURE] }),
        },
        { fallback: null },
      )
      if (cancelled || !call.ok) return
      setCanManage(Boolean(call.result?.granted?.includes(MANAGE_FEATURE)))
    })()
    return () => { cancelled = true }
  }, [scopeVersion])

  const markReadOnly = React.useCallback(() => setCanManage(false), [])

  if (isLoading && !data) {
    return <LoadingMessage label={t('export_finance.orders.errors.loadFailed')} />
  }

  if (error) {
    return (
      <ErrorMessage
        label={error instanceof Error && error.message
          ? error.message
          : t('export_finance.orders.errors.loadFailed')}
      />
    )
  }

  if (!data) {
    return (
      <RecordNotFoundState
        label={t('export_finance.orders.errors.notFound')}
        backHref={ORDER_FILES_LIST_HREF}
      />
    )
  }

  const row = data
  const purchaseOrderNumber = row.businessNumber ?? row.number ?? null

  return (
    <>
      <FormHeader
        mode="detail"
        backHref={ORDER_FILES_LIST_HREF}
        entityTypeLabel={t('export_finance.orders.detail.title')}
        title={row.businessNumber ?? row.number ?? EMPTY_CELL}
        subtitle={row.supplierName ?? undefined}
        statusBadge={<BusinessStatusBadge status={row.businessStatus} />}
        actionsContent={(
          <SegmentedControl
            value={activeTab}
            onValueChange={(next) => setActiveTab(next === 'finance' ? 'finance' : 'business')}
            aria-label={t('export_finance.orders.detail.title')}
          >
            <SegmentedControlItem value="business">
              {t('export_finance.orders.page.tab.business')}
            </SegmentedControlItem>
            <SegmentedControlItem value="finance">
              {t('export_finance.orders.page.tab.finance')}
            </SegmentedControlItem>
          </SegmentedControl>
        )}
      />

      {activeTab === 'business' ? (
        <>
          <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
            <SectionHeader title={t('export_finance.orders.detail.section.summary')} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
              <SummaryField label={t('export_finance.orders.detail.field.businessNumber')}>
                <TextValue value={row.businessNumber} />
              </SummaryField>
              <SummaryField label={t('export_finance.orders.detail.field.number')}>
                <TextValue value={row.number} />
              </SummaryField>
              <SummaryField label={t('export_finance.orders.detail.field.supplier')}>
                <TextValue value={row.supplierName} />
              </SummaryField>
              <SummaryField label={t('export_finance.orders.detail.field.customer')}>
                <TextValue value={row.customerName} />
              </SummaryField>
              <SummaryField label={t('export_finance.orders.detail.field.owner')}>
                <TextValue value={row.ownerName} />
              </SummaryField>
              <SummaryField label={t('export_finance.orders.detail.field.productCategory')}>
                <TextValue value={row.productCategory} />
              </SummaryField>
              <SummaryField label={t('export_finance.orders.detail.field.status')}>
                <BusinessStatusBadge status={row.businessStatus} />
              </SummaryField>
              <SummaryField label={t('export_finance.orders.detail.field.placedAt')}>
                <DateValue value={row.placedAt} locale={locale} />
              </SummaryField>
              <SummaryField label={t('export_finance.orders.detail.field.expectedDeliveryAt')}>
                <DateValue value={row.expectedDeliveryAt} locale={locale} />
              </SummaryField>
              <SummaryField label={t('export_finance.orders.detail.field.shipmentEtd')}>
                <DateValue value={row.shipmentEtd} locale={locale} />
              </SummaryField>
              <SummaryField label={t('export_finance.orders.detail.field.departedAt')}>
                <DateValue value={row.shipmentDepartedAt} locale={locale} />
              </SummaryField>
              <SummaryField label={t('export_finance.orders.detail.field.receivedAt')}>
                <DateValue value={row.receivedAt} locale={locale} />
              </SummaryField>
              <SummaryField label={t('export_finance.orders.detail.field.containerType')}>
                <TextValue value={row.containerType} />
              </SummaryField>
              <SummaryField label={t('export_finance.orders.detail.field.containerNumber')}>
                <TextValue value={row.containerNumber} />
              </SummaryField>
              <SummaryField label={t('export_finance.orders.detail.field.sealNumber')}>
                <TextValue value={row.sealNumber} />
              </SummaryField>
              <SummaryField label={t('export_finance.orders.detail.field.bookingNumber')}>
                <TextValue value={row.bookingNumber} />
              </SummaryField>
              <SummaryField label={t('export_finance.orders.detail.field.shipmentCount')}>
                <span className="tabular-nums">{row.shipmentCount}</span>
              </SummaryField>
            </div>
          </div>

          <OrderContainersSection row={row} />
          <OrderChecklistSection row={row} />
        </>
      ) : (
        <>
          <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
            <SectionHeader title={t('export_finance.orders.detail.section.finance')} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
              <SummaryField label={t('export_finance.orders.detail.finance.orderAmount')}>
                <AmountValue value={row.finance.orderAmount} />
              </SummaryField>
              <SummaryField label={t('export_finance.orders.detail.finance.depositPlanned')}>
                <AmountValue value={row.finance.depositPlanned} />
              </SummaryField>
              <SummaryField label={t('export_finance.orders.detail.finance.balancePlanned')}>
                <AmountValue value={row.finance.balancePlanned} />
              </SummaryField>
              <SummaryField label={t('export_finance.orders.detail.finance.paidAmount')}>
                <AmountValue value={row.finance.paidAmount} />
              </SummaryField>
              <SummaryField label={t('export_finance.orders.detail.finance.outstandingAmount')}>
                <AmountValue value={row.finance.outstandingAmount} />
              </SummaryField>
              <SummaryField label={t('export_finance.orders.detail.finance.kcPrice')}>
                <AmountValue value={row.finance.kcPriceAmount} currency={row.finance.kcPriceCurrency} />
              </SummaryField>
              <SummaryField label={t('export_finance.orders.detail.finance.subsidiaryInvoice')}>
                <AmountValue
                  value={row.finance.subsidiaryInvoiceAmount}
                  currency={row.finance.subsidiaryInvoiceCurrency}
                />
              </SummaryField>
              <SummaryField label={t('export_finance.orders.detail.finance.exchangeRate')}>
                <TextValue value={row.finance.exchangeRate} />
              </SummaryField>
              <SummaryField label={t('export_finance.orders.detail.finance.allocatedRefund')}>
                <AmountValue value={row.allocatedRefundAmount} />
              </SummaryField>
              <SummaryField label={t('export_finance.orders.collection.field.status')}>
                <CollectionStatusBadge status={row.collectionStatus} />
              </SummaryField>
              <SummaryField label={t('export_finance.orders.columns.refundStatus')}>
                <RefundStatusBadge status={row.refundStatus} />
              </SummaryField>
            </div>
          </div>

          <OrderCollectionSection
            purchaseOrderId={row.purchaseOrderId}
            purchaseOrderNumber={purchaseOrderNumber}
            canManage={canManage}
            onForbidden={markReadOnly}
          />
          <OrderRefundNoteSection row={row} />
        </>
      )}
    </>
  )
}
