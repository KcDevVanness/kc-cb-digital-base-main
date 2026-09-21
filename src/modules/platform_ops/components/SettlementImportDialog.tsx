"use client"

import * as React from 'react'
import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import {
  CrudForm,
  type CrudField,
  type CrudFieldOption,
} from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { createCrud, fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { formatDisplayDate, toUtcDateInputValue } from '@open-mercato/ui/primitives/date-format'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'

/**
 * This file owns the settlement contract shared by the settlements list, the settlement detail
 * page and the reconciliation queue: the API paths, the record shapes their routes project, the
 * status vocabulary, the money/date renderers and the channel option loader. The three of them
 * import from here instead of each re-declaring the same endpoint and the same projection, so the
 * value the list renders and the value the import writes cannot drift apart — the same
 * arrangement `ShipmentForm.tsx` uses for the cross-border module.
 */

export const CHANNELS_API_PATH = 'platform_ops/channels'
export const SETTLEMENTS_API_PATH = 'platform_ops/settlements'
export const SETTLEMENT_LINES_API_PATH = 'platform_ops/settlements/lines'
export const SETTLEMENT_IMPORT_API_PATH = 'platform_ops/settlements/import'
export const SETTLEMENTS_LIST_HREF = '/backend/platform_ops/settlements'

const CHANNEL_OPTION_PAGE_SIZE = 100
const CHANNEL_OPTIONS_QUERY_KEY = ['platform_ops', 'channel-options'] as const
const IMPORT_ERROR_KEY = 'platform_ops.settlements.import.failed'

/** The two states the import command leaves a statement in: compared, or still owing an operator. */
export const SETTLEMENT_STATUSES = ['imported', 'reconciled'] as const
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number]

const SETTLEMENT_STATUS_MAP: StatusMap<SettlementStatus> = {
  imported: 'info',
  reconciled: 'success',
}

const SETTLEMENT_STATUS_LABEL_KEYS: Record<SettlementStatus, string> = {
  imported: 'platform_ops.settlements.status.imported',
  reconciled: 'platform_ops.settlements.status.reconciled',
}

/** A settlement as `/api/platform_ops/settlements` projects it. */
export type SettlementRecord = {
  id: string
  channelId: string
  externalSettlementId: string
  periodStart: string | null
  periodEnd: string | null
  currencyCode: string
  grossAmount: string
  feeAmount: string
  netAmount: string
  status: string
  receivedAt: string | null
}

/** One statement line as `/api/platform_ops/settlements/lines` projects it. */
export type SettlementLineRecord = {
  id: string
  settlementId: string
  externalOrderId: string
  orderMirrorId: string | null
  grossAmount: string
  feeAmount: string
  netAmount: string
}

/** What `platform_ops.settlements.import` reports back about the statement it compared. */
export type SettlementImportCounts = {
  lines: number
  raised: number
  linked: number
}

type SettlementImportResponse = {
  ok?: boolean
  settlementId?: string
  lines?: number
  raised?: number
  linked?: number
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

export function toSettlementRecord(item: Record<string, unknown>): SettlementRecord {
  return {
    id: readText(item, 'id'),
    channelId: readText(item, 'channelId', 'channel_id'),
    externalSettlementId: readText(item, 'externalSettlementId', 'external_settlement_id'),
    periodStart: readOptionalText(item, 'periodStart', 'period_start'),
    periodEnd: readOptionalText(item, 'periodEnd', 'period_end'),
    currencyCode: readText(item, 'currencyCode', 'currency_code') || 'USD',
    grossAmount: readText(item, 'grossAmount', 'gross_amount') || '0',
    feeAmount: readText(item, 'feeAmount', 'fee_amount') || '0',
    netAmount: readText(item, 'netAmount', 'net_amount') || '0',
    status: readText(item, 'status') || 'imported',
    receivedAt: readOptionalText(item, 'receivedAt', 'received_at'),
  }
}

export function toSettlementLineRecord(item: Record<string, unknown>): SettlementLineRecord {
  return {
    id: readText(item, 'id'),
    settlementId: readText(item, 'settlementId', 'settlement_id'),
    externalOrderId: readText(item, 'externalOrderId', 'external_order_id'),
    orderMirrorId: readOptionalText(item, 'orderMirrorId', 'order_mirror_id'),
    grossAmount: readText(item, 'grossAmount', 'gross_amount') || '0',
    feeAmount: readText(item, 'feeAmount', 'fee_amount') || '0',
    netAmount: readText(item, 'netAmount', 'net_amount') || '0',
  }
}

/** Renders a stored decimal as a currency amount, falling back to a plain code + number. */
export function formatSettlementMoney(value: string | number, currencyCode: string, locale?: string): string {
  const numeric = typeof value === 'number' ? value : Number(value)
  const code = currencyCode.trim().toUpperCase()
  if (!Number.isFinite(numeric)) return String(value)
  if (code.length !== 3) return numeric.toFixed(2)
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(numeric)
  } catch {
    return `${code} ${numeric.toFixed(2)}`
  }
}

/**
 * The statement period as one string (`2026-08-01 – 2026-08-31`), or whichever single end was
 * reported, or `null` when the platform sent neither.
 *
 * The period columns are date-only, so their days must be read back in the frame they were written
 * in — reading the stored instant locally names the previous day west of UTC.
 */
export function formatSettlementPeriod(
  periodStart: string | null,
  periodEnd: string | null,
  locale?: string,
): string | null {
  const toDayText = (value: string | null): string | null => {
    const day = toUtcDateInputValue(value)
    return day ? formatDisplayDate(day, locale) : null
  }
  const start = toDayText(periodStart)
  const end = toDayText(periodEnd)
  if (start && end) return `${start} – ${end}`
  return start ?? end
}

export function settlementErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length) return error.message
  return fallback
}

export function SettlementStatusBadge({ status }: { status: string }) {
  const t = useT()
  if (!SETTLEMENT_STATUSES.includes(status as SettlementStatus)) {
    return <StatusBadge variant="neutral">{status}</StatusBadge>
  }
  const known = status as SettlementStatus
  return (
    <StatusBadge variant={SETTLEMENT_STATUS_MAP[known]} dot>
      {t(SETTLEMENT_STATUS_LABEL_KEYS[known])}
    </StatusBadge>
  )
}

/**
 * The channels a statement can belong to, as `value`/`label` pairs for a select or a filter.
 * `query` narrows by name or code, which is how both the field and the filter search.
 */
export async function loadChannelOptions(query?: string): Promise<CrudFieldOption[]> {
  const params: Record<string, string | number> = {
    page: 1,
    pageSize: CHANNEL_OPTION_PAGE_SIZE,
    sortField: 'name',
    sortDir: 'asc',
  }
  const term = query?.trim()
  if (term) params.search = term
  const payload = await fetchCrudList<Record<string, unknown>>(CHANNELS_API_PATH, params)
  return (payload.items ?? []).map((item) => ({
    value: readText(item, 'id'),
    label: readText(item, 'name') || readText(item, 'code'),
  }))
}

/**
 * Resolves a settlement's `channelId` to the channel's name for display.
 *
 * The statement routes carry the channel's id only, so the names come from the channels list.
 * `retry: false` because the one plausible failure is a missing `platform_ops.channels.view`
 * grant, and hammering a permission error three times before falling back to the id helps
 * nobody. The map being empty is survivable: callers show the id.
 */
export function useChannelNameMap(): Map<string, string> {
  const { data } = useQuery({
    queryKey: CHANNEL_OPTIONS_QUERY_KEY,
    queryFn: () => loadChannelOptions(),
    retry: false,
  })
  return React.useMemo(() => new Map((data ?? []).map((option) => [option.value, option.label])), [data])
}

/**
 * The payload an operator pastes: the statement and its lines, exactly the shape
 * `platform_ops.settlements.import` accepts. Returns `null` for anything that cannot be that —
 * the caller turns it into one field error rather than a round trip the API would reject.
 */
function readImportPayload(payload: string): { settlement: Record<string, unknown>; lines: Record<string, unknown>[] } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  const settlement = record.settlement
  if (!settlement || typeof settlement !== 'object' || Array.isArray(settlement)) return null
  const externalSettlementId = (settlement as Record<string, unknown>).externalSettlementId
  if (typeof externalSettlementId !== 'string' || !externalSettlementId.trim().length) return null
  const rawLines = record.lines
  if (!Array.isArray(rawLines) || rawLines.length === 0) return null
  const lines = rawLines.filter(
    (line): line is Record<string, unknown> => Boolean(line) && typeof line === 'object' && !Array.isArray(line),
  )
  if (lines.length !== rawLines.length) return null
  return { settlement: settlement as Record<string, unknown>, lines }
}

/** A sample of the accepted shape; JSON, not prose, so it carries no copy of its own. */
const IMPORT_PAYLOAD_PLACEHOLDER = `{
  "settlement": {
    "externalSettlementId": "STL-2026-08",
    "periodStart": "2026-08-01",
    "periodEnd": "2026-08-31",
    "currencyCode": "USD",
    "grossAmount": 12800,
    "feeAmount": 384,
    "netAmount": 12416
  },
  "lines": [
    { "externalOrderId": "ORD-1001", "grossAmount": 120, "feeAmount": 3.6 }
  ]
}`

type SettlementImportFormValues = {
  channelId: string
  payload: string
}

const EMPTY_IMPORT_VALUES: SettlementImportFormValues = { channelId: '', payload: '' }

const importSchema = z.object({
  channelId: z.string().trim().min(1, IMPORT_ERROR_KEY),
  payload: z
    .string()
    .trim()
    .min(1, IMPORT_ERROR_KEY)
    .refine((value) => readImportPayload(value) !== null, IMPORT_ERROR_KEY),
})

function readImportCounts(result: SettlementImportResponse | null): SettlementImportCounts {
  const toCount = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  return {
    lines: toCount(result?.lines),
    raised: toCount(result?.raised),
    linked: toCount(result?.linked),
  }
}

/**
 * The counts are the whole point of this confirmation — "imported" alone cannot tell an operator
 * whether the statement balanced — so they ride along whenever the shipped copy has no slot to
 * put them in.
 */
function settlementImportSummary(t: TranslateFn, counts: SettlementImportCounts): string {
  const message = t('platform_ops.settlements.import.succeeded', { ...counts })
  return /\{(?:lines|raised|linked)\}/.test(message)
    ? message
    : `${message} · ${counts.lines} / ${counts.raised} / ${counts.linked}`
}

export type SettlementImportDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after the statement landed, so the host list refetches. */
  onImported?: () => void | Promise<void>
}

export default function SettlementImportDialog({
  open,
  onOpenChange,
  onImported,
}: SettlementImportDialogProps) {
  const t = useT()
  const contentRef = React.useRef<HTMLDivElement | null>(null)

  const mutationContextId = React.useMemo(() => 'platform_ops.settlement-import', [])
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId?: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: mutationContextId })

  const mutationContext = React.useMemo(() => ({
    formId: mutationContextId,
    resourceKind: 'platform_ops.settlement',
    retryLastMutation,
  }), [mutationContextId, retryLastMutation])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'channelId',
      label: t('platform_ops.settlements.import.channel'),
      type: 'select',
      required: true,
      loadOptions: loadChannelOptions,
    },
    {
      id: 'payload',
      label: t('platform_ops.settlements.import.payload'),
      type: 'textarea',
      required: true,
      rows: 12,
      placeholder: IMPORT_PAYLOAD_PLACEHOLDER,
    },
  ], [t])

  // Re-seeded on every open so a cancelled import does not come back half typed. The dependency is
  // deliberate and cannot be read inside the callback: CrudForm treats each new `initialValues`
  // object as a fresh baseline, so without the memo the operator's paste would be wiped on render.
  const initialValues = React.useMemo<SettlementImportFormValues>(
    () => ({ ...EMPTY_IMPORT_VALUES }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate re-seed on dialog open
    [open],
  )

  const handleSubmit = React.useCallback(async (values: SettlementImportFormValues) => {
    const parsed = readImportPayload(values.payload)
    if (!parsed) {
      flash(t(IMPORT_ERROR_KEY), 'error')
      return
    }
    const body = {
      channelId: values.channelId,
      settlement: parsed.settlement,
      lines: parsed.lines,
    }
    try {
      const call = await runMutation({
        operation: () => createCrud<SettlementImportResponse>(SETTLEMENT_IMPORT_API_PATH, body, {
          errorMessage: t(IMPORT_ERROR_KEY),
        }),
        context: mutationContext,
        mutationPayload: body,
      })
      flash(settlementImportSummary(t, readImportCounts(call.result)), 'success')
    } catch (error) {
      // The command writes the statement and its lines in one transaction, so a rejected import
      // left nothing behind and the pasted payload is safe to correct in place.
      flash(settlementErrorMessage(error, t(IMPORT_ERROR_KEY)), 'error')
      return
    }
    onOpenChange(false)
    await onImported?.()
  }, [mutationContext, onImported, onOpenChange, runMutation, t])

  const submitForm = React.useCallback(() => {
    contentRef.current?.querySelector('form')?.requestSubmit()
  }, [])
  const handleDialogKeyDown = useDialogKeyHandler({
    onConfirm: submitForm,
    onCancel: () => onOpenChange(false),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent ref={contentRef} onKeyDown={handleDialogKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('platform_ops.settlements.import.title')}</DialogTitle>
          <DialogDescription>{t('platform_ops.settlements.page.description')}</DialogDescription>
        </DialogHeader>
        <CrudForm<SettlementImportFormValues>
          embedded
          schema={importSchema}
          fields={fields}
          initialValues={initialValues}
          submitLabel={t('platform_ops.settlements.import.submit')}
          onSubmit={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}
