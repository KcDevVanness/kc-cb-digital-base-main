'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { fetchCrudList, createCrud } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { MoneyAmount } from '@/lib/money/MoneyAmount'
import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import { RelatedSection } from '@/lib/related/RelatedSection'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { QuickEditDialog } from '@/lib/quick-edit/QuickEditDialog'
import { createDictionaryMap, renderDictionaryColor, type DictionaryMap } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import {
  resolveCodeListLabel,
  resolveHeaderSupplierName,
  toCompanyOrderHead,
} from './companyOrderDisplay'
import { useCodeListOptions } from '@/lib/dictionaries/codeListOptions'
import {
  fields as contractQuickEditFields,
  toValues as contractQuickEditValues,
} from '../../trade_docs/lib/contractQuickEdit'
import {
  fields as documentQuickEditFields,
  toValues as documentQuickEditValues,
} from '../../trade_docs/lib/documentQuickEdit'
import {
  fields as invoiceQuickEditFields,
  toValues as invoiceQuickEditValues,
} from '../../trade_docs/lib/invoiceQuickEdit'
import {
  fields as shipmentQuickEditFields,
  toValues as shipmentQuickEditValues,
} from '../../cross_border/lib/shipmentQuickEdit'
import { useSalesStatusEntries } from '../../internal_sales/lib/salesStatusEntries'
import { readChannelId, tradeTypeFromChannelId } from '../../internal_sales/lib/tradeType'
import { useTradeTypeChannels } from '../../internal_sales/lib/tradeTypeChannels'
import { OrderDocumentsDialog } from '../../trade_docs/components/OrderDocumentsDialog'
import { CompanyOrderLinkDialog } from './CompanyOrderLinkDialog'
import { CompanyOrderCollaboratorsDialog } from './CompanyOrderCollaboratorsDialog'
import { CompanyOrderStatusDialog } from './CompanyOrderStatusDialog'
import { AttachmentsSection } from '@/lib/attachments/AttachmentsSection'
import { OrderDocumentsSection } from './OrderDocumentsSection'
import { withReturnTo } from '@/lib/navigation/returnTo'
import { childStatusAppearance } from './companyOrderChildStatus'
import LinkedRecordPreviewDrawer from './LinkedRecordPreviewDrawer'
import type { LinkedRecordPreviewKind, LinkedRecordPreviewTarget } from './linkedRecordPreviewSources'
import { resolveCompanyOrderForDocument } from '../lib/companyOrderResolve'
import type { CompanyOrderLinkKind } from '../data/validators'

const ORDERS_API_PATH = 'order_hub/orders'
const LINKS_API_PATH = 'order_hub/orders/links'
const LINK_CHILD_API_PATH = 'order_hub/orders/link-child'
const SALES_ORDERS_API_PATH = 'sales/orders'

const CONTRACTS_HREF = '/backend/trade-docs/contracts'
const DOCUMENTS_HREF = '/backend/trade-docs/proformas'
const SHIPMENTS_HREF = '/backend/cross_border/shipments'
const PACKING_LISTS_HREF = '/backend/cross_border/packing-lists'
const MONEY_HREF = '/backend/export-finance/orders'

/**
 * How many children one downstream block reads before it stops.
 *
 * Each block fans out one request per child; a company order with fifty linked sales orders would
 * turn one screen into hundreds of calls. The cap keeps the page bounded and the block says it
 * truncated rather than silently dropping rows.
 */
const MAX_CHILD_READS = 20

const ORDER_STATUS_VARIANT: StatusMap = {
  // The current vocabulary (2026-10-09): the deal's own order, in flight until it reaches the
  // warehouse. Rows written before it landed keep their old values and tones.
  placed: 'info',
  in_production: 'info',
  factory_pickup: 'info',
  customs_declared: 'info',
  shipped: 'info',
  in_transit: 'info',
  warehoused: 'success',
  draft: 'neutral',
  in_progress: 'info',
  completed: 'success',
  cancelled: 'error',
}

type LinkRow = {
  id: string
  kind: CompanyOrderLinkKind
  refId: string
  refNumber: string | null
  refCounterparty: string | null
  refStatus: string | null
}

type ContractRow = { id: string; number: string | null; status: string; currencyCode: string; total: string; updatedAt: string | null }
type DocumentRow = { id: string; kind: 'proforma' | 'commercial' | 'tax_invoice'; number: string | null; status: string; currencyCode: string; total: string; updatedAt: string | null }
type ShipmentRow = { id: string; number: string | null; status: string; containerNumber: string | null; updatedAt: string | null }
type PackingListRow = { id: string; documentNumber: string | null; issuedAt: string | null; shipmentId: string; shipmentNumber: string | null }
type CollectionRow = { purchaseOrderId: string; purchaseOrderNumber: string | null; collectionStatus: string; amount: string | null; currencyCode: string }
type RefundRow = { shipmentId: string; shipmentNumber: string | null; taxRefundStatus: string; taxRefundAmount: string | null; currencyCode: string }
/** One linked purchase order's money header, as the batched `?ids=` read projects it (REQ-043). */
type PurchaseAmountRow = {
  total: string | null
  paidDeposit: string | null
  paidBalance: string | null
  /** 定金比例 — the term frozen on the order, shown beside the amounts (owner 2026-10-10). */
  depositPercent: string | null
  /** 备注 — the order's own note, shown in the row (owner 2026-10-10). */
  notes: string | null
  currencyCode: string
}

/**
 * `50.000` → `50%`: the percent column carries `numeric(6,3)`, so the row shows the term the
 * operator typed and never a trailing-zero wall. A value that is not a finite number is shown as
 * stored (the cell never blanks a fact the record holds).
 */
function formatDepositPercent(value: string | null): string | null {
  if (!value) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return value
  return `${Number(parsed.toFixed(3))}%`
}

/** The three order kinds this phase attaches; a purchase child needs no trade type. */
function isSalesKind(kind: CompanyOrderLinkKind): kind is 'internal_sales_order' | 'external_sales_order' {
  return kind === 'internal_sales_order' || kind === 'external_sales_order'
}

function readText(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return ''
}

/**
 * The 收汇 and 退税 reads answer `{ item }` — one archive per purchase order / shipment, not a list —
 * so the shared list helper's shape is narrowed here rather than cast at each call site.
 */
function readSingleItem(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || !('item' in payload)) return null
  const item = payload.item
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  return item as Record<string, unknown>
}

function toLinkRow(item: Record<string, unknown>): LinkRow {
  const snapshot = item.refSnapshot ?? item.ref_snapshot
  const status =
    snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
      ? ((snapshot as Record<string, unknown>).status ?? null)
      : null
  return {
    id: String(item.id),
    kind: String(item.kind) as CompanyOrderLinkKind,
    refId: String(item.refId ?? item.ref_id ?? ''),
    refNumber: (item.refNumber ?? item.ref_number ?? null) as string | null,
    refCounterparty: (item.refCounterparty ?? item.ref_counterparty ?? null) as string | null,
    refStatus: typeof status === 'string' && status.length > 0 ? status : null,
  }
}

/**
 * Where a linked child opens: `edit` is the module's own edit page, `detail` its read-only detail
 * page (the two sales kinds have only the edit surface; a purchase order has both).
 */
function childHref(kind: CompanyOrderLinkKind, refId: string, surface: 'edit' | 'detail'): string {
  const id = encodeURIComponent(refId)
  if (kind === 'purchase_order') {
    return surface === 'edit' ? `/backend/purchasing/orders/${id}/edit` : `/backend/purchasing/orders/${id}`
  }
  const ledger = kind === 'external_sales_order' ? '/backend/external-sales' : '/backend/internal-sales'
  return `${ledger}/orders/${id}/edit`
}

function childCreatePayloadHref(base: string, child: LinkRow): string {
  return `${base}?orderKind=${child.kind}&orderId=${encodeURIComponent(child.refId)}`
}

function aggregationLoading(queries: Array<{ isLoading: boolean }>): boolean {
  return queries.some((query) => query.isLoading)
}

function aggregationFailed(queries: Array<{ isError: boolean }>): boolean {
  return queries.some((query) => query.isError)
}

function retryQueries(queries: Array<{ refetch: () => unknown }>): void {
  for (const query of queries) void query.refetch()
}

/** The 「编辑」 action one block row offers. */
function RowEditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="sm" onClick={onClick}>
      {label}
    </Button>
  )
}

/**
 * The truncation notice a downstream block shows when a company order holds more children than the
 * block reads. It is deliberately per block: the cap is what the block did, not a page-level failure.
 */
function TruncationHint({ truncated }: { truncated: boolean }) {
  const t = useT()
  if (!truncated) return null
  return <p className="text-xs text-muted-foreground">{t('order_hub.detail.truncated', { count: MAX_CHILD_READS })}</p>
}

/**
 * What a block row's 「编辑」 needs: the owning module's own PUT path, the fields that PUT accepts and
 * the mapper that turns a **re-read** row into the dialog's initial values.
 */
type QuickEditConfig = {
  apiPath: string
  titleKey: string
  fields: CrudField[]
  toValues: (row: Record<string, unknown>) => Record<string, unknown>
}

const QUICK_EDIT_CONFIGS = {
  contracts: {
    apiPath: 'trade_docs/contracts',
    titleKey: 'order_hub.detail.contracts.editTitle',
    fields: contractQuickEditFields,
    toValues: contractQuickEditValues,
  },
  shipments: {
    apiPath: 'cross_border/shipments',
    titleKey: 'order_hub.detail.shipments.editTitle',
    fields: shipmentQuickEditFields,
    toValues: shipmentQuickEditValues,
  },
  /** PI and CI are the same table and the same PUT, so one entry serves both kinds. */
  documents: {
    apiPath: 'trade_docs/documents',
    titleKey: 'order_hub.detail.documents.editTitle',
    fields: documentQuickEditFields,
    toValues: documentQuickEditValues,
  },
  taxInvoices: {
    apiPath: 'trade_docs/invoices',
    titleKey: 'order_hub.detail.invoices.editTitle',
    fields: invoiceQuickEditFields,
    toValues: invoiceQuickEditValues,
  },
} satisfies Record<string, QuickEditConfig>

function quickEditConfigForDocument(kind: DocumentRow['kind']): QuickEditConfig {
  return kind === 'tax_invoice' ? QUICK_EDIT_CONFIGS.taxInvoices : QUICK_EDIT_CONFIGS.documents
}

function documentKindLabelKey(kind: DocumentRow['kind']): string {
  return kind === 'tax_invoice' ? 'order_hub.detail.documents.kind.taxInvoice' : `trade_docs.documents.kind.${kind}`
}

/**
 * A block row's document number. It is a button, not a link: clicking opens the record's read-only
 * preview in the right-side drawer instead of leaving the page — 「编辑」 is the action that leaves.
 */
function PreviewNumber({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="link" size="sm" onClick={onClick}>
      {label}
    </Button>
  )
}

/**
 * One labeled amount on a 采购 row (REQ-043). The value comes from the block's single batched read;
 * a row the read did not carry — or a viewer the projection refused — renders `—` rather than an
 * error, because the amount is a read-only extra on a row that is otherwise complete.
 */
function PurchaseRowAmount({ label, value, currencyCode }: { label: string; value: string | null; currencyCode: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      {label}
      <span className="text-foreground">{value ? <MoneyAmount currencyCode={currencyCode} amount={value} /> : '—'}</span>
    </span>
  )
}

/** The 新建 choice the merged 出口销售 block needs: each kind has its own create entry. */
function SalesKindDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (kind: 'internal_sales_order' | 'external_sales_order') => void
}) {
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('order_hub.detail.sales.chooseKind.title')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t('order_hub.detail.sales.chooseKind.body')}</p>
        <ul className="flex flex-col gap-2">
          {(['internal_sales_order', 'external_sales_order'] as const).map((kind) => (
            <li key={kind}>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start"
                onClick={() => onPick(kind)}
              >
                {t(
                  kind === 'external_sales_order'
                    ? 'order_hub.companyOrders.links.kind.external'
                    : 'order_hub.companyOrders.links.kind.internal',
                )}
              </Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The 「未关联」 state a legacy URL shows when its document is not attached to any company order.
 *
 * The document's own trade type decides which kind an auto-created root should link, so the sales
 * order is read (the channel marker plus the channel map) and the trade type derived before the
 * link-child call. Both entries run the same idempotent command — one with no target root (the
 * server creates a draft), one with a picked root — so a repeated click never doubles a link.
 */
function UnlinkedOrderState({ documentId }: { documentId: string }) {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const { channels } = useTradeTypeChannels('order')
  const [picking, setPicking] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  const salesQuery = useQuery({
    queryKey: ['order-hub-unlinked-sales', documentId, scopeVersion],
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>(SALES_ORDERS_API_PATH, { id: documentId, pageSize: 1 })
      return payload.items?.[0] ?? null
    },
  })

  const salesKind: CompanyOrderLinkKind = React.useMemo(() => {
    const item = salesQuery.data
    const tradeType = item ? tradeTypeFromChannelId(readChannelId(item), channels) : null
    return tradeType === 'external' ? 'external_sales_order' : 'internal_sales_order'
  }, [channels, salesQuery.data])

  const linkChild = React.useCallback(
    async (companyOrderId?: string) => {
      setBusy(true)
      try {
        const result = await readApiResultOrThrow<{ companyOrderId?: string }>(
          `/api/${LINK_CHILD_API_PATH}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ kind: salesKind, refId: documentId, ...(companyOrderId ? { companyOrderId } : {}) }),
          },
          { errorMessage: t('order_hub.companyOrders.notFound.linkFailed') },
        )
        const resolvedId = typeof result.companyOrderId === 'string' ? result.companyOrderId : companyOrderId
        flash(t('order_hub.companyOrders.notFound.linked'), 'success')
        if (resolvedId) router.replace(`/backend/orders/${encodeURIComponent(resolvedId)}`)
      } catch (error) {
        flash(error instanceof Error && error.message ? error.message : t('order_hub.companyOrders.notFound.linkFailed'), 'error')
      } finally {
        setBusy(false)
        setPicking(false)
      }
    },
    [documentId, router, salesKind, t],
  )

  return (
    <div className="flex flex-col items-start gap-4 rounded-lg border bg-card px-4 py-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{t('order_hub.companyOrders.notFound.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('order_hub.companyOrders.notFound.body')}</p>
      </div>
      {salesQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">{t('order_hub.companyOrders.notFound.resolving')}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" disabled={busy} onClick={() => void linkChild()}>
            {t('order_hub.companyOrders.notFound.createAndLink')}
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setPicking(true)}>
            {t('order_hub.companyOrders.notFound.linkExisting')}
          </Button>
          <Button asChild variant="ghost">
            <Link href="/backend/orders">{t('order_hub.workbench.title')}</Link>
          </Button>
        </div>
      )}
      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{t('order_hub.companyOrders.picker.title')}</DialogTitle>
          </DialogHeader>
          <ExistingCompanyOrderPicker
            disabled={busy}
            onPick={(companyOrderId) => void linkChild(companyOrderId)}
          />
        </DialogContent>
      </Dialog>
      {busy ? <p className="text-xs text-muted-foreground">{t('order_hub.companyOrders.notFound.resolving')}</p> : null}
    </div>
  )
}

/** A searchable company-order picker over the module's own list, for 「关联到已有公司订单」. */
function ExistingCompanyOrderPicker({
  disabled,
  onPick,
}: {
  disabled: boolean
  onPick: (companyOrderId: string) => void
}) {
  const t = useT()
  const [value, setValue] = React.useState('')
  const loadSuggestions = React.useCallback(
    async (query?: string): Promise<ComboboxOption[]> => {
      const term = query?.trim()
      const payload = await fetchCrudList<Record<string, unknown>>(ORDERS_API_PATH, {
        pageSize: 20,
        ...(term ? { search: term } : {}),
      })
      return (payload.items ?? []).map((item) => {
        const id = String(item.id ?? '')
        const number = readText(item, 'number') || id.slice(0, 8)
        const title = readText(item, 'title')
        return { value: id, label: title ? `${number} — ${title}` : number }
      })
    },
    [],
  )
  return (
    <div className="flex items-end gap-2">
      <ComboboxInput
        value={value}
        onChange={setValue}
        disabled={disabled}
        clearable
        allowCustomValues={false}
        placeholder={t('order_hub.companyOrders.picker.placeholder')}
        loadSuggestions={loadSuggestions}
      />
      <Button type="button" disabled={disabled || value.length === 0} onClick={() => onPick(value)}>
        {t('order_hub.companyOrders.picker.confirm')}
      </Button>
    </div>
  )
}

/** The picker shown when a block's downstream create has more than one sales child to choose from. */
function SalesChildPickerDialog({
  open,
  onOpenChange,
  candidates: salesChildren,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  candidates: LinkRow[]
  onPick: (child: LinkRow) => void
}) {
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('order_hub.detail.pickChild.title')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t('order_hub.detail.pickChild.body')}</p>
        <ul className="flex flex-col gap-2">
          {salesChildren.map((child) => (
            <li key={child.id}>
              <Button type="button" variant="outline" className="w-full justify-start" onClick={() => onPick(child)}>
                {child.refNumber ?? child.refId.slice(0, 8)}
                {child.refCounterparty ? ` — ${child.refCounterparty}` : ''}
              </Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

export default function OrderDetail({ orderId }: { orderId: string }) {
  const t = useT()
  const router = useRouter()
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const { entries: salesStatusEntries } = useSalesStatusEntries()
  const salesStatusDictionary = React.useMemo<DictionaryMap | null>(
    () => (salesStatusEntries.length > 0 ? createDictionaryMap(salesStatusEntries) : null),
    [salesStatusEntries],
  )
  // 订单描述: the header resolves the stored `product_category` code to its option label. A code the
  // dictionary no longer carries still renders as itself (`resolveCodeListLabel`), so the cell never
  // blanks a value the record holds.
  const { options: productCategoryOptions } = useCodeListOptions('product_category')

  const [documentsDialog, setDocumentsDialog] = React.useState<{ orderKind: string; orderId: string } | null>(null)
  const [pickerAction, setPickerAction] = React.useState<((child: LinkRow) => void) | null>(null)
  const [linkDialog, setLinkDialog] = React.useState<{ kind: CompanyOrderLinkKind; kinds?: CompanyOrderLinkKind[] } | null>(null)
  const [collaboratorsOpen, setCollaboratorsOpen] = React.useState(false)
  const [statusOpen, setStatusOpen] = React.useState(false)
  const [salesKindsOpen, setSalesKindsOpen] = React.useState(false)
  const [preview, setPreview] = React.useState<LinkedRecordPreviewTarget | null>(null)
  const [previewOpen, setPreviewOpen] = React.useState(false)
  const [quickEdit, setQuickEdit] = React.useState<{
    config: QuickEditConfig
    recordId: string
    values: Record<string, unknown>
    updatedAt: string | null
    queryKeyPrefix: readonly unknown[]
  } | null>(null)

  // Removals ask first (owner 2026-10-10): the hook's element is rendered once at the end of the
  // tree, and every `confirm(...)` call awaits the operator's answer.
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const headQuery = useQuery({
    queryKey: ['order-hub-company-order', orderId, scopeVersion],
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>(ORDERS_API_PATH, { id: orderId, pageSize: 1 })
      const item = payload.items?.[0]
      return item ? toCompanyOrderHead(item) : null
    },
  })
  const head = headQuery.data ?? null

  const resolutionQuery = useQuery({
    queryKey: ['order-hub-resolve', orderId, scopeVersion],
    enabled: headQuery.isSuccess && head === null,
    queryFn: () => resolveCompanyOrderForDocument(orderId),
  })

  React.useEffect(() => {
    const resolved = resolutionQuery.data
    if (resolved?.status === 'found') {
      router.replace(`/backend/orders/${encodeURIComponent(resolved.companyOrderId)}`)
    }
  }, [resolutionQuery.data, router])

  const linksQuery = useQuery({
    queryKey: ['order-hub-links', head?.id, scopeVersion],
    enabled: Boolean(head),
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>(LINKS_API_PATH, {
        companyOrderId: head!.id,
        pageSize: 200,
      })
      return (payload.items ?? []).map(toLinkRow)
    },
  })
  const links = linksQuery.data ?? []
  const readChildren = React.useMemo(() => links.slice(0, MAX_CHILD_READS), [links])
  const truncated = links.length > MAX_CHILD_READS
  const salesChildren = React.useMemo(() => readChildren.filter((link) => isSalesKind(link.kind)), [readChildren])
  const allSalesChildren = React.useMemo(() => links.filter((link) => isSalesKind(link.kind)), [links])
  const purchaseChildren = React.useMemo(
    () => readChildren.filter((link) => link.kind === 'purchase_order'),
    [readChildren],
  )

  // ---- 采购单行金额 (REQ-043): one batched `?ids=` read for the whole page, never one per row. A
  // viewer without `purchasing.orders.view` (a collaborating organization's account) is refused with
  // a 403; the amounts are a read-only extra, so a refused or partial read simply answers `—` for the
  // rows it did not carry instead of taking the 采购 block down with it.
  const purchaseAmountIds = React.useMemo(
    () => links.filter((link) => link.kind === 'purchase_order').map((link) => link.refId),
    [links],
  )
  const purchaseAmountsQuery = useQuery({
    queryKey: ['order-hub-purchase-amounts', purchaseAmountIds.join(','), scopeVersion],
    enabled: Boolean(head) && purchaseAmountIds.length > 0,
    queryFn: async () => {
      const byId = new Map<string, PurchaseAmountRow>()
      try {
        // The route caps `pageSize` at 100 (asking for more is a 400, see
        // `.ai/lessons/option-loaders-must-respect-page-size-caps.md`), so the whole id set is read
        // page by page — a company order with more than 100 purchase links still answers every row.
        const pageSize = 100
        for (let page = 1; page <= 5 && byId.size < purchaseAmountIds.length; page += 1) {
          const payload = await fetchCrudList<Record<string, unknown>>('purchasing/purchase-orders', {
            ids: purchaseAmountIds.join(','),
            pageSize,
            page,
          })
          const items = payload.items ?? []
          for (const item of items) {
            const id = String(item.id ?? '')
            if (!id) continue
            byId.set(id, {
              total: readText(item, 'total') || null,
              paidDeposit: readText(item, 'paidDeposit') || null,
              paidBalance: readText(item, 'paidBalance') || null,
              depositPercent: readText(item, 'depositPercent') || null,
              notes: readText(item, 'notes') || null,
              currencyCode: readText(item, 'currencyCode') || 'CNY',
            })
          }
          if (items.length < pageSize) break
        }
      } catch {
        // See above: a refused or absent projection renders `—`, not a block error.
      }
      return byId
    },
  })
  const purchaseAmounts = purchaseAmountsQuery.data ?? new Map<string, PurchaseAmountRow>()

  // ---- 购销合同: one link read per child, then one batch read of the contracts they name.
  const contractLinkQueries = useQueries({
    queries: readChildren.map((child) => ({
      queryKey: ['order-hub-contract-links', child.kind, child.refId, scopeVersion],
      queryFn: async () =>
        (await fetchCrudList<Record<string, unknown>>('trade_docs/contracts/orders', {
          orderKind: child.kind,
          orderId: child.refId,
          pageSize: 50,
        })).items ?? [],
    })),
  })
  const contractIds = React.useMemo(() => {
    const ids = new Set<string>()
    for (const query of contractLinkQueries) {
      for (const item of query.data ?? []) ids.add(readText(item, 'contractId', 'contract_id'))
    }
    ids.delete('')
    return [...ids]
  }, [contractLinkQueries])
  const contractsQuery = useQuery({
    queryKey: ['order-hub-contracts', contractIds.join(','), scopeVersion],
    enabled: Boolean(head) && contractIds.length > 0,
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>('trade_docs/contracts', {
        ids: contractIds.join(','),
        pageSize: 100,
      })
      return (payload.items ?? []).map((item) => ({
        id: String(item.id),
        number: (item.number ?? null) as string | null,
        status: String(item.status ?? 'draft'),
        currencyCode: String(item.currencyCode ?? 'CNY'),
        total: String(item.total ?? '0'),
        updatedAt: readText(item, 'updatedAt', 'updated_at') || null,
      })) satisfies ContractRow[]
    },
  })
  const contracts = contractsQuery.data ?? []
  const soleContract = contracts.length === 1 ? contracts[0].id : null

  // ---- 单据: one link read per sales child, then one batch read of documents + tax invoices.
  const documentLinkQueries = useQueries({
    queries: salesChildren.map((child) => ({
      queryKey: ['order-hub-document-links', child.kind, child.refId, scopeVersion],
      queryFn: async () =>
        (await fetchCrudList<Record<string, unknown>>('trade_docs/orders/documents', {
          orderKind: child.kind,
          orderId: child.refId,
          pageSize: 100,
        })).items ?? [],
    })),
  })
  const documentPairs = React.useMemo(() => {
    const pairs = new Map<string, { kind: string; id: string }>()
    for (const query of documentLinkQueries) {
      for (const item of query.data ?? []) {
        const kind = readText(item, 'documentKind', 'document_kind')
        const id = readText(item, 'documentId', 'document_id')
        if (id) pairs.set(`${kind}:${id}`, { kind, id })
      }
    }
    return [...pairs.values()]
  }, [documentLinkQueries])
  const documentIds = documentPairs.filter((pair) => pair.kind !== 'tax_invoice').map((pair) => pair.id)
  const invoiceIds = documentPairs.filter((pair) => pair.kind === 'tax_invoice').map((pair) => pair.id)
  const documentsQuery = useQuery({
    queryKey: ['order-hub-documents', documentIds.join(','), invoiceIds.join(','), scopeVersion],
    enabled: Boolean(head) && (documentIds.length > 0 || invoiceIds.length > 0),
    queryFn: async () => {
      const [documents, invoices] = await Promise.all([
        documentIds.length > 0
          ? fetchCrudList<Record<string, unknown>>('trade_docs/documents', { ids: documentIds.join(','), pageSize: 100 })
          : Promise.resolve({ items: [] as Record<string, unknown>[] }),
        invoiceIds.length > 0
          ? fetchCrudList<Record<string, unknown>>('trade_docs/invoices', { ids: invoiceIds.join(','), pageSize: 100 })
          : Promise.resolve({ items: [] as Record<string, unknown>[] }),
      ])
      const live = new Map<string, DocumentRow>()
      for (const item of documents.items ?? []) {
        live.set(String(item.id), {
          id: String(item.id),
          kind: readText(item, 'kind') === 'commercial' ? 'commercial' : 'proforma',
          number: (item.number ?? null) as string | null,
          status: String(item.status ?? 'draft'),
          total: String(item.total ?? '0'),
          currencyCode: String(item.currencyCode ?? 'CNY'),
          updatedAt: readText(item, 'updatedAt', 'updated_at') || null,
        })
      }
      for (const item of invoices.items ?? []) {
        live.set(String(item.id), {
          id: String(item.id),
          kind: 'tax_invoice',
          number: (item.number ?? item.ourNumber ?? null) as string | null,
          status: String(item.status ?? 'draft'),
          total: String(item.total ?? '0'),
          currencyCode: String(item.currencyCode ?? 'CNY'),
          updatedAt: readText(item, 'updatedAt', 'updated_at') || null,
        })
      }
      return documentPairs
        .map((pair) => live.get(pair.id))
        .filter((row): row is DocumentRow => row !== undefined)
    },
  })
  const documents = documentsQuery.data ?? []

  // ---- 发运单: one read per child (sales and purchase use different filters), deduped by id.
  const shipmentQueries = useQueries({
    queries: [
      ...salesChildren.map((child) => ({
        queryKey: ['order-hub-shipment-sales', child.refId, scopeVersion],
        queryFn: async () =>
          (await fetchCrudList<Record<string, unknown>>('cross_border/shipments', {
            salesOrderId: child.refId,
            pageSize: 50,
            sortField: 'created_at',
            sortDir: 'desc',
          })).items ?? [],
      })),
      ...purchaseChildren.map((child) => ({
        queryKey: ['order-hub-shipment-purchase', child.refId, scopeVersion],
        queryFn: async () =>
          (await fetchCrudList<Record<string, unknown>>('cross_border/shipments', {
            purchaseOrderId: child.refId,
            pageSize: 50,
            sortField: 'created_at',
            sortDir: 'desc',
          })).items ?? [],
      })),
    ],
  })
  const shipments = React.useMemo(() => {
    const byId = new Map<string, ShipmentRow>()
    for (const query of shipmentQueries) {
      for (const item of query.data ?? []) {
        const id = String(item.id ?? '')
        if (!id) continue
        byId.set(id, {
          id,
          number: (item.number ?? null) as string | null,
          status: String(item.status ?? 'draft'),
          containerNumber: (item.containerNumber ?? null) as string | null,
          updatedAt: readText(item, 'updatedAt', 'updated_at') || null,
        })
      }
    }
    return [...byId.values()]
  }, [shipmentQueries])

  // ---- 装箱单: reached through the shipment each belongs to.
  const packingListQueries = useQueries({
    queries: shipments.map((shipment) => ({
      queryKey: ['order-hub-packing-lists', shipment.id, scopeVersion],
      queryFn: async () =>
        (await fetchCrudList<Record<string, unknown>>('cross_border/shipments/documents', {
          shipmentId: shipment.id,
          docType: 'packing_list',
          pageSize: 50,
        })).items ?? [],
    })),
  })
  const packingLists = React.useMemo(() => {
    const rows: PackingListRow[] = []
    packingListQueries.forEach((query, index) => {
      const shipment = shipments[index]
      for (const item of query.data ?? []) {
        rows.push({
          id: String(item.id),
          documentNumber: (item.documentNumber ?? null) as string | null,
          issuedAt: (item.issuedAt ?? null) as string | null,
          shipmentId: shipment?.id ?? '',
          shipmentNumber: shipment?.number ?? null,
        })
      }
    })
    return rows
  }, [packingListQueries, shipments])

  // ---- 收汇: one archive per purchase child. The route answers `{ item }` (one archive per order),
  // which the shared list helper passes through untouched.
  const collectionsQueries = useQueries({
    queries: purchaseChildren.map((child) => ({
      queryKey: ['order-hub-collections', child.refId, scopeVersion],
      queryFn: async () =>
        fetchCrudList<Record<string, unknown>>('export_finance/collections', {
          purchaseOrderId: child.refId,
          pageSize: 1,
        }),
    })),
  })
  const collectionRows = React.useMemo(() => {
    const rows: CollectionRow[] = []
    collectionsQueries.forEach((query, index) => {
      const child = purchaseChildren[index]
      const item = readSingleItem(query.data)
      if (!child || !item) return
      rows.push({
        purchaseOrderId: child.refId,
        purchaseOrderNumber: (item.purchaseOrderNumber ?? child.refNumber ?? null) as string | null,
        collectionStatus: String(item.collectionStatus ?? 'not_received'),
        amount: (item.amount ?? null) as string | null,
        currencyCode: String(item.currencyCode ?? 'CNY'),
      })
    })
    return rows
  }, [collectionsQueries, purchaseChildren])

  const refundQueries = useQueries({
    queries: shipments.map((shipment) => ({
      queryKey: ['order-hub-refunds', shipment.id, scopeVersion],
      queryFn: async () =>
        (await fetchCrudList<Record<string, unknown>>('export_finance/refunds', {
          shipmentId: shipment.id,
          pageSize: 1,
        })).items ?? [],
    })),
  })
  const refundRows = React.useMemo(() => {
    const rows: RefundRow[] = []
    refundQueries.forEach((query, index) => {
      const shipment = shipments[index]
      const item = readSingleItem(query.data)
      if (!shipment || !item) return
      rows.push({
        shipmentId: shipment.id,
        shipmentNumber: (item.shipmentNumber ?? shipment.number ?? null) as string | null,
        taxRefundStatus: String(item.taxRefundStatus ?? 'not_started'),
        taxRefundAmount: (item.taxRefundAmount ?? null) as string | null,
        currencyCode: String(item.currencyCode ?? 'CNY'),
      })
    })
    return rows
  }, [refundQueries, shipments])

  const relatedSectionMessages = {
    loading: t('order_hub.detail.section.loading'),
    loadFailed: t('order_hub.detail.section.loadFailed'),
    retry: t('order_hub.detail.section.retry'),
    viewAll: t('order_hub.detail.section.viewAll'),
  }

  const resolveSalesTarget = React.useCallback(
    (action: (child: LinkRow) => void) => {
      if (allSalesChildren.length === 0) return
      if (allSalesChildren.length === 1) {
        action(allSalesChildren[0])
        return
      }
      setPickerAction(() => action)
    },
    [allSalesChildren],
  )

  const removeLink = React.useCallback(
    async (link: LinkRow) => {
      if (!head) return
      // Every removal asks first (owner 2026-10-10): the row's own number is what the operator
      // confirms against, so a mis-click on a list of look-alike rows cannot unlink a child silently.
      const confirmed = await confirm({
        title: t('order_hub.detail.orders.remove'),
        text: t('order_hub.companyOrders.links.removeConfirm', { number: link.refNumber ?? link.refId.slice(0, 8) }),
        variant: 'destructive',
      })
      if (!confirmed) return
      const remaining = links
        .filter((candidate) => candidate.kind === link.kind && candidate.id !== link.id)
        .map((candidate) => ({ refId: candidate.refId }))
      try {
        await createCrud(
          LINKS_API_PATH,
          {
            companyOrderId: head.id,
            kind: link.kind,
            refs: remaining,
            ...(head.updatedAt ? { updatedAt: head.updatedAt } : {}),
          },
          { errorMessage: t('order_hub.companyOrders.links.saveFailed') },
        )
        flash(t('order_hub.companyOrders.links.saved'), 'success')
        await queryClient.invalidateQueries({ queryKey: ['order-hub-links'] })
        void queryClient.invalidateQueries({ queryKey: ['order-hub-company-order'] })
      } catch (error) {
        flash(error instanceof Error && error.message ? error.message : t('order_hub.companyOrders.links.saveFailed'), 'error')
      }
    },
    [confirm, head, links, queryClient, t],
  )

  const openQuickEdit = React.useCallback(
    async (config: QuickEditConfig, rowId: string, queryKeyPrefix: readonly unknown[]) => {
      try {
        const payload = await fetchCrudList<Record<string, unknown>>(config.apiPath, { id: rowId, pageSize: 1 })
        const item = payload.items?.[0]
        if (!item) {
          flash(t('order_hub.detail.loadFailed'), 'error')
          return
        }
        setQuickEdit({
          config,
          recordId: rowId,
          values: config.toValues(item),
          updatedAt: readText(item, 'updatedAt', 'updated_at') || null,
          queryKeyPrefix,
        })
      } catch {
        flash(t('order_hub.detail.loadFailed'), 'error')
      }
    },
    [t],
  )

  if (headQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">{t('order_hub.detail.loading')}</p>
  }

  if (headQuery.isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-destructive">{t('order_hub.detail.loadFailed')}</p>
        <Button type="button" variant="outline" onClick={() => void headQuery.refetch()}>
          {t('order_hub.detail.section.retry')}
        </Button>
      </div>
    )
  }

  if (!head) {
    if (resolutionQuery.isError) {
      return (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-destructive">{t('order_hub.detail.loadFailed')}</p>
          <Button type="button" variant="outline" onClick={() => void resolutionQuery.refetch()}>
            {t('order_hub.detail.section.retry')}
          </Button>
        </div>
      )
    }
    if (resolutionQuery.data?.status === 'found') {
      return <p className="text-sm text-muted-foreground">{t('order_hub.companyOrders.notFound.resolving')}</p>
    }
    return <UnlinkedOrderState documentId={orderId} />
  }

  const orderUpdatedAt = head.updatedAt
  // A collaborator sees the same root and its children but writes neither: every entry that would
  // edit the root, re-link a child or create a downstream document is hidden, and the status/notes
  // dialog takes the edit action's place. The server refuses the same writes regardless of this flag.
  const viewerIsCollaborator = head.viewerIsCollaborator
  const canWrite = !viewerIsCollaborator
  /** Everything this page links to carries it, so the module page's 「返回」 lands back on this hub. */
  const returnTo = `/backend/orders/${encodeURIComponent(head.id)}`
  const purchaseCreateHref = `/backend/purchasing/orders/create?companyOrderId=${encodeURIComponent(head.id)}${
    allSalesChildren.length === 1
      ? `&orderKind=${allSalesChildren[0].kind}&orderId=${encodeURIComponent(allSalesChildren[0].refId)}`
      : ''
  }`
  const salesRows = links.filter((link) => isSalesKind(link.kind))
  const purchaseRows = links.filter((link) => link.kind === 'purchase_order')
  // 订单描述 (dictionary code → label) and 采购负责人 (the name frozen with the pick) are root-held;
  // the header only reads them. 供应商 leads with the root's frozen name and falls back to the linked
  // purchase rows' suppliers when the root carries none (owner 2026-10-10).
  const descriptionLabel = resolveCodeListLabel(head.productCategory, productCategoryOptions)
  const supplierLabel = resolveHeaderSupplierName(head.supplierName, purchaseRows.map((row) => row.refCounterparty))
  const openPreview = (target: LinkedRecordPreviewTarget) => {
    setPreview(target)
    setPreviewOpen(true)
  }
  // The row's number is a preview trigger everywhere on this page; the label stays the row's own.
  const previewNumber = (target: LinkedRecordPreviewTarget, label: string) => (
    <PreviewNumber label={label} onClick={() => openPreview(target)} />
  )

  const shipmentsViewAllHref = salesChildren.length === 1
    ? `${SHIPMENTS_HREF}?salesOrderId=${encodeURIComponent(salesChildren[0].refId)}`
    : purchaseChildren.length === 1
      ? `${SHIPMENTS_HREF}?purchaseOrderId=${encodeURIComponent(purchaseChildren[0].refId)}`
      : SHIPMENTS_HREF

  return (
    <>
      <FormHeader
        mode="detail"
        backHref="/backend/orders"
        entityTypeLabel={t('order_hub.companyOrders.entityLabel')}
        title={head.number || t('order_hub.companyOrders.untitled')}
        subtitle={head.title ?? undefined}
        statusBadge={
          <StatusBadge variant={ORDER_STATUS_VARIANT[head.status] ?? 'neutral'} dot>
            {t(`order_hub.companyOrders.status.${head.status}`)}
          </StatusBadge>
        }
        actionsContent={(
          <div className="flex flex-wrap items-center gap-2">
            {canWrite ? (
              <>
                <Button asChild variant="outline">
                  <Link href={`/backend/orders/${encodeURIComponent(head.id)}/edit`}>{t('order_hub.companyOrders.actions.edit')}</Link>
                </Button>
                <Button type="button" variant="ghost" onClick={() => setCollaboratorsOpen(true)}>
                  {t('order_hub.companyOrders.actions.collaborators')}
                </Button>
              </>
            ) : (
              <Button type="button" variant="outline" onClick={() => setStatusOpen(true)}>
                {t('order_hub.companyOrders.statusEdit.action')}
              </Button>
            )}
          </div>
        )}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t('order_hub.companyOrders.header.orderDate')}</p>
          <p className="text-sm font-medium">{head.orderDate ?? '—'}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t('order_hub.companyOrders.header.etaDate')}</p>
          <p className="text-sm font-medium">{head.etaDate ?? '—'}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t('order_hub.companyOrders.header.notes')}</p>
          <p className="text-sm font-medium">{head.notes ?? '—'}</p>
        </div>
        {/* 是否已收款: the root's own marker. “—” is the honest answer for a root written before the
            column existed — never rendered as 未收款. */}
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t('order_hub.companyOrders.header.paymentStatus')}</p>
          <p className="text-sm font-medium">
            {head.paymentStatus
              ? t(`order_hub.companyOrders.paymentStatus.${head.paymentStatus}`, head.paymentStatus)
              : '—'}
          </p>
        </div>
        {/* 订单描述 (a `product_category` code shown as its label) and 采购负责人 (the name frozen
            with the pick): root-held, read-only here — both are edited on the company-order form
            (owner 2026-10-10). */}
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t('order_hub.companyOrders.header.productCategory')}</p>
          <p className="text-sm font-medium">{descriptionLabel ?? '—'}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t('order_hub.companyOrders.header.owner')}</p>
          <p className="text-sm font-medium">{head.ownerName ?? '—'}</p>
        </div>
        {/* The default customer/supplier are the root's own start-up information; the display name
            is the one frozen when they were set, and clearing them stays on the edit page. 供应商
            falls back to the linked purchase rows when the root carries no supplier of its own. */}
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t('order_hub.companyOrders.header.customer')}</p>
          <p className="text-sm font-medium">{head.customerName ?? '—'}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t('order_hub.companyOrders.header.supplier')}</p>
          <p className="text-sm font-medium">{supplierLabel ?? '—'}</p>
        </div>
      </div>

      {/* 采购 (owner 2026-10-09 板块布局): the board headings mirror the sidebar tree, so a block and
          the ledger it writes into read as the same area of the business. */}
      <SectionHeader title={t('order_hub.detail.groups.purchasing')} className="pt-1" />

      <RelatedSection
        id="purchasing"
        title={t('order_hub.detail.purchaseOrders.title')}
        action={canWrite ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={withReturnTo(purchaseCreateHref, returnTo)}>{t('order_hub.detail.orders.create')}</Link>
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setLinkDialog({ kind: 'purchase_order' })}>
              {t('order_hub.detail.orders.link')}
            </Button>
          </div>
        ) : undefined}
        isLoading={linksQuery.isLoading}
        failed={linksQuery.isError}
        isEmpty={purchaseRows.length === 0}
        emptyLabel={t('order_hub.detail.section.empty.purchase')}
        onRetry={() => void linksQuery.refetch()}
        framed
        messages={relatedSectionMessages}
      >
        <ul className="flex flex-col gap-2">
          {purchaseRows.map((row) => {
            const amounts = purchaseAmounts.get(row.refId)
            const amountCurrency = amounts?.currencyCode ?? 'CNY'
            return (
              <li key={row.id} className="flex flex-wrap items-center gap-3 text-sm">
                {previewNumber(
                  { kind: 'purchase_order', refId: row.refId, label: row.refNumber },
                  row.refNumber ?? row.refId.slice(0, 8),
                )}
                <span className="text-muted-foreground">{row.refCounterparty ?? '—'}</span>
                <ChildStatusBadge t={t} kind={row.kind} status={row.refStatus} salesDictionary={salesStatusDictionary} />
                {/* 订单金额 / 预付款金额 / 尾款金额, from the block's one batched read (REQ-043). The
                    预付款/尾款 are the actual registered payments (deposit / balance stages), never a
                    plan; a row or viewer the read did not cover renders `—`. */}
                <PurchaseRowAmount
                  label={t('order_hub.detail.purchaseOrders.amount.order')}
                  value={amounts?.total ?? null}
                  currencyCode={amountCurrency}
                />
                <PurchaseRowAmount
                  label={t('order_hub.detail.purchaseOrders.amount.deposit')}
                  value={amounts?.paidDeposit ?? null}
                  currencyCode={amountCurrency}
                />
                <PurchaseRowAmount
                  label={t('order_hub.detail.purchaseOrders.amount.balance')}
                  value={amounts?.paidBalance ?? null}
                  currencyCode={amountCurrency}
                />
                {/* 定金比例 + 备注 (owner 2026-10-10): the two facts an operator checks next to the
                    money. Both come from the same batched read; `—` when the order does not carry
                    one, and the note is clamped so a long one cannot push the actions off the row. */}
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  {t('order_hub.detail.purchaseOrders.depositPercent')}
                  <span className="text-foreground">
                    {formatDepositPercent(amounts?.depositPercent ?? null) ?? '—'}
                  </span>
                </span>
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  {t('order_hub.detail.purchaseOrders.notes')}
                  <span className="max-w-64 truncate text-foreground" title={amounts?.notes ?? undefined}>
                    {amounts?.notes ?? '—'}
                  </span>
                </span>
                {/* 详情, not 编辑 (owner 2026-10-10): the purchase order's own page is where its
                    单证 and 付款记录 are filled in, and its edit form is one click from there. */}
                <Button asChild variant="ghost" size="sm">
                  <Link href={withReturnTo(childHref(row.kind, row.refId, 'detail'), returnTo)}>
                    {t('order_hub.detail.orders.openDetail')}
                  </Link>
                </Button>
                {canWrite ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => void removeLink(row)}>
                    {t('order_hub.detail.orders.remove')}
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
      </RelatedSection>

      {/* One block for both sales kinds (owner 2026-10-09): the company order is the main view, so
          the operator no longer picks a block by kind — every child row says which kind it is, and
          the kind is chosen at the moment one is linked or created. */}
      <SectionHeader title={t('order_hub.detail.groups.sales')} className="pt-1" />

      <RelatedSection
        id="sales"
        title={t('order_hub.detail.sales.title')}
        action={canWrite ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setSalesKindsOpen(true)}>
              {t('order_hub.detail.orders.create')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setLinkDialog({
                  kind: 'internal_sales_order',
                  kinds: ['internal_sales_order', 'external_sales_order'],
                })
              }
            >
              {t('order_hub.detail.orders.link')}
            </Button>
          </div>
        ) : undefined}
        isLoading={linksQuery.isLoading}
        failed={linksQuery.isError}
        isEmpty={salesRows.length === 0}
        emptyLabel={t('order_hub.detail.sales.empty')}
        onRetry={() => void linksQuery.refetch()}
        framed
        messages={relatedSectionMessages}
      >
        <ul className="flex flex-col gap-2">
          {salesRows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 text-sm">
              <Badge variant="info" size="sm">
                {t(
                  row.kind === 'external_sales_order'
                    ? 'order_hub.detail.sales.kind.external'
                    : 'order_hub.detail.sales.kind.internal',
                )}
              </Badge>
              {previewNumber(
                { kind: row.kind, refId: row.refId, label: row.refNumber },
                row.refNumber ?? row.refId.slice(0, 8),
              )}
              <span className="text-muted-foreground">{row.refCounterparty ?? '—'}</span>
              <ChildStatusBadge t={t} kind={row.kind} status={row.refStatus} salesDictionary={salesStatusDictionary} />
              <Button asChild variant="ghost" size="sm">
                <Link href={withReturnTo(childHref(row.kind, row.refId, canWrite ? 'edit' : 'detail'), returnTo)}>
                  {t(canWrite ? 'order_hub.detail.section.edit' : 'order_hub.detail.orders.open')}
                </Link>
              </Button>
              {canWrite ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => void removeLink(row)}>
                  {t('order_hub.detail.orders.remove')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </RelatedSection>

      <SectionHeader title={t('order_hub.detail.groups.contracts')} className="pt-1" />

      <RelatedSection
        id="contracts"
        title={t('order_hub.detail.contracts.title')}
        action={canWrite ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={allSalesChildren.length === 0}
            onClick={() =>
              resolveSalesTarget((child) =>
                router.push(withReturnTo(childCreatePayloadHref(`${CONTRACTS_HREF}/create`, child), returnTo)),
              )
            }
          >
            {t('order_hub.detail.section.add.contracts')}
          </Button>
        ) : undefined}
        isLoading={linksQuery.isLoading || aggregationLoading(contractLinkQueries) || (contractIds.length > 0 && contractsQuery.isLoading)}
        failed={linksQuery.isError || aggregationFailed(contractLinkQueries) || (contractIds.length > 0 && contractsQuery.isError)}
        isEmpty={contracts.length === 0}
        emptyLabel={allSalesChildren.length === 0 ? t('order_hub.detail.empty.noSalesChild') : t('order_hub.detail.section.empty.contracts')}
        viewAllHref={CONTRACTS_HREF}
        onRetry={() => {
          retryQueries(contractLinkQueries)
          void contractsQuery.refetch()
        }}
        framed
        messages={relatedSectionMessages}
      >
        <ul className="flex flex-col gap-2">
          {contracts.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 text-sm">
              {previewNumber({ kind: 'contract', refId: row.id, label: row.number }, row.number ?? row.id.slice(0, 8))}
              <MoneyAmount currencyCode={row.currencyCode} amount={row.total} />
              <StatusBadge variant="neutral">{row.status}</StatusBadge>
              {canWrite ? (
                <RowEditButton
                  label={t('order_hub.detail.section.edit')}
                  onClick={() => void openQuickEdit(QUICK_EDIT_CONFIGS.contracts, row.id, ['order-hub-contracts'])}
                />
              ) : null}
            </li>
          ))}
        </ul>
        <TruncationHint truncated={truncated} />
      </RelatedSection>

      <RelatedSection
        id="documents"
        title={t('order_hub.detail.documents.title')}
        action={canWrite ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={allSalesChildren.length === 0}
              onClick={() =>
                resolveSalesTarget((child) =>
                  router.push(
                    withReturnTo(
                      childCreatePayloadHref(`${DOCUMENTS_HREF}/create`, child) +
                        (soleContract ? `&contractId=${encodeURIComponent(soleContract)}` : ''),
                      returnTo,
                    ),
                  ),
                )
              }
            >
              {t('order_hub.detail.section.add.documents')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={allSalesChildren.length === 0}
              onClick={() =>
                resolveSalesTarget((child) => setDocumentsDialog({ orderKind: child.kind, orderId: child.refId }))
              }
            >
              {t('order_hub.detail.documents.manage')}
            </Button>
          </div>
        ) : undefined}
        isLoading={linksQuery.isLoading || aggregationLoading(documentLinkQueries) || documentsQuery.isLoading}
        failed={linksQuery.isError || aggregationFailed(documentLinkQueries) || documentsQuery.isError}
        isEmpty={documents.length === 0}
        emptyLabel={allSalesChildren.length === 0 ? t('order_hub.detail.empty.noSalesChild') : t('order_hub.detail.section.empty.documents')}
        viewAllHref={soleContract ? `${DOCUMENTS_HREF}?contractId=${encodeURIComponent(soleContract)}` : DOCUMENTS_HREF}
        onRetry={() => {
          retryQueries(documentLinkQueries)
          void documentsQuery.refetch()
        }}
        framed
        messages={relatedSectionMessages}
      >
        <ul className="flex flex-col gap-2">
          {documents.map((row) => (
            <li key={`${row.kind}-${row.id}`} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-muted-foreground">{t(documentKindLabelKey(row.kind))}</span>
              {previewNumber(
                {
                  kind: row.kind === 'tax_invoice' ? 'tax_invoice' : 'document',
                  refId: row.id,
                  label: row.number,
                  // A PI and a CI are one table with two edit pages, so the row says which one it is.
                  variant: row.kind,
                },
                row.number ?? row.id.slice(0, 8),
              )}
              <MoneyAmount currencyCode={row.currencyCode} amount={row.total} />
              <StatusBadge variant="neutral">{row.status}</StatusBadge>
              {canWrite ? (
                <RowEditButton
                  label={t('order_hub.detail.section.edit')}
                  onClick={() => void openQuickEdit(quickEditConfigForDocument(row.kind), row.id, ['order-hub-documents'])}
                />
              ) : null}
            </li>
          ))}
        </ul>
        <TruncationHint truncated={truncated} />
      </RelatedSection>

      <SectionHeader title={t('order_hub.detail.groups.shipping')} className="pt-1" />

      <RelatedSection
        id="shipments"
        title={t('order_hub.detail.shipments.title')}
        action={canWrite ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={allSalesChildren.length === 0}
            onClick={() =>
              resolveSalesTarget((child) =>
                router.push(withReturnTo(childCreatePayloadHref(`${SHIPMENTS_HREF}/create`, child), returnTo)),
              )
            }
          >
            {t('order_hub.detail.section.add.shipment')}
          </Button>
        ) : undefined}
        isLoading={linksQuery.isLoading || aggregationLoading(shipmentQueries)}
        failed={linksQuery.isError || aggregationFailed(shipmentQueries)}
        isEmpty={shipments.length === 0}
        emptyLabel={allSalesChildren.length === 0 ? t('order_hub.detail.empty.noSalesChild') : t('order_hub.detail.section.empty.shipment')}
        viewAllHref={shipmentsViewAllHref}
        onRetry={() => retryQueries(shipmentQueries)}
        framed
        messages={relatedSectionMessages}
      >
        <ul className="flex flex-col gap-2">
          {shipments.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 text-sm">
              {previewNumber({ kind: 'shipment', refId: row.id, label: row.number }, row.number ?? row.id.slice(0, 8))}
              <span className="text-muted-foreground">{row.containerNumber ?? '—'}</span>
              <StatusBadge variant="neutral">{row.status}</StatusBadge>
              {canWrite ? (
                <RowEditButton
                  label={t('order_hub.detail.section.edit')}
                  onClick={() => void openQuickEdit(QUICK_EDIT_CONFIGS.shipments, row.id, ['order-hub-shipment-sales'])}
                />
              ) : null}
            </li>
          ))}
        </ul>
        <TruncationHint truncated={truncated} />
      </RelatedSection>

      <RelatedSection
        id="packing-lists"
        title={t('order_hub.detail.packingLists.title')}
        action={canWrite ? (
          <Button asChild variant="outline" size="sm">
            <Link
              href={withReturnTo(
                soleContract
                  ? `${PACKING_LISTS_HREF}/create?contractId=${encodeURIComponent(soleContract)}`
                  : `${PACKING_LISTS_HREF}/create`,
                returnTo,
              )}
            >
              {t('order_hub.detail.section.add.packingList')}
            </Link>
          </Button>
        ) : undefined}
        isLoading={linksQuery.isLoading || aggregationLoading(packingListQueries)}
        failed={linksQuery.isError || aggregationFailed(packingListQueries)}
        isEmpty={packingLists.length === 0}
        emptyLabel={t('order_hub.detail.section.empty.packingList')}
        viewAllHref={soleContract ? `${PACKING_LISTS_HREF}?contractId=${encodeURIComponent(soleContract)}` : PACKING_LISTS_HREF}
        onRetry={() => retryQueries(packingListQueries)}
        framed
        messages={relatedSectionMessages}
      >
        <ul className="flex flex-col gap-2">
          {packingLists.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 text-sm">
              {previewNumber(
                { kind: 'packing_list', refId: row.id, label: row.documentNumber },
                row.documentNumber ?? row.id.slice(0, 8),
              )}
              <span className="text-muted-foreground">
                {t('order_hub.detail.packingLists.shipment')} {row.shipmentNumber ?? row.shipmentId.slice(0, 8)}
              </span>
              {row.issuedAt ? <span className="text-muted-foreground">{row.issuedAt.slice(0, 10)}</span> : null}
            </li>
          ))}
        </ul>
      </RelatedSection>

      <RelatedSection
        id="money"
        title={t('order_hub.detail.money.title')}
        isLoading={linksQuery.isLoading || aggregationLoading(collectionsQueries) || aggregationLoading(refundQueries)}
        failed={linksQuery.isError || aggregationFailed(collectionsQueries) || aggregationFailed(refundQueries)}
        isEmpty={collectionRows.length === 0 && refundRows.length === 0}
        emptyLabel={t('order_hub.detail.section.empty.money')}
        viewAllHref={MONEY_HREF}
        onRetry={() => {
          retryQueries(collectionsQueries)
          retryQueries(refundQueries)
        }}
        framed
        messages={relatedSectionMessages}
      >
        <ul className="flex flex-col gap-2">
          {collectionRows.map((row) => (
            <li key={`collection-${row.purchaseOrderId}`} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-muted-foreground">{t('order_hub.detail.money.collection')}</span>
              {previewNumber(
                { kind: 'collection', refId: row.purchaseOrderId, label: row.purchaseOrderNumber },
                row.purchaseOrderNumber ?? row.purchaseOrderId.slice(0, 8),
              )}
              <span>{t(`export_finance.collection.status.${row.collectionStatus}`)}</span>
              {row.amount ? <MoneyAmount currencyCode={row.currencyCode} amount={row.amount} /> : null}
              <Button asChild variant="ghost" size="sm">
                <Link href={withReturnTo(`/backend/export-finance/orders/${encodeURIComponent(row.purchaseOrderId)}`, returnTo)}>
                  {t('order_hub.detail.orders.open')}
                </Link>
              </Button>
            </li>
          ))}
          {refundRows.map((row) => (
            <li key={`refund-${row.shipmentId}`} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-muted-foreground">{t('order_hub.detail.money.refund')}</span>
              {previewNumber(
                { kind: 'refund', refId: row.shipmentId, label: row.shipmentNumber },
                row.shipmentNumber ?? row.shipmentId.slice(0, 8),
              )}
              <span>{t(`export_finance.refund.status.${row.taxRefundStatus}`)}</span>
              {row.taxRefundAmount ? <MoneyAmount currencyCode={row.currencyCode} amount={row.taxRefundAmount} /> : null}
              <Button asChild variant="ghost" size="sm">
                <Link href={withReturnTo(`/backend/export-finance/containers/${encodeURIComponent(row.shipmentId)}`, returnTo)}>
                  {t('order_hub.detail.orders.open')}
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </RelatedSection>

      {/* 单据字段级槽位（REQ-024）：每个 35 列字段一个上传位，既列本单文件也列子单来源。
          通用文件区仍在其下（「其他文件」），锚点不变。 */}
      <OrderDocumentsSection
        companyOrderId={head.id}
        canManage={canWrite}
        title={t('order_hub.documents.title')}
        emptyLabel={t('order_hub.documents.empty')}
        messages={relatedSectionMessages}
      />

      {/* 未拆细的文件（水单/证明/盖章件…）先挂根单：the installed `attachments` module owns the bytes
          and the upload, but its list/file routes scope by the caller's own organization, which hides
          the owner's files from a collaborator. This block reads through this module's routes, which
          authorize on the root; upload still posts to the installed route, and a collaborator's
          `canManage={false}` hides the write controls. */}
      <AttachmentsSection
        entityId="order_hub:company_order"
        recordId={head.id}
        id="files"
        title={t('order_hub.detail.files.title')}
        emptyLabel={t('order_hub.detail.files.empty')}
        messages={relatedSectionMessages}
        canManage={canWrite}
        listHref={(recordId) => `/api/order_hub/orders/attachments?companyOrderId=${encodeURIComponent(recordId)}`}
        fileHref="/api/order_hub/orders/attachments"
      />

      {quickEdit ? (
        <QuickEditDialog
          open
          onOpenChange={(next) => { if (!next) setQuickEdit(null) }}
          title={t(quickEdit.config.titleKey)}
          apiPath={quickEdit.config.apiPath}
          recordId={quickEdit.recordId}
          updatedAt={quickEdit.updatedAt}
          fields={quickEdit.config.fields}
          initialValues={quickEdit.values}
          savedMessageKey="order_hub.detail.edit.saved"
          onSaved={() => void queryClient.invalidateQueries({ queryKey: quickEdit.queryKeyPrefix })}
        />
      ) : null}

      {ConfirmDialogElement}

      {linkDialog ? (
        <CompanyOrderLinkDialog
          open
          onOpenChange={(next) => { if (!next) setLinkDialog(null) }}
          companyOrderId={head.id}
          kind={linkDialog.kind}
          kinds={linkDialog.kinds}
          companyOrderUpdatedAt={orderUpdatedAt}
          onSaved={async () => {
            await queryClient.invalidateQueries({ queryKey: ['order-hub-links'] })
            await queryClient.invalidateQueries({ queryKey: ['order-hub-company-order'] })
          }}
        />
      ) : null}

      <SalesKindDialog
        open={salesKindsOpen}
        onOpenChange={setSalesKindsOpen}
        onPick={(kind) => {
          setSalesKindsOpen(false)
          router.push(
            withReturnTo(
              `/backend/${kind === 'external_sales_order' ? 'external-sales' : 'internal-sales'}/orders/create?companyOrderId=${encodeURIComponent(head.id)}`,
              returnTo,
            ),
          )
        }}
      />

      {collaboratorsOpen && head.organizationId ? (
        <CompanyOrderCollaboratorsDialog
          open
          onOpenChange={(next) => { if (!next) setCollaboratorsOpen(false) }}
          companyOrderId={head.id}
          ownerOrganizationId={head.organizationId}
          companyOrderUpdatedAt={orderUpdatedAt}
          onSaved={async () => {
            await queryClient.invalidateQueries({ queryKey: ['order-hub-company-order'] })
            await queryClient.invalidateQueries({ queryKey: ['order-hub-collaborators'] })
          }}
        />
      ) : null}

      {statusOpen ? (
        <CompanyOrderStatusDialog
          open
          onOpenChange={(next) => { if (!next) setStatusOpen(false) }}
          companyOrderId={head.id}
          companyOrderUpdatedAt={orderUpdatedAt}
          initialStatus={head.status}
          initialNotes={head.notes}
          onSaved={async () => {
            await queryClient.invalidateQueries({ queryKey: ['order-hub-company-order'] })
          }}
        />
      ) : null}

      {documentsDialog ? (
        <OrderDocumentsDialog
          open
          onOpenChange={(next) => { if (!next) setDocumentsDialog(null) }}
          orderKind={documentsDialog.orderKind}
          orderId={documentsDialog.orderId}
          orderUpdatedAt={null}
          onSaved={async () => {
            await queryClient.invalidateQueries({ queryKey: ['order-hub-document-links'] })
            await queryClient.invalidateQueries({ queryKey: ['order-hub-documents'] })
          }}
        />
      ) : null}

      <LinkedRecordPreviewDrawer
        target={preview}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        returnTo={returnTo}
      />

      <SalesChildPickerDialog
        open={pickerAction !== null}
        onOpenChange={(next) => { if (!next) setPickerAction(null) }}
        candidates={allSalesChildren}
        onPick={(child) => {
          const action = pickerAction
          setPickerAction(null)
          action?.(child)
        }}
      />
    </>
  )
}

/**
 * The status badge a linked child row shows — and nothing when the child has no status: an empty
 * badge reading 「—」 is noise (owner 2026-10-09), so the row simply does without it.
 */
function ChildStatusBadge({
  t,
  kind,
  status,
  salesDictionary,
}: {
  t: TranslateFn
  kind: CompanyOrderLinkKind
  status: string | null
  salesDictionary: DictionaryMap | null
}) {
  const appearance = childStatusAppearance(t, kind, status, salesDictionary)
  if (!appearance) return null
  // The sales kinds colour their dot with the dictionary's own hex (the sales lists draw the same
  // swatch); the purchase vocabulary has semantic tones, which the badge renders itself.
  const dictionaryDot = appearance.color
    ? renderDictionaryColor(appearance.color, 'inline-flex h-1.5 w-1.5 shrink-0 rounded-full')
    : null
  return (
    <StatusBadge
      variant={appearance.tone ?? 'neutral'}
      dot={dictionaryDot === null}
      className={dictionaryDot ? 'gap-1.5' : undefined}
    >
      {dictionaryDot}
      {appearance.label}
    </StatusBadge>
  )
}
