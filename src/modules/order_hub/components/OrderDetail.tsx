'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { MoneyAmount } from '@/lib/money/MoneyAmount'
import { RelatedSection } from '@/lib/related/RelatedSection'
import { SALES_STATUS_CANCELED, SALES_STATUS_CONFIRMED, salesStatusActions } from '../../internal_sales/lib/salesStatus'
import { readChannelId, tradeTypeFromChannelId, type SalesTradeType } from '../../internal_sales/lib/tradeType'
import { useTradeTypeChannels } from '../../internal_sales/lib/tradeTypeChannels'
import { useSalesStatusEntries } from '../../internal_sales/lib/salesStatusEntries'
import { writeSalesStatus } from '../../internal_sales/lib/salesStatusWrite'
import { toDocumentRecord, type DocumentRecord } from '../../internal_sales/lib/salesDocumentRecord'
import { apiPathFor, documentEditHrefForTradeType } from '../../internal_sales/components/InternalSalesForm'
import { OrderDocumentsDialog } from '../../trade_docs/components/OrderDocumentsDialog'

/**
 * The sales order hub: everything that follows an order, in one place.
 *
 * The hub lives in `order_hub` at `/backend/orders/<id>` — the one filling surface for a company
 * order — and reads its trade type from the document's own channel marker (falling back to
 * `internal`), so both sales types render on the same URL. Each downstream module is a branch off
 * the order: the hub lists the branches (采购订单 / 发运单 / 购销合同 / 单据 / 收汇·退税), anchors each block
 * for the workbench's deep links, and hands the operator a prefilled create entry plus a 查看全部 link
 * into that branch's ledger. Every section reads its own source and fails on its own: one module
 * being down, slow or unauthorized must not blank the rest of the order. The block shell itself —
 * header, the four loading/error/empty/rows states and the card framing — is the shared
 * `@/lib/related/RelatedSection`, the same component behind the contract detail page's blocks.
 *
 * It never writes anything but the order's own status (confirm / cancel) — the branches keep their
 * own commands, reached through their own pages.
 */

/**
 * The page size every section read asks for. 100 is the lowest cap among the routes involved
 * (`/api/sales/order-lines` refuses more than 100 with a 400), so one constant keeps the hub from
 * asking for a page a route will not serve.
 */
const PAGE_SIZE = 100

type PurchaseOrderRow = {
  id: string
  number: string | null
  supplierName: string | null
  currencyCode: string
  total: string
  status: string
  sourceSalesOrderNumber: string | null
}

type ShipmentRow = {
  id: string
  number: string | null
  status: string
  containerNumber: string | null
  eta: string | null
}

type ContractLinkRow = { contractId: string; orderKind: string; orderId: string }
type ContractRow = { id: string; number: string | null; status: string; currencyCode: string; total: string }
/**
 * One row of the order's documents block: the **link** the order owns, resolved against the live
 * document, so the row shows the document's current number, status and amount.
 */
type DocumentRow = {
  id: string
  kind: 'proforma' | 'commercial' | 'tax_invoice'
  number: string | null
  status: string
  total: string
  currencyCode: string
}
type CollectionRow = { purchaseOrderId: string; purchaseOrderNumber: string | null; collectionStatus: string; amount: string | null; currencyCode: string }
type RefundRow = { shipmentId: string; shipmentNumber: string | null; taxRefundStatus: string; taxRefundAmount: string | null; currencyCode: string }

const ORDER_STATUS_MAP: StatusMap = {
  draft: 'neutral',
  sent: 'info',
  confirmed: 'success',
  canceled: 'error',
}

function readText(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return ''
}

/**
 * The 收汇 and 退税 reads answer `{ item }` — one archive per purchase order / container, not a list —
 * so the shared list helper's shape is narrowed here rather than cast at each call site.
 */
function readSingleItem(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || !('item' in payload)) return null
  const item = payload.item
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  return item as Record<string, unknown>
}

function orderKindForTradeType(tradeType: SalesTradeType): 'internal_sales_order' | 'external_sales_order' {
  return tradeType === 'external' ? 'external_sales_order' : 'internal_sales_order'
}

/**
 * Where a linked document opens for editing. The two heavy kinds live under their own ledgers
 * (`documentListHref` in `trade_docs/components/DocumentsTable.tsx` names the same paths) and the
 * tax invoice under the invoices ledger.
 */
function documentEditHref(kind: DocumentRow['kind'], id: string): string {
  const listHref = kind === 'tax_invoice'
    ? '/backend/trade-docs/invoices'
    : kind === 'commercial'
      ? '/backend/trade-docs/commercial-invoices'
      : '/backend/trade-docs/proformas'
  return `${listHref}/${encodeURIComponent(id)}/edit`
}

export default function OrderDetail({ orderId }: { orderId: string }) {
  const t = useT()
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { entryIdFor } = useSalesStatusEntries()
  const [pendingStatus, setPendingStatus] = React.useState<string | null>(null)
  const [documentsDialogOpen, setDocumentsDialogOpen] = React.useState(false)

  // The shared section is translation-agnostic, so the hub keeps its own keys for the states it
  // renders; every section here passes `onRetry`, so a failed one offers the retry button.
  const relatedSectionMessages = {
    loading: t('order_hub.detail.section.loading'),
    loadFailed: t('order_hub.detail.section.loadFailed'),
    retry: t('order_hub.detail.section.retry'),
  }

  // The trade type is the document's own, not the entry's: the hub lives at one URL
  // (`/backend/orders/<id>`) for both types, so it reads the head's channel marker and falls back
  // to `internal` when the marker is missing or unrecognised — the same convention the workbench
  // uses. While the head read or the channel map is still in flight the loading state below holds
  // the links still, so they never flip after paint.
  const { channels, isLoading: channelsLoading } = useTradeTypeChannels('order')
  const ordersApiPath = apiPathFor('order')

  const orderQuery = useQuery({
    queryKey: ['order-hub-detail-order', orderId, scopeVersion],
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>(ordersApiPath, { id: orderId, pageSize: 1 })
      const item = payload.items?.[0]
      return item ? { record: toDocumentRecord(item, 'order'), raw: item } : null
    },
  })
  const orderHead = orderQuery.data ?? null
  const order = orderHead?.record ?? null
  const tradeType: SalesTradeType = tradeTypeFromChannelId(readChannelId(orderHead?.raw ?? {}), channels) ?? 'internal'

  const orderKind = orderKindForTradeType(tradeType)

  const linesQuery = useQuery({
    queryKey: ['order-hub-detail-lines', orderId, scopeVersion],
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>('sales/order-lines', {
        orderId,
        pageSize: PAGE_SIZE,
      })
      return payload.items ?? []
    },
  })

  const purchaseOrdersQuery = useQuery({
    queryKey: ['order-hub-detail-purchase-orders', orderId, scopeVersion],
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>('purchasing/purchase-orders', {
        sourceSalesOrderId: orderId,
        pageSize: 50,
        sortField: 'created_at',
        sortDir: 'desc',
      })
      return (payload.items ?? []).map((item) => ({
        id: String(item.id),
        number: (item.number ?? null) as string | null,
        supplierName: (item.supplierName ?? null) as string | null,
        currencyCode: String(item.currencyCode ?? 'CNY'),
        total: String(item.total ?? '0'),
        status: String(item.status ?? 'draft'),
        sourceSalesOrderNumber: (item.sourceSalesOrderNumber ?? null) as string | null,
      })) satisfies PurchaseOrderRow[]
    },
  })

  const shipmentsQuery = useQuery({
    queryKey: ['order-hub-detail-shipments', orderId, scopeVersion],
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>('cross_border/shipments', {
        salesOrderId: orderId,
        pageSize: 50,
        sortField: 'created_at',
        sortDir: 'desc',
      })
      return (payload.items ?? []).map((item) => ({
        id: String(item.id),
        number: (item.number ?? null) as string | null,
        status: String(item.status ?? 'draft'),
        containerNumber: (item.containerNumber ?? null) as string | null,
        eta: (item.eta ?? null) as string | null,
      })) satisfies ShipmentRow[]
    },
  })

  const contractsQuery = useQuery({
    queryKey: ['order-hub-detail-contracts', orderId, orderKind, scopeVersion],
    queryFn: async () => {
      const links = await fetchCrudList<Record<string, unknown>>('trade_docs/contracts/orders', {
        orderKind,
        orderId,
        pageSize: 50,
      })
      const contractIds = (links.items ?? [])
        .map((item) => readText(item, 'contractId', 'contract_id'))
        .filter((id) => id.length > 0)
      if (contractIds.length === 0) return { links: [] as ContractLinkRow[], contracts: [] as ContractRow[] }
      const payload = await fetchCrudList<Record<string, unknown>>('trade_docs/contracts', {
        ids: contractIds.join(','),
        pageSize: 50,
      })
      return {
        links: (links.items ?? []).map((item) => ({
          contractId: readText(item, 'contractId', 'contract_id'),
          orderKind: readText(item, 'orderKind', 'order_kind'),
          orderId: readText(item, 'orderId', 'order_id'),
        })),
        contracts: (payload.items ?? []).map((item) => ({
          id: String(item.id),
          number: (item.number ?? null) as string | null,
          status: String(item.status ?? 'draft'),
          currencyCode: String(item.currencyCode ?? 'CNY'),
          total: String(item.total ?? '0'),
        })),
      }
    },
  })

  /**
   * The order's own documents dimension: its link rows (`trade_docs_order_documents`) resolved
   * against the live documents and tax invoices.
   *
   * The link carries only ids plus the number it froze at link time, so the live read is what makes
   * a row show the document's **current** number, status and amount — and it is also the filter: a
   * link whose document was deleted resolves to nothing and simply does not render. Two reads, not
   * one per row: the link set names the ids, each table answers them in a single call.
   */
  const documentsQuery = useQuery({
    queryKey: ['order-hub-detail-documents', orderId, orderKind, scopeVersion],
    queryFn: async () => {
      const links = await fetchCrudList<Record<string, unknown>>('trade_docs/orders/documents', {
        orderKind,
        orderId,
        pageSize: PAGE_SIZE,
      })
      const linkRows = links.items ?? []
      const documentKindOf = (item: Record<string, unknown>) =>
        readText(item, 'documentKind', 'document_kind')
      const documentIdOf = (item: Record<string, unknown>) => readText(item, 'documentId', 'document_id')
      const idsFor = (kind: string) =>
        linkRows.filter((item) => documentKindOf(item) === kind).map(documentIdOf).filter((id) => id.length > 0)
      const documentIds = [...idsFor('proforma'), ...idsFor('commercial')]
      const invoiceIds = idsFor('tax_invoice')
      const [documents, invoices] = await Promise.all([
        documentIds.length > 0
          ? fetchCrudList<Record<string, unknown>>('trade_docs/documents', { ids: documentIds.join(','), pageSize: PAGE_SIZE })
          : Promise.resolve({ items: [] as Record<string, unknown>[] }),
        invoiceIds.length > 0
          ? fetchCrudList<Record<string, unknown>>('trade_docs/invoices', { ids: invoiceIds.join(','), pageSize: PAGE_SIZE })
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
        })
      }
      return linkRows
        .map((link) => live.get(documentIdOf(link)))
        .filter((row): row is DocumentRow => row !== undefined)
    },
  })

  const collectionsQuery = useQuery({
    queryKey: ['order-hub-detail-collections', orderId, scopeVersion],
    enabled: (purchaseOrdersQuery.data?.length ?? 0) > 0,
    queryFn: async () => {
      const rows: CollectionRow[] = []
      for (const purchaseOrder of purchaseOrdersQuery.data ?? []) {
        const payload = await fetchCrudList<Record<string, unknown>>('export_finance/collections', {
          purchaseOrderId: purchaseOrder.id,
          pageSize: 1,
        })
        const item = readSingleItem(payload)
        if (!item) continue
        rows.push({
          purchaseOrderId: purchaseOrder.id,
          purchaseOrderNumber: (item.purchaseOrderNumber ?? null) as string | null,
          collectionStatus: String(item.collectionStatus ?? 'not_received'),
          amount: (item.amount ?? null) as string | null,
          currencyCode: String(item.currencyCode ?? purchaseOrder.currencyCode),
        })
      }
      return rows
    },
  })

  const refundsQuery = useQuery({
    queryKey: ['order-hub-detail-refunds', orderId, scopeVersion],
    enabled: (shipmentsQuery.data?.length ?? 0) > 0,
    queryFn: async () => {
      const rows: RefundRow[] = []
      for (const shipment of shipmentsQuery.data ?? []) {
        const payload = await fetchCrudList<Record<string, unknown>>('export_finance/refunds', {
          shipmentId: shipment.id,
          pageSize: 1,
        })
        const item = readSingleItem(payload)
        if (!item) continue
        rows.push({
          shipmentId: shipment.id,
          shipmentNumber: (item.shipmentNumber ?? null) as string | null,
          taxRefundStatus: String(item.taxRefundStatus ?? 'not_started'),
          taxRefundAmount: (item.taxRefundAmount ?? null) as string | null,
          currencyCode: String(item.currencyCode ?? 'CNY'),
        })
      }
      return rows
    },
  })

  const lineColumns = React.useMemo<ColumnDef<Record<string, unknown>>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('order_hub.detail.lines.name'),
        cell: ({ row }) => readText(row.original, 'name', 'productName', 'sku') || '—',
      },
      {
        accessorKey: 'quantity',
        header: t('order_hub.detail.lines.quantity'),
        cell: ({ row }) => String(row.original.quantity ?? '—'),
      },
      {
        accessorKey: 'unit_price_net',
        header: t('order_hub.detail.lines.unitPrice'),
        cell: ({ row }) => {
          // The installed line route projects numbers (`unit_price_net`), a camelCase variant would be
          // a string — both are read so the column survives either shape.
          const price = row.original.unitPriceNet ?? row.original.unit_price_net
          const amount = typeof price === 'number' ? price.toFixed(4) : typeof price === 'string' ? price : ''
          return amount ? <MoneyAmount currencyCode={order?.currencyCode ?? 'CNY'} amount={amount} /> : '—'
        },
      },
    ],
    [order?.currencyCode, t],
  )

  const actions = salesStatusActions('order', order?.status ?? null)

  const applyStatus = React.useCallback(
    async (value: string): Promise<boolean> => {
      if (!order) return false
      const statusEntryId = entryIdFor(value)
      if (!statusEntryId) {
        flash(t('internal_sales.list.actions.statusMissing', 'This status is not configured for your organization.'), 'error')
        return false
      }
      setPendingStatus(value)
      try {
        await writeSalesStatus({
          apiPath: ordersApiPath,
          documentId: order.id,
          statusEntryId,
          updatedAt: order.updatedAt,
          errorMessage: t('internal_sales.list.actions.statusFailed', 'Could not change the status.'),
        })
        await queryClient.invalidateQueries({ queryKey: ['order-hub-detail-order', orderId] })
        return true
      } catch (error) {
        if (surfaceRecordConflict(error, t)) {
          await queryClient.invalidateQueries({ queryKey: ['order-hub-detail-order', orderId] })
          return false
        }
        flash(error instanceof Error && error.message ? error.message : t('internal_sales.list.actions.statusFailed'), 'error')
        return false
      } finally {
        setPendingStatus(null)
      }
    },
    [entryIdFor, order, orderId, ordersApiPath, queryClient, t],
  )

  const handleConfirm = React.useCallback(async () => {
    const confirmed = await confirm({
      title: t('internal_sales.list.actions.confirmConfirmTitle'),
      description: t('internal_sales.list.actions.confirmConfirmBody'),
      confirmText: t('internal_sales.list.actions.confirm'),
    })
    if (!confirmed) return
    if (await applyStatus(SALES_STATUS_CONFIRMED)) flash(t('internal_sales.list.actions.confirmDone'), 'success')
  }, [applyStatus, confirm, t])

  const handleCancel = React.useCallback(async () => {
    const confirmed = await confirm({
      title: t('internal_sales.list.actions.cancelConfirmTitle'),
      description: t('internal_sales.list.actions.cancelConfirmBody'),
      confirmText: t('internal_sales.list.actions.cancel'),
    })
    if (!confirmed) return
    if (await applyStatus(SALES_STATUS_CANCELED)) flash(t('internal_sales.list.actions.cancelDone'), 'success')
  }, [applyStatus, confirm, t])

  if (orderQuery.isLoading || channelsLoading) {
    return <p className="text-sm text-muted-foreground">{t('order_hub.detail.loading')}</p>
  }

  if (!order) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-destructive">{t('order_hub.detail.loadFailed')}</p>
        <Button type="button" variant="outline" onClick={() => void orderQuery.refetch()}>
          {t('order_hub.detail.section.retry')}
        </Button>
      </div>
    )
  }

  const contracts = contractsQuery.data?.contracts ?? []
  const purchaseOrders = purchaseOrdersQuery.data ?? []
  const shipments = shipmentsQuery.data ?? []
  const documents = documentsQuery.data ?? []
  const collections = collectionsQuery.data ?? []
  const refunds = refundsQuery.data ?? []
  const soleContract = contracts.length === 1 ? contracts[0].id : null

  return (
    <>
      <FormHeader
        mode="detail"
        backHref="/backend/orders"
        entityTypeLabel={t(tradeType === 'external' ? 'internal_sales.list.externalOrder.title' : 'internal_sales.list.order.title')}
        title={order.number ?? t('order_hub.detail.untitled')}
        subtitle={order.customerName ?? undefined}
        statusBadge={order.status ? <StatusBadge variant={ORDER_STATUS_MAP[order.status] ?? 'neutral'} dot>{order.status}</StatusBadge> : undefined}
        actionsContent={(
          <div className="flex flex-wrap items-center gap-2">
            {actions.canEdit ? (
              <Button asChild variant="outline">
                <Link href={documentEditHrefForTradeType('order', order.id, tradeType)}>{t('internal_sales.list.actions.edit')}</Link>
              </Button>
            ) : null}
            {actions.canConfirm ? (
              <Button type="button" disabled={pendingStatus !== null} onClick={() => void handleConfirm()}>
                {t('internal_sales.list.actions.confirm')}
              </Button>
            ) : null}
            {actions.canCancel ? (
              <Button type="button" variant="destructive" disabled={pendingStatus !== null} onClick={() => void handleCancel()}>
                {t('internal_sales.list.actions.cancel')}
              </Button>
            ) : null}
          </div>
        )}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t('internal_sales.list.columns.customer')}</p>
          <p className="text-sm font-medium">{order.customerName ?? '—'}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t('internal_sales.list.columns.total')}</p>
          <p className="text-sm font-medium">
            <MoneyAmount currencyCode={order.currencyCode} amount={order.total} />
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t('order_hub.detail.lines.title')}</p>
          <p className="text-sm font-medium">{order.lineItemCount}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t('order_hub.detail.orderedAt')}</p>
          <p className="text-sm font-medium">{order.createdAt ? order.createdAt.slice(0, 10) : '—'}</p>
        </div>
      </div>

      <section className="space-y-3 rounded-lg border bg-card px-4 py-3">
        <SectionHeader title={t('order_hub.detail.lines.title')} count={linesQuery.data?.length ?? 0} />
        {linesQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">{t('order_hub.detail.section.loading')}</p>
        ) : linesQuery.isError ? (
          <div className="flex items-center gap-2">
            <p className="text-sm text-destructive">{t('order_hub.detail.section.loadFailed')}</p>
            <Button type="button" variant="ghost" size="sm" onClick={() => void linesQuery.refetch()}>
              {t('order_hub.detail.section.retry')}
            </Button>
          </div>
        ) : (
          <DataTable<Record<string, unknown>>
            embedded
            columns={lineColumns}
            data={linesQuery.data ?? []}
            disableRowClick
          />
        )}
      </section>

      <RelatedSection
        id="purchasing"
        title={t('order_hub.detail.purchaseOrders.title')}
        action={(
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/backend/purchasing/orders/create?orderKind=${orderKind}&orderId=${encodeURIComponent(order.id)}`}>
                {t('order_hub.detail.section.add.purchase')}
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/backend/purchasing/orders">{t('order_hub.detail.section.viewAll')}</Link>
            </Button>
          </div>
        )}
        isLoading={purchaseOrdersQuery.isLoading}
        failed={purchaseOrdersQuery.isError}
        isEmpty={purchaseOrders.length === 0}
        emptyLabel={t('order_hub.detail.section.empty.purchase')}
        onRetry={() => void purchaseOrdersQuery.refetch()}
        framed
        messages={relatedSectionMessages}
      >
        <ul className="flex flex-col gap-2">
          {purchaseOrders.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 text-sm">
              <Link className="font-medium underline" href={`/backend/purchasing/orders/${encodeURIComponent(row.id)}`}>
                {row.number ?? row.id.slice(0, 8)}
              </Link>
              <span className="text-muted-foreground">{row.supplierName ?? '—'}</span>
              <MoneyAmount currencyCode={row.currencyCode} amount={row.total} />
              <StatusBadge variant="neutral">{row.status}</StatusBadge>
            </li>
          ))}
        </ul>
      </RelatedSection>

      <RelatedSection
        id="shipments"
        title={t('order_hub.detail.shipments.title')}
        action={(
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/backend/cross_border/shipments/create?orderKind=${orderKind}&orderId=${encodeURIComponent(order.id)}`}>
                {t('order_hub.detail.section.add.shipment')}
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/backend/cross_border/shipments">{t('order_hub.detail.section.viewAll')}</Link>
            </Button>
          </div>
        )}
        isLoading={shipmentsQuery.isLoading}
        failed={shipmentsQuery.isError}
        isEmpty={shipments.length === 0}
        emptyLabel={t('order_hub.detail.section.empty.shipment')}
        onRetry={() => void shipmentsQuery.refetch()}
        framed
        messages={relatedSectionMessages}
      >
        <ul className="flex flex-col gap-2">
          {shipments.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 text-sm">
              <Link className="font-medium underline" href={`/backend/cross_border/shipments/${encodeURIComponent(row.id)}`}>
                {row.number ?? row.id.slice(0, 8)}
              </Link>
              <span className="text-muted-foreground">{row.containerNumber ?? '—'}</span>
              <StatusBadge variant="neutral">{row.status}</StatusBadge>
            </li>
          ))}
        </ul>
      </RelatedSection>

      <RelatedSection
        id="contracts"
        title={t('order_hub.detail.contracts.title')}
        action={(
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/backend/trade-docs/contracts/create?orderKind=${orderKind}&orderId=${encodeURIComponent(order.id)}`}>
                {t('order_hub.detail.section.add.contracts')}
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/backend/trade-docs/contracts">{t('order_hub.detail.section.viewAll')}</Link>
            </Button>
          </div>
        )}
        isLoading={contractsQuery.isLoading}
        failed={contractsQuery.isError}
        isEmpty={contracts.length === 0}
        emptyLabel={t('order_hub.detail.section.empty.contracts')}
        onRetry={() => void contractsQuery.refetch()}
        framed
        messages={relatedSectionMessages}
      >
        <ul className="flex flex-col gap-2">
          {contracts.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 text-sm">
              <Link className="font-medium underline" href={`/backend/trade-docs/contracts/${encodeURIComponent(row.id)}`}>
                {row.number ?? row.id.slice(0, 8)}
              </Link>
              <MoneyAmount currencyCode={row.currencyCode} amount={row.total} />
              <StatusBadge variant="neutral">{row.status}</StatusBadge>
            </li>
          ))}
        </ul>
      </RelatedSection>

      <RelatedSection
        id="documents"
        title={t('order_hub.detail.documents.title')}
        action={(
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link
                href={`/backend/trade-docs/proformas/create?orderKind=${orderKind}&orderId=${encodeURIComponent(order.id)}${
                  soleContract ? `&contractId=${encodeURIComponent(soleContract)}` : ''
                }`}
              >
                {t('order_hub.detail.section.add.documents')}
              </Link>
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setDocumentsDialogOpen(true)}>
              {t('order_hub.detail.documents.manage')}
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/backend/trade-docs/proformas">{t('order_hub.detail.section.viewAll')}</Link>
            </Button>
          </div>
        )}
        isLoading={documentsQuery.isLoading}
        failed={documentsQuery.isError}
        isEmpty={documents.length === 0}
        emptyLabel={t('order_hub.detail.section.empty.documents')}
        onRetry={() => void documentsQuery.refetch()}
        framed
        messages={relatedSectionMessages}
      >
        <ul className="flex flex-col gap-2">
          {documents.map((row) => (
            <li key={`${row.kind}-${row.id}`} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-muted-foreground">
                {t(row.kind === 'tax_invoice' ? 'order_hub.detail.documents.kind.taxInvoice' : `trade_docs.documents.kind.${row.kind}`)}
              </span>
              <Link className="font-medium underline" href={documentEditHref(row.kind, row.id)}>
                {row.number ?? row.id.slice(0, 8)}
              </Link>
              <MoneyAmount currencyCode={row.currencyCode} amount={row.total} />
              <StatusBadge variant="neutral">{row.status}</StatusBadge>
            </li>
          ))}
        </ul>
      </RelatedSection>

      <RelatedSection
        id="money"
        title={t('order_hub.detail.money.title')}
        action={(
          <Button asChild variant="ghost" size="sm">
            <Link href="/backend/export-finance/orders">{t('order_hub.detail.section.viewAll')}</Link>
          </Button>
        )}
        isLoading={collectionsQuery.isLoading || refundsQuery.isLoading}
        failed={collectionsQuery.isError || refundsQuery.isError}
        isEmpty={collections.length === 0 && refunds.length === 0}
        emptyLabel={t('order_hub.detail.section.empty.money')}
        onRetry={() => {
          void collectionsQuery.refetch()
          void refundsQuery.refetch()
        }}
        framed
        messages={relatedSectionMessages}
      >
        <ul className="flex flex-col gap-2">
          {collections.map((row) => (
            <li key={`collection-${row.purchaseOrderId}`} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-muted-foreground">{t('order_hub.detail.money.collection')}</span>
              <Link className="font-medium underline" href={`/backend/export-finance/orders/${encodeURIComponent(row.purchaseOrderId)}`}>
                {row.purchaseOrderNumber ?? row.purchaseOrderId.slice(0, 8)}
              </Link>
              <span>{t(`export_finance.collection.status.${row.collectionStatus}`)}</span>
              {row.amount ? <MoneyAmount currencyCode={row.currencyCode} amount={row.amount} /> : null}
            </li>
          ))}
          {refunds.map((row) => (
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

      <OrderDocumentsDialog
        open={documentsDialogOpen}
        onOpenChange={setDocumentsDialogOpen}
        orderKind={orderKind}
        orderId={order.id}
        orderUpdatedAt={order.updatedAt}
        onSaved={() => void documentsQuery.refetch()}
      />

      {ConfirmDialogElement}
    </>
  )
}
