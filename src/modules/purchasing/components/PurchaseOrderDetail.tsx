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
  type CrudFieldOption,
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
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { toUtcDateInputValue } from '@open-mercato/ui/primitives/date-format'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useLocale, useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { AttachmentPreviewLink, useAttachmentPreview } from '@/lib/attachments/AttachmentPreview'
import { MoneyAmount } from '@/lib/money/MoneyAmount'
import { formatDepositPercent } from '@/lib/orders/depositPercent'
import { useReturnHref } from '@/lib/navigation/returnTo'
import { PurchaseOrderStatusBadge } from '@/lib/orders/purchaseOrderStatus'
import {
  ORDERS_API_PATH,
  ORDERS_LINES_API_PATH,
  ORDERS_LIST_HREF,
  ORDERS_PAYMENTS_API_PATH,
  ORDERS_TRANSITIONS_API_PATH,
  formatOrderDate,
  toPurchaseOrderRecord,
  toOptionalNumber,
  trimDecimalZeros,
  type OrderStatus,
  type PaymentStatus,
  type PurchaseOrderRecord,
} from './PurchaseOrderForm'
import { loadProductCategoryOptions } from './orderFormOptions'

const ORDER_LINES_PAGE_SIZE = 200
const PAYMENT_PAGE_SIZE = 100

const EMPTY_CELL = '—'

/**
 * Attachments entity id for a recorded payment: the same `entityId` the upload endpoint
 * (`POST /api/attachments`, multipart) expects, and what the purchase-payment attach command
 * stores. The dialog uploads no bytes with the payment command, only this id.
 */
const PAYMENT_ATTACHMENT_ENTITY_ID = 'purchasing:purchase_payment'

/**
 * Attachments entity id for a purchase-order document: the file is filed against the order it
 * belongs to — the document row does not exist yet when the operator picks the file — and the
 * document command stores only the returned id.
 */


/** Document types the module accepts — the same literals the command's enum offers. */





type OrderTransitionAction = 'place' | 'mark_shipped' | 'mark_received' | 'close' | 'cancel'
export type PaymentStage = 'deposit' | 'balance' | 'other'

/** A line as `/api/purchasing/purchase-orders/lines` projects it. */
type OrderLineRecord = {
  id: string
  lineNumber: number
  productTitle: string | null
  productSku: string | null
  /** The supplier's own item number, frozen when the line was ordered from the library. */
  supplierSku: string | null
  productUnit: string | null
  quantity: string
  unitPrice: string
  taxRate: string
  /** Whether the unit price already carries the tax — set in the editor, so the detail shows it. */
  priceIncludesTax: boolean
  lineTotal: string
  note: string | null
}

/** A payment as `/api/purchasing/purchase-orders/payments` projects it. */
export type PaymentRecord = {
  id: string
  stage: PaymentStage
  amount: string
  currencyCode: string
  paidAt: string | null
  reference: string | null
  methodNote: string | null
  attachmentId: string | null
}

/** Only the transitions the current status allows — mirroring the command's transition table. */
const TRANSITIONS_BY_STATUS: Record<OrderStatus, readonly OrderTransitionAction[]> = {
  draft: ['place', 'cancel'],
  placed: ['mark_shipped', 'cancel'],
  shipped: ['mark_received'],
  received: ['close'],
  closed: [],
  cancelled: [],
}

const TRANSITION_LABEL_KEYS: Record<OrderTransitionAction, string> = {
  place: 'purchasing.orders.transitions.place',
  mark_shipped: 'purchasing.orders.transitions.mark_shipped',
  mark_received: 'purchasing.orders.transitions.mark_received',
  close: 'purchasing.orders.transitions.close',
  cancel: 'purchasing.orders.transitions.cancel',
}

const PAYMENT_STAGE_LABEL_KEYS: Record<PaymentStage, string> = {
  deposit: 'purchasing.orders.payments.stage.deposit',
  balance: 'purchasing.orders.payments.stage.balance',
  other: 'purchasing.orders.payments.stage.other',
}

const PAYMENT_STATUS_LABEL_KEYS: Record<PaymentStatus, string> = {
  unpaid: 'purchasing.orders.paymentStatus.unpaid',
  deposit_paid: 'purchasing.orders.paymentStatus.deposit_paid',
  partially_paid: 'purchasing.orders.paymentStatus.partially_paid',
  paid: 'purchasing.orders.paymentStatus.paid',
}

const PAYMENT_STATUS_MAP: StatusMap<PaymentStatus> = {
  unpaid: 'warning',
  deposit_paid: 'info',
  partially_paid: 'info',
  paid: 'success',
}

const PAYMENT_STAGES: readonly PaymentStage[] = ['deposit', 'balance', 'other']

function toOrderLineRecord(item: Record<string, unknown>): OrderLineRecord {
  return {
    id: String(item.id ?? ''),
    lineNumber: Number(item.lineNumber ?? 0),
    productTitle: typeof item.productTitle === 'string' ? item.productTitle : null,
    productSku: typeof item.productSku === 'string' ? item.productSku : null,
    supplierSku: typeof item.supplierSku === 'string' ? item.supplierSku : null,
    productUnit: typeof item.productUnit === 'string' ? item.productUnit : null,
    quantity: String(item.quantity ?? '0'),
    unitPrice: String(item.unitPrice ?? '0'),
    taxRate: String(item.taxRate ?? '0'),
    priceIncludesTax: item.priceIncludesTax === true,
    lineTotal: String(item.lineTotal ?? '0'),
    note: typeof item.note === 'string' ? item.note : null,
  }
}

function toPaymentRecord(item: Record<string, unknown>): PaymentRecord {
  const stage = item.stage
  return {
    id: String(item.id ?? ''),
    stage: PAYMENT_STAGES.includes(stage as PaymentStage) ? (stage as PaymentStage) : 'other',
    amount: String(item.amount ?? '0'),
    currencyCode: typeof item.currencyCode === 'string' ? item.currencyCode : '',
    paidAt: typeof item.paidAt === 'string' ? item.paidAt : null,
    reference: typeof item.reference === 'string' ? item.reference : null,
    methodNote: typeof item.methodNote === 'string' ? item.methodNote : null,
    attachmentId: typeof item.attachmentId === 'string' ? item.attachmentId : null,
  }
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

function buildLineColumns(t: TranslateFn, currencyCode: string): ColumnDef<OrderLineRecord>[] {
  return [
    {
      accessorKey: 'productTitle',
      header: t('purchasing.orders.form.lines.product'),
      meta: { priority: 1, truncate: true, maxWidth: 320 },
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span>{row.original.productTitle ?? EMPTY_CELL}</span>
          {row.original.productSku ? (
            <span className="text-xs text-muted-foreground">{row.original.productSku}</span>
          ) : null}
          {row.original.supplierSku ? (
            <span className="text-xs text-muted-foreground">
              {`${t('purchasing.orders.detail.supplierCode')}: ${row.original.supplierSku}`}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: 'quantity',
      header: t('purchasing.orders.form.lines.quantity'),
      enableSorting: false,
      meta: { priority: 2 },
      cell: ({ row }) => {
        const quantity = trimDecimalZeros(row.original.quantity)
        return row.original.productUnit ? `${quantity} ${row.original.productUnit}` : quantity
      },
    },
    {
      accessorKey: 'unitPrice',
      header: t('purchasing.orders.form.lines.unitPrice'),
      enableSorting: false,
      meta: { priority: 3, align: 'right' },
      cell: ({ row }) => (
        <MoneyAmount currencyCode={currencyCode} amount={row.original.unitPrice} kind="price" className="items-end" />
      ),
    },
    {
      accessorKey: 'taxRate',
      header: t('purchasing.orders.form.lines.taxRate'),
      enableSorting: false,
      meta: { priority: 4, align: 'right' },
      cell: ({ row }) => `${trimDecimalZeros(row.original.taxRate)}%`,
    },
    {
      // Set in the editor, so the detail shows it too (owner 2026-10-10: 可填的内容需要在详情页完整显示).
      accessorKey: 'priceIncludesTax',
      header: t('purchasing.orders.form.lines.priceIncludesTax'),
      enableSorting: false,
      meta: { priority: 5 },
      cell: ({ row }) => t(row.original.priceIncludesTax ? 'common.yes' : 'common.no'),
    },
    {
      accessorKey: 'lineTotal',
      header: t('purchasing.orders.form.lines.total'),
      enableSorting: false,
      meta: { priority: 6, align: 'right' },
      cell: ({ row }) => (
        <MoneyAmount currencyCode={currencyCode} amount={row.original.lineTotal} className="items-end" />
      ),
    },
    {
      accessorKey: 'note',
      header: t('purchasing.orders.form.lines.note'),
      enableSorting: false,
      meta: { priority: 7, truncate: true, maxWidth: 240 },
      cell: ({ row }) => {
        const note = row.original.note
        return note ? note : <span className="text-xs text-muted-foreground">{EMPTY_CELL}</span>
      },
    },
  ]
}

type PaymentFormValues = {
  stage: string
  /** CrudForm's number field yields a number once edited, the raw string while untouched. */
  amount: number | string
  paidAt: string
  reference: string
  methodNote: string
  /** Held as a File until submit; the payment must exist before the file can be uploaded. */
  attachment: File | null
}

/** Cancelling is the one transition that carries data: the reason the command records in notes. */
type CancelFormValues = {
  reason: string
}

const EMPTY_CANCEL_VALUES: CancelFormValues = { reason: '' }

/**
 * The upload control for a payment's proof of payment. Unlike a shipment document, the payment
 * must exist before the file can be attached — the attachments endpoint keys on the payment id —
 * so this control only captures the chosen file and hands it to the submit flow. That flow talks
 * to the shared attachments endpoint (`POST /api/attachments`, multipart) exactly as the installed
 * attachment surfaces do, and the payment command receives only the resulting attachment id.
 */
function PurchasePaymentAttachmentField({ value, setValue, disabled }: CrudCustomFieldRenderProps) {
  const t = useT()
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const file = value instanceof File ? value : null

  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="size-4" aria-hidden="true" />
        {t('purchasing.orders.payments.attachmentUpload')}
      </Button>
      {file ? <p className="text-xs text-muted-foreground">{file.name}</p> : null}
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(event) => {
          const selected = event.target.files?.[0]
          if (selected) setValue(selected)
          if (inputRef.current) inputRef.current.value = ''
        }}
      />
    </div>
  )
}

function PurchasePaymentsSection({
  orderId,
  currencyCode,
  payments,
  onChanged,
}: {
  orderId: string
  currencyCode: string
  payments: PaymentRecord[]
  onChanged: () => Promise<void>
}) {
  const t = useT()
  const locale = useLocale()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [formResetKey, setFormResetKey] = React.useState(0)
  const dialogContentRef = React.useRef<HTMLDivElement | null>(null)
  // One shared picker for the row-level retry: the operator re-attaches a proof of payment to a
  // payment whose upload failed, without re-recording the payment.
  const retryInputRef = React.useRef<HTMLInputElement | null>(null)
  const retryPaymentRef = React.useRef<string | null>(null)

  const mutationContextId = React.useMemo(() => `purchasing.purchase-payment:${orderId}`, [orderId])
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId?: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: mutationContextId })

  const mutationContext = React.useMemo(() => ({
    formId: mutationContextId,
    resourceKind: 'purchasing.purchase_payment',
    resourceId: orderId,
    retryLastMutation,
  }), [mutationContextId, orderId, retryLastMutation])

  const initialValues = React.useMemo<PaymentFormValues>(() => ({
    stage: 'deposit',
    amount: '',
    paidAt: toUtcDateInputValue(new Date()) ?? '',
    reference: '',
    methodNote: '',
    attachment: null,
  }), [])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'stage',
      label: t('purchasing.orders.payments.field.stage'),
      type: 'select',
      required: true,
      options: PAYMENT_STAGES.map((stage) => ({ value: stage, label: t(PAYMENT_STAGE_LABEL_KEYS[stage]) })),
    },
    {
      id: 'amount',
      label: t('purchasing.orders.payments.field.amount'),
      type: 'number',
      required: true,
    },
    {
      id: 'paidAt',
      label: t('purchasing.orders.payments.field.paidAt'),
      type: 'date',
      required: true,
    },
    {
      id: 'reference',
      label: t('purchasing.orders.payments.field.reference'),
      type: 'text',
    },
    {
      id: 'methodNote',
      label: t('purchasing.orders.payments.field.methodNote'),
      type: 'textarea',
    },
    {
      id: 'attachment',
      label: t('purchasing.orders.payments.field.attachment'),
      type: 'custom',
      rendersOwnError: true,
      component: (props) => <PurchasePaymentAttachmentField {...props} />,
    },
  ], [t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'paymentDetails', column: 1, fields: ['stage', 'amount', 'paidAt'] },
    { id: 'paymentReference', column: 2, fields: ['reference', 'methodNote', 'attachment'] },
  ], [])

  /**
   * Uploads a chosen file against an already-created payment and links it back through the attach
   * command. Returns whether the proof of payment ended up attached; a failure is reported by the
   * caller, never thrown, so a recorded payment is never lost to a failed upload.
   */
  const attachProofOfPayment = React.useCallback(async (paymentId: string, file: File): Promise<boolean> => {
    try {
      const body = new FormData()
      body.set('entityId', PAYMENT_ATTACHMENT_ENTITY_ID)
      body.set('recordId', paymentId)
      body.set('file', file)
      const upload = await apiCall<{ item?: { id?: string }; error?: string }>(
        '/api/attachments',
        { method: 'POST', body },
        { fallback: null },
      )
      const attachmentId = upload.ok && typeof upload.result?.item?.id === 'string' ? upload.result.item.id : ''
      if (!attachmentId) throw new Error(upload.result?.error || t('purchasing.orders.payments.attachmentFailed'))
      await runMutation({
        operation: () => updateCrud(
          ORDERS_PAYMENTS_API_PATH,
          { id: paymentId, attachmentId },
          { errorMessage: t('purchasing.orders.payments.attachmentFailed') },
        ),
        context: mutationContext,
        mutationPayload: { id: paymentId, attachmentId },
      })
      return true
    } catch {
      return false
    }
  }, [mutationContext, runMutation, t])

  const handleSubmit = React.useCallback(async (values: PaymentFormValues) => {
    const reference = typeof values.reference === 'string' ? values.reference.trim() : ''
    const methodNote = typeof values.methodNote === 'string' ? values.methodNote.trim() : ''
    const attachment = values.attachment instanceof File ? values.attachment : null
    const payload: Record<string, unknown> = {
      orderId,
      stage: PAYMENT_STAGES.includes(values.stage as PaymentStage) ? values.stage : 'other',
      amount: toOptionalNumber(values.amount) ?? 0,
      paidAt: typeof values.paidAt === 'string' ? values.paidAt : '',
      reference: reference.length ? reference : null,
      methodNote: methodNote.length ? methodNote : null,
    }
    let paymentId = ''
    try {
      const created = await runMutation({
        operation: () => createCrud<{ id?: string }>(
          ORDERS_PAYMENTS_API_PATH,
          payload,
          { errorMessage: t('purchasing.orders.payments.recordFailed') },
        ),
        context: mutationContext,
        mutationPayload: payload,
      })
      paymentId = typeof created.result?.id === 'string' ? created.result.id : ''
    } catch (error) {
      flash(t('purchasing.orders.payments.recordFailed'), 'error')
      throw error
    }
    // The payment is already recorded: a failed upload flashes and leaves the row so the operator
    // can retry the proof of payment from the row, and must never roll the payment back.
    const attachmentAttached = attachment && paymentId
      ? await attachProofOfPayment(paymentId, attachment)
      : false
    const attachmentFailed = Boolean(attachment) && !attachmentAttached
    flash(
      t(
        attachmentFailed
          ? 'purchasing.orders.payments.attachmentFailed'
          : attachment
            ? 'purchasing.orders.payments.attachmentUploaded'
            : 'purchasing.orders.payments.recorded',
      ),
      attachmentFailed ? 'error' : 'success',
    )
    setFormResetKey((previous) => previous + 1)
    setDialogOpen(false)
    await onChanged()
  }, [attachProofOfPayment, mutationContext, onChanged, orderId, runMutation, t])

  const handleRetryFile = React.useCallback(async (files: FileList | null) => {
    const file = files?.[0]
    const paymentId = retryPaymentRef.current
    retryPaymentRef.current = null
    if (retryInputRef.current) retryInputRef.current.value = ''
    if (!file || !paymentId) return
    const attached = await attachProofOfPayment(paymentId, file)
    flash(
      t(attached ? 'purchasing.orders.payments.attachmentUploaded' : 'purchasing.orders.payments.attachmentFailed'),
      attached ? 'success' : 'error',
    )
    if (attached) await onChanged()
  }, [attachProofOfPayment, onChanged, t])

  const handleRemove = React.useCallback(async (payment: PaymentRecord) => {
    const confirmed = await confirm({
      title: t('purchasing.orders.payments.remove'),
      confirmText: t('purchasing.orders.payments.remove'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await runMutation({
        operation: () => deleteCrud(
          ORDERS_PAYMENTS_API_PATH,
          {
            id: payment.id,
            errorMessage: t('purchasing.orders.payments.recordFailed'),
          },
        ),
        context: mutationContext,
        mutationPayload: { id: payment.id },
      })
      await onChanged()
    } catch (removeError) {
      if (surfaceRecordConflict(removeError, t, { onRefresh: () => void onChanged() })) return
      flash(mutationErrorMessage(removeError, t('purchasing.orders.payments.recordFailed')), 'error')
    }
  }, [confirm, mutationContext, onChanged, runMutation, t])

  const columns = React.useMemo<ColumnDef<PaymentRecord>[]>(() => [
    {
      accessorKey: 'stage',
      header: t('purchasing.orders.payments.field.stage'),
      enableSorting: false,
      meta: { priority: 1 },
      cell: ({ row }) => t(PAYMENT_STAGE_LABEL_KEYS[row.original.stage]),
    },
    {
      accessorKey: 'amount',
      header: t('purchasing.orders.payments.field.amount'),
      enableSorting: false,
      meta: { priority: 2, align: 'right' },
      cell: ({ row }) => (
        <MoneyAmount
          currencyCode={row.original.currencyCode || currencyCode}
          amount={row.original.amount}
          className="items-end"
        />
      ),
    },
    {
      accessorKey: 'paidAt',
      header: t('purchasing.orders.payments.field.paidAt'),
      enableSorting: false,
      meta: { priority: 3 },
      cell: ({ row }) => formatOrderDate(row.original.paidAt, locale) ?? EMPTY_CELL,
    },
    {
      accessorKey: 'reference',
      header: t('purchasing.orders.payments.field.reference'),
      enableSorting: false,
      meta: { priority: 4, truncate: true, maxWidth: 200 },
      cell: ({ row }) => row.original.reference ?? <span className="text-xs text-muted-foreground">{EMPTY_CELL}</span>,
    },
    {
      accessorKey: 'methodNote',
      header: t('purchasing.orders.payments.field.methodNote'),
      enableSorting: false,
      meta: { priority: 5, truncate: true, maxWidth: 240 },
      cell: ({ row }) => row.original.methodNote ?? <span className="text-xs text-muted-foreground">{EMPTY_CELL}</span>,
    },
    {
      accessorKey: 'attachmentId',
      header: t('purchasing.orders.payments.field.attachment'),
      enableSorting: false,
      meta: { priority: 6 },
      cell: ({ row }) => {
        const attachmentId = row.original.attachmentId
        if (!attachmentId) return <span className="text-xs text-muted-foreground">{EMPTY_CELL}</span>
        return (
          <div className="flex flex-wrap items-center gap-3">
            <AttachmentPreviewLink
              attachmentId={attachmentId}
              label={t('purchasing.orders.payments.attachmentOpen')}
            />
            <Link
              href={`/api/attachments/file/${encodeURIComponent(attachmentId)}?download=1`}
              className="text-sm text-primary hover:underline"
            >
              {t('purchasing.orders.payments.attachmentDownload')}
            </Link>
          </div>
        )
      },
    },
  ], [currencyCode, locale, t])

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
          title={t('purchasing.orders.payments.title')}
          count={payments.length}
          action={(
            <Button type="button" variant="outline" onClick={() => setDialogOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              {t('purchasing.orders.payments.add')}
            </Button>
          )}
        />
        <DataTable<PaymentRecord>
          embedded
          columns={columns}
          data={payments}
          disableRowClick
          emptyState={(
            <EmptyState
              variant="subtle"
              size="sm"
              title={t('purchasing.orders.payments.empty')}
            />
          )}
          rowActions={(row) => (
            <RowActions
              items={[
                ...(row.attachmentId ? [] : [{
                  id: 'attach',
                  label: t('purchasing.orders.payments.attachmentUpload'),
                  onSelect: () => {
                    retryPaymentRef.current = row.id
                    retryInputRef.current?.click()
                  },
                }]),
                {
                  id: 'remove',
                  label: t('purchasing.orders.payments.remove'),
                  destructive: true,
                  onSelect: () => { void handleRemove(row) },
                },
              ]}
            />
          )}
        />
      </div>

      <input
        ref={retryInputRef}
        type="file"
        className="hidden"
        onChange={(event) => { void handleRetryFile(event.target.files) }}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent ref={dialogContentRef} onKeyDown={handleDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>{t('purchasing.orders.payments.add')}</DialogTitle>
            <DialogDescription>{t('purchasing.orders.payments.title')}</DialogDescription>
          </DialogHeader>
          <CrudForm<PaymentFormValues>
            key={formResetKey}
            embedded
            fields={fields}
            groups={groups}
            initialValues={initialValues}
            submitLabel={t('purchasing.orders.form.save')}
            onSubmit={handleSubmit}
          />
        </DialogContent>
      </Dialog>

      {ConfirmDialogElement}
    </>
  )
}

/** The editable shape of the 新增/编辑单证 dialog, and the body its command accepts. */








/**
 * The upload control for a document's file. It talks to the shared attachments endpoint
 * (`POST /api/attachments`, multipart) exactly as the installed attachment surfaces do, and hands
 * the returned id back to the form — the document row stores that id, never a byte of file.
 */




/**
 * The company order (根单) holding this purchase order, if any — read through the order hub's link
 * collection with the same `refId` reverse lookup the hub itself uses.
 *
 * The root owns 订单描述 / 采购负责人, so this id is only needed to point 「去公司订单修改」 at the right
 * page. A role without `order_hub.view` gets a 403 and an order that is simply not linked gets no
 * row; both answer `null`, and neither may disturb the page's own read.
 */
async function fetchCompanyOrderId(purchaseOrderId: string): Promise<string | null> {
  try {
    const payload = await fetchCrudList<Record<string, unknown>>('order_hub/orders/links', {
      refId: purchaseOrderId,
      kind: 'purchase_order',
      pageSize: 1,
    })
    const companyOrderId = payload.items?.[0]?.companyOrderId
    return typeof companyOrderId === 'string' && companyOrderId.length > 0 ? companyOrderId : null
  } catch {
    return null
  }
}

export default function PurchaseOrderDetail({ orderId }: { orderId: string }) {
  const t = useT()
  const locale = useLocale()
  const scopeVersion = useOrganizationScopeVersion()
  const backHref = useReturnHref(ORDERS_LIST_HREF)
  const [order, setOrder] = React.useState<PurchaseOrderRecord | null>(null)
  const [lines, setLines] = React.useState<OrderLineRecord[]>([])
  const [payments, setPayments] = React.useState<PaymentRecord[]>([])
  // The `product_category` dictionary, resolved to a label for the summary; an empty list
  // (a dictionary the operator has not seeded, or a failed load) falls back to the stored code.
  const [categoryOptions, setCategoryOptions] = React.useState<CrudFieldOption[]>([])
  /**
   * The company order (根单) this purchase order is attached to, when there is one. The root owns
   * 订单描述 / 采购负责人, so the two summary cells are read-only and this id drives the
   * 「去公司订单修改」 link; a role without `order_hub.view` cannot read the link and gets `null`.
   */
  const [companyOrderId, setCompanyOrderId] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)
  const [pendingTransition, setPendingTransition] = React.useState<OrderTransitionAction | null>(null)
  const [cancelDialogOpen, setCancelDialogOpen] = React.useState(false)
  const cancelDialogRef = React.useRef<HTMLDivElement | null>(null)

  const mutationContextId = React.useMemo(() => `purchasing.purchase-order:${orderId}`, [orderId])
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId?: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: mutationContextId })

  const mutationContext = React.useMemo(() => ({
    formId: mutationContextId,
    resourceKind: 'purchasing.purchase_order',
    resourceId: orderId,
    retryLastMutation,
  }), [mutationContextId, orderId, retryLastMutation])

  const load = React.useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    setNotFound(false)
    try {
      const [orderPayload, linePayload, paymentPayload, options, rootCompanyOrderId] = await Promise.all([
        fetchCrudList<Record<string, unknown>>(ORDERS_API_PATH, { ids: orderId, pageSize: 1 }),
        fetchCrudList<Record<string, unknown>>(ORDERS_LINES_API_PATH, { orderId, pageSize: ORDER_LINES_PAGE_SIZE }),
        fetchCrudList<Record<string, unknown>>(ORDERS_PAYMENTS_API_PATH, { orderId, pageSize: PAYMENT_PAGE_SIZE }),
        loadProductCategoryOptions(t('purchasing.orders.form.optionsLoadFailed')),
        fetchCompanyOrderId(orderId),
      ])
      const item = orderPayload.items?.[0]
      if (!item) {
        setOrder(null)
        setLines([])
        setPayments([])
        setNotFound(true)
        return
      }
      setOrder(toPurchaseOrderRecord(item))
      setLines((linePayload.items ?? []).map(toOrderLineRecord))
      setPayments((paymentPayload.items ?? []).map(toPaymentRecord))
      setCategoryOptions(options)
      setCompanyOrderId(rootCompanyOrderId)
    } catch {
      setLoadError(t('purchasing.orders.form.loadFailed'))
      return
    } finally {
      setLoading(false)
    }
    // `scopeVersion` is not read inside the callback on purpose: it is the organization-scope
    // generation, and bumping it must rebuild this callback so the effect below refetches after
    // an organization switch. The rule cannot see that intent, so the dependency is explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate scope-change refetch
  }, [orderId, scopeVersion, t])

  React.useEffect(() => {
    void load()
  }, [load])

  const runTransition = React.useCallback(async (action: OrderTransitionAction, reason?: string) => {
    setPendingTransition(action)
    try {
      await runMutation({
        operation: () => createCrud(
          ORDERS_TRANSITIONS_API_PATH,
          { id: orderId, action, ...(reason ? { reason } : {}) },
          { errorMessage: t('purchasing.orders.form.saveFailed') },
        ),
        context: mutationContext,
        mutationPayload: { id: orderId, action },
      })
      await load()
    } finally {
      setPendingTransition(null)
    }
  }, [load, mutationContext, orderId, runMutation, t])

  const handleTransition = React.useCallback((action: OrderTransitionAction) => {
    void runTransition(action).catch((error: unknown) => {
      if (surfaceRecordConflict(error, t, { onRefresh: () => void load() })) return
      flash(mutationErrorMessage(error, t('purchasing.orders.form.saveFailed')), 'error')
    })
  }, [load, runTransition, t])

  const cancelSchema = React.useMemo(() => z.object({
    reason: z.string().trim().min(1, 'purchasing.orders.transitions.cancelReasonRequired'),
  }), [])

  const cancelFields = React.useMemo<CrudField[]>(() => [
    {
      id: 'reason',
      label: t('purchasing.orders.transitions.cancelReason'),
      type: 'textarea',
      required: true,
    },
  ], [t])

  const handleCancelSubmit = React.useCallback(async (values: CancelFormValues) => {
    // A cancelled order accepts no further transitions, so the dialog stays open until the
    // command accepts the reason — a rejected cancellation must not look like a success.
    await runTransition('cancel', values.reason.trim())
    setCancelDialogOpen(false)
  }, [runTransition])

  const handleCancelSubmitForm = React.useCallback(() => {
    cancelDialogRef.current?.querySelector('form')?.requestSubmit()
  }, [])
  const handleCancelDialogKeyDown = useDialogKeyHandler({
    onConfirm: handleCancelSubmitForm,
    onCancel: () => setCancelDialogOpen(false),
  })

  const lineColumns = React.useMemo(
    () => buildLineColumns(t, order?.currencyCode ?? ''),
    [order?.currencyCode, t],
  )

  if (loading && !order) return <LoadingMessage label={t('purchasing.orders.form.loadFailed')} />

  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('purchasing.orders.form.loadFailed')}
        backHref={backHref}
      />
    )
  }

  if (loadError || !order) {
    return <ErrorMessage label={loadError ?? t('purchasing.orders.form.loadFailed')} />
  }

  const transitionActions = TRANSITIONS_BY_STATUS[order.status]
  const ownerName = order.ownerName ?? (typeof order.ownerSnapshot?.name === 'string' ? order.ownerSnapshot.name : null)
  const customerName = order.customerName ?? (typeof order.customerSnapshot?.name === 'string' ? order.customerSnapshot.name : null)
  const sourceSalesOrderHref = (kind: string | null, id: string): string => {
    const prefix = kind === 'external_sales_order' ? '/backend/external-sales' : '/backend/internal-sales'
    return `${prefix}/orders/${encodeURIComponent(id)}`
  }
  const productCategoryLabel = order.productCategory
    ? categoryOptions.find((option) => option.value === order.productCategory)?.label ?? order.productCategory
    : null
  const depositPercentLabel = formatDepositPercent(order.depositPercent)

  return (
    <>
      <FormHeader
        mode="detail"
        backHref={backHref}
        entityTypeLabel={t('purchasing.orders.page.title')}
        title={order.number ?? EMPTY_CELL}
        subtitle={order.supplierName ?? undefined}
        statusBadge={<PurchaseOrderStatusBadge status={order.status} />}
        actionsContent={(
          <div className="flex flex-wrap items-center gap-2">
            {/* 根单持有后，采购单的「上游」是公司订单（owner 2026-10-10：被公司订单关联了就要有入口，
                直接跳到那张根单的详情页）。Linked only: an order raised on its own has no root to open. */}
            {companyOrderId ? (
              <Button asChild variant="outline">
                <Link href={`/backend/orders/${encodeURIComponent(companyOrderId)}`}>
                  {t('purchasing.orders.detail.openCompanyOrder')}
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="outline">
              <Link href={`${ORDERS_LIST_HREF}/${encodeURIComponent(order.id)}/edit`}>
                {t('purchasing.orders.edit.title')}
              </Link>
            </Button>
            {transitionActions.map((action) => (
              <Button
                key={action}
                type="button"
                variant={action === 'cancel' ? 'destructive' : 'default'}
                disabled={pendingTransition !== null}
                onClick={() => {
                  if (action === 'cancel') {
                    setCancelDialogOpen(true)
                    return
                  }
                  handleTransition(action)
                }}
              >
                {pendingTransition === action ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                {t(TRANSITION_LABEL_KEYS[action])}
              </Button>
            ))}
          </div>
        )}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
        <SummaryField label={t('purchasing.orders.detail.businessNumber')}>
          {order.businessNumber ?? EMPTY_CELL}
        </SummaryField>
        {/* 订单描述 and 采购负责人 are held by the company order (根单): the purchase order only mirrors
            them, so both cells are read-only and the edit entry jumps to the root. */}
        <SummaryField label={t('purchasing.orders.detail.productCategory')}>
          {productCategoryLabel ?? EMPTY_CELL}
          {companyOrderId ? (
            <Link
              href={`/backend/orders/${encodeURIComponent(companyOrderId)}`}
              className="ml-2 text-xs text-muted-foreground underline"
            >
              {t('purchasing.orders.detail.editAtCompanyOrder')}
            </Link>
          ) : null}
        </SummaryField>
        <SummaryField label={t('purchasing.orders.detail.owner')}>{ownerName ?? EMPTY_CELL}</SummaryField>
        <SummaryField label={t('purchasing.orders.detail.customer')}>{customerName ?? EMPTY_CELL}</SummaryField>
        {order.sourceSalesOrderId ? (
          // Read-only: the anchor is written by the create flow (or cleared on edit), never typed here.
          <SummaryField label={t('purchasing.orders.form.sourceOrder.label')}>
            <Link
              href={sourceSalesOrderHref(order.sourceSalesOrderKind, order.sourceSalesOrderId)}
              className="underline"
            >
              {order.sourceSalesOrderNumber ?? order.sourceSalesOrderId}
            </Link>
          </SummaryField>
        ) : null}
        <SummaryField label={t('purchasing.orders.form.field.currency')}>{order.currencyCode}</SummaryField>
        <SummaryField label={t('purchasing.orders.list.columns.total')}>
          <MoneyAmount currencyCode={order.currencyCode} amount={order.total} />
        </SummaryField>
        <SummaryField label={t('purchasing.orders.list.columns.paid')}>
          <MoneyAmount currencyCode={order.currencyCode} amount={order.paidTotal} />
        </SummaryField>
        <SummaryField label={t('purchasing.orders.list.columns.outstanding')}>
          <MoneyAmount currencyCode={order.currencyCode} amount={order.outstanding} />
        </SummaryField>
        <SummaryField label={t('purchasing.orders.list.columns.paymentStatus')}>
          <StatusBadge variant={PAYMENT_STATUS_MAP[order.paymentStatus]} dot>
            {t(PAYMENT_STATUS_LABEL_KEYS[order.paymentStatus])}
          </StatusBadge>
        </SummaryField>
        <SummaryField label={t('purchasing.orders.list.columns.expectedShipAt')}>
          {formatOrderDate(order.expectedShipAt, locale) ?? EMPTY_CELL}
        </SummaryField>
        {/* Every field the edit form can still fill belongs here too (owner 2026-10-10: 可填的内容需要
            在详情页对应完整显示) — the deposit terms and the note were the ones missing. */}
        <SummaryField label={t('purchasing.orders.form.field.depositPercent')}>
          {depositPercentLabel ?? EMPTY_CELL}
        </SummaryField>
        <SummaryField label={t('purchasing.orders.form.field.depositAmount')}>
          {order.depositAmount ? (
            <MoneyAmount currencyCode={order.currencyCode} amount={order.depositAmount} />
          ) : (
            EMPTY_CELL
          )}
        </SummaryField>
        <SummaryField label={t('purchasing.orders.form.field.notes')}>
          {order.notes ? <span className="whitespace-pre-wrap">{order.notes}</span> : EMPTY_CELL}
        </SummaryField>
      </div>

      <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
        <SectionHeader title={t('purchasing.orders.form.lines.title')} count={lines.length} />
        <DataTable<OrderLineRecord>
          embedded
          columns={lineColumns}
          data={lines}
          disableRowClick
        />
      </div>

      {/* 单证 moved to the company order (owner 2026-10-10): the purchase order keeps a pointer to
          where paperwork is filed now instead of its own second entry — the root's 单据与文件 slots
          already aggregate the files filed against this order. */}
      <section className="space-y-3 rounded-lg border bg-card px-4 py-3">
        <SectionHeader title={t('purchasing.orders.detail.documents')} />
        <p className="text-sm text-muted-foreground">{t('purchasing.orders.documents.rootEntryHint')}</p>
        {companyOrderId ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/backend/orders/${encodeURIComponent(companyOrderId)}`}>
              {t('purchasing.orders.documents.openCompanyOrder')}
            </Link>
          </Button>
        ) : null}
      </section>

      <PurchasePaymentsSection
        orderId={order.id}
        currencyCode={order.currencyCode}
        payments={payments}
        onChanged={load}
      />

      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent ref={cancelDialogRef} onKeyDown={handleCancelDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>{t('purchasing.orders.transitions.cancelConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('purchasing.orders.transitions.cancelConfirmBody')}</DialogDescription>
          </DialogHeader>
          <CrudForm<CancelFormValues>
            embedded
            schema={cancelSchema}
            fields={cancelFields}
            initialValues={EMPTY_CANCEL_VALUES}
            submitLabel={t('purchasing.orders.transitions.cancel')}
            onSubmit={handleCancelSubmit}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
