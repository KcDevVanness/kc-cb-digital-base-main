'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { FileText } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@open-mercato/ui/primitives/drawer'
import { ErrorMessage } from '@open-mercato/ui/backend/detail/ErrorMessage'
import { LoadingMessage } from '@open-mercato/ui/backend/detail/LoadingMessage'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { formatDisplayDate, toUtcDateInputValue } from '@open-mercato/ui/primitives/date-format'
import { useLocale, useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { createDictionaryMap, type DictionaryMap } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { MoneyAmount } from '@/lib/money/MoneyAmount'
import { useSalesStatusEntries } from '../../internal_sales/lib/salesStatusEntries'
import { BUSINESS_STATUS_LABEL_KEYS, COLLECTION_STATUS_LABEL_KEYS, ORDER_CHECKLIST_LABEL_KEYS, REFUND_STATUS_LABEL_KEYS } from '../../export_finance/components/labels'
import type { OrderChecklistKey } from '../../export_finance/lib/orderFileProjection'

/**
 * The 「全字段」 drawer of the order workbench: every field of one company order, without the
 * workbench table having to grow a 35-column lineup.
 *
 * Purchase rows are the order-file projection read back on demand (`export_finance/order-files`,
 * the same source `/backend/export-finance/orders` renders), split into the three groups an operator
 * thinks in — 订单 / 单证与文件 / 财务 — each with a 「去填写」 link straight to the branch that fills
 * that group. A sales row needs no read at all: the workbench already holds the head fields and the
 * stage counts, so the drawer is the head block plus the four downstream branches.
 *
 * The drawer owns only the read state, this layout and the "not recorded" fallbacks; the words stay
 * in the module catalogs (`order_hub.drawer.*`, plus the branch names the workbench columns already
 * use, and the projection's own enum labels).
 */

/** The one company order this drawer is showing. Built by the workbench from the row the user clicked. */
export type OrderFieldsTarget =
  | { kind: 'purchase'; id: string; number: string | null }
  | {
      kind: 'sales'
      id: string
      number: string | null
      tradeType: 'internal' | 'external'
      head: {
        buyer: string | null
        currencyCode: string
        total: string
        status: string | null
        orderedAt: string | null
        lineCount: number
      } | null
      stages: {
        procurementCount: number
        shipmentCount: number
        documentCount: number
        collected: boolean
        refunded: boolean
      } | null
    }

export type OrderFieldsDrawerProps = {
  target: OrderFieldsTarget | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * One purchase order as `export_finance/order-files` serializes it — the fields this drawer renders,
 * declared locally so the drawer does not import a server projection module into the client bundle.
 */
type OrderFileItem = {
  purchaseOrderId: string
  number: string | null
  businessNumber: string | null
  supplierName: string | null
  ownerName: string | null
  customerName: string | null
  productCategory: string | null
  businessStatus: string
  placedAt: string | null
  expectedDeliveryAt: string | null
  shipmentEtd: string | null
  shipmentDepartedAt: string | null
  receivedAt: string | null
  containerType: string | null
  containerNumber: string | null
  sealNumber: string | null
  bookingNumber: string | null
  shipmentCount: number
  finance: {
    orderAmount: string
    depositPlanned: string | null
    balancePlanned: string | null
    paidAmount: string
    outstandingAmount: string
    collectedAmount: string | null
    collectedAt: string | null
    kcPriceAmount: string | null
    kcPriceCurrency: string | null
    subsidiaryInvoiceAmount: string | null
    subsidiaryInvoiceCurrency: string | null
    exchangeRate: string | null
  }
  collectionStatus: string
  refundStatus: string
  allocatedRefundAmount: string | null
  containers: Array<{ shipmentId: string; containerNumber: string | null }>
  checklistMissing: string[]
}

const ORDER_FILES_API_PATH = 'export_finance/order-files'

/** `raiseCrudError` attaches the failing HTTP status to the thrown error; a 403 is a permission answer. */
function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('status' in error)) return null
  const status = error.status
  return typeof status === 'number' ? status : null
}

/** An enum value's label from one of the projection's key maps; an unknown value stays itself. */
function enumLabel(map: Record<string, string>, value: string | null, t: TranslateFn): string | null {
  if (!value) return null
  const key = map[value]
  return key ? t(key) : value
}

function EmptyValue() {
  const t = useT()
  // The workbench's own em-dash cell, so an unrecorded field reads the same in both surfaces.
  return <span className="text-xs text-muted-foreground">{t('order_hub.workbench.cell.notApplicable')}</span>
}

function TextValue({ value }: { value: string | null | undefined }) {
  return value ? <>{value}</> : <EmptyValue />
}

function DateValue({ value }: { value: string | null }) {
  const locale = useLocale()
  // Date-only columns are written as UTC midnight, so their day is read in the frame it was written in.
  const day = toUtcDateInputValue(value)
  const formatted = day ? formatDisplayDate(day, locale) : null
  return <TextValue value={formatted} />
}

/**
 * An amount whose currency the projection does not carry (order/deposit/balance/paid/outstanding)
 * renders as the stored figure; only KC price and subsidiary invoice come with a currency code, so
 * only those two can carry the `≈ ¥…` line. Mirrors the order file table's own amount cell.
 */
function PlainAmount({ value }: { value: string | null }) {
  return value === null ? <EmptyValue /> : <span className="tabular-nums">{value}</span>
}

function FieldRow({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={className ? `flex min-w-0 flex-col gap-0.5 ${className}` : 'flex min-w-0 flex-col gap-0.5'}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium break-words">{children}</dd>
    </div>
  )
}

function DrawerGroup({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <SectionHeader title={title} action={action} />
      {children}
    </section>
  )
}

function GoFillLink({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="link" size="sm">
      <Link href={href}>{label}</Link>
    </Button>
  )
}

function ForbiddenBody() {
  const t = useT()
  return <p className="text-sm text-muted-foreground">{t('order_hub.drawer.group.forbidden')}</p>
}

function PurchaseFields({ item }: { item: OrderFileItem | null }) {
  const t = useT()
  const finance = item?.finance ?? null
  const firstShipmentId = item?.containers[0]?.shipmentId ?? null
  const purchaseHref = item ? `/backend/purchasing/orders/${item.purchaseOrderId}` : null
  const documentsHref = item
    ? firstShipmentId
      ? `/backend/cross_border/shipments/${firstShipmentId}`
      : `/backend/purchasing/orders/${item.purchaseOrderId}`
    : null
  const moneyHref = item ? `/backend/export-finance/orders/${item.purchaseOrderId}` : null

  return (
    <div className="flex flex-col gap-5">
      <DrawerGroup
        title={t('order_hub.drawer.group.order')}
        action={
          purchaseHref ? <GoFillLink href={purchaseHref} label={t('order_hub.drawer.goFill.payment')} /> : undefined
        }
      >
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <FieldRow label={t('order_hub.drawer.field.number')}>
            <TextValue value={item?.number} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.field.businessNumber')}>
            <TextValue value={item?.businessNumber} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.field.supplier')}>
            <TextValue value={item?.supplierName} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.field.owner')}>
            <TextValue value={item?.ownerName} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.field.customer')}>
            <TextValue value={item?.customerName} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.field.productCategory')}>
            <TextValue value={item?.productCategory} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.field.status')}>
            <TextValue value={enumLabel(BUSINESS_STATUS_LABEL_KEYS, item?.businessStatus ?? null, t)} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.field.placedAt')}>
            <DateValue value={item?.placedAt ?? null} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.field.expectedDeliveryAt')}>
            <DateValue value={item?.expectedDeliveryAt ?? null} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.field.shipmentEtd')}>
            <DateValue value={item?.shipmentEtd ?? null} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.field.shipmentDepartedAt')}>
            <DateValue value={item?.shipmentDepartedAt ?? null} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.field.receivedAt')}>
            <DateValue value={item?.receivedAt ?? null} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.field.container')}>
            <TextValue value={item?.containerNumber} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.field.containerType')}>
            <TextValue value={item?.containerType} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.field.sealNumber')}>
            <TextValue value={item?.sealNumber} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.field.bookingNumber')}>
            <TextValue value={item?.bookingNumber} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.field.shipmentCount')}>
            <TextValue value={item ? String(item.shipmentCount) : null} />
          </FieldRow>
        </dl>
      </DrawerGroup>

      <DrawerGroup
        title={t('order_hub.drawer.group.documents')}
        action={
          documentsHref ? <GoFillLink href={documentsHref} label={t('order_hub.drawer.goFill.documents')} /> : undefined
        }
      >
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <FieldRow label={t('order_hub.drawer.field.checklistMissing')} className="col-span-2">
            {item && item.checklistMissing.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {item.checklistMissing.map((key) => (
                  <li key={key}>{t(ORDER_CHECKLIST_LABEL_KEYS[key as OrderChecklistKey] ?? key)}</li>
                ))}
              </ul>
            ) : (
              <EmptyValue />
            )}
          </FieldRow>
        </dl>
      </DrawerGroup>

      <DrawerGroup
        title={t('order_hub.drawer.group.finance')}
        action={moneyHref ? <GoFillLink href={moneyHref} label={t('order_hub.drawer.goFill.money')} /> : undefined}
      >
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <FieldRow label={t('order_hub.drawer.field.orderAmount')}>
            <PlainAmount value={finance?.orderAmount ?? null} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.field.depositPlanned')}>
            <PlainAmount value={finance?.depositPlanned ?? null} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.field.balancePlanned')}>
            <PlainAmount value={finance?.balancePlanned ?? null} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.field.paidAmount')}>
            <PlainAmount value={finance?.paidAmount ?? null} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.field.outstandingAmount')}>
            <PlainAmount value={finance?.outstandingAmount ?? null} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.field.collectedAmount')}>
            <PlainAmount value={finance?.collectedAmount ?? null} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.field.collectedAt')}>
            <DateValue value={finance?.collectedAt ?? null} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.field.collectionStatus')}>
            <TextValue value={enumLabel(COLLECTION_STATUS_LABEL_KEYS, item?.collectionStatus ?? null, t)} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.field.refundStatus')}>
            <TextValue value={enumLabel(REFUND_STATUS_LABEL_KEYS, item?.refundStatus ?? null, t)} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.field.allocatedRefundAmount')}>
            <PlainAmount value={item?.allocatedRefundAmount ?? null} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.field.kcPrice')}>
            {finance?.kcPriceAmount && finance.kcPriceCurrency ? (
              <MoneyAmount currencyCode={finance.kcPriceCurrency} amount={finance.kcPriceAmount} />
            ) : (
              <PlainAmount value={finance?.kcPriceAmount ?? null} />
            )}
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.field.subsidiaryInvoice')}>
            {finance?.subsidiaryInvoiceAmount && finance.subsidiaryInvoiceCurrency ? (
              <MoneyAmount
                currencyCode={finance.subsidiaryInvoiceCurrency}
                amount={finance.subsidiaryInvoiceAmount}
              />
            ) : (
              <PlainAmount value={finance?.subsidiaryInvoiceAmount ?? null} />
            )}
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.field.exchangeRate')}>
            <TextValue value={finance?.exchangeRate ?? null} />
          </FieldRow>
        </dl>
      </DrawerGroup>
    </div>
  )
}

function ForbiddenGroups() {
  const t = useT()
  return (
    <div className="flex flex-col gap-5">
      <DrawerGroup title={t('order_hub.drawer.group.order')}>
        <ForbiddenBody />
      </DrawerGroup>
      <DrawerGroup title={t('order_hub.drawer.group.documents')}>
        <ForbiddenBody />
      </DrawerGroup>
      <DrawerGroup title={t('order_hub.drawer.group.finance')}>
        <ForbiddenBody />
      </DrawerGroup>
    </div>
  )
}

function SalesFields({
  target,
  statusDictionary,
}: {
  target: Extract<OrderFieldsTarget, { kind: 'sales' }>
  statusDictionary: DictionaryMap | null
}) {
  const t = useT()
  const head = target.head
  const stages = target.stages
  const statusLabel = head?.status ? (statusDictionary?.[head.status]?.label ?? head.status) : null

  return (
    <div className="flex flex-col gap-5">
      <DrawerGroup title={t('order_hub.drawer.sales.heading')}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <FieldRow label={t('order_hub.drawer.sales.buyer')}>
            <TextValue value={head?.buyer ?? null} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.sales.currency')}>
            <TextValue value={head?.currencyCode ?? null} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.sales.total')}>
            {head ? <MoneyAmount currencyCode={head.currencyCode} amount={head.total} /> : <EmptyValue />}
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.sales.status')}>
            <TextValue value={statusLabel} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.sales.orderedAt')}>
            <DateValue value={head?.orderedAt ?? null} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.sales.lineCount')}>
            <TextValue value={head ? String(head.lineCount) : null} />
          </FieldRow>
        </dl>
      </DrawerGroup>

      {/* The branch names are the workbench's own column words, so the drawer and the table that opened it agree. */}
      <DrawerGroup title={t('order_hub.drawer.sales.branches')}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <FieldRow label={t('order_hub.workbench.columns.procurement')}>
            {stages ? <span className="tabular-nums">{stages.procurementCount}</span> : <EmptyValue />}
          </FieldRow>
          <FieldRow label={t('order_hub.workbench.columns.shipment')}>
            {stages ? <span className="tabular-nums">{stages.shipmentCount}</span> : <EmptyValue />}
          </FieldRow>
          <FieldRow label={t('order_hub.workbench.columns.documents')}>
            {stages ? <span className="tabular-nums">{stages.documentCount}</span> : <EmptyValue />}
          </FieldRow>
          <FieldRow label={t('order_hub.workbench.columns.money')}>
            {stages ? (
              <span>
                {stages.collected
                  ? t('order_hub.workbench.cell.collected')
                  : t('order_hub.workbench.cell.notCollected')}
                {' · '}
                {stages.refunded
                  ? t('order_hub.workbench.cell.refunded')
                  : t('order_hub.workbench.cell.notRefunded')}
              </span>
            ) : (
              <EmptyValue />
            )}
          </FieldRow>
        </dl>
      </DrawerGroup>
    </div>
  )
}

export default function OrderFieldsDrawer({ target, open, onOpenChange }: OrderFieldsDrawerProps) {
  const t = useT()
  const purchaseId = target?.kind === 'purchase' ? target.id : null
  const { entries: salesStatusEntries } = useSalesStatusEntries()
  const statusDictionary = React.useMemo<DictionaryMap | null>(
    () => (salesStatusEntries.length > 0 ? createDictionaryMap(salesStatusEntries) : null),
    [salesStatusEntries],
  )

  const purchaseQuery = useQuery({
    queryKey: ['order-hub', 'fields', 'purchase', purchaseId],
    enabled: open && Boolean(purchaseId),
    // One read on open; a permission answer is final and a transient failure gets a manual retry.
    retry: false,
    queryFn: async () => {
      const response = await fetchCrudList<OrderFileItem>(ORDER_FILES_API_PATH, {
        purchaseOrderId: purchaseId,
        pageSize: 1,
      })
      return response.items[0] ?? null
    },
  })

  if (!target) return null

  const isPurchase = target.kind === 'purchase'
  const forbidden = errorStatus(purchaseQuery.error) === 403
  const subtitle = target.number ?? undefined

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent closeAriaLabel={t('order_hub.drawer.close')}>
        <DrawerHeader leading={<FileText aria-hidden="true" className="size-4" />}>
          <DrawerTitle>{t('order_hub.drawer.title')}</DrawerTitle>
          {subtitle ? <DrawerDescription>{subtitle}</DrawerDescription> : null}
        </DrawerHeader>
        <DrawerBody>
          {isPurchase ? (
            purchaseQuery.isLoading ? (
              <LoadingMessage label={t('order_hub.drawer.loading')} />
            ) : forbidden ? (
              <ForbiddenGroups />
            ) : purchaseQuery.isError ? (
              <ErrorMessage
                label={t('order_hub.drawer.loadFailed')}
                action={
                  <Button variant="outline" size="sm" onClick={() => void purchaseQuery.refetch()}>
                    {t('order_hub.drawer.retry')}
                  </Button>
                }
              />
            ) : (
              <PurchaseFields item={purchaseQuery.data ?? null} />
            )
          ) : (
            <SalesFields target={target} statusDictionary={statusDictionary} />
          )}
        </DrawerBody>
        <DrawerFooter>
          <DrawerClose asChild>
            <Button variant="outline">{t('order_hub.drawer.close')}</Button>
          </DrawerClose>
          {isPurchase ? (
            <Button asChild>
              <Link href={`/backend/export-finance/orders/${target.id}`}>
                {t('order_hub.drawer.openOrderFile')}
              </Link>
            </Button>
          ) : (
            <Button asChild>
              <Link
                href={
                  target.tradeType === 'external'
                    ? `/backend/external-sales/orders/${target.id}`
                    : `/backend/internal-sales/orders/${target.id}`
                }
              >
                {t('order_hub.drawer.openHub')}
              </Link>
            </Button>
          )}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
