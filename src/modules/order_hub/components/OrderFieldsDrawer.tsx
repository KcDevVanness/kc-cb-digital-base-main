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
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '@open-mercato/ui/primitives/drawer'
import { ErrorMessage } from '@open-mercato/ui/backend/detail/ErrorMessage'
import { LoadingMessage } from '@open-mercato/ui/backend/detail/LoadingMessage'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { formatDisplayDate, toUtcDateInputValue } from '@open-mercato/ui/primitives/date-format'
import { useLocale, useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { formatMoneyAmount } from '@/lib/money/format'
import { COLLECTION_STATUS_LABEL_KEYS, REFUND_STATUS_LABEL_KEYS } from '../../export_finance/components/labels'
import type { CompanyOrderCurrencyAmounts, CompanyOrderFields } from '../lib/companyOrderFields'

/**
 * The 「全字段」 drawer of the order workbench: the 35-field summary of one company order, read from
 * the order_hub projection (`GET /api/order_hub/orders/fields`, REQ-017) and rendered read-only in
 * the four groups an operator scans — 订单 / 金额与日期 / 单证与文件 / 财务.
 *
 * The drawer owns only the read state, this layout and the "not recorded" fallbacks; the words stay
 * in the module catalog (`order_hub.drawer.*`, `order_hub.drawer.fields.*`, plus the shipment
 * document-type and finance enum labels the owning modules already publish). A failed read degrades
 * this one surface — the workbench table is unaffected — and offers a retry.
 */

/** The one company order this drawer is showing. Built by the workbench from the row the user clicked. */
export type OrderFieldsTarget = {
  id: string
  number: string | null
}

export type OrderFieldsDrawerProps = {
  target: OrderFieldsTarget | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const FIELDS_API_PATH = 'order_hub/orders/fields'

/** An enum value's label from one of the modules' key maps; an unknown value stays itself. */
function enumLabel(map: Record<string, string>, value: string | null, t: TranslateFn): string | null {
  if (!value) return null
  const key = map[value]
  return key ? t(key) : value
}

const DOCUMENT_KIND_LABEL_KEYS: Record<string, string> = {
  proforma: 'order_hub.drawer.fields.documentKind.proforma',
  commercial: 'order_hub.drawer.fields.documentKind.commercial',
  tax_invoice: 'order_hub.drawer.fields.documentKind.tax_invoice',
}

function EmptyValue() {
  const t = useT()
  return <span className="text-xs text-muted-foreground">{t('order_hub.workbench.cell.notApplicable')}</span>
}

function TextValue({ value }: { value: string | null | undefined }) {
  return value ? <>{value}</> : <EmptyValue />
}

function DateValue({ value }: { value: string | null }) {
  const locale = useLocale()
  const day = toUtcDateInputValue(value)
  const formatted = day ? formatDisplayDate(day, locale) : null
  return <TextValue value={formatted} />
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
    <div className={`flex min-w-0 flex-col gap-0.5${className ? ` ${className}` : ''}`}>
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

/** A money value in its own currency: `¥12,345.00`, or the bare figure when the code is unusable. */
function MoneyValue({ amount, currencyCode }: { amount: string; currencyCode: string }) {
  const locale = useLocale()
  const formatted = formatMoneyAmount(amount, currencyCode, locale)
  return <span className="tabular-nums">{formatted ?? amount}</span>
}

function amountParts(amounts: CompanyOrderCurrencyAmounts): Array<{ key: string; value: string }> {
  return [
    { key: 'sales', value: amounts.sales },
    { key: 'purchase', value: amounts.purchase },
    { key: 'deposit', value: amounts.deposit },
    { key: 'paid', value: amounts.paid },
    { key: 'outstanding', value: amounts.outstanding },
  ]
}

function AmountsAndDates({ fields }: { fields: CompanyOrderFields }) {
  const t = useT()
  const amounts = fields.amounts ?? []
  return (
    <DrawerGroup title={t('order_hub.drawer.fields.group.amounts')}>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-3">
        {amounts.length === 0 ? (
          <FieldRow label={t('order_hub.drawer.fields.currency')}>
            <span className="text-xs text-muted-foreground">{t('order_hub.drawer.fields.noAmounts')}</span>
          </FieldRow>
        ) : (
          amounts.map((amount) => (
            <FieldRow key={amount.currencyCode} label={amount.currencyCode}>
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {amountParts(amount).map((part) => (
                  <span key={part.key}>
                    <span className="text-xs text-muted-foreground">{t(`order_hub.drawer.fields.${part.key}`)}</span>{' '}
                    <MoneyValue amount={part.value} currencyCode={amount.currencyCode} />
                  </span>
                ))}
              </span>
            </FieldRow>
          ))
        )}
        <FieldRow label={t('order_hub.drawer.fields.orderedAt')}>
          <DateValue value={fields.dates?.orderedAt ?? null} />
        </FieldRow>
        <FieldRow label={t('order_hub.drawer.fields.expectedDeliveryAt')}>
          <DateValue value={fields.dates?.expectedDeliveryAt ?? null} />
        </FieldRow>
        <FieldRow label={t('order_hub.drawer.fields.shippedAt')}>
          <DateValue value={fields.dates?.shippedAt ?? null} />
        </FieldRow>
      </dl>
    </DrawerGroup>
  )
}

function DocumentsAndFiles({ fields }: { fields: CompanyOrderFields }) {
  const t = useT()
  const byKind = fields.documents?.byKind ?? []
  const invoiceNumbers = fields.documents?.invoiceNumbers ?? []
  const bySlot = fields.documents?.bySlot ?? []

  return (
    <DrawerGroup title={t('order_hub.drawer.group.documents')}>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-3">
        <FieldRow label={t('order_hub.drawer.fields.documentNumbers')}>
          {byKind.length === 0 ? (
            <span className="text-xs text-muted-foreground">{t('order_hub.drawer.fields.noDocuments')}</span>
          ) : (
            <span className="flex flex-col gap-0.5">
              {byKind.map((group) => (
                <span key={group.kind}>
                  <span className="text-xs text-muted-foreground">
                    {DOCUMENT_KIND_LABEL_KEYS[group.kind] ? t(DOCUMENT_KIND_LABEL_KEYS[group.kind]) : group.kind}
                  </span>{' '}
                  {group.numbers.join(', ')}
                </span>
              ))}
            </span>
          )}
        </FieldRow>
        <FieldRow label={t('order_hub.drawer.fields.invoiceNo')}>
          <TextValue value={invoiceNumbers.length > 0 ? invoiceNumbers.join(', ') : null} />
        </FieldRow>
        {/* 每个单据字段一个槽位（REQ-023）：本单上传的文件在本位列出，子单既有来源以徽标列出。 */}
        {bySlot.map((group) => (
          <FieldRow key={group.slot} label={t(`order_hub.documents.slots.${group.slot}`)}>
            {group.files.length === 0 && group.childSources.length === 0 ? (
              <span className="text-xs text-muted-foreground">{t('order_hub.documents.noFiles')}</span>
            ) : (
              <span className="flex flex-col gap-0.5">
                {group.files.map((file) => (
                  <span key={file.attachmentId} className="flex flex-wrap items-center gap-x-2">
                    <span className="text-xs text-muted-foreground">{t('order_hub.documents.sourceSelf')}</span>
                    <span className="break-all">{file.fileName}</span>
                    {file.createdAt ? (
                      <span className="text-xs text-muted-foreground">{file.createdAt.slice(0, 10)}</span>
                    ) : null}
                  </span>
                ))}
                {group.childSources.map((source, index) => (
                  <span
                    key={`${source.source}-${index}`}
                    className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground"
                  >
                    <span>{t(`order_hub.documents.sources.${source.source}`)}</span>
                    {source.label ? <span className="font-medium text-foreground">{source.label}</span> : null}
                    {typeof source.count === 'number' ? (
                      <span>{t('order_hub.documents.sourceCount', { count: source.count })}</span>
                    ) : null}
                  </span>
                ))}
              </span>
            )}
          </FieldRow>
        ))}
      </dl>
    </DrawerGroup>
  )
}

function Finance({ fields }: { fields: CompanyOrderFields }) {
  const t = useT()
  const collections = fields.collections ?? []
  const refunds = fields.refunds ?? []

  return (
    <DrawerGroup title={t('order_hub.drawer.group.finance')}>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-3">
        <FieldRow label={t('order_hub.drawer.fields.collections')}>
          {collections.length === 0 ? (
            <span className="text-xs text-muted-foreground">{t('order_hub.drawer.fields.noCollections')}</span>
          ) : (
            <span className="flex flex-col gap-0.5">
              {collections.map((collection, index) => (
                <span key={`${collection.status}-${index}`}>
                  {enumLabel(COLLECTION_STATUS_LABEL_KEYS, collection.status, t) ?? collection.status}
                  {' · '}
                  {collection.hasForeignIncomeCertificate
                    ? t('order_hub.drawer.fields.hasCertificate')
                    : t('order_hub.drawer.fields.noCertificate')}
                </span>
              ))}
            </span>
          )}
        </FieldRow>
        <FieldRow label={t('order_hub.drawer.fields.refunds')}>
          {refunds.length === 0 ? (
            <span className="text-xs text-muted-foreground">{t('order_hub.drawer.fields.noRefunds')}</span>
          ) : (
            <span className="flex flex-col gap-0.5">
              {refunds.map((refund, index) => (
                <span key={`${refund.status}-${index}`} className="flex flex-wrap items-center gap-x-2">
                  <span>{enumLabel(REFUND_STATUS_LABEL_KEYS, refund.status, t) ?? refund.status}</span>
                  {refund.amount ? <MoneyValue amount={refund.amount} currencyCode={refund.currencyCode} /> : <EmptyValue />}
                </span>
              ))}
            </span>
          )}
        </FieldRow>
        <FieldRow label={t('order_hub.drawer.fields.kcStamp')}>
          {fields.kcStamp ? t('order_hub.drawer.fields.yes') : t('order_hub.drawer.fields.no')}
        </FieldRow>
      </dl>
    </DrawerGroup>
  )
}

function CompanyOrderFieldsBody({ target }: { target: OrderFieldsTarget }) {
  const t = useT()
  const fieldsQuery = useQuery({
    queryKey: ['order-hub', 'fields', target.id],
    retry: false,
    queryFn: () =>
      readApiResultOrThrow<Partial<CompanyOrderFields>>(
        `/api/${FIELDS_API_PATH}?companyOrderId=${encodeURIComponent(target.id)}`,
        undefined,
        { fallback: {}, errorMessage: t('order_hub.drawer.loadFailed') },
      ),
  })

  if (fieldsQuery.isLoading) {
    return <LoadingMessage label={t('order_hub.drawer.loading')} />
  }
  if (fieldsQuery.isError) {
    return (
      <ErrorMessage
        label={t('order_hub.drawer.loadFailed')}
        action={
          <Button variant="outline" size="sm" onClick={() => void fieldsQuery.refetch()}>
            {t('order_hub.drawer.retry')}
          </Button>
        }
      />
    )
  }
  const fields = fieldsQuery.data as CompanyOrderFields | undefined
  if (!fields?.order) {
    return <p className="text-sm text-muted-foreground">{t('order_hub.drawer.fields.empty')}</p>
  }

  const childNumbers = fields.order.childNumbers ?? []
  return (
    <div className="flex flex-col gap-5">
      <DrawerGroup title={t('order_hub.drawer.group.order')}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <FieldRow label={t('order_hub.drawer.companyOrder.number')}>
            <TextValue value={fields.order.number ?? target.number} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.companyOrder.title')}>
            <TextValue value={fields.order.title} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.companyOrder.orderDate')}>
            <DateValue value={fields.order.orderDate} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.companyOrder.etaDate')}>
            <DateValue value={fields.order.etaDate} />
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.companyOrder.status')}>
            <span>{fields.order.status ? t(`order_hub.companyOrders.status.${fields.order.status}`) : ''}</span>
          </FieldRow>
          <FieldRow label={t('order_hub.drawer.companyOrder.childNumbers')}>
            <TextValue value={childNumbers.length > 0 ? childNumbers.join(', ') : null} />
          </FieldRow>
        </dl>
      </DrawerGroup>
      <AmountsAndDates fields={fields} />
      <DocumentsAndFiles fields={fields} />
      <Finance fields={fields} />
    </div>
  )
}

export default function OrderFieldsDrawer({ target, open, onOpenChange }: OrderFieldsDrawerProps) {
  const t = useT()
  if (!target) return null

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent closeAriaLabel={t('order_hub.drawer.close')}>
        <DrawerHeader leading={<FileText aria-hidden="true" className="size-4" />}>
          <DrawerTitle>{t('order_hub.drawer.title')}</DrawerTitle>
          {target.number ? <DrawerDescription>{target.number}</DrawerDescription> : null}
        </DrawerHeader>
        <DrawerBody>
          <CompanyOrderFieldsBody target={target} />
        </DrawerBody>
        <DrawerFooter>
          <DrawerClose asChild>
            <Button variant="outline">{t('order_hub.drawer.close')}</Button>
          </DrawerClose>
          <Button asChild>
            <Link href={`/backend/orders/${target.id}`}>{t('order_hub.drawer.openCompanyOrder')}</Link>
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
