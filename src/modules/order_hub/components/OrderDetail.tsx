'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
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
import { QuickEditDialog } from '@/lib/quick-edit/QuickEditDialog'
import { createDictionaryMap, type DictionaryMap } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { isPurchaseOrderStatus, purchaseOrderStatusLabel } from '@/lib/orders/purchaseOrderStatus'
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
import OrderFieldsDrawer from './OrderFieldsDrawer'
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
  draft: 'neutral',
  in_progress: 'info',
  completed: 'success',
  cancelled: 'error',
}

type CompanyOrderHead = {
  id: string
  number: string
  title: string | null
  orderDate: string | null
  etaDate: string | null
  status: string
  notes: string | null
  /** The default customer/supplier frozen names (display-only here; the edit page clears them). */
  customerName: string | null
  supplierName: string | null
  /**
   * True when the caller's organization is a **collaborator** on this root: the hub then hides every
   * entry that writes the root or its children and offers only the status/notes dialog (REQ-016).
   * The server enforces the same split, so this only decides what is shown.
   */
  viewerIsCollaborator: boolean
  /** The root's own organization; never offered as a collaborator of itself. */
  organizationId: string | null
  updatedAt: string | null
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

function toHead(item: Record<string, unknown>): CompanyOrderHead {
  return {
    id: String(item.id),
    number: String(item.number ?? ''),
    title: (item.title ?? null) as string | null,
    orderDate: (item.orderDate ?? null) as string | null,
    etaDate: (item.etaDate ?? null) as string | null,
    status: String(item.status ?? 'draft'),
    notes: (item.notes ?? null) as string | null,
    customerName: snapshotDisplayName(item.customerSnapshot),
    supplierName: snapshotDisplayName(item.supplierSnapshot),
    viewerIsCollaborator: item.viewerIsCollaborator === true,
    organizationId: readText(item, 'organizationId', 'organization_id') || null,
    updatedAt: readText(item, 'updatedAt', 'updated_at') || null,
  }
}

/** The name frozen into a default-customer/supplier snapshot, for the header's display-only cell. */
function snapshotDisplayName(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null
  if (!('name' in snapshot)) return null
  const name = snapshot.name
  return typeof name === 'string' && name.trim().length > 0 ? name : null
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

/** Where a linked child opens: the two sales kinds under their own ledger, the purchase under its own. */
function childOpenHref(kind: CompanyOrderLinkKind, refId: string): string {
  if (kind === 'purchase_order') return `/backend/purchasing/orders/${encodeURIComponent(refId)}`
  const ledger = kind === 'external_sales_order' ? '/backend/external-sales' : '/backend/internal-sales'
  return `${ledger}/orders/${encodeURIComponent(refId)}/edit`
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

function documentEditHref(kind: DocumentRow['kind'], id: string): string {
  const listHref = kind === 'tax_invoice'
    ? '/backend/trade-docs/invoices'
    : kind === 'commercial'
      ? '/backend/trade-docs/commercial-invoices'
      : '/backend/trade-docs/proformas'
  return `${listHref}/${encodeURIComponent(id)}/edit`
}

/**
 * The attach blocks' shape: the two sales families and the purchase family, each with its own
 * read/create/row targets, so the three blocks are rendered by one map instead of three copies.
 */
type AttachBlock = {
  kind: CompanyOrderLinkKind
  id: string
  titleKey: string
  emptyKey: string
  createHref: string
  openHref: (refId: string) => string
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

  const [documentsDialog, setDocumentsDialog] = React.useState<{ orderKind: string; orderId: string } | null>(null)
  const [pickerAction, setPickerAction] = React.useState<((child: LinkRow) => void) | null>(null)
  const [linkDialogKind, setLinkDialogKind] = React.useState<CompanyOrderLinkKind | null>(null)
  const [collaboratorsOpen, setCollaboratorsOpen] = React.useState(false)
  const [statusOpen, setStatusOpen] = React.useState(false)
  const [fieldsOpen, setFieldsOpen] = React.useState(false)
  const [quickEdit, setQuickEdit] = React.useState<{
    config: QuickEditConfig
    recordId: string
    values: Record<string, unknown>
    updatedAt: string | null
    queryKeyPrefix: readonly unknown[]
  } | null>(null)

  const headQuery = useQuery({
    queryKey: ['order-hub-company-order', orderId, scopeVersion],
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>(ORDERS_API_PATH, { id: orderId, pageSize: 1 })
      const item = payload.items?.[0]
      return item ? toHead(item) : null
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
    [head, links, queryClient, t],
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
  const purchaseCreateHref = `/backend/purchasing/orders/create?companyOrderId=${encodeURIComponent(head.id)}${
    allSalesChildren.length === 1
      ? `&orderKind=${allSalesChildren[0].kind}&orderId=${encodeURIComponent(allSalesChildren[0].refId)}`
      : ''
  }`
  const attachBlocks: AttachBlock[] = [
    {
      kind: 'internal_sales_order',
      id: 'internal-orders',
      titleKey: 'order_hub.detail.internalOrders.title',
      emptyKey: 'order_hub.detail.internalOrders.empty',
      createHref: `/backend/internal-sales/orders/create?companyOrderId=${encodeURIComponent(head.id)}`,
      openHref: (refId) => childOpenHref('internal_sales_order', refId),
    },
    {
      kind: 'external_sales_order',
      id: 'external-orders',
      titleKey: 'order_hub.detail.externalOrders.title',
      emptyKey: 'order_hub.detail.externalOrders.empty',
      createHref: `/backend/external-sales/orders/create?companyOrderId=${encodeURIComponent(head.id)}`,
      openHref: (refId) => childOpenHref('external_sales_order', refId),
    },
    {
      kind: 'purchase_order',
      id: 'purchasing',
      titleKey: 'order_hub.detail.purchaseOrders.title',
      emptyKey: 'order_hub.detail.section.empty.purchase',
      createHref: purchaseCreateHref,
      openHref: (refId) => childOpenHref('purchase_order', refId),
    },
  ]

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
            {/* Read-only, so both the owner and a collaborating organization can open it. */}
            <Button type="button" variant="outline" onClick={() => setFieldsOpen(true)}>
              {t('order_hub.workbench.actions.fields')}
            </Button>
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
          <p className="text-xs text-muted-foreground">{t('order_hub.companyOrders.header.title')}</p>
          <p className="text-sm font-medium">{head.title ?? '—'}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t('order_hub.companyOrders.header.notes')}</p>
          <p className="text-sm font-medium">{head.notes ?? '—'}</p>
        </div>
        {/* The default customer/supplier are the root's own start-up information; the display name
            is the one frozen when they were set, and clearing them stays on the edit page. */}
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t('order_hub.companyOrders.header.customer')}</p>
          <p className="text-sm font-medium">{head.customerName ?? '—'}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t('order_hub.companyOrders.header.supplier')}</p>
          <p className="text-sm font-medium">{head.supplierName ?? '—'}</p>
        </div>
      </div>

      {attachBlocks.map((block) => {
        const rows = links.filter((link) => link.kind === block.kind)
        return (
          <RelatedSection
            key={block.id}
            id={block.id}
            title={t(block.titleKey)}
            action={canWrite ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href={block.createHref}>{t('order_hub.detail.orders.create')}</Link>
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setLinkDialogKind(block.kind)}>
                  {t('order_hub.detail.orders.link')}
                </Button>
              </div>
            ) : undefined}
            isLoading={linksQuery.isLoading}
            failed={linksQuery.isError}
            isEmpty={rows.length === 0}
            emptyLabel={t(block.emptyKey)}
            onRetry={() => void linksQuery.refetch()}
            framed
            messages={relatedSectionMessages}
          >
            <ul className="flex flex-col gap-2">
              {rows.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-3 text-sm">
                  <Link className="font-medium underline" href={block.openHref(row.refId)}>
                    {row.refNumber ?? row.refId.slice(0, 8)}
                  </Link>
                  <span className="text-muted-foreground">{row.refCounterparty ?? '—'}</span>
                  <StatusBadge variant="neutral">{childStatusLabel(t, block.kind, row.refStatus, salesStatusDictionary)}</StatusBadge>
                  <Button asChild variant="ghost" size="sm">
                    <Link href={block.openHref(row.refId)}>{t('order_hub.detail.orders.open')}</Link>
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
        )
      })}

      <RelatedSection
        id="contracts"
        title={t('order_hub.detail.contracts.title')}
        action={canWrite ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={allSalesChildren.length === 0}
            onClick={() => resolveSalesTarget((child) => router.push(childCreatePayloadHref(`${CONTRACTS_HREF}/create`, child)))}
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
              <Link className="font-medium underline" href={`${CONTRACTS_HREF}/${encodeURIComponent(row.id)}`}>
                {row.number ?? row.id.slice(0, 8)}
              </Link>
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
                    childCreatePayloadHref(`${DOCUMENTS_HREF}/create`, child) +
                      (soleContract ? `&contractId=${encodeURIComponent(soleContract)}` : ''),
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
              <Link className="font-medium underline" href={documentEditHref(row.kind, row.id)}>
                {row.number ?? row.id.slice(0, 8)}
              </Link>
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

      <RelatedSection
        id="shipments"
        title={t('order_hub.detail.shipments.title')}
        action={canWrite ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={allSalesChildren.length === 0}
            onClick={() => resolveSalesTarget((child) => router.push(childCreatePayloadHref(`${SHIPMENTS_HREF}/create`, child)))}
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
              <Link className="font-medium underline" href={`${SHIPMENTS_HREF}/${encodeURIComponent(row.id)}`}>
                {row.number ?? row.id.slice(0, 8)}
              </Link>
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
              href={
                soleContract
                  ? `${PACKING_LISTS_HREF}/create?contractId=${encodeURIComponent(soleContract)}`
                  : `${PACKING_LISTS_HREF}/create`
              }
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
              <Link className="font-medium underline" href={`${PACKING_LISTS_HREF}/${encodeURIComponent(row.id)}`}>
                {row.documentNumber ?? row.id.slice(0, 8)}
              </Link>
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
              <Link className="font-medium underline" href={`/backend/export-finance/orders/${encodeURIComponent(row.purchaseOrderId)}`}>
                {row.purchaseOrderNumber ?? row.purchaseOrderId.slice(0, 8)}
              </Link>
              <span>{t(`export_finance.collection.status.${row.collectionStatus}`)}</span>
              {row.amount ? <MoneyAmount currencyCode={row.currencyCode} amount={row.amount} /> : null}
            </li>
          ))}
          {refundRows.map((row) => (
            <li key={`refund-${row.shipmentId}`} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-muted-foreground">{t('order_hub.detail.money.refund')}</span>
              <Link className="font-medium underline" href={`/backend/export-finance/containers/${encodeURIComponent(row.shipmentId)}`}>
                {row.shipmentNumber ?? row.shipmentId.slice(0, 8)}
              </Link>
              <span>{t(`export_finance.refund.status.${row.taxRefundStatus}`)}</span>
              {row.taxRefundAmount ? <MoneyAmount currencyCode={row.currencyCode} amount={row.taxRefundAmount} /> : null}
            </li>
          ))}
        </ul>
      </RelatedSection>

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

      {linkDialogKind ? (
        <CompanyOrderLinkDialog
          open
          onOpenChange={(next) => { if (!next) setLinkDialogKind(null) }}
          companyOrderId={head.id}
          kind={linkDialogKind}
          companyOrderUpdatedAt={orderUpdatedAt}
          onSaved={async () => {
            await queryClient.invalidateQueries({ queryKey: ['order-hub-links'] })
            await queryClient.invalidateQueries({ queryKey: ['order-hub-company-order'] })
          }}
        />
      ) : null}

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

      <OrderFieldsDrawer
        target={{ id: head.id, number: head.number ?? null }}
        open={fieldsOpen}
        onOpenChange={setFieldsOpen}
      />
    </>
  )
}

/** A child's frozen status in the hub's own words: the sales dictionary, the purchase vocabulary, or the raw value. */
function childStatusLabel(
  t: TranslateFn,
  kind: CompanyOrderLinkKind,
  status: string | null,
  salesDictionary: DictionaryMap | null,
): string {
  if (!status) return '—'
  if (kind === 'purchase_order') return isPurchaseOrderStatus(status) ? purchaseOrderStatusLabel(t, status) : status
  return salesDictionary?.[status]?.label ?? status
}
