"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ContainerFileRow, OrderFileRow } from '../lib/fileRules'

/**
 * 逾期清单 — one screen listing the money that is late, both sides of it.
 *
 * The page **does not decide what is late**. Both lists are read with `overdue=true`, and the server
 * answers with the rows whose own derived flag (`refundOverdue` / `collectionOverdue`, rule and
 * threshold in `lib/fileRules.ts`) is true — so this screen, the 档案 pages' 逾期 columns and the CSV
 * exports can never disagree about a row. What the page adds is only the two things a worklist needs:
 * the sections side by side, and the age of each item.
 */
const CONTAINERS_API_PATH = 'export_finance/container-files'
const ORDERS_API_PATH = 'export_finance/order-files'

/**
 * One page holds the whole worklist on purpose: an operator must be able to see everything that is
 * late without paging. If a scope ever exceeds this, the list needs a server-side sort by age rather
 * than a bigger cap — the sections already say when they were cut.
 */
const WORKLIST_PAGE_SIZE = 100

/** Whole days between a timestamp and now; a future or unparsable date yields `null`, never a number. */
function daysSince(timestamp: string | null, now: number): number | null {
  if (!timestamp) return null
  const value = Date.parse(timestamp)
  if (!Number.isFinite(value)) return null
  const days = Math.floor((now - value) / 86_400_000)
  return days >= 0 ? days : null
}

function formatDay(timestamp: string | null): string {
  if (!timestamp) return '—'
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toISOString().slice(0, 10)
}

type WorklistRow = {
  key: string
  href: string
  /** 单号 — the number the operator searches for, and the link text. */
  number: string
  /** 关联方 / 供应商 — who the money is owed by or to. */
  party: string | null
  /** 收货日期 — the date the rule measures from. */
  since: string | null
  /** 逾期天数, or null when the date is missing (the row would not be here, but stay honest). */
  days: number | null
  /** 状态 — the money's own status word, already translated by the caller. */
  status: string
}

function WorklistSection({
  title,
  rows,
  emptyLabel,
  ageLabel,
  daySuffix,
  isLoading,
  errorLabel,
}: {
  title: string
  rows: WorklistRow[]
  emptyLabel: string
  ageLabel: string
  daySuffix: string
  isLoading: boolean
  errorLabel: string | null
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        <span className="text-sm text-muted-foreground">{rows.length}</span>
      </div>
      {errorLabel ? (
        <Alert status="error">{errorLabel}</Alert>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">
          {emptyLabel}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground" role="status">
          {emptyLabel}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {rows.map((row) => (
            <li key={row.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
              <Link className="font-medium underline-offset-2 hover:underline" href={row.href}>
                {row.number}
              </Link>
              {row.party ? <span className="text-sm">{row.party}</span> : null}
              <span className="text-sm text-muted-foreground">{formatDay(row.since)}</span>
              <span className="ml-auto flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  {row.days === null ? '—' : `${ageLabel} ${row.days} ${daySuffix}`}
                </span>
                <StatusBadge variant="warning" dot>
                  {row.status}
                </StatusBadge>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default function OverdueWorklist() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const { payload: chromePayload, isReady: chromeReady } = useBackendChrome()
  const canReadCabinets = !chromeReady || hasFeature(chromePayload?.grantedFeatures, 'export_finance.cabinets.view')
  // One clock for the whole screen: two rows loaded in the same second must not disagree about age.
  const now = React.useMemo(() => Date.now(), [])

  const containersQuery = useQuery({
    queryKey: ['export_finance', 'overdue-worklist', 'containers', scopeVersion],
    enabled: canReadCabinets,
    queryFn: () =>
      fetchCrudList<ContainerFileRow>(CONTAINERS_API_PATH, {
        overdue: 'true',
        pageSize: String(WORKLIST_PAGE_SIZE),
        sortDir: 'asc',
      }),
  })

  const ordersQuery = useQuery({
    queryKey: ['export_finance', 'overdue-worklist', 'orders', scopeVersion],
    queryFn: () =>
      fetchCrudList<OrderFileRow>(ORDERS_API_PATH, {
        overdue: 'true',
        view: 'finance',
        pageSize: String(WORKLIST_PAGE_SIZE),
        sortDir: 'asc',
      }),
  })

  const containerRows: WorklistRow[] = React.useMemo(
    () =>
      (containersQuery.data?.items ?? [])
        .filter((row) => row.refundOverdue)
        .map((row) => ({
          key: row.shipmentId,
          href: `/backend/export-finance/containers/${row.shipmentId}`,
          number: row.shipmentNumber ?? row.shipmentId,
          party: row.orders[0]?.customerName ?? row.orders[0]?.ownerName ?? null,
          since: row.receivedAt,
          days: daysSince(row.receivedAt, now),
          status: t(`export_finance.refund.status.${row.taxRefundStatus}`, row.taxRefundStatus),
        })),
    [containersQuery.data, now, t],
  )

  const orderRows: WorklistRow[] = React.useMemo(
    () =>
      (ordersQuery.data?.items ?? [])
        .filter((row) => row.collectionOverdue)
        .map((row) => ({
          key: row.purchaseOrderId,
          href: `/backend/export-finance/orders/${row.purchaseOrderId}?view=finance`,
          number: row.businessNumber ?? row.number ?? row.purchaseOrderId,
          party: row.customerName ?? row.ownerName ?? row.supplierName ?? null,
          since: row.receivedAt,
          days: daysSince(row.receivedAt, now),
          status: t(`export_finance.collection.status.${row.collectionStatus}`, row.collectionStatus),
        })),
    [now, ordersQuery.data, t],
  )

  // Both sections are cut at the same size; saying so beats silently hiding row 101.
  const containersCapped = (containersQuery.data?.total ?? 0) > containerRows.length
  const ordersCapped = (ordersQuery.data?.total ?? 0) > orderRows.length

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">{t('export_finance.overdue.page.title', '逾期清单')}</h1>
        <p className="text-sm text-muted-foreground">
          {t(
            'export_finance.overdue.page.description',
            '钱还没有到位、而且已经等了太久的单据。判定规则与「柜档案 / 订单档案」的逾期标记完全同一份（见规格 Phase 2·C），本页只做汇总。',
          )}
        </p>
      </header>

      {canReadCabinets ? (
        <>
          <WorklistSection
            title={t('export_finance.overdue.section.refunds', '退税逾期（柜）')}
            rows={containerRows}
            emptyLabel={
              containersQuery.isLoading
                ? t('ui.common.loading', '载入中…')
                : t('export_finance.overdue.section.refunds.empty', '当前没有退税逾期的柜。')
            }
            ageLabel={t('export_finance.overdue.age', '已等待')}
            daySuffix={t('export_finance.overdue.days', '天')}
            isLoading={containersQuery.isLoading}
            errorLabel={containersQuery.isError ? t('export_finance.overdue.loadFailed', '载入失败，请稍后重试。') : null}
          />
          {containersCapped ? (
            <p className="text-sm text-muted-foreground">
              {t('export_finance.overdue.capped', '仅显示最旧的一部分，全部逾期项请到柜档案按逾期列查看。')}
            </p>
          ) : null}
        </>
      ) : null}

      <WorklistSection
        title={t('export_finance.overdue.section.collections', '收款逾期（订单）')}
        rows={orderRows}
        emptyLabel={
          ordersQuery.isLoading
            ? t('ui.common.loading', '载入中…')
            : t('export_finance.overdue.section.collections.empty', '当前没有收款逾期的订单。')
        }
        ageLabel={t('export_finance.overdue.age', '已等待')}
        daySuffix={t('export_finance.overdue.days', '天')}
        isLoading={ordersQuery.isLoading}
        errorLabel={ordersQuery.isError ? t('export_finance.overdue.loadFailed', '载入失败，请稍后重试。') : null}
      />
      {ordersCapped ? (
        <p className="text-sm text-muted-foreground">
          {t('export_finance.overdue.capped', '仅显示最旧的一部分，全部逾期项请到柜档案按逾期列查看。')}
        </p>
      ) : null}
    </div>
  )
}
