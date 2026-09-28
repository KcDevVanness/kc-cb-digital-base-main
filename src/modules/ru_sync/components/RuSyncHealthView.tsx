"use client"

import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'

/**
 * 同步健康 — per endpoint: the snapshot date the projection carries, the watermark the next pull
 * resumes from, when it last moved, and the last run's outcome. A page-level banner says whether
 * anything is stale, because "how old is this data" is the question a reader actually has.
 */

type RuEndpointStatus = 'ok' | 'stale' | 'failing' | 'never'

type RuEndpointHealth = {
  endpoint: string
  path: string
  lastAsOf: string | null
  cursor: string | null
  lastAdvancedAt: string | null
  lastRunAt: string | null
  lastRunStatus: string | null
  lastRunError: string | null
  status: RuEndpointStatus
  ageHours: number | null
}

type RuHealthResponse = {
  staleAfterHours: number
  checkedAt: string
  stale: boolean
  endpoints: RuEndpointHealth[]
}

const STATUS_VARIANTS: StatusMap<RuEndpointStatus> = {
  ok: 'success',
  stale: 'warning',
  failing: 'error',
  never: 'neutral',
}

const STATUS_LABEL_KEYS: Record<RuEndpointStatus, string> = {
  ok: 'ru_sync.health.status.ok',
  stale: 'ru_sync.health.status.stale',
  failing: 'ru_sync.health.status.failing',
  never: 'ru_sync.health.status.never',
}

function columns(t: TranslateFn): ColumnDef<RuEndpointHealth>[] {
  return [
    {
      accessorKey: 'endpoint',
      header: t('ru_sync.health.columns.endpoint'),
      meta: { priority: 1 },
      cell: ({ row }) => (
        <span className="font-medium">{t(`ru_sync.endpoint.${row.original.endpoint}`)}</span>
      ),
    },
    {
      accessorKey: 'status',
      header: t('ru_sync.health.columns.status'),
      meta: { priority: 2 },
      cell: ({ row }) => (
        <StatusBadge variant={STATUS_VARIANTS[row.original.status]} dot>
          {t(STATUS_LABEL_KEYS[row.original.status])}
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'lastAsOf',
      header: t('ru_sync.health.columns.lastAsOf'),
      enableSorting: false,
      meta: { priority: 3 },
      cell: ({ row }) => <span className="tabular-nums">{row.original.lastAsOf ?? '—'}</span>,
    },
    {
      accessorKey: 'ageHours',
      header: t('ru_sync.health.columns.age'),
      enableSorting: false,
      meta: { priority: 4, align: 'right' },
      cell: ({ row }) => (
        <span className="tabular-nums">
          {row.original.ageHours === null ? '—' : `${row.original.ageHours} h`}
        </span>
      ),
    },
    {
      accessorKey: 'cursor',
      header: t('ru_sync.health.columns.cursor'),
      enableSorting: false,
      meta: { priority: 5, truncate: true, maxWidth: 240 },
      cell: ({ row }) => <span className="text-xs tabular-nums">{row.original.cursor ?? '—'}</span>,
    },
    {
      accessorKey: 'lastRunStatus',
      header: t('ru_sync.health.columns.lastRun'),
      enableSorting: false,
      meta: { priority: 6, truncate: true, maxWidth: 260 },
      cell: ({ row }) => (
        <span className="text-xs">
          {row.original.lastRunStatus
            ? `${row.original.lastRunStatus}${row.original.lastRunError ? ` — ${row.original.lastRunError}` : ''}`
            : '—'}
        </span>
      ),
    },
  ]
}

export default function RuSyncHealthView() {
  const t = useT()
  const [data, setData] = React.useState<RuHealthResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const call = await apiCall<RuHealthResponse>('/api/ru_sync/health')
        if (!call.ok || !call.result) throw new Error(t('ru_sync.health.loadFailed'))
        if (!cancelled) setData(call.result)
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error && loadError.message ? loadError.message : t('ru_sync.health.loadFailed'))
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-base font-semibold leading-tight">{t('ru_sync.health.page.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('ru_sync.health.page.description')}</p>
      </div>

      {error ? <ErrorMessage label={error} /> : null}
      {loading ? <LoadingMessage label={t('ru_sync.health.loading')} /> : null}

      {!loading && !error && data ? (
        <>
          {data.stale ? (
            <Alert variant="warning">
              {t('ru_sync.health.alert.stale', { hours: String(data.staleAfterHours) })}
            </Alert>
          ) : null}

          <DataTable<RuEndpointHealth>
            title={t('ru_sync.health.section.endpoints')}
            columns={columnDefs}
            data={data.endpoints}
            entityId="ru_sync:ru_sync_snapshot"
            extensionTableId="ru_sync.health.endpoints"
            embedded
          />
        </>
      ) : null}
    </div>
  )
}
