"use client"

import * as React from 'react'
import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { ListChecks } from 'lucide-react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import {
  CrudForm,
  type CrudField,
} from '@open-mercato/ui/backend/CrudForm'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { createCrud, fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useLocale, useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import {
  formatSettlementMoney,
  settlementErrorMessage,
  useChannelNameMap,
} from './SettlementImportDialog'

const PAGE_SIZE = 50
const QUERY_KEY_ROOT = 'platform-ops-reconciliation'

export const RECONCILIATION_API_PATH = 'platform_ops/reconciliation'

/** The three disagreements the import command raises, and the two decisions an operator can take. */
const RECONCILIATION_KINDS = ['missing_in_erp', 'amount_mismatch', 'duplicate_line'] as const
type ReconciliationKind = (typeof RECONCILIATION_KINDS)[number]

const RECONCILIATION_STATUSES = ['open', 'resolved', 'ignored'] as const
type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number]

type ReconciliationAction = 'resolve' | 'ignore'

const KIND_LABEL_KEYS: Record<ReconciliationKind, string> = {
  missing_in_erp: 'platform_ops.reconciliation.kind.missing_in_erp',
  amount_mismatch: 'platform_ops.reconciliation.kind.amount_mismatch',
  duplicate_line: 'platform_ops.reconciliation.kind.duplicate_line',
}

const STATUS_LABEL_KEYS: Record<ReconciliationStatus, string> = {
  open: 'platform_ops.reconciliation.status.open',
  resolved: 'platform_ops.reconciliation.status.resolved',
  ignored: 'platform_ops.reconciliation.status.ignored',
}

const STATUS_VARIANTS: StatusMap<ReconciliationStatus> = {
  open: 'warning',
  resolved: 'success',
  ignored: 'neutral',
}

const ACTION_PATHS: Record<ReconciliationAction, string> = {
  resolve: `${RECONCILIATION_API_PATH}/resolve`,
  ignore: `${RECONCILIATION_API_PATH}/ignore`,
}

const ACTION_LABEL_KEYS: Record<ReconciliationAction, string> = {
  resolve: 'platform_ops.reconciliation.actions.resolve',
  ignore: 'platform_ops.reconciliation.actions.ignore',
}

const ACTION_TITLE_KEYS: Record<ReconciliationAction, string> = {
  resolve: 'platform_ops.reconciliation.dialog.resolveTitle',
  ignore: 'platform_ops.reconciliation.dialog.ignoreTitle',
}

const ACTION_SUCCESS_KEYS: Record<ReconciliationAction, string> = {
  resolve: 'platform_ops.reconciliation.resolved',
  ignore: 'platform_ops.reconciliation.ignored',
}

const ACTION_FAILED_KEY = 'platform_ops.reconciliation.actionFailed'

/** A disagreement as `/api/platform_ops/reconciliation` projects it. */
type ReconciliationRecord = {
  id: string
  channelId: string
  kind: string
  externalRef: string
  settlementId: string | null
  orderMirrorId: string | null
  expectedAmount: string | null
  actualAmount: string | null
  currencyCode: string | null
  status: string
  note: string | null
  resolvedAt: string | null
}

/** A decision awaiting its note: which item, and which of the two decisions. */
type ReconciliationDecision = {
  item: ReconciliationRecord
  action: ReconciliationAction
}

function readText(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string') return value
  }
  return ''
}

function readOptionalText(source: Record<string, unknown>, ...keys: string[]): string | null {
  const value = readText(source, ...keys).trim()
  return value.length ? value : null
}

function toReconciliationRecord(item: Record<string, unknown>): ReconciliationRecord {
  return {
    id: readText(item, 'id'),
    channelId: readText(item, 'channelId', 'channel_id'),
    kind: readText(item, 'kind'),
    externalRef: readText(item, 'externalRef', 'external_ref'),
    settlementId: readOptionalText(item, 'settlementId', 'settlement_id'),
    orderMirrorId: readOptionalText(item, 'orderMirrorId', 'order_mirror_id'),
    expectedAmount: readOptionalText(item, 'expectedAmount', 'expected_amount'),
    actualAmount: readOptionalText(item, 'actualAmount', 'actual_amount'),
    currencyCode: readOptionalText(item, 'currencyCode', 'currency_code'),
    status: readText(item, 'status') || 'open',
    note: readOptionalText(item, 'note'),
    resolvedAt: readOptionalText(item, 'resolvedAt', 'resolved_at'),
  }
}

function kindLabel(t: TranslateFn, kind: string): string {
  return RECONCILIATION_KINDS.includes(kind as ReconciliationKind)
    ? t(KIND_LABEL_KEYS[kind as ReconciliationKind])
    : kind
}

function ReconciliationStatusBadge({ status }: { status: string }) {
  const t = useT()
  if (!RECONCILIATION_STATUSES.includes(status as ReconciliationStatus)) {
    return <StatusBadge variant="neutral">{status}</StatusBadge>
  }
  const known = status as ReconciliationStatus
  return (
    <StatusBadge variant={STATUS_VARIANTS[known]} dot>
      {t(STATUS_LABEL_KEYS[known])}
    </StatusBadge>
  )
}

function buildColumns(
  t: TranslateFn,
  locale: string,
  channelNames: Map<string, string>,
): ColumnDef<ReconciliationRecord>[] {
  return [
    {
      accessorKey: 'kind',
      header: t('platform_ops.reconciliation.list.columns.kind'),
      meta: { priority: 1 },
      cell: ({ row }) => kindLabel(t, row.original.kind),
    },
    {
      accessorKey: 'channelId',
      header: t('platform_ops.reconciliation.list.columns.channel'),
      enableSorting: false,
      meta: { priority: 2, truncate: true, maxWidth: 240 },
      // The queue carries the channel's id only; a viewer without `channels.view` cannot read the
      // name, so the id stands in rather than the cell going blank.
      cell: ({ row }) => channelNames.get(row.original.channelId) ?? row.original.channelId,
    },
    {
      accessorKey: 'externalRef',
      header: t('platform_ops.reconciliation.list.columns.externalRef'),
      enableSorting: false,
      meta: { priority: 3, truncate: true, maxWidth: 280 },
      cell: ({ row }) => {
        const externalRef = row.original.externalRef
        return externalRef ? externalRef : <span className="text-xs text-muted-foreground">—</span>
      },
    },
    {
      accessorKey: 'expectedAmount',
      header: t('platform_ops.reconciliation.list.columns.expected'),
      enableSorting: false,
      meta: { priority: 4 },
      // `missing_in_erp` has nothing to expect and `duplicate_line` nothing to compare against, so
      // an absent amount is the normal shape here, not a loading artefact.
      cell: ({ row }) => (
        row.original.expectedAmount === null
          ? <span className="text-xs text-muted-foreground">—</span>
          : formatSettlementMoney(row.original.expectedAmount, row.original.currencyCode ?? '', locale)
      ),
    },
    {
      accessorKey: 'actualAmount',
      header: t('platform_ops.reconciliation.list.columns.actual'),
      enableSorting: false,
      meta: { priority: 5 },
      cell: ({ row }) => (
        row.original.actualAmount === null
          ? <span className="text-xs text-muted-foreground">—</span>
          : formatSettlementMoney(row.original.actualAmount, row.original.currencyCode ?? '', locale)
      ),
    },
    {
      accessorKey: 'status',
      header: t('platform_ops.reconciliation.list.columns.status'),
      meta: { priority: 6 },
      cell: ({ row }) => <ReconciliationStatusBadge status={row.original.status} />,
    },
  ]
}

/**
 * The note dialog a decision goes through. Both decisions are recorded with a reason, so both walk
 * the same form and differ only in where they post and what they report.
 */
function ReconciliationNoteDialog({
  decision,
  onClose,
  onDecided,
}: {
  decision: ReconciliationDecision | null
  onClose: () => void
  onDecided: () => void | Promise<void>
}) {
  const t = useT()
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const action: ReconciliationAction = decision?.action ?? 'resolve'
  const itemId = decision?.item.id ?? ''

  const mutationContextId = React.useMemo(() => `platform_ops.reconciliation:${itemId}`, [itemId])
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId?: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: mutationContextId })

  const mutationContext = React.useMemo(() => ({
    formId: mutationContextId,
    resourceKind: 'platform_ops.reconciliation-item',
    resourceId: itemId,
    retryLastMutation,
  }), [itemId, mutationContextId, retryLastMutation])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'note',
      label: t('platform_ops.reconciliation.dialog.note'),
      type: 'textarea',
      required: true,
      rows: 4,
    },
  ], [t])

  const schema = React.useMemo(() => z.object({
    note: z.string().trim().min(1, 'platform_ops.reconciliation.dialog.noteRequired'),
  }), [])

  // A blank note per decision: the previous item's reasoning must never be submitted against the
  // next one just because the dialog was reopened. The dependency cannot be read inside the
  // callback — it is the identity of the decision the baseline is being reset for.
  const initialValues = React.useMemo(
    () => ({ note: '' }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate re-seed per decision
    [itemId],
  )

  const handleSubmit = React.useCallback(async (values: { note: string }) => {
    if (!decision) return
    const body = { id: decision.item.id, note: values.note.trim() }
    try {
      await runMutation({
        operation: () => createCrud(ACTION_PATHS[decision.action], body, {
          errorMessage: t(ACTION_FAILED_KEY),
        }),
        context: mutationContext,
        mutationPayload: body,
      })
    } catch (error) {
      // The item stays in the queue untouched, so the note is still there to correct and resubmit.
      flash(settlementErrorMessage(error, t(ACTION_FAILED_KEY)), 'error')
      return
    }
    flash(t(ACTION_SUCCESS_KEYS[decision.action]), 'success')
    onClose()
    await onDecided()
  }, [decision, mutationContext, onClose, onDecided, runMutation, t])

  const submitForm = React.useCallback(() => {
    contentRef.current?.querySelector('form')?.requestSubmit()
  }, [])
  const handleDialogKeyDown = useDialogKeyHandler({ onConfirm: submitForm, onCancel: onClose })

  return (
    <Dialog open={Boolean(decision)} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent ref={contentRef} onKeyDown={handleDialogKeyDown}>
        <DialogHeader>
          <DialogTitle>{t(ACTION_TITLE_KEYS[action])}</DialogTitle>
          {/* The disagreement itself is the dialog's subject: the operator decides on a specific
              order reference, not on the queue in general. */}
          <DialogDescription>
            {decision ? `${kindLabel(t, decision.item.kind)} · ${decision.item.externalRef}` : ''}
          </DialogDescription>
        </DialogHeader>
        {decision ? (
          <CrudForm<{ note: string }>
            embedded
            schema={schema}
            fields={fields}
            initialValues={initialValues}
            submitLabel={t('platform_ops.reconciliation.dialog.confirm')}
            onSubmit={handleSubmit}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

export default function ReconciliationTable() {
  const t = useT()
  const locale = useLocale()
  const scopeVersion = useOrganizationScopeVersion()
  const channelNames = useChannelNameMap()
  const [kind, setKind] = React.useState('')
  // The queue is worked from its open end: the route defaults to `open` as well, so the list state
  // and the request agree from the first render.
  const [status, setStatus] = React.useState<ReconciliationStatus>('open')
  const [page, setPage] = React.useState(1)
  const [decision, setDecision] = React.useState<ReconciliationDecision | null>(null)

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      status,
    })
    if (kind) params.set('kind', kind)
    return params
  }, [kind, page, status])

  const queryKey = React.useMemo(
    () => [QUERY_KEY_ROOT, queryParams.toString(), scopeVersion],
    [queryParams, scopeVersion],
  )

  const columns = React.useMemo(() => buildColumns(t, locale, channelNames), [channelNames, locale, t])

  const { data, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>(
        RECONCILIATION_API_PATH,
        Object.fromEntries(queryParams),
      )
      return { ...payload, items: (payload.items ?? []).map(toReconciliationRecord) }
    },
  })

  // A resolved or ignored item leaves the open queue by design, so the count the footer shows is
  // the queue's, not the table's.
  const rows = data?.items ?? []
  const total = data?.total ?? 0
  const listError = error
    ? (error instanceof Error && error.message ? error.message : t('ui.errors.defaultMessage'))
    : null

  return (
    <>
      <DataTable<ReconciliationRecord>
        title={(
          <div className="flex flex-col gap-1">
            <h1 className="text-base font-semibold leading-tight">{t('platform_ops.reconciliation.page.title')}</h1>
            <p className="text-sm font-normal text-muted-foreground">{t('platform_ops.reconciliation.page.description')}</p>
          </div>
        )}
        columns={columns}
        data={rows}
        filters={[
          {
            id: 'kind',
            label: t('platform_ops.reconciliation.list.columns.kind'),
            type: 'select',
            options: RECONCILIATION_KINDS.map((value) => ({ value, label: t(KIND_LABEL_KEYS[value]) })),
          },
          {
            id: 'status',
            label: t('platform_ops.reconciliation.list.columns.status'),
            type: 'select',
            options: RECONCILIATION_STATUSES.map((value) => ({ value, label: t(STATUS_LABEL_KEYS[value]) })),
          },
        ]}
        filterValues={kind ? { kind, status } : { status }}
        onFiltersApply={(values: FilterValues) => {
          const nextKind = values.kind
          const nextStatus = values.status
          setKind(typeof nextKind === 'string' ? nextKind : '')
          setStatus(
            typeof nextStatus === 'string' && RECONCILIATION_STATUSES.includes(nextStatus as ReconciliationStatus)
              ? (nextStatus as ReconciliationStatus)
              : 'open',
          )
          setPage(1)
        }}
        onFiltersClear={() => {
          setKind('')
          setStatus('open')
          setPage(1)
        }}
        emptyState={(
          <ListEmptyState
            title={t('platform_ops.reconciliation.list.empty')}
            icon={<ListChecks className="size-7" aria-hidden />}
          />
        )}
        rowActions={(row) => (
          // The command rejects a second decision on an item that is no longer open, so a resolved
          // or ignored row offers none: the operator sees them only by filtering for them, and the
          // queue is where work is done.
          row.status === 'open' ? (
            <RowActions
              items={(['resolve', 'ignore'] as const).map((action) => ({
                id: action,
                label: t(ACTION_LABEL_KEYS[action]),
                onSelect: () => setDecision({ item: row, action }),
              }))}
            />
          ) : null
        )}
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          total,
          totalPages: total > 0 ? Math.ceil(total / PAGE_SIZE) : 0,
          onPageChange: setPage,
        }}
        isLoading={isLoading}
        error={listError}
        disableRowClick
      />

      <ReconciliationNoteDialog
        decision={decision}
        onClose={() => setDecision(null)}
        onDecided={() => { void refetch() }}
      />
    </>
  )
}
