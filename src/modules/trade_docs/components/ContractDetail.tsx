"use client"

import * as React from 'react'
import Link from 'next/link'
import { Trash2, Upload } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { createCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
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
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { formatDisplayDate, toUtcDateInputValue } from '@open-mercato/ui/primitives/date-format'
import { useLocale, useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { AttachmentPreviewLink } from '@/lib/attachments/AttachmentPreview'
import { MoneyAmount } from '@/lib/money/MoneyAmount'
import { loadRelatedPage, RelatedSection } from '@/lib/related/RelatedSection'
import { AMOUNT_SCALE, toScaledUnits } from '../lib/money'
import { contractStatusLabel, directionLabel, invoiceStatusLabel, type ContractStatus } from './contractLabels'
import { ContractOrdersDialog, orderKindLabel } from './ContractOrdersDialog'
import { invoiceKindLabel } from './InvoicesTable'
import { downloadApiFile } from './downloadFile'

const CONTRACTS_API_PATH = 'trade_docs/contracts'
const CONTRACT_LINES_API_PATH = 'trade_docs/contracts/lines'
const CONTRACT_TRANSITIONS_API_PATH = 'trade_docs/contracts/transitions'
const CONTRACT_ORDERS_API_PATH = 'trade_docs/contracts/orders'
const INVOICES_API_PATH = 'trade_docs/invoices'
const DOCUMENTS_API_PATH = 'trade_docs/documents'
const CONTRACT_ATTACH_API_PATH = 'trade_docs/contracts/attach'
const CONTRACT_DOCUMENT_API_PATH = '/api/trade_docs/contracts'
const SHIPMENTS_API_PATH = 'cross_border/shipments'
const SHIPMENT_DOCUMENTS_API_PATH = 'cross_border/shipments/documents'
const LIST_HREF = '/backend/trade-docs/contracts'
const INVOICES_HREF = '/backend/trade-docs/invoices'
const SHIPMENTS_HREF = '/backend/cross_border/shipments'
const PACKING_LISTS_HREF = '/backend/cross_border/packing-lists'
const PROFORMAS_HREF = '/backend/trade-docs/proformas'
const COMMERCIAL_INVOICES_HREF = '/backend/trade-docs/commercial-invoices'

/**
 * The hub sections are previews, not ledgers: the shared section loads a page of each collection
 * (`loadRelatedPage`) and this page shows the newest few of it, handing the rest to the filtered
 * list page behind 「查看全部」.
 */
const RELATED_ROW_LIMIT = 5

/** Kind → badge tone, so the purchase side reads apart from the two sales families at a glance. */
const ORDER_KIND_VARIANT: Record<string, 'info' | 'success' | 'neutral'> = {
  purchase_order: 'info',
  internal_sales_order: 'success',
  external_sales_order: 'neutral',
}

/**
 * The shipment status wording is the logistics module's own catalog (`cross_border.shipments.status.*`,
 * which `ShipmentForm`'s `shipmentStatusLabel` reads). The hub reads the same keys rather than
 * importing that module: it owns the whole shipment form — allocations, milestones, editors — which
 * this page has no other use for.
 */
const SHIPMENT_STATUS_LABEL: Record<string, { key: string; fallback: string }> = {
  draft: { key: 'cross_border.shipments.status.draft', fallback: 'Draft' },
  in_transit: { key: 'cross_border.shipments.status.in_transit', fallback: 'In transit' },
  received: { key: 'cross_border.shipments.status.received', fallback: 'Received' },
  closed: { key: 'cross_border.shipments.status.closed', fallback: 'Closed' },
  cancelled: { key: 'cross_border.shipments.status.cancelled', fallback: 'Cancelled' },
}

const SHIPMENT_STATUS_VARIANT: Record<string, 'neutral' | 'info' | 'success' | 'error'> = {
  draft: 'neutral',
  in_transit: 'info',
  received: 'success',
  closed: 'neutral',
  cancelled: 'error',
}

/** The three states a PI/CI can be in; the wording is `trade_docs.documents.status.*`. */
const DOCUMENT_STATUS_LABEL: Record<string, { key: string; fallback: string }> = {
  draft: { key: 'trade_docs.documents.status.draft', fallback: 'Draft' },
  issued: { key: 'trade_docs.documents.status.issued', fallback: 'Issued' },
  void: { key: 'trade_docs.documents.status.void', fallback: 'Void' },
}

const DOCUMENT_STATUS_VARIANT: Record<string, 'neutral' | 'success' | 'error'> = {
  draft: 'neutral',
  issued: 'success',
  void: 'error',
}

function shipmentStatusLabel(t: TranslateFn, status: string): string {
  const entry = SHIPMENT_STATUS_LABEL[status]
  return entry ? t(entry.key, entry.fallback) : status
}

function documentStatusLabel(t: TranslateFn, status: string): string {
  const entry = DOCUMENT_STATUS_LABEL[status]
  return entry ? t(entry.key, entry.fallback) : status
}

/**
 * `etd`, `issued_at` and `ordered_at` are date-only columns written as UTC midnight, so their day is
 * read back the way it was written (`toUtcDateInputValue`) before formatting — parsing the instant in
 * the reader's own zone would name the previous day west of UTC.
 */
function dateOnlyLabel(value: string | null, locale?: string): string | null {
  const day = toUtcDateInputValue(value)
  return day ? formatDisplayDate(day, locale) : null
}

/**
 * Attachment assignment entity id of the stamped scan; the partition resolves to the platform's
 * private default, exactly like the invoice scan.
 */
const ATTACHMENT_ENTITY_ID = 'trade_docs:trade_docs_contract'

/** The content type the generated document is served with; the download verifies it. */
const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const STATUS_VARIANT: StatusMap<ContractStatus> = {
  draft: 'neutral',
  issued: 'info',
  signed: 'success',
  closed: 'neutral',
  cancelled: 'error',
}

type ContractHead = {
  id: string
  number: string | null
  direction: string
  status: ContractStatus
  counterpartyKind: string
  counterpartyName: string | null
  priceTier: string | null
  currencyCode: string
  exchangeRate: string | null
  contractTotal: string
  financeTotal: string
  differenceTotal: string
  signedAt: string | null
  deliveryDate: string | null
  paymentTerms: string | null
  incoterms: string | null
  shippingMethod: string | null
  destination: string | null
  notes: string | null
  generatedAttachmentId: string | null
  attachmentId: string | null
  updatedAt: string | null
  counterpartySnapshot: Record<string, unknown> | null
  ourPartySnapshot: Record<string, unknown> | null
}

type ContractLineRecord = {
  id: string
  lineNumber: number
  name: string | null
  sku: string | null
  model: string | null
  spec: string | null
  unit: string | null
  quantity: string
  unitPrice: string
  contractAmount: string
  financeAmount: string
  financeSource: 'invoice' | 'computed'
  note: string | null
}

type InvoiceRecord = {
  id: string
  number: string | null
  direction: string
  invoiceKind: string | null
  status: string
  total: string
  currencyCode: string
  issuedAt: string | null
  attachmentId: string | null
}

/** One link of the contract ↔ order relation, with the order's frozen display snapshot. */
type ContractOrderRecord = {
  id: string
  orderKind: string
  orderId: string
  orderNumber: string | null
  counterpartyName: string | null
  orderedAt: string | null
}

type ContractShipmentRecord = {
  id: string
  number: string | null
  status: string
  carrierName: string | null
  etd: string | null
}

/** A packing list, which belongs to a contract through its shipment; the number and date travel. */
type ContractPackingListRecord = {
  id: string
  documentNumber: string | null
  issuedAt: string | null
}

/** A PI/CI bound to the contract (`trade_docs_documents.contract_id`). */
type ContractDocumentRecord = {
  id: string
  number: string | null
  status: string
  total: string
  currencyCode: string
}

/** Which transitions the current status allows — mirrors the command's table, never widens it. */
const ALLOWED_ACTIONS: Record<ContractStatus, Array<'issue' | 'sign' | 'close' | 'cancel'>> = {
  draft: ['issue', 'cancel'],
  issued: ['sign', 'cancel'],
  signed: ['close'],
  closed: [],
  cancelled: [],
}

function snapshotText(snapshot: Record<string, unknown> | null, key: string): string | null {
  if (!snapshot) return null
  const value = snapshot[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function toHead(item: Record<string, unknown>): ContractHead {
  const status = String(item.status ?? 'draft')
  return {
    id: String(item.id),
    number: (item.number ?? null) as string | null,
    direction: String(item.direction ?? 'purchase'),
    status: (['draft', 'issued', 'signed', 'closed', 'cancelled'] as string[]).includes(status)
      ? (status as ContractStatus)
      : 'draft',
    counterpartyKind: String(item.counterpartyKind ?? 'supplier'),
    counterpartyName: (item.counterpartyName ?? null) as string | null,
    priceTier: (item.priceTier ?? null) as string | null,
    currencyCode: String(item.currencyCode ?? 'CNY'),
    exchangeRate: (item.exchangeRate ?? null) as string | null,
    contractTotal: String(item.contractTotal ?? '0'),
    financeTotal: String(item.financeTotal ?? '0'),
    differenceTotal: String(item.differenceTotal ?? '0'),
    signedAt: (item.signedAt ?? null) as string | null,
    deliveryDate: (item.deliveryDate ?? null) as string | null,
    paymentTerms: (item.paymentTerms ?? null) as string | null,
    incoterms: (item.incoterms ?? null) as string | null,
    shippingMethod: (item.shippingMethod ?? null) as string | null,
    destination: (item.destination ?? null) as string | null,
    notes: (item.notes ?? null) as string | null,
    generatedAttachmentId: (item.generatedAttachmentId ?? null) as string | null,
    attachmentId: (item.attachmentId ?? null) as string | null,
    updatedAt: (item.updatedAt ?? null) as string | null,
    counterpartySnapshot: (item.counterpartySnapshot ?? null) as Record<string, unknown> | null,
    ourPartySnapshot: (item.ourPartySnapshot ?? null) as Record<string, unknown> | null,
  }
}

function toLine(item: Record<string, unknown>): ContractLineRecord {
  return {
    id: String(item.id),
    lineNumber: Number(item.lineNumber ?? 0),
    name: (item.name ?? null) as string | null,
    sku: (item.sku ?? null) as string | null,
    model: (item.model ?? null) as string | null,
    spec: (item.spec ?? null) as string | null,
    unit: (item.unit ?? null) as string | null,
    quantity: String(item.quantity ?? '0'),
    unitPrice: String(item.unitPrice ?? '0'),
    contractAmount: String(item.contractAmount ?? '0'),
    financeAmount: String(item.financeAmount ?? '0'),
    financeSource: item.financeSource === 'invoice' ? 'invoice' : 'computed',
    note: (item.note ?? null) as string | null,
  }
}

function toInvoice(item: Record<string, unknown>): InvoiceRecord {
  return {
    id: String(item.id),
    number: (item.number ?? null) as string | null,
    direction: String(item.direction ?? 'inbound'),
    invoiceKind: (item.invoiceKind ?? item.invoice_kind ?? null) as string | null,
    status: String(item.status ?? 'draft'),
    total: String(item.total ?? '0'),
    currencyCode: String(item.currencyCode ?? 'CNY'),
    issuedAt: (item.issuedAt ?? null) as string | null,
    attachmentId: (item.attachmentId ?? null) as string | null,
  }
}

function toContractOrder(item: Record<string, unknown>): ContractOrderRecord {
  return {
    id: String(item.id),
    orderKind: String(item.orderKind ?? 'purchase_order'),
    orderId: String(item.orderId ?? ''),
    orderNumber: (item.orderNumber ?? null) as string | null,
    counterpartyName: (item.counterpartyName ?? null) as string | null,
    orderedAt: (item.orderedAt ?? null) as string | null,
  }
}

function toContractShipment(item: Record<string, unknown>): ContractShipmentRecord {
  return {
    id: String(item.id),
    number: (item.number ?? null) as string | null,
    status: String(item.status ?? 'draft'),
    carrierName: (item.carrierName ?? null) as string | null,
    etd: (item.etd ?? null) as string | null,
  }
}

function toContractPackingList(item: Record<string, unknown>): ContractPackingListRecord {
  return {
    id: String(item.id),
    documentNumber: (item.documentNumber ?? null) as string | null,
    issuedAt: (item.issuedAt ?? null) as string | null,
  }
}

function toContractDocument(item: Record<string, unknown>): ContractDocumentRecord {
  return {
    id: String(item.id),
    number: (item.number ?? null) as string | null,
    status: String(item.status ?? 'draft'),
    total: String(item.total ?? '0'),
    currencyCode: String(item.currencyCode ?? 'CNY'),
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

function buildLineColumns(t: TranslateFn, currencyCode: string): ColumnDef<ContractLineRecord>[] {
  return [
    { accessorKey: 'lineNumber', header: '#', meta: { priority: 1 } },
    {
      accessorKey: 'name',
      header: t('trade_docs.contracts.form.lines.name'),
      meta: { priority: 2, truncate: true, maxWidth: 260 },
      cell: ({ row }) => row.original.name ?? '—',
    },
    {
      accessorKey: 'model',
      header: t('trade_docs.contracts.form.lines.model'),
      enableSorting: false,
      meta: { priority: 3 },
      cell: ({ row }) => row.original.model ?? '—',
    },
    {
      accessorKey: 'spec',
      header: t('trade_docs.contracts.form.lines.spec'),
      enableSorting: false,
      meta: { priority: 4, truncate: true, maxWidth: 220 },
      cell: ({ row }) => row.original.spec ?? '—',
    },
    {
      accessorKey: 'unit',
      header: t('trade_docs.contracts.form.lines.unit'),
      enableSorting: false,
      meta: { priority: 5 },
      cell: ({ row }) => row.original.unit ?? '—',
    },
    {
      accessorKey: 'quantity',
      header: t('trade_docs.contracts.form.lines.quantity'),
      enableSorting: false,
      meta: { priority: 6 },
      cell: ({ row }) => <span className="tabular-nums">{row.original.quantity}</span>,
    },
    {
      accessorKey: 'unitPrice',
      header: t('trade_docs.contracts.form.lines.unitPrice'),
      enableSorting: false,
      meta: { priority: 7 },
      cell: ({ row }) => <span className="tabular-nums">{row.original.unitPrice}</span>,
    },
    {
      accessorKey: 'contractAmount',
      header: t('trade_docs.contracts.detail.columns.contractAmount'),
      enableSorting: false,
      meta: { priority: 8 },
      cell: ({ row }) => (
        <MoneyAmount currencyCode={currencyCode} amount={row.original.contractAmount} />
      ),
    },
    {
      accessorKey: 'financeAmount',
      header: t('trade_docs.contracts.detail.columns.financeAmount'),
      enableSorting: false,
      meta: { priority: 9 },
      cell: ({ row }) => (
        <MoneyAmount currencyCode={currencyCode} amount={row.original.financeAmount} />
      ),
    },
    {
      id: 'financeSource',
      header: t('trade_docs.contracts.detail.columns.financeSource'),
      enableSorting: false,
      meta: { priority: 10 },
      cell: ({ row }) => (
        <StatusBadge variant={row.original.financeSource === 'invoice' ? 'info' : 'neutral'}>
          {row.original.financeSource === 'invoice'
            ? t('trade_docs.contracts.detail.financeSource.invoice')
            : t('trade_docs.contracts.detail.financeSource.computed')}
        </StatusBadge>
      ),
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

type ContractScanSectionProps = {
  contractId: string
  attachmentId: string | null
  updatedAt: string | null
  onChanged: () => Promise<void>
}

/**
 * Upload-then-bind, exactly like the invoice scan and the purchasing payment vouchers: the file is
 * uploaded against the platform's attachment route, and only then is the pointer recorded through
 * `trade_docs.contracts.attach`. A failed upload never loses the previously bound scan, and the
 * section keeps offering a retry.
 *
 * This is the counterparty-signed/stamped paper the business files back; it lives in its own
 * column and its own section, so regenerating the XLSX above can never drop it.
 */
function ContractScanSection({ contractId, attachmentId, updatedAt, onChanged }: ContractScanSectionProps) {
  const t = useT()
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const [isUploading, setIsUploading] = React.useState(false)
  const [isRemoving, setIsRemoving] = React.useState(false)

  const flashFailure = React.useCallback(
    (error: unknown, fallbackKey: string) => {
      if (isHttpStatusError(error, 403)) {
        flash(t('trade_docs.common.notAuthorized'), 'error')
        return
      }
      flash(error instanceof Error && error.message ? error.message : t(fallbackKey), 'error')
    },
    [t],
  )

  const handleFile = React.useCallback(async (files: FileList | null) => {
    const file = files?.[0]
    if (inputRef.current) inputRef.current.value = ''
    if (!file) return
    setIsUploading(true)
    try {
      const body = new FormData()
      body.set('entityId', ATTACHMENT_ENTITY_ID)
      body.set('recordId', contractId)
      body.set('file', file)
      const upload = await apiCall<{ item?: { id?: string }; error?: string }>(
        '/api/attachments',
        { method: 'POST', body },
        { fallback: null },
      )
      const uploadedId = upload.ok && typeof upload.result?.item?.id === 'string' ? upload.result.item.id : ''
      if (!uploadedId) {
        flash(upload.result?.error || t('trade_docs.contracts.attach.failed'), 'error')
        return
      }
      try {
        await updateCrud(
          CONTRACT_ATTACH_API_PATH,
          { id: contractId, attachmentId: uploadedId, updatedAt },
          { errorMessage: t('trade_docs.contracts.attach.bindFailed') },
        )
        flash(t('trade_docs.contracts.attach.uploaded'), 'success')
        await onChanged()
      } catch (bindError) {
        flashFailure(bindError, 'trade_docs.contracts.attach.bindFailed')
      }
    } catch {
      flash(t('trade_docs.contracts.attach.failed'), 'error')
    } finally {
      setIsUploading(false)
    }
  }, [contractId, flashFailure, onChanged, t, updatedAt])

  const handleRemove = React.useCallback(async () => {
    setIsRemoving(true)
    try {
      await updateCrud(
        CONTRACT_ATTACH_API_PATH,
        { id: contractId, attachmentId: null, updatedAt },
        { errorMessage: t('trade_docs.contracts.attach.removeFailed') },
      )
      flash(t('trade_docs.contracts.attach.removed'), 'success')
      await onChanged()
    } catch (removeError) {
      flashFailure(removeError, 'trade_docs.contracts.attach.removeFailed')
    } finally {
      setIsRemoving(false)
    }
  }, [contractId, flashFailure, onChanged, t, updatedAt])

  return (
    <section className="space-y-3">
      <SectionHeader title={t('trade_docs.contracts.field.attachment')} />
      <p className="text-xs text-muted-foreground">{t('trade_docs.contracts.attach.hint')}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={isUploading || isRemoving}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="size-4" aria-hidden="true" />
          {attachmentId ? t('trade_docs.contracts.attach.retry') : t('trade_docs.contracts.attach.upload')}
        </Button>
        {attachmentId ? (
          <>
            <AttachmentPreviewLink
              attachmentId={attachmentId}
              label={t('trade_docs.contracts.attach.preview')}
            />
            <a
              className="text-sm font-medium hover:underline"
              href={`/api/attachments/file/${encodeURIComponent(attachmentId)}?download=1`}
              target="_blank"
              rel="noreferrer"
            >
              {t('trade_docs.contracts.attach.download')}
            </a>
            <Button
              type="button"
              variant="outline"
              disabled={isUploading || isRemoving}
              onClick={() => void handleRemove()}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              {t('trade_docs.contracts.attach.remove')}
            </Button>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">{t('trade_docs.contracts.attach.empty')}</span>
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

export default function ContractDetail({ contractId }: { contractId: string }) {
  const t = useT()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [cancelOpen, setCancelOpen] = React.useState(false)
  const [cancelReason, setCancelReason] = React.useState('')
  const [isMutating, setIsMutating] = React.useState(false)
  const [isGenerating, setIsGenerating] = React.useState(false)
  const [isDownloading, setIsDownloading] = React.useState(false)
  const [ordersDialogOpen, setOrdersDialogOpen] = React.useState(false)

  // The shared section is translation-agnostic, so this page keeps its own keys for the states it
  // renders; it passes no `onRetry`, so a failed section shows text only.
  const relatedSectionMessages = {
    loading: t('trade_docs.contracts.detail.related.loading', 'Loading…'),
    loadFailed: t('trade_docs.contracts.detail.related.loadFailed', 'Could not load this section.'),
    viewAll: t('trade_docs.contracts.detail.related.viewAll', 'View all'),
  }

  const headQuery = useQuery({
    queryKey: ['trade-docs-contract', contractId],
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>(CONTRACTS_API_PATH, {
        ids: contractId,
        pageSize: 1,
      })
      const item = payload.items?.[0]
      return item ? toHead(item) : null
    },
  })

  const linesQuery = useQuery({
    queryKey: ['trade-docs-contract-lines', contractId],
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>(CONTRACT_LINES_API_PATH, {
        contractId,
        pageSize: 500,
      })
      return (payload.items ?? []).map(toLine)
    },
  })

  const invoicesQuery = useQuery({
    queryKey: ['trade-docs-contract-invoices', contractId],
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>(INVOICES_API_PATH, {
        contractId,
        pageSize: 200,
      })
      return (payload.items ?? []).map(toInvoice)
    },
  })

  // The hub's five related collections. Each is its own read so a section a viewer cannot see (a
  // missing cross_border feature, say) fails alone instead of blanking the page.
  const ordersQuery = useQuery({
    queryKey: ['trade-docs-contract-orders', contractId],
    queryFn: () => loadRelatedPage(CONTRACT_ORDERS_API_PATH, { contractId }, toContractOrder),
  })

  const shipmentsQuery = useQuery({
    queryKey: ['trade-docs-contract-shipments', contractId],
    queryFn: () => loadRelatedPage(SHIPMENTS_API_PATH, { contractId }, toContractShipment),
  })

  const packingListsQuery = useQuery({
    queryKey: ['trade-docs-contract-packing-lists', contractId],
    queryFn: () => loadRelatedPage(
      SHIPMENT_DOCUMENTS_API_PATH,
      { contractId, docType: 'packing_list' },
      toContractPackingList,
    ),
  })

  const proformasQuery = useQuery({
    queryKey: ['trade-docs-contract-documents', contractId, 'proforma'],
    queryFn: () => loadRelatedPage(DOCUMENTS_API_PATH, { contractId, kind: 'proforma' }, toContractDocument),
  })

  const commercialInvoicesQuery = useQuery({
    queryKey: ['trade-docs-contract-documents', contractId, 'commercial'],
    queryFn: () => loadRelatedPage(DOCUMENTS_API_PATH, { contractId, kind: 'commercial' }, toContractDocument),
  })

  const head = headQuery.data ?? null
  const lines = linesQuery.data ?? []
  const invoices = invoicesQuery.data ?? []
  const orders = ordersQuery.data ?? { items: [], total: 0 }
  const shipments = shipmentsQuery.data ?? { items: [], total: 0 }
  const packingLists = packingListsQuery.data ?? { items: [], total: 0 }
  const proformas = proformasQuery.data ?? { items: [], total: 0 }
  const commercialInvoices = commercialInvoicesQuery.data ?? { items: [], total: 0 }
  const locale = useLocale()
  const columns = React.useMemo(
    () => buildLineColumns(t, head?.currencyCode ?? 'CNY'),
    [head?.currencyCode, t],
  )

  /** Refreshes the section the dialog writes, plus the head (a save may move the contract's version). */
  const refreshOrderLinks = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['trade-docs-contract-orders', contractId] })
    await queryClient.invalidateQueries({ queryKey: ['trade-docs-contract', contractId] })
  }, [contractId, queryClient])

  const runTransition = React.useCallback(
    async (action: 'issue' | 'sign' | 'close' | 'cancel', reason?: string) => {
      setIsMutating(true)
      try {
        await createCrud(CONTRACT_TRANSITIONS_API_PATH, { id: contractId, action, ...(reason ? { reason } : {}) })
        await queryClient.invalidateQueries({ queryKey: ['trade-docs-contract', contractId] })
        await queryClient.invalidateQueries({ queryKey: ['trade-docs-contracts'] })
        await queryClient.invalidateQueries({ queryKey: ['trade-docs-contract-lines', contractId] })
      } catch (error) {
        flash(error instanceof Error && error.message ? error.message : t('trade_docs.contracts.transitions.failed'), 'error')
      } finally {
        setIsMutating(false)
      }
    },
    [contractId, queryClient, t],
  )

  /** Renders the document on the server and refreshes the head so the download button appears. */
  const handleGenerate = React.useCallback(async () => {
    setIsGenerating(true)
    try {
      await apiCallOrThrow(
        `${CONTRACT_DOCUMENT_API_PATH}/${encodeURIComponent(contractId)}`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        },
        { errorMessage: t('trade_docs.contracts.detail.attachment.failed') },
      )
      flash(t('trade_docs.contracts.detail.attachment.generated'), 'success')
      await queryClient.invalidateQueries({ queryKey: ['trade-docs-contract', contractId] })
    } catch (error) {
      flash(
        error instanceof Error && error.message
          ? error.message
          : t('trade_docs.contracts.detail.attachment.failed'),
        'error',
      )
    } finally {
      setIsGenerating(false)
    }
  }, [contractId, queryClient, t])

  const handleDownload = React.useCallback(async () => {
    setIsDownloading(true)
    try {
      await downloadApiFile({
        url: `${CONTRACT_DOCUMENT_API_PATH}/${encodeURIComponent(contractId)}`,
        expectedContentType: XLSX_CONTENT_TYPE,
        fallbackName: `${head?.number ?? 'contract'}.xlsx`,
        errorMessage: t('trade_docs.contracts.detail.attachment.notReady'),
      })
    } catch (error) {
      flash(
        error instanceof Error && error.message
          ? error.message
          : t('trade_docs.contracts.detail.attachment.notReady'),
        'error',
      )
    } finally {
      setIsDownloading(false)
    }
  }, [contractId, head?.number, t])

  const handleAction = React.useCallback(
    async (action: 'issue' | 'sign' | 'close' | 'cancel') => {
      if (action === 'cancel') {
        setCancelReason('')
        setCancelOpen(true)
        return
      }
      if (action === 'issue') {
        const confirmed = await confirm({
          title: t('trade_docs.contracts.transitions.issue'),
          description: t('trade_docs.contracts.transitions.issueConfirmBody'),
          confirmText: t('trade_docs.contracts.transitions.issue'),
        })
        if (!confirmed) return
      }
      await runTransition(action)
    },
    [confirm, runTransition, t],
  )

  if (headQuery.isLoading) return <LoadingMessage label={t('trade_docs.common.loading')} />
  if (headQuery.error) {
    const status = (headQuery.error as { status?: number }).status
    if (status === 404) return <RecordNotFoundState label={t('trade_docs.contracts.form.notFound')} backHref={LIST_HREF} />
    return <ErrorMessage label={t('trade_docs.contracts.form.loadFailed')} />
  }
  if (!head) return <RecordNotFoundState label={t('trade_docs.contracts.form.notFound')} backHref={LIST_HREF} />

  const actions = ALLOWED_ACTIONS[head.status]
  // Scaled units, not a float: the difference is an amount, so "is there a difference?" is exact.
  const hasDifference = toScaledUnits(head.differenceTotal, AMOUNT_SCALE) !== 0n

  return (
    <div className="space-y-6">
      <FormHeader
        mode="detail"
        backHref={LIST_HREF}
        entityTypeLabel={t('trade_docs.contracts.page.title')}
        title={head.number ?? t(`trade_docs.contracts.status.${head.status}`)}
        statusBadge={(
          <StatusBadge variant={STATUS_VARIANT[head.status]} dot>
            {contractStatusLabel(t, head.status)}
          </StatusBadge>
        )}
        actionsContent={(
          <div className="flex flex-wrap items-center gap-2">
            {actions.map((action) => (
              <Button
                key={action}
                type="button"
                variant={action === 'cancel' ? 'outline' : 'default'}
                disabled={isMutating}
                onClick={() => void handleAction(action)}
              >
                {t(`trade_docs.contracts.transitions.${action}`)}
              </Button>
            ))}
            {head.status === 'draft' ? (
              <Button asChild variant="outline">
                <Link href={`${LIST_HREF}/${head.id}/edit`}>{t('trade_docs.contracts.actions.edit')}</Link>
              </Button>
            ) : null}
          </div>
        )}
      />

      <section className="space-y-3">
        <SectionHeader title={t('trade_docs.contracts.detail.amounts.title')} />
        <p className="text-xs text-muted-foreground">{t('trade_docs.contracts.detail.amounts.hint')}</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <SummaryField label={t('trade_docs.contracts.detail.amounts.contractTotal')}>
            <MoneyAmount
              currencyCode={head.currencyCode}
              amount={head.contractTotal}
              className="text-lg font-semibold"
            />
          </SummaryField>
          <SummaryField label={t('trade_docs.contracts.detail.amounts.financeTotal')}>
            <MoneyAmount
              currencyCode={head.currencyCode}
              amount={head.financeTotal}
              className="text-lg font-semibold"
            />
          </SummaryField>
          <SummaryField label={t('trade_docs.contracts.detail.amounts.differenceTotal')}>
            <MoneyAmount
              currencyCode={head.currencyCode}
              amount={head.differenceTotal}
              className={
                hasDifference
                  ? 'text-lg font-semibold text-status-error-text'
                  : 'text-lg font-semibold'
              }
            />
          </SummaryField>
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeader title={t('trade_docs.contracts.form.group.header')} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SummaryField label={t('trade_docs.contracts.form.field.direction')}>
            {directionLabel(t, head.direction)}
          </SummaryField>
          <SummaryField label={t('trade_docs.contracts.list.columns.counterparty')}>
            {head.counterpartyName ?? snapshotText(head.counterpartySnapshot, 'name') ?? '—'}
          </SummaryField>
          <SummaryField label={t('trade_docs.contracts.form.field.currencyCode')}>{head.currencyCode}</SummaryField>
          <SummaryField label={t('trade_docs.contracts.form.field.priceTier')}>
            {head.priceTier
              ? t(`products.priceTier.${head.priceTier}`)
              : t('trade_docs.contracts.form.priceTier.none')}
          </SummaryField>
          <SummaryField label={t('trade_docs.contracts.form.field.signedAt')}>{head.signedAt ?? '—'}</SummaryField>
          <SummaryField label={t('trade_docs.contracts.form.field.deliveryDate')}>{head.deliveryDate ?? '—'}</SummaryField>
          <SummaryField label={t('trade_docs.contracts.form.field.paymentTerms')}>{head.paymentTerms ?? '—'}</SummaryField>
          <SummaryField label={t('trade_docs.contracts.form.field.incoterms')}>{head.incoterms ?? '—'}</SummaryField>
          <SummaryField label={t('trade_docs.contracts.form.field.shippingMethod')}>{head.shippingMethod ?? '—'}</SummaryField>
          <SummaryField label={t('trade_docs.contracts.form.field.destination')}>{head.destination ?? '—'}</SummaryField>
          <SummaryField label={t('trade_docs.contracts.form.field.notes')}>{head.notes ?? '—'}</SummaryField>
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeader title={t('trade_docs.contracts.form.lines.title')} />
        <DataTable<ContractLineRecord>
          columns={columns}
          data={lines}
          emptyState={<EmptyState title={t('trade_docs.contracts.form.lines.empty')} />}
          isLoading={linesQuery.isLoading}
          error={linesQuery.error ? t('trade_docs.contracts.form.loadFailed') : null}
        />
      </section>

      <section className="space-y-3">
        <SectionHeader
          title={t('trade_docs.contracts.detail.invoices.title')}
          action={(
            <Button asChild variant="outline">
              <Link href={`${INVOICES_HREF}/create?contractId=${encodeURIComponent(head.id)}`}>
                {t('trade_docs.contracts.detail.invoices.add')}
              </Link>
            </Button>
          )}
        />
        {invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('trade_docs.contracts.detail.invoices.empty')}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {invoices.map((invoice) => (
              <li key={invoice.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="flex items-center gap-3">
                  <Link className="text-sm font-medium hover:underline" href={`${INVOICES_HREF}/${invoice.id}/edit`}>
                    {invoice.number ?? invoice.id.slice(0, 8)}
                  </Link>
                  <StatusBadge variant={invoice.status === 'confirmed' ? 'success' : invoice.status === 'void' ? 'error' : 'neutral'}>
                    {invoiceStatusLabel(t, invoice.status)}
                  </StatusBadge>
                  <span className="text-xs text-muted-foreground">{directionLabel(t, invoice.direction)}</span>
                  {/*
                    The kind is what tells a reader why a listed invoice may not move the contract's
                    financial figures: an export invoice is excluded by caliber, everything else counts.
                  */}
                  <span className="text-xs text-muted-foreground">{invoiceKindLabel(t, invoice.invoiceKind)}</span>
                </div>
                <MoneyAmount
                  currencyCode={invoice.currencyCode}
                  amount={invoice.total}
                  className="items-end text-sm"
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <RelatedSection
        title={t('trade_docs.contracts.detail.orders.title', 'Linked orders')}
        action={head.status === 'cancelled' ? undefined : (
          <Button type="button" variant="outline" onClick={() => setOrdersDialogOpen(true)}>
            {t('trade_docs.contracts.detail.orders.manage', 'Manage order links')}
          </Button>
        )}
        isLoading={ordersQuery.isLoading}
        failed={Boolean(ordersQuery.error)}
        messages={relatedSectionMessages}
        isEmpty={orders.items.length === 0}
        emptyLabel={t('trade_docs.contracts.detail.orders.empty', 'No orders linked yet.')}
      >
        <ul className="divide-y divide-border rounded-lg border border-border">
          {orders.items.slice(0, RELATED_ROW_LIMIT).map((order) => {
            const orderedAt = dateOnlyLabel(order.orderedAt, locale)
            return (
              <li key={order.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="flex flex-wrap items-center gap-3">
                  {/*
                    The number is text, not a link: the installed purchasing and sales engines have no
                    order detail page of their own, and a guessed URL would 404 on the operator.
                  */}
                  <span className="text-sm font-medium">{order.orderNumber ?? order.orderId.slice(0, 8)}</span>
                  <StatusBadge variant={ORDER_KIND_VARIANT[order.orderKind] ?? 'neutral'}>
                    {orderKindLabel(t, order.orderKind)}
                  </StatusBadge>
                  {order.counterpartyName ? (
                    <span className="text-xs text-muted-foreground">{order.counterpartyName}</span>
                  ) : null}
                </div>
                {orderedAt ? (
                  <span className="text-xs tabular-nums text-muted-foreground">{orderedAt}</span>
                ) : null}
              </li>
            )
          })}
        </ul>
      </RelatedSection>

      <RelatedSection
        title={t('trade_docs.contracts.detail.shipments.title', 'Linked shipments')}
        action={(
          <Button asChild variant="outline">
            <Link href={`${SHIPMENTS_HREF}/create?contractId=${encodeURIComponent(head.id)}`}>
              {t('trade_docs.contracts.detail.shipments.add', 'New shipment')}
            </Link>
          </Button>
        )}
        isLoading={shipmentsQuery.isLoading}
        failed={Boolean(shipmentsQuery.error)}
        messages={relatedSectionMessages}
        isEmpty={shipments.items.length === 0}
        emptyLabel={t('trade_docs.contracts.detail.shipments.empty', 'No shipments linked yet.')}
        viewAllHref={
          shipments.total > RELATED_ROW_LIMIT
            ? `${SHIPMENTS_HREF}?contractId=${encodeURIComponent(head.id)}`
            : null
        }
      >
        <ul className="divide-y divide-border rounded-lg border border-border">
          {shipments.items.slice(0, RELATED_ROW_LIMIT).map((shipment) => {
            const etd = dateOnlyLabel(shipment.etd, locale)
            return (
              <li key={shipment.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="flex flex-wrap items-center gap-3">
                  <Link className="text-sm font-medium hover:underline" href={`${SHIPMENTS_HREF}/${shipment.id}`}>
                    {shipment.number ?? shipment.id.slice(0, 8)}
                  </Link>
                  <StatusBadge variant={SHIPMENT_STATUS_VARIANT[shipment.status] ?? 'neutral'}>
                    {shipmentStatusLabel(t, shipment.status)}
                  </StatusBadge>
                  {shipment.carrierName ? (
                    <span className="text-xs text-muted-foreground">{shipment.carrierName}</span>
                  ) : null}
                </div>
                {etd ? <span className="text-xs tabular-nums text-muted-foreground">{etd}</span> : null}
              </li>
            )
          })}
        </ul>
      </RelatedSection>

      <RelatedSection
        title={t('trade_docs.contracts.detail.packingLists.title', 'Linked packing lists')}
        action={(
          <Button asChild variant="outline">
            <Link href={`${PACKING_LISTS_HREF}/create?contractId=${encodeURIComponent(head.id)}`}>
              {t('trade_docs.contracts.detail.packingLists.add', 'New packing list')}
            </Link>
          </Button>
        )}
        isLoading={packingListsQuery.isLoading}
        failed={Boolean(packingListsQuery.error)}
        messages={relatedSectionMessages}
        isEmpty={packingLists.items.length === 0}
        emptyLabel={t('trade_docs.contracts.detail.packingLists.empty', 'No packing lists linked yet.')}
        viewAllHref={
          packingLists.total > RELATED_ROW_LIMIT
            ? `${PACKING_LISTS_HREF}?contractId=${encodeURIComponent(head.id)}`
            : null
        }
      >
        <ul className="divide-y divide-border rounded-lg border border-border">
          {packingLists.items.slice(0, RELATED_ROW_LIMIT).map((packingList) => {
            const issuedAt = dateOnlyLabel(packingList.issuedAt, locale)
            return (
              <li key={packingList.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <Link
                  className="text-sm font-medium hover:underline"
                  href={`${PACKING_LISTS_HREF}/${packingList.id}`}
                >
                  {packingList.documentNumber ?? packingList.id.slice(0, 8)}
                </Link>
                {issuedAt ? (
                  <span className="text-xs tabular-nums text-muted-foreground">{issuedAt}</span>
                ) : null}
              </li>
            )
          })}
        </ul>
      </RelatedSection>

      <RelatedSection
        title={t('trade_docs.contracts.detail.proformas.title', 'Proforma invoice (PI)')}
        action={(
          <Button asChild variant="outline">
            <Link href={`${PROFORMAS_HREF}/create?contractId=${encodeURIComponent(head.id)}`}>
              {t('trade_docs.contracts.detail.proformas.add', 'New PI')}
            </Link>
          </Button>
        )}
        isLoading={proformasQuery.isLoading}
        failed={Boolean(proformasQuery.error)}
        messages={relatedSectionMessages}
        isEmpty={proformas.items.length === 0}
        emptyLabel={t('trade_docs.contracts.detail.proformas.empty', 'No proforma invoices linked yet.')}
        viewAllHref={
          proformas.total > RELATED_ROW_LIMIT
            ? `${PROFORMAS_HREF}?contractId=${encodeURIComponent(head.id)}`
            : null
        }
      >
        <ul className="divide-y divide-border rounded-lg border border-border">
          {proformas.items.slice(0, RELATED_ROW_LIMIT).map((proforma) => (
            <li key={proforma.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="flex items-center gap-3">
                <Link className="text-sm font-medium hover:underline" href={`${PROFORMAS_HREF}/${proforma.id}`}>
                  {proforma.number ?? proforma.id.slice(0, 8)}
                </Link>
                <StatusBadge variant={DOCUMENT_STATUS_VARIANT[proforma.status] ?? 'neutral'}>
                  {documentStatusLabel(t, proforma.status)}
                </StatusBadge>
              </div>
              <MoneyAmount
                currencyCode={proforma.currencyCode}
                amount={proforma.total}
                className="items-end text-sm"
              />
            </li>
          ))}
        </ul>
      </RelatedSection>

      <RelatedSection
        title={t('trade_docs.contracts.detail.commercialInvoices.title', 'Commercial invoice (CI)')}
        action={(
          <Button asChild variant="outline">
            <Link href={`${COMMERCIAL_INVOICES_HREF}/create?contractId=${encodeURIComponent(head.id)}`}>
              {t('trade_docs.contracts.detail.commercialInvoices.add', 'New CI')}
            </Link>
          </Button>
        )}
        isLoading={commercialInvoicesQuery.isLoading}
        failed={Boolean(commercialInvoicesQuery.error)}
        messages={relatedSectionMessages}
        isEmpty={commercialInvoices.items.length === 0}
        emptyLabel={t(
          'trade_docs.contracts.detail.commercialInvoices.empty',
          'No commercial invoices linked yet.',
        )}
        viewAllHref={
          commercialInvoices.total > RELATED_ROW_LIMIT
            ? `${COMMERCIAL_INVOICES_HREF}?contractId=${encodeURIComponent(head.id)}`
            : null
        }
      >
        <ul className="divide-y divide-border rounded-lg border border-border">
          {commercialInvoices.items.slice(0, RELATED_ROW_LIMIT).map((commercialInvoice) => (
            <li key={commercialInvoice.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="flex items-center gap-3">
                <Link
                  className="text-sm font-medium hover:underline"
                  href={`${COMMERCIAL_INVOICES_HREF}/${commercialInvoice.id}`}
                >
                  {commercialInvoice.number ?? commercialInvoice.id.slice(0, 8)}
                </Link>
                <StatusBadge variant={DOCUMENT_STATUS_VARIANT[commercialInvoice.status] ?? 'neutral'}>
                  {documentStatusLabel(t, commercialInvoice.status)}
                </StatusBadge>
              </div>
              <MoneyAmount
                currencyCode={commercialInvoice.currencyCode}
                amount={commercialInvoice.total}
                className="items-end text-sm"
              />
            </li>
          ))}
        </ul>
      </RelatedSection>

      <section className="space-y-3">
        <SectionHeader title={t('trade_docs.contracts.detail.attachment.title')} />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={isGenerating || head.status === 'draft' || head.status === 'cancelled'}
            onClick={() => void handleGenerate()}
          >
            {t('trade_docs.contracts.detail.attachment.generate')}
          </Button>
          {head.generatedAttachmentId ? (
            <Button type="button" variant="outline" disabled={isDownloading} onClick={() => void handleDownload()}>
              {t('trade_docs.contracts.detail.attachment.download')}
            </Button>
          ) : (
            <span className="text-sm text-muted-foreground">
              {t('trade_docs.contracts.detail.attachment.none')}
            </span>
          )}
        </div>
      </section>

      <ContractScanSection
        contractId={head.id}
        attachmentId={head.attachmentId}
        updatedAt={head.updatedAt}
        onChanged={async () => {
          await queryClient.invalidateQueries({ queryKey: ['trade-docs-contract', contractId] })
          await queryClient.invalidateQueries({ queryKey: ['trade-docs-contracts'] })
        }}
      />

      <section className="space-y-3">
        <SectionHeader title={t('trade_docs.contracts.detail.party.title')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1 rounded-lg border border-border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('trade_docs.contracts.list.columns.counterparty')}
            </p>
            <p className="text-sm">{snapshotText(head.counterpartySnapshot, 'name') ?? '—'}</p>
            <p className="text-sm text-muted-foreground">{snapshotText(head.counterpartySnapshot, 'address') ?? ''}</p>
            <p className="text-sm text-muted-foreground">{snapshotText(head.counterpartySnapshot, 'contact') ?? ''}</p>
            <p className="text-sm text-muted-foreground">{snapshotText(head.counterpartySnapshot, 'bank') ?? ''}</p>
          </div>
          <div className="space-y-1 rounded-lg border border-border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('trade_docs.contracts.detail.ourParty')}
            </p>
            <p className="text-sm">{snapshotText(head.ourPartySnapshot, 'name') ?? '—'}</p>
            <p className="text-sm text-muted-foreground">{snapshotText(head.ourPartySnapshot, 'address') ?? ''}</p>
            <p className="text-sm text-muted-foreground">{snapshotText(head.ourPartySnapshot, 'contact') ?? ''}</p>
            <p className="text-sm text-muted-foreground">{snapshotText(head.ourPartySnapshot, 'bank') ?? ''}</p>
          </div>
        </div>
      </section>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('trade_docs.contracts.transitions.cancelConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('trade_docs.contracts.transitions.cancelConfirmBody')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="contract-cancel-reason">
              {t('trade_docs.contracts.transitions.cancelReason')}
            </label>
            <Input
              id="contract-cancel-reason"
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCancelOpen(false)}>
              {t('ui.actions.cancel')}
            </Button>
            <Button
              type="button"
              disabled={cancelReason.trim().length === 0 || isMutating}
              onClick={async () => {
                const reason = cancelReason.trim()
                if (!reason) {
                  flash(t('trade_docs.contracts.transitions.cancelReasonRequired'), 'error')
                  return
                }
                await runTransition('cancel', reason)
                setCancelOpen(false)
              }}
            >
              {t('trade_docs.contracts.transitions.cancel')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <ContractOrdersDialog
        open={ordersDialogOpen}
        onOpenChange={setOrdersDialogOpen}
        contractId={head.id}
        contractUpdatedAt={head.updatedAt}
        cancelled={head.status === 'cancelled'}
        onSaved={refreshOrderLinks}
      />
      {ConfirmDialogElement}
    </div>
  )
}
