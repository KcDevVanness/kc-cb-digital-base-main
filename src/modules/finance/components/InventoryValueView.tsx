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
 * 库存资金占用 — what the stock on hand is worth, with both cost calibers side by side and the
 * resolving source named on every row. A row nothing could price is shown as unpriced with its
 * quantity, never valued at zero.
 */

type InventoryCostSource = 'landed' | 'price_tier' | 'missing'

type InventoryValueRow = {
  sku: string | null
  productId: string | null
  quantity: string
  unitCostCny: string | null
  valueCny: string | null
  source: InventoryCostSource
  landedUnitCostCny: string | null
  purchaseUnitCostCny: string | null
}

type InventoryValueResult = {
  asOf: string
  rows: InventoryValueRow[]
  totals: {
    value: string
    missingQuantity: string
    unconvertible: Array<{ sku: string | null; productId: string | null; currencyCode: string; unitPrice: string }>
  }
}

const SOURCE_STATUS: StatusMap<InventoryCostSource> = {
  landed: 'success',
  price_tier: 'info',
  missing: 'warning',
}

function sourceLabel(source: InventoryCostSource, t: TranslateFn): string {
  if (source === 'landed') return t('finance.inventoryValue.source.landed')
  if (source === 'price_tier') return t('finance.inventoryValue.source.priceTier')
  return t('finance.inventoryValue.source.missing')
}

function columns(t: TranslateFn): ColumnDef<InventoryValueRow>[] {
  return [
    {
      accessorKey: 'sku',
      header: t('finance.inventoryValue.columns.sku'),
      meta: { priority: 1 },
      cell: ({ row }) => <span className="font-medium">{row.original.sku ?? '—'}</span>,
    },
    {
      accessorKey: 'quantity',
      header: t('finance.inventoryValue.columns.quantity'),
      meta: { priority: 2, align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.quantity}</span>,
    },
    {
      accessorKey: 'purchaseUnitCostCny',
      header: t('finance.inventoryValue.columns.purchaseUnit'),
      enableSorting: false,
      meta: { priority: 4, align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.purchaseUnitCostCny ?? '—'}</span>,
    },
    {
      accessorKey: 'landedUnitCostCny',
      header: t('finance.inventoryValue.columns.landedUnit'),
      enableSorting: false,
      meta: { priority: 5, align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.landedUnitCostCny ?? '—'}</span>,
    },
    {
      accessorKey: 'unitCostCny',
      header: t('finance.inventoryValue.columns.valuedUnit'),
      enableSorting: false,
      meta: { priority: 6, align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.unitCostCny ?? '—'}</span>,
    },
    {
      accessorKey: 'valueCny',
      header: t('finance.inventoryValue.columns.value'),
      enableSorting: false,
      meta: { priority: 3, align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.valueCny ?? '—'}</span>,
    },
    {
      accessorKey: 'source',
      header: t('finance.inventoryValue.columns.source'),
      enableSorting: false,
      meta: { priority: 7 },
      cell: ({ row }) => (
        <StatusBadge variant={SOURCE_STATUS[row.original.source]} dot>
          {sourceLabel(row.original.source, t)}
        </StatusBadge>
      ),
    },
  ]
}

export default function InventoryValueView() {
  const t = useT()
  const [data, setData] = React.useState<InventoryValueResult | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const payload = await readApiResultOrThrow<InventoryValueResult>(
          '/api/finance/inventory-value',
          undefined,
          { errorMessage: t('finance.inventoryValue.loadFailed') },
        )
        if (!cancelled) setData(payload)
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error && loadError.message ? loadError.message : t('finance.inventoryValue.loadFailed'))
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

  const columnDefs = React.useMemo(() => columns(t), [t])
  const missingQuantity = data ? Number.parseFloat(data.totals.missingQuantity) : 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-base font-semibold leading-tight">{t('finance.inventoryValue.page.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('finance.inventoryValue.page.description')}</p>
      </div>

      {error ? <ErrorMessage label={error} /> : null}
      {loading ? <LoadingMessage label={t('finance.inventoryValue.loading')} /> : null}

      {!loading && !error && data ? (
        <>
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="rounded-md border bg-card px-3 py-1.5">
              {t('finance.inventoryValue.totals.value')}:{' '}
              <span className="tabular-nums font-medium">{data.totals.value}</span>
            </span>
            <span className="rounded-md border bg-card px-3 py-1.5">
              {t('finance.inventoryValue.totals.missingQuantity')}:{' '}
              <span className="tabular-nums font-medium">{data.totals.missingQuantity}</span>
            </span>
            <span className="rounded-md border bg-card px-3 py-1.5">
              {t('finance.inventoryValue.totals.asOf')}: <span className="font-medium">{data.asOf}</span>
            </span>
          </div>

          {missingQuantity > 0 ? (
            <Alert variant="warning">{t('finance.inventoryValue.alert.missingCost')}</Alert>
          ) : null}
          {data.totals.unconvertible.length > 0 ? (
            <Alert variant="destructive">
              {t('finance.inventoryValue.alert.unconvertible', { count: String(data.totals.unconvertible.length) })}
            </Alert>
          ) : null}

          <DataTable<InventoryValueRow>
            title={t('finance.inventoryValue.section.rows')}
            columns={columnDefs}
            data={data.rows}
            entityId="finance:finance_shipment_cost"
            extensionTableId="finance.inventory-value.rows"
            embedded
          />
        </>
      ) : null}
    </div>
  )
}
