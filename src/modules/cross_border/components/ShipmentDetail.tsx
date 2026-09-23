"use client"

import * as React from 'react'
import Link from 'next/link'
import { z } from 'zod'
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
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, deleteCrud, fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { ActivityFeed, ActivityFeedItem } from '@open-mercato/ui/primitives/activity-feed'
import { formatDisplayDate, formatDisplayDateTime } from '@open-mercato/ui/primitives/date-format'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useLocale, useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import {
  SHIPMENT_ALLOCATIONS_API_PATH,
  SHIPMENT_ATTACHMENT_ENTITY_ID,
  SHIPMENT_CANCEL_API_PATH,
  SHIPMENT_DEPART_API_PATH,
  SHIPMENT_DOCUMENTS_API_PATH,
  SHIPMENT_DOCUMENT_TYPES,
  SHIPMENT_MILESTONES,
  SHIPMENT_MILESTONES_API_PATH,
  SHIPMENT_RECEIVE_API_PATH,
  SHIPMENTS_API_PATH,
  SHIPMENTS_LIST_HREF,
  ShipmentDestinationFields,
  ShipmentStatusBadge,
  buildDocumentPayload,
  buildMilestonePayload,
  formatShipmentDate,
  shipmentDocumentTypeLabel,
  shipmentErrorMessage,
  shipmentMilestoneLabel,
  toLocalDateTimeInputValue,
  toShipmentRecord,
  trimShipmentQuantity,
  type ShipmentDocumentFormValues,
  type ShipmentDocumentType,
  type ShipmentMilestone,
  type ShipmentMilestoneFormValues,
  type ShipmentRecord,
  type ShipmentStatus,
} from './ShipmentForm'

const ALLOCATION_PAGE_SIZE = 200
const MILESTONE_PAGE_SIZE = 100
const DOCUMENT_PAGE_SIZE = 100
const EMPTY_CELL = '—'

/** A shipment allocation as `/api/cross_border/shipments/allocations` projects it. */
export type ShipmentAllocationRecord = {
  id: string
  purchaseOrderId: string
  purchaseOrderNumber: string | null
  purchaseOrderLineId: string
  catalogProductId: string | null
  productTitle: string | null
  productSku: string | null
  supplierSku: string | null
  quantity: string
  receivedQuantity: string | null
}

/** A milestone row as `/api/cross_border/shipments/milestones` projects it. */
export type ShipmentMilestoneRecord = {
  id: string
  milestone: ShipmentMilestone | null
  occurredAt: string | null
  note: string | null
}

/** An export document as `/api/cross_border/shipments/documents` projects it. */
export type ShipmentDocumentRecord = {
  id: string
  shipmentId: string
  purchaseOrderId: string | null
  docType: ShipmentDocumentType
  documentNumber: string | null
  issuedAt: string | null
  attachmentId: string | null
  note: string | null
}

/** Only the actions the current status allows — mirroring the command's transition table. */
type ShipmentAction = 'depart' | 'receive' | 'cancel'

const SHIPMENT_ACTIONS_BY_STATUS: Record<ShipmentStatus, readonly ShipmentAction[]> = {
  draft: ['depart', 'cancel'],
  in_transit: ['receive', 'cancel'],
  received: [],
  cancelled: [],
}

const SHIPMENT_ACTION_LABEL_KEYS: Record<ShipmentAction, string> = {
  depart: 'cross_border.shipments.actions.depart',
  receive: 'cross_border.shipments.actions.receive',
  cancel: 'cross_border.shipments.actions.cancel',
}

const SHIPMENT_ACTION_PATHS: Record<ShipmentAction, string> = {
  depart: SHIPMENT_DEPART_API_PATH,
  receive: SHIPMENT_RECEIVE_API_PATH,
  cancel: SHIPMENT_CANCEL_API_PATH,
}

function readRecordText(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string') return value
  }
  return ''
}

function readRecordOptionalText(source: Record<string, unknown>, ...keys: string[]): string | null {
  const value = readRecordText(source, ...keys).trim()
  return value.length ? value : null
}

function toShipmentAllocationRecord(item: Record<string, unknown>): ShipmentAllocationRecord {
  return {
    id: readRecordText(item, 'id'),
    purchaseOrderId: readRecordText(item, 'purchaseOrderId', 'purchase_order_id'),
    purchaseOrderNumber: readRecordOptionalText(item, 'purchaseOrderNumber', 'purchase_order_number'),
    purchaseOrderLineId: readRecordText(item, 'purchaseOrderLineId', 'purchase_order_line_id'),
    catalogProductId: readRecordOptionalText(item, 'catalogProductId', 'catalog_product_id'),
    productTitle: readRecordOptionalText(item, 'productTitle', 'product_title'),
    productSku: readRecordOptionalText(item, 'productSku', 'product_sku'),
    supplierSku: readRecordOptionalText(item, 'supplierSku', 'supplier_sku'),
    quantity: readRecordText(item, 'quantity') || '0',
    receivedQuantity: readRecordOptionalText(item, 'receivedQuantity', 'received_quantity'),
  }
}

function toShipmentMilestoneRecord(item: Record<string, unknown>): ShipmentMilestoneRecord {
  const milestone = item.milestone
  return {
    id: readRecordText(item, 'id'),
    milestone: SHIPMENT_MILESTONES.includes(milestone as ShipmentMilestone)
      ? (milestone as ShipmentMilestone)
      : null,
    occurredAt: readRecordOptionalText(item, 'occurredAt', 'occurred_at'),
    note: readRecordOptionalText(item, 'note'),
  }
}

function toShipmentDocumentRecord(item: Record<string, unknown>): ShipmentDocumentRecord {
  const docType = item.docType ?? item.doc_type
  return {
    id: readRecordText(item, 'id'),
    shipmentId: readRecordText(item, 'shipmentId', 'shipment_id'),
    purchaseOrderId: readRecordOptionalText(item, 'purchaseOrderId', 'purchase_order_id'),
    docType: SHIPMENT_DOCUMENT_TYPES.includes(docType as ShipmentDocumentType)
      ? (docType as ShipmentDocumentType)
      : 'other',
    documentNumber: readRecordOptionalText(item, 'documentNumber', 'document_number'),
    issuedAt: readRecordOptionalText(item, 'issuedAt', 'issued_at'),
    attachmentId: readRecordOptionalText(item, 'attachmentId', 'attachment_id'),
    note: readRecordOptionalText(item, 'note'),
  }
}

function SummaryField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  )
}

function buildAllocationColumns(t: TranslateFn): ColumnDef<ShipmentAllocationRecord>[] {
  return [
    {
      accessorKey: 'purchaseOrderNumber',
      header: t('cross_border.shipments.allocations.purchaseOrder'),
      enableSorting: false,
      meta: { priority: 1, truncate: true, maxWidth: 240 },
      cell: ({ row }) => row.original.purchaseOrderNumber ?? row.original.purchaseOrderId ?? EMPTY_CELL,
    },
    {
      accessorKey: 'productTitle',
      header: t('cross_border.shipments.allocations.product'),
      enableSorting: false,
      meta: { priority: 2, truncate: true, maxWidth: 320 },
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span>{row.original.productTitle ?? EMPTY_CELL}</span>
          {row.original.productSku ? (
            <span className="text-xs text-muted-foreground">{row.original.productSku}</span>
          ) : null}
          {row.original.supplierSku ? (
            <span className="text-xs text-muted-foreground">
              {t('cross_border.shipments.allocations.supplierSku')}: {row.original.supplierSku}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: 'quantity',
      header: t('cross_border.shipments.allocations.quantity'),
      enableSorting: false,
      meta: { priority: 3, align: 'right' },
      cell: ({ row }) => trimShipmentQuantity(row.original.quantity),
    },
    {
      accessorKey: 'receivedQuantity',
      // The received column reuses the `received` status label: the allocation contract has no
      // dedicated column key, and the label is the same word the shipment's own state uses.
      header: t('cross_border.shipments.status.received'),
      enableSorting: false,
      meta: { priority: 4, align: 'right' },
      cell: ({ row }) => {
        const received = row.original.receivedQuantity
        return received ? trimShipmentQuantity(received) : <span className="text-xs text-muted-foreground">{EMPTY_CELL}</span>
      },
    },
  ]
}

/**
 * The upload control for a document's file. It talks to the shared attachments endpoint
 * (`POST /api/attachments`, multipart) exactly as the installed attachment surfaces do, and hands
 * the returned id back to the form — the document command stores that id, never a byte of file.
 */
function ShipmentDocumentAttachmentField({
  value,
  setValue,
  disabled,
  shipmentId,
}: CrudCustomFieldRenderProps & { shipmentId: string }) {
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
      body.set('entityId', SHIPMENT_ATTACHMENT_ENTITY_ID)
      body.set('recordId', shipmentId)
      body.set('file', file)
      const call = await apiCall<{ item?: { id?: string }; error?: string }>(
        '/api/attachments',
        { method: 'POST', body },
        { fallback: null },
      )
      const uploadedId = call.ok && typeof call.result?.item?.id === 'string' ? call.result.item.id : ''
      if (!uploadedId) {
        throw new Error(call.result?.error || t('cross_border.shipments.documents.saveFailed'))
      }
      setValue(uploadedId)
      setFileName(file.name)
    } catch (cause) {
      setError(shipmentErrorMessage(cause, t('cross_border.shipments.documents.saveFailed')))
    } finally {
      setIsUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }, [setValue, shipmentId, t])

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={disabled || isUploading}
          onClick={() => inputRef.current?.click()}
        >
          {isUploading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Upload className="size-4" aria-hidden="true" />}
          {t('cross_border.shipments.documents.field.attachment')}
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
            {t('cross_border.shipments.documents.remove')}
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

function ShipmentMilestonesSection({
  shipmentId,
  milestones,
  onChanged,
}: {
  shipmentId: string
  milestones: ShipmentMilestoneRecord[]
  onChanged: () => Promise<void>
}) {
  const t = useT()
  const locale = useLocale()
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const dialogContentRef = React.useRef<HTMLDivElement | null>(null)

  const mutationContextId = React.useMemo(() => `cross_border.shipment-milestone:${shipmentId}`, [shipmentId])
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId?: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: mutationContextId })

  const mutationContext = React.useMemo(() => ({
    formId: mutationContextId,
    resourceKind: 'cross_border.shipment_milestone',
    resourceId: shipmentId,
    retryLastMutation,
  }), [mutationContextId, retryLastMutation, shipmentId])

  // Recomputed each time the dialog opens so the stamp starts at the moment of recording, and
  // stable while it stays open so the form never re-seeds under the operator's typing.
  const initialValues = React.useMemo<ShipmentMilestoneFormValues>(() => ({
    milestone: '',
    occurredAt: toLocalDateTimeInputValue(new Date()),
    note: '',
  // The open flag is the trigger, not a value read in the body: the memo must rebuild when the
  // dialog opens so the date stamp is fresh, and stay stable while it is open.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate re-seed on dialog open
  }), [dialogOpen])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'milestone',
      label: t('cross_border.shipments.milestones.field.milestone'),
      type: 'select',
      required: true,
      options: SHIPMENT_MILESTONES.map((value) => ({ value, label: shipmentMilestoneLabel(t, value) })),
    },
    {
      id: 'occurredAt',
      label: t('cross_border.shipments.milestones.field.occurredAt'),
      type: 'datetime-local',
    },
    {
      id: 'note',
      label: t('cross_border.shipments.milestones.field.note'),
      type: 'textarea',
    },
  ], [t])

  const handleSubmit = React.useCallback(async (values: ShipmentMilestoneFormValues) => {
    const payload = buildMilestonePayload(shipmentId, values)
    try {
      await runMutation({
        operation: () => createCrud(
          SHIPMENT_MILESTONES_API_PATH,
          payload,
          { errorMessage: t('cross_border.shipments.milestones.recordFailed') },
        ),
        context: mutationContext,
        mutationPayload: payload,
      })
    } catch (error) {
      // A rejected stage (the command refuses to walk backwards) must leave the dialog open with
      // the server's reason on screen, so the form keeps ownership of the message.
      surfaceRecordConflict(error, t, { onRefresh: () => void onChanged() })
      throw error
    }
    flash(t('cross_border.shipments.milestones.recorded'), 'success')
    setDialogOpen(false)
    await onChanged()
  }, [mutationContext, onChanged, runMutation, shipmentId, t])

  const handleSubmitForm = React.useCallback(() => {
    dialogContentRef.current?.querySelector('form')?.requestSubmit()
  }, [])
  const handleDialogKeyDown = useDialogKeyHandler({
    onConfirm: handleSubmitForm,
    onCancel: () => setDialogOpen(false),
  })

  const ordered = React.useMemo(
    () => [...milestones].sort((left, right) => (left.occurredAt ?? '').localeCompare(right.occurredAt ?? '')),
    [milestones],
  )

  return (
    <>
      <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
        <SectionHeader
          title={t('cross_border.shipments.milestones.title')}
          count={milestones.length}
          action={(
            <Button type="button" variant="outline" onClick={() => setDialogOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              {t('cross_border.shipments.actions.recordMilestone')}
            </Button>
          )}
        />
        {ordered.length ? (
          <ActivityFeed>
            {ordered.map((item) => (
              <ActivityFeedItem
                key={item.id}
                title={item.milestone ? shipmentMilestoneLabel(t, item.milestone) : EMPTY_CELL}
                timestamp={formatDisplayDateTime(item.occurredAt, locale) ?? undefined}
              >
                {item.note ? <p className="text-sm text-muted-foreground">{item.note}</p> : null}
              </ActivityFeedItem>
            ))}
          </ActivityFeed>
        ) : null}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent ref={dialogContentRef} onKeyDown={handleDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>{t('cross_border.shipments.milestones.title')}</DialogTitle>
            <DialogDescription>{t('cross_border.shipments.list.columns.milestone')}</DialogDescription>
          </DialogHeader>
          <CrudForm<ShipmentMilestoneFormValues>
            embedded
            fields={fields}
            initialValues={initialValues}
            submitLabel={t('cross_border.shipments.actions.recordMilestone')}
            onSubmit={handleSubmit}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}

function ShipmentDocumentsSection({
  shipmentId,
  documents,
  onChanged,
}: {
  shipmentId: string
  documents: ShipmentDocumentRecord[]
  onChanged: () => Promise<void>
}) {
  const t = useT()
  const locale = useLocale()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const dialogContentRef = React.useRef<HTMLDivElement | null>(null)

  const mutationContextId = React.useMemo(() => `cross_border.shipment-document:${shipmentId}`, [shipmentId])
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId?: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: mutationContextId })

  const mutationContext = React.useMemo(() => ({
    formId: mutationContextId,
    resourceKind: 'cross_border.export_document',
    resourceId: shipmentId,
    retryLastMutation,
  }), [mutationContextId, retryLastMutation, shipmentId])

  // The document type is deliberately not pre-filled: guessing the paperwork an operator is
  // filing would record the wrong type silently, and the select is required besides.
  const initialValues = React.useMemo<ShipmentDocumentFormValues>(() => ({
    docType: '',
    documentNumber: '',
    issuedAt: '',
    attachmentId: '',
    note: '',
  // The open flag is the trigger, not a value read in the body: the memo must rebuild when the
  // dialog opens so the date stamp is fresh, and stay stable while it is open.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate re-seed on dialog open
  }), [dialogOpen])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'docType',
      label: t('cross_border.shipments.documents.field.docType'),
      type: 'select',
      required: true,
      options: SHIPMENT_DOCUMENT_TYPES.map((value) => ({ value, label: shipmentDocumentTypeLabel(t, value) })),
    },
    {
      id: 'documentNumber',
      label: t('cross_border.shipments.documents.field.documentNumber'),
      type: 'text',
    },
    {
      id: 'issuedAt',
      label: t('cross_border.shipments.documents.field.issuedAt'),
      type: 'date',
    },
    {
      id: 'attachmentId',
      label: t('cross_border.shipments.documents.field.attachment'),
      type: 'custom',
      rendersOwnError: true,
      component: (props) => <ShipmentDocumentAttachmentField {...props} shipmentId={shipmentId} />,
    },
    {
      id: 'note',
      label: t('cross_border.shipments.documents.field.note'),
      type: 'textarea',
    },
  ], [shipmentId, t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'documentDetails', column: 1, fields: ['docType', 'documentNumber', 'attachmentId'] },
    { id: 'documentStamp', column: 2, fields: ['issuedAt', 'note'] },
  ], [])

  const handleSubmit = React.useCallback(async (values: ShipmentDocumentFormValues) => {
    const payload = buildDocumentPayload(shipmentId, values)
    try {
      await runMutation({
        operation: () => createCrud(
          SHIPMENT_DOCUMENTS_API_PATH,
          payload,
          { errorMessage: t('cross_border.shipments.documents.saveFailed') },
        ),
        context: mutationContext,
        mutationPayload: payload,
      })
    } catch (error) {
      surfaceRecordConflict(error, t, { onRefresh: () => void onChanged() })
      throw error
    }
    flash(t('cross_border.shipments.documents.saved'), 'success')
    setDialogOpen(false)
    await onChanged()
  }, [mutationContext, onChanged, runMutation, shipmentId, t])

  const handleRemove = React.useCallback(async (document: ShipmentDocumentRecord) => {
    const confirmed = await confirm({
      title: t('cross_border.shipments.documents.remove'),
      confirmText: t('cross_border.shipments.documents.remove'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await runMutation({
        operation: () => deleteCrud(
          SHIPMENT_DOCUMENTS_API_PATH,
          { id: document.id, errorMessage: t('cross_border.shipments.documents.saveFailed') },
        ),
        context: mutationContext,
        mutationPayload: { id: document.id },
      })
      await onChanged()
    } catch (error) {
      if (surfaceRecordConflict(error, t, { onRefresh: () => void onChanged() })) return
      flash(shipmentErrorMessage(error, t('cross_border.shipments.documents.saveFailed')), 'error')
    }
  }, [confirm, mutationContext, onChanged, runMutation, t])

  const columns = React.useMemo<ColumnDef<ShipmentDocumentRecord>[]>(() => [
    {
      accessorKey: 'docType',
      header: t('cross_border.shipments.documents.field.docType'),
      enableSorting: false,
      meta: { priority: 1 },
      cell: ({ row }) => shipmentDocumentTypeLabel(t, row.original.docType),
    },
    {
      accessorKey: 'documentNumber',
      header: t('cross_border.shipments.documents.field.documentNumber'),
      enableSorting: false,
      meta: { priority: 2, truncate: true, maxWidth: 240 },
      cell: ({ row }) => row.original.documentNumber ?? <span className="text-xs text-muted-foreground">{EMPTY_CELL}</span>,
    },
    {
      accessorKey: 'issuedAt',
      header: t('cross_border.shipments.documents.field.issuedAt'),
      enableSorting: false,
      meta: { priority: 3 },
      cell: ({ row }) => formatShipmentDate(row.original.issuedAt, locale) ?? <span className="text-xs text-muted-foreground">{EMPTY_CELL}</span>,
    },
    {
      accessorKey: 'attachmentId',
      header: t('cross_border.shipments.documents.field.attachment'),
      enableSorting: false,
      meta: { priority: 4 },
      cell: ({ row }) => {
        const attachmentId = row.original.attachmentId
        if (!attachmentId) return <span className="text-xs text-muted-foreground">{EMPTY_CELL}</span>
        return (
          <Link
            href={`/api/attachments/file/${encodeURIComponent(attachmentId)}?download=1`}
            className="text-sm text-primary hover:underline"
          >
            {t('cross_border.shipments.documents.field.attachment')}
          </Link>
        )
      },
    },
    {
      accessorKey: 'note',
      header: t('cross_border.shipments.documents.field.note'),
      enableSorting: false,
      meta: { priority: 5, truncate: true, maxWidth: 240 },
      cell: ({ row }) => row.original.note ?? <span className="text-xs text-muted-foreground">{EMPTY_CELL}</span>,
    },
  ], [locale, t])

  const handleSubmitForm = React.useCallback(() => {
    dialogContentRef.current?.querySelector('form')?.requestSubmit()
  }, [])
  const handleDialogKeyDown = useDialogKeyHandler({
    onConfirm: handleSubmitForm,
    onCancel: () => setDialogOpen(false),
  })

  return (
    <>
      <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
        <SectionHeader
          title={t('cross_border.shipments.documents.title')}
          count={documents.length}
          action={(
            <Button type="button" variant="outline" onClick={() => setDialogOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              {t('cross_border.shipments.actions.addDocument')}
            </Button>
          )}
        />
        <DataTable<ShipmentDocumentRecord>
          embedded
          columns={columns}
          data={documents}
          disableRowClick
          emptyState={(
            <EmptyState
              variant="subtle"
              size="sm"
              title={t('cross_border.shipments.documents.empty')}
            />
          )}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'remove',
                  label: t('cross_border.shipments.documents.remove'),
                  destructive: true,
                  onSelect: () => { void handleRemove(row) },
                },
              ]}
            />
          )}
        />
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent ref={dialogContentRef} onKeyDown={handleDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>{t('cross_border.shipments.actions.addDocument')}</DialogTitle>
            <DialogDescription>{t('cross_border.shipments.documents.title')}</DialogDescription>
          </DialogHeader>
          <CrudForm<ShipmentDocumentFormValues>
            embedded
            fields={fields}
            groups={groups}
            initialValues={initialValues}
            submitLabel={t('cross_border.shipments.actions.addDocument')}
            onSubmit={handleSubmit}
          />
        </DialogContent>
      </Dialog>

      {ConfirmDialogElement}
    </>
  )
}

type ReceiveFormValues = {
  destinationWarehouseId: string
  destinationLocationId: string
}

type CancelFormValues = {
  reason: string
}

const EMPTY_CANCEL_VALUES: CancelFormValues = { reason: '' }

export default function ShipmentDetail({ shipmentId }: { shipmentId: string }) {
  const t = useT()
  const locale = useLocale()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [shipment, setShipment] = React.useState<ShipmentRecord | null>(null)
  const [allocations, setAllocations] = React.useState<ShipmentAllocationRecord[]>([])
  const [milestones, setMilestones] = React.useState<ShipmentMilestoneRecord[]>([])
  const [documents, setDocuments] = React.useState<ShipmentDocumentRecord[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)
  const [pendingAction, setPendingAction] = React.useState<ShipmentAction | null>(null)
  const [receiveDialogOpen, setReceiveDialogOpen] = React.useState(false)
  const [cancelDialogOpen, setCancelDialogOpen] = React.useState(false)
  const receiveDialogRef = React.useRef<HTMLDivElement | null>(null)
  const cancelDialogRef = React.useRef<HTMLDivElement | null>(null)

  const mutationContextId = React.useMemo(() => `cross_border.shipment:${shipmentId}`, [shipmentId])
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId?: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: mutationContextId })

  const mutationContext = React.useMemo(() => ({
    formId: mutationContextId,
    resourceKind: 'cross_border.shipment',
    resourceId: shipmentId,
    retryLastMutation,
  }), [mutationContextId, retryLastMutation, shipmentId])

  const load = React.useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    setNotFound(false)
    try {
      const [shipmentPayload, allocationPayload, milestonePayload, documentPayload] = await Promise.all([
        fetchCrudList<Record<string, unknown>>(SHIPMENTS_API_PATH, { ids: shipmentId, pageSize: 1 }),
        fetchCrudList<Record<string, unknown>>(SHIPMENT_ALLOCATIONS_API_PATH, {
          shipmentId,
          pageSize: ALLOCATION_PAGE_SIZE,
        }),
        fetchCrudList<Record<string, unknown>>(SHIPMENT_MILESTONES_API_PATH, {
          shipmentId,
          pageSize: MILESTONE_PAGE_SIZE,
        }),
        fetchCrudList<Record<string, unknown>>(SHIPMENT_DOCUMENTS_API_PATH, {
          shipmentId,
          pageSize: DOCUMENT_PAGE_SIZE,
        }),
      ])
      const item = shipmentPayload.items?.[0]
      if (!item) {
        setShipment(null)
        setAllocations([])
        setMilestones([])
        setDocuments([])
        setNotFound(true)
        return
      }
      setShipment(toShipmentRecord(item))
      setAllocations((allocationPayload.items ?? []).map(toShipmentAllocationRecord))
      setMilestones((milestonePayload.items ?? []).map(toShipmentMilestoneRecord))
      setDocuments((documentPayload.items ?? []).map(toShipmentDocumentRecord))
    } catch {
      setLoadError(t('cross_border.shipments.form.loadFailed'))
    } finally {
      setLoading(false)
    }
    // `scopeVersion` is not read inside the callback on purpose: it is the organization-scope
    // generation, and bumping it must rebuild this callback so the effect below refetches after
    // an organization switch. The rule cannot see that intent, so the dependency is explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate scope-change refetch
  }, [shipmentId, scopeVersion, t])

  React.useEffect(() => {
    void load()
  }, [load])

  const runAction = React.useCallback(async (action: ShipmentAction, payload: Record<string, unknown>) => {
    setPendingAction(action)
    try {
      await runMutation({
        operation: () => createCrud(
          SHIPMENT_ACTION_PATHS[action],
          { id: shipmentId, ...payload },
          { errorMessage: t('cross_border.shipments.form.saveFailed') },
        ),
        context: mutationContext,
        mutationPayload: { id: shipmentId, ...payload },
      })
      await load()
    } finally {
      setPendingAction(null)
    }
  }, [load, mutationContext, runMutation, shipmentId, t])

  const handleDepart = React.useCallback(async () => {
    const confirmed = await confirm({
      title: t('cross_border.shipments.departConfirmTitle'),
      text: t('cross_border.shipments.departConfirmBody'),
      confirmText: t('cross_border.shipments.actions.depart'),
    })
    if (!confirmed) return
    try {
      await runAction('depart', {})
    } catch (error) {
      if (surfaceRecordConflict(error, t, { onRefresh: () => void load() })) return
      flash(shipmentErrorMessage(error, t('cross_border.shipments.form.saveFailed')), 'error')
    }
  }, [confirm, load, runAction, t])

  // The receive dialog re-seeds from the shipment each time it opens (the operator may have just
  // corrected the destination), and holds its values steady while it stays open.
  const receiveInitialValues = React.useMemo<ReceiveFormValues>(() => ({
    destinationWarehouseId: shipment?.destinationWarehouseId ?? '',
    destinationLocationId: shipment?.destinationLocationId ?? '',
  // Same deliberate trigger as the milestone dialog: rebuild when the receive dialog opens.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate re-seed on dialog open
  }), [shipment, receiveDialogOpen])

  const handleReceiveSubmit = React.useCallback(async (values: ReceiveFormValues) => {
    const warehouseId = values.destinationWarehouseId.trim()
    const locationId = values.destinationLocationId.trim()
    // The command requires both, and the pair is picked by hand — a blank pick never leaves the
    // dialog, so the operator is told before a round trip that would fail anyway.
    if (!warehouseId || !locationId) {
      throw new Error(t('cross_border.shipments.receive.failed'))
    }
    try {
      await runAction('receive', { warehouseId, locationId })
    } catch (error) {
      // Nothing was booked: the command leaves the shipment in transit and re-running is safe.
      surfaceRecordConflict(error, t, { onRefresh: () => void load() })
      throw error
    }
    flash(t('cross_border.shipments.receive.succeeded'), 'success')
    setReceiveDialogOpen(false)
  }, [load, runAction, t])

  const handleReceiveSubmitForm = React.useCallback(() => {
    receiveDialogRef.current?.querySelector('form')?.requestSubmit()
  }, [])
  const handleReceiveDialogKeyDown = useDialogKeyHandler({
    onConfirm: handleReceiveSubmitForm,
    onCancel: () => setReceiveDialogOpen(false),
  })

  const cancelSchema = React.useMemo(() => z.object({
    reason: z.string().trim().min(1, 'cross_border.shipments.cancelReasonRequired'),
  }), [])

  const cancelFields = React.useMemo<CrudField[]>(() => [
    {
      id: 'reason',
      label: t('cross_border.shipments.cancelReason'),
      type: 'textarea',
      required: true,
    },
  ], [t])

  const handleCancelSubmit = React.useCallback(async (values: CancelFormValues) => {
    // A cancelled shipment accepts no further actions, so the dialog stays open until the command
    // accepts the reason — a rejected cancellation must not look like a success.
    try {
      await runAction('cancel', { reason: values.reason.trim() })
    } catch (error) {
      surfaceRecordConflict(error, t, { onRefresh: () => void load() })
      throw error
    }
    setCancelDialogOpen(false)
  }, [load, runAction, t])

  const handleCancelSubmitForm = React.useCallback(() => {
    cancelDialogRef.current?.querySelector('form')?.requestSubmit()
  }, [])
  const handleCancelDialogKeyDown = useDialogKeyHandler({
    onConfirm: handleCancelSubmitForm,
    onCancel: () => setCancelDialogOpen(false),
  })

  const allocationColumns = React.useMemo(() => buildAllocationColumns(t), [t])

  if (loading && !shipment) return <LoadingMessage label={t('cross_border.shipments.form.loadFailed')} />

  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('cross_border.shipments.form.loadFailed')}
        backHref={SHIPMENTS_LIST_HREF}
      />
    )
  }

  if (loadError || !shipment) {
    return <ErrorMessage label={loadError ?? t('cross_border.shipments.form.loadFailed')} />
  }

  const actions = SHIPMENT_ACTIONS_BY_STATUS[shipment.status]

  return (
    <>
      <FormHeader
        mode="detail"
        backHref={SHIPMENTS_LIST_HREF}
        entityTypeLabel={t('cross_border.shipments.page.title')}
        title={shipment.number ?? t('cross_border.shipments.status.draft')}
        statusBadge={<ShipmentStatusBadge status={shipment.status} />}
        actionsContent={actions.length ? (
          <div className="flex flex-wrap items-center gap-2">
            {actions.map((action) => (
              <Button
                key={action}
                type="button"
                variant={action === 'cancel' ? 'destructive' : 'default'}
                disabled={pendingAction !== null}
                onClick={() => {
                  if (action === 'depart') {
                    void handleDepart()
                    return
                  }
                  if (action === 'receive') {
                    setReceiveDialogOpen(true)
                    return
                  }
                  setCancelDialogOpen(true)
                }}
              >
                {pendingAction === action ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                {t(SHIPMENT_ACTION_LABEL_KEYS[action])}
              </Button>
            ))}
          </div>
        ) : undefined}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
        <SummaryField label={t('cross_border.shipments.form.field.carrierName')}>
          {shipment.carrierName ?? EMPTY_CELL}
        </SummaryField>
        <SummaryField label={t('cross_border.shipments.form.field.departurePort')}>
          {shipment.departurePort ?? EMPTY_CELL}
        </SummaryField>
        <SummaryField label={t('cross_border.shipments.field.containerType')}>
          {shipment.containerType ?? EMPTY_CELL}
        </SummaryField>
        <SummaryField label={t('cross_border.shipments.field.containerNumber')}>
          {shipment.containerNumber ?? EMPTY_CELL}
        </SummaryField>
        <SummaryField label={t('cross_border.shipments.field.sealNumber')}>
          {shipment.sealNumber ?? EMPTY_CELL}
        </SummaryField>
        <SummaryField label={t('cross_border.shipments.field.bookingNumber')}>
          {shipment.bookingNumber ?? EMPTY_CELL}
        </SummaryField>
        <SummaryField label={t('cross_border.shipments.list.columns.eta')}>
          {formatShipmentDate(shipment.eta, locale) ?? EMPTY_CELL}
        </SummaryField>
        <SummaryField label={t('cross_border.shipments.list.columns.milestone')}>
          {shipment.currentMilestone ? shipmentMilestoneLabel(t, shipment.currentMilestone) : EMPTY_CELL}
        </SummaryField>
      </div>

      <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
        <SectionHeader title={t('cross_border.shipments.allocations.title')} count={allocations.length} />
        <DataTable<ShipmentAllocationRecord>
          embedded
          columns={allocationColumns}
          data={allocations}
          disableRowClick
        />
      </div>

      <ShipmentMilestonesSection
        shipmentId={shipment.id}
        milestones={milestones}
        onChanged={load}
      />

      <ShipmentDocumentsSection
        shipmentId={shipment.id}
        documents={documents}
        onChanged={load}
      />

      <Dialog open={receiveDialogOpen} onOpenChange={setReceiveDialogOpen}>
        <DialogContent ref={receiveDialogRef} onKeyDown={handleReceiveDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>{t('cross_border.shipments.receive.title')}</DialogTitle>
            {/* The shipment itself is the dialog's subject — the operator confirms which
                consignment is being booked in before choosing where. */}
            <DialogDescription>{shipment.number ?? t('cross_border.shipments.status.draft')}</DialogDescription>
          </DialogHeader>
          <CrudForm<ReceiveFormValues>
            embedded
            fields={[]}
            groups={[
              {
                id: 'receiveDestination',
                column: 1,
                bare: true,
                component: (context) => (
                  <ShipmentDestinationFields {...context} t={t} required labels="receive" />
                ),
              },
            ]}
            initialValues={receiveInitialValues}
            submitLabel={t('cross_border.shipments.receive.confirm')}
            onSubmit={handleReceiveSubmit}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent ref={cancelDialogRef} onKeyDown={handleCancelDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>{t('cross_border.shipments.cancelConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('cross_border.shipments.cancelConfirmBody')}</DialogDescription>
          </DialogHeader>
          <CrudForm<CancelFormValues>
            embedded
            schema={cancelSchema}
            fields={cancelFields}
            initialValues={EMPTY_CANCEL_VALUES}
            submitLabel={t('cross_border.shipments.actions.cancel')}
            onSubmit={handleCancelSubmit}
          />
        </DialogContent>
      </Dialog>

      {ConfirmDialogElement}
    </>
  )
}
