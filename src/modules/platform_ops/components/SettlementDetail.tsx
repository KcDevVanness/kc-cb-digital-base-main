"use client"

import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { ReceiptText } from 'lucide-react'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useLocale, useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { MoneyAmount } from '@/lib/money/MoneyAmount'
import {
  SETTLEMENTS_API_PATH,
  SETTLEMENT_LINES_API_PATH,
  SETTLEMENTS_LIST_HREF,
  SettlementStatusBadge,
  formatSettlementPeriod,
  toSettlementLineRecord,
  toSettlementRecord,
  useChannelNameMap,
  type SettlementLineRecord,
  type SettlementRecord,
} from './SettlementImportDialog'

/**
 * The statement's lines are a snapshot of one payout, and the route caps a page at 200 — the size
 * of the largest statement the import accepts in one call, so a settlement that was imported at
 * all fits in a single page.
 */
const LINE_PAGE_SIZE = 200
const EMPTY_CELL = '—'

function SummaryField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  )
}

function buildLineColumns(t: TranslateFn, currencyCode: string): ColumnDef<SettlementLineRecord>[] {
  return [
    {
      accessorKey: 'externalOrderId',
      header: t('platform_ops.settlements.detail.lines.columns.externalOrderId'),
      meta: { priority: 1, truncate: true, maxWidth: 280 },
      cell: ({ row }) => {
        const externalId = row.original.externalOrderId
        return externalId ? externalId : EMPTY_CELL
      },
    },
    {
      accessorKey: 'orderMirrorId',
      header: t('platform_ops.settlements.detail.lines.columns.matched'),
      enableSorting: false,
      meta: { priority: 2 },
      // A line is matched when the import linked it to one of our order mirrors; a line that
      // stayed unlinked is the very thing the reconciliation queue works on.
      cell: ({ row }) => (
        <StatusBadge variant={row.original.orderMirrorId ? 'success' : 'warning'} dot>
          {row.original.orderMirrorId ? t('common.yes') : t('common.no')}
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'grossAmount',
      header: t('platform_ops.settlements.detail.lines.columns.gross'),
      enableSorting: false,
      meta: { priority: 3 },
      cell: ({ row }) => <MoneyAmount currencyCode={currencyCode} amount={row.original.grossAmount} />,
    },
    {
      accessorKey: 'feeAmount',
      header: t('platform_ops.settlements.detail.lines.columns.fee'),
      enableSorting: false,
      meta: { priority: 4 },
      cell: ({ row }) => <MoneyAmount currencyCode={currencyCode} amount={row.original.feeAmount} />,
    },
    {
      accessorKey: 'netAmount',
      header: t('platform_ops.settlements.detail.lines.columns.net'),
      enableSorting: false,
      meta: { priority: 5 },
      cell: ({ row }) => <MoneyAmount currencyCode={currencyCode} amount={row.original.netAmount} />,
    },
  ]
}

export default function SettlementDetail({ settlementId }: { settlementId: string }) {
  const t = useT()
  const locale = useLocale()
  const scopeVersion = useOrganizationScopeVersion()
  const channelNames = useChannelNameMap()
  const [settlement, setSettlement] = React.useState<SettlementRecord | null>(null)
  const [lines, setLines] = React.useState<SettlementLineRecord[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    setNotFound(false)
    try {
      const [settlementPayload, linePayload] = await Promise.all([
        fetchCrudList<Record<string, unknown>>(SETTLEMENTS_API_PATH, { id: settlementId, pageSize: 1 }),
        fetchCrudList<Record<string, unknown>>(SETTLEMENT_LINES_API_PATH, {
          settlementId,
          pageSize: LINE_PAGE_SIZE,
        }),
      ])
      const item = settlementPayload.items?.[0]
      if (!item) {
        setSettlement(null)
        setLines([])
        setNotFound(true)
        return
      }
      setSettlement(toSettlementRecord(item))
      setLines((linePayload.items ?? []).map(toSettlementLineRecord))
    } catch {
      setLoadError(t('ui.errors.defaultMessage'))
    } finally {
      setLoading(false)
    }
    // `scopeVersion` is not read inside the callback on purpose: it is the organization-scope
    // generation, and bumping it must rebuild this callback so the effect below refetches after an
    // organization switch. The rule cannot see that intent, so the dependency is explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate scope-change refetch
  }, [settlementId, scopeVersion, t])

  React.useEffect(() => {
    void load()
  }, [load])

  const lineColumns = React.useMemo(
    () => buildLineColumns(t, settlement?.currencyCode ?? 'USD'),
    [settlement?.currencyCode, t],
  )

  if (loading && !settlement) return <LoadingMessage label={t('ui.forms.loading')} />

  if (notFound) {
    return <RecordNotFoundState label={t('api.errors.notFound')} backHref={SETTLEMENTS_LIST_HREF} />
  }

  if (loadError || !settlement) {
    return <ErrorMessage label={loadError ?? t('ui.errors.defaultMessage')} />
  }

  const channelLabel = channelNames.get(settlement.channelId) ?? settlement.channelId
  const period = formatSettlementPeriod(settlement.periodStart, settlement.periodEnd, locale)

  return (
    <>
      <FormHeader
        mode="detail"
        backHref={SETTLEMENTS_LIST_HREF}
        entityTypeLabel={t('platform_ops.settlements.page.title')}
        title={settlement.externalSettlementId}
        statusBadge={<SettlementStatusBadge status={settlement.status} />}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-5">
        <SummaryField label={t('platform_ops.settlements.list.columns.channel')}>{channelLabel}</SummaryField>
        <SummaryField label={t('platform_ops.settlements.list.columns.period')}>{period ?? EMPTY_CELL}</SummaryField>
        <SummaryField label={t('platform_ops.settlements.list.columns.gross')}>
          <MoneyAmount currencyCode={settlement.currencyCode} amount={settlement.grossAmount} />
        </SummaryField>
        <SummaryField label={t('platform_ops.settlements.list.columns.fee')}>
          <MoneyAmount currencyCode={settlement.currencyCode} amount={settlement.feeAmount} />
        </SummaryField>
        <SummaryField label={t('platform_ops.settlements.list.columns.net')}>
          <MoneyAmount currencyCode={settlement.currencyCode} amount={settlement.netAmount} />
        </SummaryField>
      </div>

      <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
        <SectionHeader title={t('platform_ops.settlements.detail.lines')} count={lines.length} />
        <DataTable<SettlementLineRecord>
          embedded
          columns={lineColumns}
          data={lines}
          disableRowClick
          emptyState={(
            <ListEmptyState
              title={t('platform_ops.settlements.detail.lines.empty')}
              icon={<ReceiptText className="size-7" aria-hidden />}
            />
          )}
        />
      </div>
    </>
  )
}
