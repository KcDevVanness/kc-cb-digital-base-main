"use client"

import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'

/**
 * 应付台账 — one row per placed purchase order with the payment state `purchasing` derives, plus the
 * per-supplier/per-currency groups. Amounts in different currencies are never added together, so the
 * groups are keyed by supplier **and** currency.
 */

type PaymentStatus = 'unpaid' | 'deposit_paid' | 'partially_paid' | 'paid'

type PayableRow = {
  purchaseOrderId: string
  number: string | null
  businessNumber: string | null
  supplierId: string
  supplierName: string | null
  currencyCode: string
  orderTotal: string
  paidAmount: string
  outstandingAmount: string
  paymentStatus: PaymentStatus
  placedAt: string | null
  expectedShipAt: string | null
  shipments: Array<{ number: string | null; status: string }>
}

type PayableGroup = {
  supplierId: string
  supplierName: string | null
  currencyCode: string
  orderCount: number
  orderTotal: string
  paidAmount: string
  outstandingAmount: string
}

type PayablesResult = { rows: PayableRow[]; groups: PayableGroup[] }

const PAYMENT_STATUS_VARIANTS: StatusMap<PaymentStatus> = {
  unpaid: 'error',
  deposit_paid: 'warning',
  partially_paid: 'warning',
  paid: 'success',
}

const PAYMENT_STATUS_LABEL_KEYS: Record<PaymentStatus, string> = {
  unpaid: 'finance.payables.status.unpaid',
  deposit_paid: 'finance.payables.status.depositPaid',
  partially_paid: 'finance.payables.status.partiallyPaid',
  paid: 'finance.payables.status.paid',
}

function groupColumns(t: TranslateFn): ColumnDef<PayableGroup>[] {
  return [
    {
      accessorKey: 'supplierName',
      header: t('finance.payables.columns.supplier'),
      meta: { priority: 1, truncate: true, maxWidth: 280 },
      cell: ({ row }) => <span>{row.original.supplierName ?? row.original.supplierId.slice(0, 8)}</span>,
    },
    {
      accessorKey: 'currencyCode',
      header: t('finance.payables.columns.currency'),
      meta: { priority: 2 },
    },
    {
      accessorKey: 'orderCount',
      header: t('finance.payables.columns.orders'),
      enableSorting: false,
      meta: { priority: 6, align: 'right' },
    },
    {
      accessorKey: 'orderTotal',
      header: t('finance.payables.columns.orderTotal'),
      enableSorting: false,
      meta: { priority: 3, align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.orderTotal}</span>,
    },
    {
      accessorKey: 'paidAmount',
      header: t('finance.payables.columns.paid'),
      enableSorting: false,
      meta: { priority: 4, align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.paidAmount}</span>,
    },
    {
      accessorKey: 'outstandingAmount',
      header: t('finance.payables.columns.outstanding'),
      enableSorting: false,
      meta: { priority: 5, align: 'right' },
      cell: ({ row }) => (
        <span className="tabular-nums font-medium">{row.original.outstandingAmount}</span>
      ),
    },
  ]
}

function rowColumns(t: TranslateFn): ColumnDef<PayableRow>[] {
  return [
    {
      accessorKey: 'number',
      header: t('finance.payables.columns.order'),
      meta: { priority: 1 },
      cell: ({ row }) => (
        <span className="font-medium">
          {row.original.number ?? row.original.businessNumber ?? row.original.purchaseOrderId.slice(0, 8)}
        </span>
      ),
    },
    {
      accessorKey: 'supplierName',
      header: t('finance.payables.columns.supplier'),
      enableSorting: false,
      meta: { priority: 2, truncate: true, maxWidth: 240 },
      cell: ({ row }) => <span>{row.original.supplierName ?? '—'}</span>,
    },
    {
      accessorKey: 'currencyCode',
      header: t('finance.payables.columns.currency'),
      enableSorting: false,
      meta: { priority: 7 },
    },
    {
      accessorKey: 'orderTotal',
      header: t('finance.payables.columns.orderTotal'),
      enableSorting: false,
      meta: { priority: 3, align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.orderTotal}</span>,
    },
    {
      accessorKey: 'paidAmount',
      header: t('finance.payables.columns.paid'),
      enableSorting: false,
      meta: { priority: 4, align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.paidAmount}</span>,
    },
    {
      accessorKey: 'outstandingAmount',
      header: t('finance.payables.columns.outstanding'),
      enableSorting: false,
      meta: { priority: 5, align: 'right' },
      cell: ({ row }) => <span className="tabular-nums font-medium">{row.original.outstandingAmount}</span>,
    },
    {
      accessorKey: 'paymentStatus',
      header: t('finance.payables.columns.status'),
      enableSorting: false,
      meta: { priority: 8 },
      cell: ({ row }) => (
        <StatusBadge variant={PAYMENT_STATUS_VARIANTS[row.original.paymentStatus]} dot>
          {t(PAYMENT_STATUS_LABEL_KEYS[row.original.paymentStatus])}
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'placedAt',
      header: t('finance.payables.columns.placedAt'),
      enableSorting: false,
      meta: { priority: 6 },
      cell: ({ row }) => <span className="tabular-nums">{row.original.placedAt ?? '—'}</span>,
    },
  ]
}

export default function PayablesView() {
  const t = useT()
  const [data, setData] = React.useState<PayablesResult | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const payload = await readApiResultOrThrow<PayablesResult>('/api/finance/payables', undefined, {
          errorMessage: t('finance.payables.loadFailed'),
        })
        if (!cancelled) setData(payload)
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error && loadError.message ? loadError.message : t('finance.payables.loadFailed'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [t])

  const groupColumnDefs = React.useMemo(() => groupColumns(t), [t])
  const rowColumnDefs = React.useMemo(() => rowColumns(t), [t])
  const currencies = React.useMemo(
    () => [...new Set((data?.rows ?? []).map((row) => row.currencyCode))],
    [data],
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-base font-semibold leading-tight">{t('finance.payables.page.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('finance.payables.page.description')}</p>
      </div>

      {error ? <ErrorMessage label={error} /> : null}
      {loading ? <LoadingMessage label={t('finance.payables.loading')} /> : null}

      {!loading && !error && data ? (
        <>
          {currencies.length > 1 ? (
            <Alert variant="warning">{t('finance.payables.alert.multiCurrency')}</Alert>
          ) : null}

          <DataTable<PayableGroup>
            title={t('finance.payables.section.groups')}
            columns={groupColumnDefs}
            data={data.groups}
            entityId="finance:finance_shipment_cost"
            extensionTableId="finance.payables.groups"
            embedded
          />

          <DataTable<PayableRow>
            title={t('finance.payables.section.rows')}
            columns={rowColumnDefs}
            data={data.rows}
            entityId="finance:finance_shipment_cost"
            extensionTableId="finance.payables.rows"
            embedded
          />
        </>
      ) : null}
    </div>
  )
}
