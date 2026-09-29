"use client"

import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@open-mercato/ui/primitives/select'
import { Input } from '@open-mercato/ui/primitives/input'
import { KpiCard } from '@open-mercato/ui/backend/charts'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { loadShipmentOptions } from './shipmentCostOptions'

/**
 * 到岸成本 — the read-only view of one container: its purchase value, the container fees allocated
 * over the purchase lines, and the resulting landed unit cost. Everything shown here is derived by
 * the API on every request; the page owns no state of its own beyond the selection.
 */

type LandedCostLine = {
  purchaseOrderLineId: string
  purchaseOrderId: string
  purchaseOrderNumber: string | null
  businessNumber: string | null
  lineNumber: number
  sku: string | null
  currencyCode: string
  quantity: string
  purchaseAmountOriginal: string
  purchaseAmountCny: string | null
  allocatedCostCny: string
  landedTotalCny: string | null
  landedUnitCostCny: string | null
  rateMissing: boolean
}

type LandedCostSkuRow = {
  sku: string | null
  quantity: string
  purchaseAmountCny: string | null
  allocatedCostCny: string
  landedTotalCny: string | null
  landedUnitCostCny: string | null
  rateMissing: boolean
  lineCount: number
}

type LandedCostResult = {
  shipmentId: string
  shipmentNumber: string | null
  lines: LandedCostLine[]
  skuRows: LandedCostSkuRow[]
  unconvertibleFees: Array<{ id: string; costType: string; amount: string; currencyCode: string }>
  unallocatedFees: Array<{ id: string; costType: string; amount: string; currencyCode: string }>
  totals: { feesCny: string; allocatedCny: string; purchaseCny: string; landedCny: string; linesMissingRate: number }
}

type LandedCostSkuReport = {
  sku: string
  containers: Array<{
    shipmentId: string
    shipmentNumber: string | null
    quantity: string
    allocatedCostCny: string
    purchaseAmountCny: string | null
    landedTotalCny: string | null
    landedUnitCostCny: string | null
    rateMissing: boolean
  }>
  totals: {
    quantity: string
    purchaseCny: string
    allocatedCny: string
    landedCny: string
    landedUnitCostCny: string | null
    linesMissingRate: number
  }
}

/** Exact decimal string → a display number; the API keeps the string precision either way. */
function toDisplayNumber(value: string | null): number | null {
  if (value === null) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

function lineColumns(t: TranslateFn): ColumnDef<LandedCostLine>[] {
  return [
    {
      accessorKey: 'purchaseOrderNumber',
      header: t('finance.landedCosts.columns.order'),
      enableSorting: false,
      meta: { priority: 1, truncate: true, maxWidth: 240 },
      cell: ({ row }) => <span>{row.original.businessNumber ?? row.original.purchaseOrderNumber ?? '—'}</span>,
    },
    {
      accessorKey: 'lineNumber',
      header: t('finance.landedCosts.columns.line'),
      enableSorting: false,
      meta: { priority: 6 },
    },
    {
      accessorKey: 'sku',
      header: t('finance.landedCosts.columns.sku'),
      enableSorting: false,
      meta: { priority: 2 },
      cell: ({ row }) => <span>{row.original.sku ?? '—'}</span>,
    },
    {
      accessorKey: 'quantity',
      header: t('finance.landedCosts.columns.quantity'),
      enableSorting: false,
      meta: { priority: 3, align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.quantity}</span>,
    },
    {
      accessorKey: 'purchaseAmountOriginal',
      header: t('finance.landedCosts.columns.purchaseOriginal'),
      enableSorting: false,
      meta: { priority: 4, align: 'right' },
      cell: ({ row }) => (
        <span className="tabular-nums">
          {row.original.purchaseAmountOriginal} {row.original.currencyCode}
        </span>
      ),
    },
    {
      accessorKey: 'purchaseAmountCny',
      header: t('finance.landedCosts.columns.purchaseCny'),
      enableSorting: false,
      meta: { priority: 5, align: 'right' },
      cell: ({ row }) =>
        row.original.rateMissing ? (
          <span className="text-status-warning-text">{t('finance.landedCosts.rateMissing')}</span>
        ) : (
          <span className="tabular-nums">{row.original.purchaseAmountCny ?? '—'}</span>
        ),
    },
    {
      accessorKey: 'allocatedCostCny',
      header: t('finance.landedCosts.columns.allocated'),
      enableSorting: false,
      meta: { priority: 7, align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.allocatedCostCny}</span>,
    },
    {
      accessorKey: 'landedTotalCny',
      header: t('finance.landedCosts.columns.landedTotal'),
      enableSorting: false,
      meta: { priority: 8, align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.landedTotalCny ?? '—'}</span>,
    },
    {
      accessorKey: 'landedUnitCostCny',
      header: t('finance.landedCosts.columns.landedUnit'),
      enableSorting: false,
      meta: { priority: 9, align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.landedUnitCostCny ?? '—'}</span>,
    },
  ]
}

function skuColumns(t: TranslateFn): ColumnDef<LandedCostSkuRow>[] {
  return [
    {
      accessorKey: 'sku',
      header: t('finance.landedCosts.columns.sku'),
      enableSorting: false,
      meta: { priority: 1 },
      cell: ({ row }) => <span>{row.original.sku ?? '—'}</span>,
    },
    {
      accessorKey: 'lineCount',
      header: t('finance.landedCosts.columns.lines'),
      enableSorting: false,
      meta: { priority: 6 },
    },
    {
      accessorKey: 'quantity',
      header: t('finance.landedCosts.columns.quantity'),
      enableSorting: false,
      meta: { priority: 2, align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.quantity}</span>,
    },
    {
      accessorKey: 'purchaseAmountCny',
      header: t('finance.landedCosts.columns.purchaseCny'),
      enableSorting: false,
      meta: { priority: 3, align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.purchaseAmountCny ?? '—'}</span>,
    },
    {
      accessorKey: 'allocatedCostCny',
      header: t('finance.landedCosts.columns.allocated'),
      enableSorting: false,
      meta: { priority: 4, align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.allocatedCostCny}</span>,
    },
    {
      accessorKey: 'landedTotalCny',
      header: t('finance.landedCosts.columns.landedTotal'),
      enableSorting: false,
      meta: { priority: 5, align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.landedTotalCny ?? '—'}</span>,
    },
    {
      accessorKey: 'landedUnitCostCny',
      header: t('finance.landedCosts.columns.landedUnit'),
      enableSorting: false,
      meta: { priority: 7, align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.landedUnitCostCny ?? '—'}</span>,
    },
  ]
}

export default function LandedCostView() {
  const t = useT()
  const [shipments, setShipments] = React.useState<Array<{ value: string; label: string }>>([])
  const [shipmentId, setShipmentId] = React.useState('')
  const [sku, setSku] = React.useState('')
  const [applied, setApplied] = React.useState<{ shipmentId: string; sku: string } | null>(null)
  const [result, setResult] = React.useState<LandedCostResult | null>(null)
  const [report, setReport] = React.useState<LandedCostSkuReport | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    loadShipmentOptions(t('finance.shipmentCosts.form.loadShipmentsFailed'))
      .then((options) => {
        if (!cancelled) setShipments(options)
      })
      .catch(() => {
        if (!cancelled) setShipments([])
      })
    return () => {
      cancelled = true
    }
  }, [t])

  React.useEffect(() => {
    if (!applied) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams()
        if (applied?.shipmentId) params.set('shipmentId', applied.shipmentId)
        if (applied?.sku) params.set('sku', applied.sku)
        const payload = await readApiResultOrThrow<{ result: LandedCostResult | null; report: LandedCostSkuReport | null }>(
          `/api/finance/landed-costs?${params.toString()}`,
          undefined,
          { errorMessage: t('finance.landedCosts.loadFailed') },
        )
        if (!cancelled) {
          setResult(payload.result)
          setReport(payload.report)
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error && loadError.message ? loadError.message : t('finance.landedCosts.loadFailed'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [applied, t])

  const handleQuery = React.useCallback(() => {
    if (!shipmentId && !sku.trim()) return
    setApplied({ shipmentId, sku: sku.trim() })
  }, [shipmentId, sku])

  const lineColumnDefs = React.useMemo(() => lineColumns(t), [t])
  const skuColumnDefs = React.useMemo(() => skuColumns(t), [t])
  const totals = result?.totals ?? report?.totals
  const unconvertible = result?.unconvertibleFees ?? []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-base font-semibold leading-tight">{t('finance.landedCosts.page.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('finance.landedCosts.page.description')}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex w-64 flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t('finance.landedCosts.filter.shipment')}</span>
          <Select value={shipmentId} onValueChange={setShipmentId}>
            <SelectTrigger aria-label={t('finance.landedCosts.filter.shipment')}>
              {shipments.find((option) => option.value === shipmentId)?.label ??
                t('finance.landedCosts.filter.shipmentPlaceholder')}
            </SelectTrigger>
            <SelectContent>
              {shipments.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex w-56 flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t('finance.landedCosts.filter.sku')}</span>
          <Input
            value={sku}
            onChange={(event) => setSku(event.target.value)}
            placeholder={t('finance.landedCosts.filter.skuPlaceholder')}
            aria-label={t('finance.landedCosts.filter.sku')}
          />
        </div>
        <Button type="button" onClick={handleQuery} disabled={!shipmentId && sku.trim().length === 0}>
          {t('finance.landedCosts.filter.apply')}
        </Button>
      </div>

      {error ? <ErrorMessage label={error} /> : null}
      {loading ? <LoadingMessage label={t('finance.landedCosts.loading')} /> : null}

      {!loading && applied && !error && (unconvertible.length > 0 || (totals?.linesMissingRate ?? 0) > 0) ? (
        <Alert variant="destructive">
          {unconvertible.length > 0
            ? t('finance.landedCosts.alert.unconvertibleFees', { count: String(unconvertible.length) })
            : t('finance.landedCosts.alert.missingRates', { count: String(totals?.linesMissingRate ?? 0) })}
        </Alert>
      ) : null}

      {!loading && !error && applied && !result && !report ? (
        <Alert>{t('finance.landedCosts.empty')}</Alert>
      ) : null}

      {!loading && !error && totals ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            title={t('finance.landedCosts.kpi.purchase')}
            value={toDisplayNumber(totals.purchaseCny)}
            formatValue={(value) => value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          />
          <KpiCard
            title={t('finance.landedCosts.kpi.fees')}
            value={result ? toDisplayNumber(result.totals.feesCny) : toDisplayNumber(report?.totals.allocatedCny ?? null)}
            formatValue={(value) => value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          />
          <KpiCard
            title={t('finance.landedCosts.kpi.allocated')}
            value={toDisplayNumber(totals.allocatedCny)}
            formatValue={(value) => value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          />
          <KpiCard
            title={t('finance.landedCosts.kpi.landed')}
            value={toDisplayNumber(totals.landedCny)}
            formatValue={(value) => value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          />
        </div>
      ) : null}

      {result ? (
        <DataTable<LandedCostLine>
          title={t('finance.landedCosts.section.lines')}
          columns={lineColumnDefs}
          data={result.lines}
          entityId="finance:finance_shipment_cost"
          extensionTableId="finance.landed-costs.lines"
          embedded
        />
      ) : null}

      {result ? (
        <DataTable<LandedCostSkuRow>
          title={t('finance.landedCosts.section.skuRollup')}
          columns={skuColumnDefs}
          data={result.skuRows}
          entityId="finance:finance_shipment_cost"
          extensionTableId="finance.landed-costs.sku"
          embedded
        />
      ) : null}

      {report ? (
        <DataTable<LandedCostSkuRow>
          title={t('finance.landedCosts.section.containers')}
          columns={skuColumnDefs}
          data={report.containers.map((container) => ({
            sku: container.shipmentNumber ?? container.shipmentId.slice(0, 8),
            lineCount: 1,
            quantity: container.quantity,
            purchaseAmountCny: container.purchaseAmountCny,
            allocatedCostCny: container.allocatedCostCny,
            landedTotalCny: container.landedTotalCny,
            landedUnitCostCny: container.landedUnitCostCny,
            rateMissing: container.rateMissing,
          }))}
          entityId="finance:finance_shipment_cost"
          extensionTableId="finance.landed-costs.containers"
          embedded
        />
      ) : null}
    </div>
  )
}
