'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
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
import { SALES_STATUS_CANCELED, SALES_STATUS_CONFIRMED, salesStatusActions } from '../lib/salesStatus'
import { tradeTypeFromPathname, type SalesTradeType } from '../lib/tradeType'
import { useSalesStatusEntries } from '../lib/salesStatusEntries'
import { writeSalesStatus } from '../lib/salesStatusWrite'
import { toDocumentRecord, type DocumentRecord } from '../lib/salesDocumentRecord'
import { apiPathFor, listHrefForTradeType } from './InternalSalesForm'

/**
 * The sales order hub: everything that follows an order, in one place.
 *
 * The order is the root of the business, and each downstream module is a branch off it — so the hub
 * lists the branches (采购订单 / 发运单 / 购销合同 / 单据 / 收汇·退税) and hands the operator a prefilled
 * create entry for each. Every section reads its own source and fails on its own: one module being
 * down, slow or unauthorized must not blank the rest of the order.
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
type DocumentRow = { id: string; number: string | null; kind: string; status: string; total: string; contractId: string | null }
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
 * One hub section: a header with its action, then exactly one of loading, error, empty or rows.
 * Mirrors `trade_docs/components/ContractDetail.tsx`'s `RelatedSection` so the two hubs read the
 * same, including the "this section failed, the rest did not" behaviour.
 */
function RelatedSection({
  title,
  action,
  isLoading,
  failed,
  isEmpty,
  emptyLabel,
  onRetry,
  children,
}: {
  title: string
  action?: React.ReactNode
  isLoading: boolean
  failed: boolean
  isEmpty: boolean
  emptyLabel: string
  onRetry: () => void
  children: React.ReactNode
}) {
  const t = useT()
  return (
    <section className="space-y-3 rounded-lg border bg-card px-4 py-3">
      <SectionHeader title={title} action={action} />
      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('internal_sales.hub.section.loading')}</p>
      ) : failed ? (
        <div className="flex items-center gap-2">
          <p className="text-sm text-destructive">{t('internal_sales.hub.section.loadFailed')}</p>
          <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
            {t('internal_sales.hub.section.retry')}
          </Button>
        </div>
      ) : isEmpty ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        children
      )}
    </section>
  )
}

export default function OrderDetail({ orderId }: { orderId: string }) {
  const t = useT()
  const pathname = usePathname()
  // One component, two entries: the pathname decides the trade type, so the hub opened from the
  // external list keeps its links, prefills and contract kind on the external side.
  const tradeType = tradeTypeFromPathname(pathname)
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { entryIdFor } = useSalesStatusEntries()
  const [pendingStatus, setPendingStatus] = React.useState<string | null>(null)

  const listHref = listHrefForTradeType('order', tradeType)
  const ordersApiPath = apiPathFor('order')
  const orderKind = orderKindForTradeType(tradeType)

  const orderQuery = useQuery({
    queryKey: ['internal-sales-hub-order', orderId, scopeVersion],
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>(ordersApiPath, { id: orderId, pageSize: 1 })
      const item = payload.items?.[0]
      return item ? toDocumentRecord(item, 'order') : null
    },
  })
  const order = orderQuery.data ?? null

  const linesQuery = useQuery({
    queryKey: ['internal-sales-hub-lines', orderId, scopeVersion],
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>('sales/order-lines', {
        orderId,
        pageSize: PAGE_SIZE,
      })
      return payload.items ?? []
    },
  })

  const purchaseOrdersQuery = useQuery({
    queryKey: ['internal-sales-hub-purchase-orders', orderId, scopeVersion],
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
    queryKey: ['internal-sales-hub-shipments', orderId, scopeVersion],
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
    queryKey: ['internal-sales-hub-contracts', orderId, orderKind, scopeVersion],
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
   * PI / CI / 税务发票 of every contract linked to this order. One read per contract, merged here:
   * the documents route filters by a single contract, and an order normally carries one or two.
   */
  const documentsQuery = useQuery({
    queryKey: ['internal-sales-hub-documents', orderId, orderKind, scopeVersion],
    enabled: (contractsQuery.data?.contracts.length ?? 0) > 0,
    queryFn: async () => {
      const contracts = contractsQuery.data?.contracts ?? []
      const rows: DocumentRow[] = []
      for (const contract of contracts) {
        const [documents, invoices] = await Promise.all([
          fetchCrudList<Record<string, unknown>>('trade_docs/documents', { contractId: contract.id, pageSize: PAGE_SIZE }),
          fetchCrudList<Record<string, unknown>>('trade_docs/invoices', { contractId: contract.id, pageSize: PAGE_SIZE }),
        ])
        for (const item of documents.items ?? []) {
          rows.push({
            id: String(item.id),
            number: (item.number ?? null) as string | null,
            kind: String(item.kind ?? 'proforma'),
            status: String(item.status ?? 'draft'),
            total: String(item.total ?? '0'),
            contractId: contract.id,
          })
        }
        for (const item of invoices.items ?? []) {
          rows.push({
            id: String(item.id),
            number: (item.number ?? null) as string | null,
            kind: 'tax_invoice',
            status: String(item.status ?? 'draft'),
            total: String(item.total ?? '0'),
            contractId: contract.id,
          })
        }
      }
      return rows
    },
  })

  const collectionsQuery = useQuery({
    queryKey: ['internal-sales-hub-collections', orderId, scopeVersion],
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
    queryKey: ['internal-sales-hub-refunds', orderId, scopeVersion],
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
        header: t('internal_sales.hub.lines.name'),
        cell: ({ row }) => readText(row.original, 'name', 'productName', 'sku') || '—',
      },
      {
        accessorKey: 'quantity',
        header: t('internal_sales.hub.lines.quantity'),
        cell: ({ row }) => String(row.original.quantity ?? '—'),
      },
      {
        accessorKey: 'unit_price_net',
        header: t('internal_sales.hub.lines.unitPrice'),
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
        await queryClient.invalidateQueries({ queryKey: ['internal-sales-hub-order', orderId] })
        return true
      } catch (error) {
        if (surfaceRecordConflict(error, t)) {
          await queryClient.invalidateQueries({ queryKey: ['internal-sales-hub-order', orderId] })
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

  if (orderQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">{t('internal_sales.hub.loading')}</p>
  }

  if (!order) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-destructive">{t('internal_sales.hub.loadFailed')}</p>
        <Button type="button" variant="outline" onClick={() => void orderQuery.refetch()}>
          {t('internal_sales.hub.section.retry')}
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
        backHref={listHref}
        entityTypeLabel={t(tradeType === 'external' ? 'internal_sales.list.externalOrder.title' : 'internal_sales.list.order.title')}
        title={order.number ?? t('internal_sales.hub.untitled')}
        subtitle={order.customerName ?? undefined}
        statusBadge={order.status ? <StatusBadge variant={ORDER_STATUS_MAP[order.status] ?? 'neutral'} dot>{order.status}</StatusBadge> : undefined}
        actionsContent={(
          <div className="flex flex-wrap items-center gap-2">
            {actions.canEdit ? (
              <Button asChild variant="outline">
                <Link href={`${listHref}/${encodeURIComponent(order.id)}/edit`}>{t('internal_sales.list.actions.edit')}</Link>
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
          <p className="text-xs text-muted-foreground">{t('internal_sales.hub.lines.title')}</p>
          <p className="text-sm font-medium">{order.lineItemCount}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t('internal_sales.hub.orderedAt')}</p>
          <p className="text-sm font-medium">{order.createdAt ? order.createdAt.slice(0, 10) : '—'}</p>
        </div>
      </div>

      <section className="space-y-3 rounded-lg border bg-card px-4 py-3">
        <SectionHeader title={t('internal_sales.hub.lines.title')} count={linesQuery.data?.length ?? 0} />
        {linesQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">{t('internal_sales.hub.section.loading')}</p>
        ) : linesQuery.isError ? (
          <div className="flex items-center gap-2">
            <p className="text-sm text-destructive">{t('internal_sales.hub.section.loadFailed')}</p>
            <Button type="button" variant="ghost" size="sm" onClick={() => void linesQuery.refetch()}>
              {t('internal_sales.hub.section.retry')}
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
        title={t('internal_sales.hub.purchaseOrders.title')}
        action={(
          <Button asChild variant="outline" size="sm">
            <Link href={`/backend/purchasing/orders/create?orderKind=${orderKind}&orderId=${encodeURIComponent(order.id)}`}>
              {t('internal_sales.hub.purchaseOrders.add')}
            </Link>
          </Button>
        )}
        isLoading={purchaseOrdersQuery.isLoading}
        failed={purchaseOrdersQuery.isError}
        isEmpty={purchaseOrders.length === 0}
        emptyLabel={t('internal_sales.hub.purchaseOrders.empty')}
        onRetry={() => void purchaseOrdersQuery.refetch()}
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
        title={t('internal_sales.hub.shipments.title')}
        action={(
          <Button asChild variant="outline" size="sm">
            <Link href={`/backend/cross_border/shipments/create?orderKind=${orderKind}&orderId=${encodeURIComponent(order.id)}`}>
              {t('internal_sales.hub.shipments.add')}
            </Link>
          </Button>
        )}
        isLoading={shipmentsQuery.isLoading}
        failed={shipmentsQuery.isError}
        isEmpty={shipments.length === 0}
        emptyLabel={t('internal_sales.hub.shipments.empty')}
        onRetry={() => void shipmentsQuery.refetch()}
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
        title={t('internal_sales.hub.contracts.title')}
        action={(
          <Button asChild variant="outline" size="sm">
            <Link href={`/backend/trade-docs/contracts/create?orderKind=${orderKind}&orderId=${encodeURIComponent(order.id)}`}>
              {t('internal_sales.hub.contracts.add')}
            </Link>
          </Button>
        )}
        isLoading={contractsQuery.isLoading}
        failed={contractsQuery.isError}
        isEmpty={contracts.length === 0}
        emptyLabel={t('internal_sales.hub.contracts.empty')}
        onRetry={() => void contractsQuery.refetch()}
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
        title={t('internal_sales.hub.documents.title')}
        action={(
          <Button asChild variant="outline" size="sm">
            <Link
              href={`/backend/trade-docs/proformas/create?orderKind=${orderKind}&orderId=${encodeURIComponent(order.id)}${
                soleContract ? `&contractId=${encodeURIComponent(soleContract)}` : ''
              }`}
            >
              {t('internal_sales.hub.documents.add')}
            </Link>
          </Button>
        )}
        isLoading={contractsQuery.isLoading || documentsQuery.isLoading}
        failed={documentsQuery.isError}
        isEmpty={documents.length === 0}
        emptyLabel={t('internal_sales.hub.documents.empty')}
        onRetry={() => void documentsQuery.refetch()}
      >
        <ul className="flex flex-col gap-2">
          {documents.map((row) => (
            <li key={`${row.kind}-${row.id}`} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-muted-foreground">
                {t(row.kind === 'tax_invoice' ? 'internal_sales.hub.documents.kind.taxInvoice' : `trade_docs.documents.kind.${row.kind}`)}
              </span>
              <span className="font-medium">{row.number ?? row.id.slice(0, 8)}</span>
              <MoneyAmount currencyCode={order.currencyCode} amount={row.total} />
              <StatusBadge variant="neutral">{row.status}</StatusBadge>
            </li>
          ))}
        </ul>
      </RelatedSection>

      <RelatedSection
        title={t('internal_sales.hub.money.title')}
        isLoading={collectionsQuery.isLoading || refundsQuery.isLoading}
        failed={collectionsQuery.isError || refundsQuery.isError}
        isEmpty={collections.length === 0 && refunds.length === 0}
        emptyLabel={t('internal_sales.hub.money.empty')}
        onRetry={() => {
          void collectionsQuery.refetch()
          void refundsQuery.refetch()
        }}
      >
        <ul className="flex flex-col gap-2">
          {collections.map((row) => (
            <li key={`collection-${row.purchaseOrderId}`} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-muted-foreground">{t('internal_sales.hub.money.collection')}</span>
              <Link className="font-medium underline" href={`/backend/export-finance/orders/${encodeURIComponent(row.purchaseOrderId)}`}>
                {row.purchaseOrderNumber ?? row.purchaseOrderId.slice(0, 8)}
              </Link>
              <span>{t(`export_finance.collection.status.${row.collectionStatus}`)}</span>
              {row.amount ? <MoneyAmount currencyCode={row.currencyCode} amount={row.amount} /> : null}
            </li>
          ))}
          {refunds.map((row) => (
            <li key={`refund-${row.shipmentId}`} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-muted-foreground">{t('internal_sales.hub.money.refund')}</span>
              <Link className="font-medium underline" href={`/backend/export-finance/containers/${encodeURIComponent(row.shipmentId)}`}>
                {row.shipmentNumber ?? row.shipmentId.slice(0, 8)}
              </Link>
              <span>{t(`export_finance.refund.status.${row.taxRefundStatus}`)}</span>
              {row.taxRefundAmount ? <MoneyAmount currencyCode={row.currencyCode} amount={row.taxRefundAmount} /> : null}
            </li>
          ))}
        </ul>
      </RelatedSection>

      {ConfirmDialogElement}
    </>
  )
}
