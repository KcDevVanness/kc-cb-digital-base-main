"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { FieldLabel } from '@open-mercato/ui/primitives/label'
import { Input } from '@open-mercato/ui/primitives/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { formatDate } from '@open-mercato/ui/utils/format'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { usePathname } from 'next/navigation'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { useLocale, useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { createDictionaryMap, DictionaryValue, type DictionaryMap } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { MoneyAmount } from '@/lib/money/MoneyAmount'
import {
  SALES_STATUS_CANCELED,
  SALES_STATUS_CONFIRMED,
  SALES_STATUS_SENT,
  isQuoteExpired,
  salesStatusActions,
} from '../lib/salesStatus'
import { useSalesStatusEntries } from '../lib/salesStatusEntries'
import type { InternalSalesKind } from './InternalSalesForm'
import { useTradeTypeChannels } from '../lib/tradeTypeChannels'
import {
  channelIdForTradeType,
  tradeTypeFromPathname,
} from '../lib/tradeType'
import { documentEditHrefForTradeType, listHrefForTradeType } from './InternalSalesForm'

/**
 * App-owned list for the internal-sales documents.
 *
 * The installed lists are the platform's own view; this one belongs to the module so the whole
 * flow — list, create, edit — stays inside the app-owned surface. It reads the installed list API,
 * which already projects the document head (number, currency, totals, customer snapshot), and its
 * row action opens this module's own edit page. The entry (internal or external) is its trade type:
 * the list is always filtered by that type's channel, so every row carries the same marker and no
 * Type column is needed.
 */

const PAGE_SIZE = 50

type DocumentRecord = {
  id: string
  number: string | null
  currencyCode: string
  total: string
  customerName: string | null
  /** The buyer address `quotes/send` needs; the list carries the snapshot, so the dialog can pre-check. */
  buyerEmail: string | null
  status: string | null
  /** Quote only: the deadline `quotes/send` wrote (ISO date, `null` when never sent). */
  validUntil: string | null
  /** Carried for the optimistic lock every status write sends (`buildOptimisticLockHeader`). */
  updatedAt: string | null
  lineItemCount: number
  createdAt: string | null
}

function readText(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string') return value
  }
  return ''
}

function toDocumentRecord(item: Record<string, unknown>, kind: InternalSalesKind): DocumentRecord {
  const snapshot = item.customerSnapshot ?? item.customer_snapshot
  const customerName = snapshot && typeof snapshot === 'object'
    ? readText(snapshot as Record<string, unknown>, 'name') || null
    : null
  // The same two keys the engine's `resolveQuoteEmail` reads, so the dialog can block a send the
  // route would refuse anyway (and say why) instead of letting the operator discover it by 400.
  const snapshotRecord = snapshot && typeof snapshot === 'object' ? snapshot as Record<string, unknown> : null
  const contact = snapshotRecord?.contact
  const customer = snapshotRecord?.customer
  const metadata = item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
    ? item.metadata as Record<string, unknown>
    : null
  const buyerEmail = (contact && typeof contact === 'object' && !Array.isArray(contact)
    ? readText(contact as Record<string, unknown>, 'email')
    : '')
    || (customer && typeof customer === 'object' && !Array.isArray(customer)
      ? readText(customer as Record<string, unknown>, 'primaryEmail')
      : '')
    // Third key of the engine's own resolution chain (`resolveQuoteEmail`): an address another
    // surface may have frozen into the document metadata.
    || (metadata ? readText(metadata, 'customerEmail') : '')
  const total = item.grandTotalNetAmount ?? item.grand_total_net_amount ?? item.grandTotalGrossAmount
  return {
    id: String(item.id),
    number: readText(item, kind === 'quote' ? 'quoteNumber' : 'orderNumber') || null,
    currencyCode: readText(item, 'currencyCode', 'currency_code') || 'CNY',
    total: typeof total === 'number' ? String(total) : typeof total === 'string' ? total : '0',
    customerName,
    buyerEmail: buyerEmail || null,
    status: readText(item, 'status') || null,
    validUntil: readText(item, 'validUntil', 'valid_until') || null,
    updatedAt: readText(item, 'updatedAt', 'updated_at') || null,
    lineItemCount: Number(item.lineItemCount ?? item.line_item_count ?? 0),
    createdAt: (item.createdAt ?? item.created_at ?? null) as string | null,
  }
}

/**
 * The quote's validity cell: the deadline `quotes/send` wrote, and — when it has passed while the
 * quote is still `sent` — the date in the destructive tone with an "expired" chip, so nobody has to
 * open the document to spot a stale quote.
 */
function quoteValidityLabel(record: DocumentRecord, locale: string, t: TranslateFn): React.ReactNode {
  // The engine's sent→draft revoke clears the token but leaves `valid_until` behind, so only a
  // quote that is still sent has a meaningful deadline.
  if (record.status !== SALES_STATUS_SENT || !record.validUntil) {
    return <span className="text-xs text-muted-foreground">—</span>
  }
  const formatted = formatDate(record.validUntil, locale)
  if (!isQuoteExpired(record.status, record.validUntil)) return <span>{formatted}</span>
  return (
    <span className="inline-flex items-center gap-1.5 text-destructive">
      {formatted}
      <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-xs font-medium">
        {t('internal_sales.list.quoteExpired', 'Expired')}
      </span>
    </span>
  )
}

function buildColumns(
  t: TranslateFn,
  locale: string,
  kind: InternalSalesKind,
  statusMap: DictionaryMap | null,
): ColumnDef<DocumentRecord>[] {
  return [
    {
      accessorKey: 'number',
      header: t(kind === 'quote' ? 'internal_sales.list.columns.quoteNumber' : 'internal_sales.list.columns.orderNumber'),
      cell: ({ row }) => row.original.number ?? <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      accessorKey: 'customerName',
      header: t('internal_sales.list.columns.customer'),
      enableSorting: false,
      meta: { truncate: true, maxWidth: 280 },
      cell: ({ row }) => row.original.customerName ?? <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      accessorKey: 'status',
      header: t('internal_sales.list.columns.status'),
      enableSorting: false,
      cell: ({ row }) => (
        <DictionaryValue
          value={row.original.status}
          map={statusMap}
          fallback={<span className="text-xs text-muted-foreground">—</span>}
          colorClassName="h-3 w-3 rounded-full"
        />
      ),
    },
    ...(kind === 'quote'
      ? [{
          accessorKey: 'validUntil' as const,
          header: t('internal_sales.list.columns.validUntil', 'Valid until'),
          enableSorting: false,
          cell: ({ row }: { row: { original: DocumentRecord } }) => {
            const expiry = quoteValidityLabel(row.original, locale, t)
            return expiry
          },
        }]
      : []),
    {
      accessorKey: 'total',
      header: t('internal_sales.list.columns.total'),
      enableSorting: false,
      cell: ({ row }) => (
        <MoneyAmount currencyCode={row.original.currencyCode} amount={row.original.total} />
      ),
    },
    {
      id: 'lineItemCount',
      header: t('internal_sales.list.columns.lines'),
      enableSorting: false,
      cell: ({ row }) => <span className="tabular-nums">{row.original.lineItemCount}</span>,
    },
    {
      accessorKey: 'createdAt',
      header: t('internal_sales.list.columns.createdAt'),
      enableSorting: false,
      cell: ({ row }) => formatDate(row.original.createdAt, locale) ?? '—',
    },
  ]
}

export default function InternalSalesTable({ kind }: { kind: InternalSalesKind }) {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  // One implementation, two menus: the route prefix decides which trade type this entry owns, so
  // the external pages can be plain re-exports of the internal ones. An entry lists its own type
  // only — the server-side `channelId` filter is what keeps the other type, and every document
  // written before the marker existed, out of it.
  const entryTradeType = tradeTypeFromPathname(pathname)
  const external = entryTradeType === 'external'
  const { channels, isLoading: channelsLoading, missingMessage: missingChannelMessage } = useTradeTypeChannels(kind)
  const entryChannelId = channelIdForTradeType(entryTradeType, channels)
  const scopeVersion = useOrganizationScopeVersion()
  const [search, setSearch] = React.useState('')
  const [page, setPage] = React.useState(1)
  /** The quote awaiting the "send" dialog, and the validity the operator picked (platform caps 1–365). */
  const [sendTarget, setSendTarget] = React.useState<DocumentRecord | null>(null)
  const [sendValidDays, setSendValidDays] = React.useState(14)
  const [sendBusy, setSendBusy] = React.useState(false)
  // Create/edit are gated server-side by the document's manage feature; hide the controls from a
  // read-only operator (same pattern as the products list and the purchasing supplier library).
  // Nothing is hidden while the chrome payload loads, so a permitted operator never sees flicker.
  const { payload: chromePayload, isReady: chromeReady } = useBackendChrome()
  const manageFeature = kind === 'quote' ? 'sales.quotes.manage' : 'sales.orders.manage'
  const canManage = !chromeReady || hasFeature(chromePayload?.grantedFeatures, manageFeature)
  // Both quote→order actions write an order (convert converts the quote in place; the loader
  // creates a new one), so both need the order's manage feature on top of the quote's: hide them
  // from an operator who holds only one of the two.
  const canOrderFromQuote = kind === 'quote'
    && canManage
    && (!chromeReady || hasFeature(chromePayload?.grantedFeatures, 'sales.orders.manage'))

  const listHref = listHrefForTradeType(kind, entryTradeType)
  const ordersCreateHref = `${listHrefForTradeType('order', entryTradeType)}/create`
  const apiPath = kind === 'quote' ? 'sales/quotes' : 'sales/orders'

  const queryKey = React.useMemo(
    () => [`internal-sales-${kind}`, entryTradeType, entryChannelId ?? '', page, search, scopeVersion],
    [entryChannelId, entryTradeType, kind, page, scopeVersion, search],
  )

  const { data, isLoading, error } = useQuery({
    queryKey,
    // No channel, no list: without the marker the filter cannot be expressed, and showing every
    // document instead would mix the two types in a type-specific entry (and there is nothing to
    // tell them apart with, since the Type column is gone). The unseeded state is reported below
    // with the command that fixes it, exactly like the form blocks its save.
    enabled: entryChannelId !== null,
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), sortField: 'created_at', sortDir: 'desc' })
      const term = search.trim()
      if (term) params.set('search', term)
      // The engine's own server-side filter: the other trade type never appears here.
      if (entryChannelId) params.set('channelId', entryChannelId)
      // Documents that predate the marker carry no channel at all: neither entry lists them, so the
      // hint above the table reports how many the backfill still has to classify.
      const probe = await fetchCrudList<Record<string, unknown>>(apiPath, {
        channelIdsEmpty: 'true',
        pageSize: 1,
      })
      const unmarkedCount = Number.isFinite(probe.total) ? probe.total : 0
      const payload = await fetchCrudList<Record<string, unknown>>(apiPath, Object.fromEntries(params))
      return {
        ...payload,
        unmarkedCount,
        items: (payload.items ?? []).map((item) => toDocumentRecord(item, kind)),
      }
    },
  })

  const rows = data?.items ?? []
  const listError = error
    ? (error instanceof Error && error.message ? error.message : t('internal_sales.form.loadFailed'))
    : null
  const channelError = !channelsLoading && entryChannelId === null ? missingChannelMessage : null
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  /**
   * Converts the quote into an order through the engine's own route.
   *
   * The engine converts **in place**: the document keeps its id, its lines and its buyer snapshot
   * and comes back as an order with a new number, so the quote stops existing. That is why the
   * confirm dialog spells the irreversibility out, why the list is invalidated afterwards (the row
   * would otherwise still be listed as a quote), and why the redirect goes to this module's *order*
   * edit page for the returned id.
   */
  const handleConvertToOrder = React.useCallback(async (row: DocumentRecord) => {
    const confirmed = await confirm({
      title: t('internal_sales.list.actions.convertConfirmTitle'),
      description: t('internal_sales.list.actions.convertConfirmBody'),
      confirmText: t('internal_sales.list.actions.convert'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      const result = await readApiResultOrThrow<{ orderId?: string }>(
        '/api/sales/quotes/convert',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ quoteId: row.id }),
        },
        { errorMessage: t('internal_sales.list.actions.convertFailed') },
      )
      const orderId = typeof result?.orderId === 'string' && result.orderId ? result.orderId : row.id
      flash(t('internal_sales.list.actions.convertDone'), 'success')
      await queryClient.invalidateQueries({ queryKey })
      // The converted document is an order now, so it opens on this module's order edit page —
      // built from the shared helper rather than by hand, so a route move cannot drift here.
      router.push(documentEditHrefForTradeType('order', orderId, entryTradeType))
    } catch (conversionError) {
      const message = conversionError instanceof Error && conversionError.message
        ? conversionError.message
        : t('internal_sales.list.actions.convertFailed')
      flash(message, 'error')
    }
  }, [confirm, entryTradeType, queryClient, queryKey, router, t])
  // Statuses are the tenant's own dictionary, so the column resolves labels from it rather than
  // hard-coding the seeded values, and every status write resolves its entry id here. An
  // unreadable dictionary degrades to a dash / raw code and leaves the status actions disabled.
  const { entries: salesStatusEntries, entryIdFor } = useSalesStatusEntries()
  const statusMap = React.useMemo(
    () => (salesStatusEntries.length > 0 ? createDictionaryMap(salesStatusEntries) : null),
    [salesStatusEntries],
  )
  /**
   * Writes one status transition through the engine's own document update, then **verifies** it.
   *
   * The engine takes a dictionary **entry id** (`statusEntryId`), resolves the value itself, keeps
   * the change trail and — for orders moving to `confirmed`/`canceled` — emits
   * `sales.order.confirmed` / `sales.order.cancelled`. The row's `updatedAt` rides along as the
   * optimistic lock, so a document somebody else touched in the meantime answers 409 instead of
   * being overwritten.
   *
   * Two engine rules shape the write:
   *
   * - **Any update of a `sent` quote resets it to `draft` and clears the acceptance token**
   *   (`sales/commands/documents.js`: `shouldInvalidateSentToken` + the `quote.status = "draft"`
   *   block run *after* the payload is applied — a `statusEntryId` in that payload is overwritten).
   *   Canceling a sent quote therefore takes two writes: first a no-op update that performs the
   *   engine's own revoke, then the cancel on the now-draft document. The buyer's link dies with the
   *   first write, which is exactly what canceling means.
   * - The engine may still ignore a status we asked for, so the persisted value is re-read and the
   *   operator is told what actually happened instead of a hopeful success message.
   */
  const isSendableEmail = React.useCallback(
    (value: string | null | undefined): boolean => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    [],
  )

  const applyStatus = React.useCallback(async (row: DocumentRecord, value: string): Promise<boolean> => {
    const statusEntryId = entryIdFor(value)
    if (!statusEntryId) {
      flash(t('internal_sales.list.actions.statusMissing', 'This status is not configured for your organization.'), 'error')
      return false
    }
    const write = async (entryId: string, updatedAt: string | null) => readApiResultOrThrow<{ updatedAt?: string }>(
      `/api/${apiPath}`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          ...(updatedAt ? buildOptimisticLockHeader(updatedAt) : {}),
        },
        body: JSON.stringify({ id: row.id, statusEntryId: entryId, updatedAt: updatedAt ?? null }),
      },
      { errorMessage: t('internal_sales.list.actions.statusFailed', 'Could not change the status.') },
    )
    try {
      let version = row.updatedAt
      if (kind === 'quote' && row.status === SALES_STATUS_SENT) {
        // The engine's revoke: any update of a sent quote returns it to draft and kills the link.
        const revoked = await write(statusEntryId, version)
        version = typeof revoked?.updatedAt === 'string' ? revoked.updatedAt : null
        await queryClient.invalidateQueries({ queryKey })
      }
      await write(statusEntryId, version)
      const persisted = await fetchCrudList<Record<string, unknown>>(apiPath, { id: row.id, pageSize: 1 })
      const storedStatus = readText(persisted.items?.[0] ?? {}, 'status') || null
      await queryClient.invalidateQueries({ queryKey })
      if (storedStatus !== value) {
        flash(t('internal_sales.list.actions.statusNotApplied', 'The status did not stick — please reload the list.'), 'error')
        return false
      }
      return true
    } catch (statusError) {
      if (surfaceRecordConflict(statusError, t)) {
        await queryClient.invalidateQueries({ queryKey })
        return false
      }
      const message = statusError instanceof Error && statusError.message
        ? statusError.message
        : t('internal_sales.list.actions.statusFailed', 'Could not change the status.')
      flash(message, 'error')
      return false
    }
  }, [apiPath, entryIdFor, kind, queryClient, queryKey, t])

  /** Quote only: hand the document to the engine's send route (validity, acceptance link, email). */
  const handleSendQuote = React.useCallback(async (row: DocumentRecord, validForDays: number) => {
    if (!row.buyerEmail) {
      // The engine refuses a send without an address; say it here, before a round trip.
      flash(t('internal_sales.list.actions.sendNoEmail', 'Fill in the buyer email on this quote before sending it.'), 'error')
      return
    }
    if (!isSendableEmail(row.buyerEmail)) {
      flash(t('internal_sales.list.actions.sendBadEmail', 'That buyer email does not look like an address.'), 'error')
      return
    }
    setSendBusy(true)
    try {
      await readApiResultOrThrow(
        '/api/sales/quotes/send',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ quoteId: row.id, validForDays }),
        },
        { errorMessage: t('internal_sales.list.actions.sendFailed') },
      )
      flash(t('internal_sales.list.actions.sendDone'), 'success')
      setSendTarget(null)
      await queryClient.invalidateQueries({ queryKey })
    } catch (sendError) {
      const message = sendError instanceof Error && sendError.message
        ? sendError.message
        : t('internal_sales.list.actions.sendFailed')
      flash(message, 'error')
      // The engine commits the sent state before it hands the mail to the transport, so a mail
      // failure leaves the quote marked `sent`: re-read instead of claiming nothing happened.
      await queryClient.invalidateQueries({ queryKey })
    } finally {
      setSendBusy(false)
    }
  }, [isSendableEmail, queryClient, queryKey, t])

  const handleConfirmOrder = React.useCallback(async (row: DocumentRecord) => {
    const confirmed = await confirm({
      title: t('internal_sales.list.actions.confirmConfirmTitle'),
      description: t('internal_sales.list.actions.confirmConfirmBody'),
      confirmText: t('internal_sales.list.actions.confirm'),
    })
    if (!confirmed) return
    if (await applyStatus(row, SALES_STATUS_CONFIRMED)) flash(t('internal_sales.list.actions.confirmDone'), 'success')
  }, [applyStatus, confirm, t])

  const handleCancel = React.useCallback(async (row: DocumentRecord) => {
    const confirmed = await confirm({
      title: t('internal_sales.list.actions.cancelConfirmTitle'),
      description: t('internal_sales.list.actions.cancelConfirmBody'),
      confirmText: t('internal_sales.list.actions.cancel'),
      variant: 'destructive',
    })
    if (!confirmed) return
    if (await applyStatus(row, SALES_STATUS_CANCELED)) flash(t('internal_sales.list.actions.cancelDone'), 'success')
  }, [applyStatus, confirm, t])

  const unmarkedCount = data?.unmarkedCount ?? 0
  const columns = React.useMemo(
    () => buildColumns(t, locale, kind, statusMap),
    [kind, locale, statusMap, t],
  )
  const titleKey = kind === 'quote'
    ? (external ? 'internal_sales.list.externalQuote.title' : 'internal_sales.list.quote.title')
    : (external ? 'internal_sales.list.externalOrder.title' : 'internal_sales.list.order.title')
  const descriptionKey = kind === 'quote'
    ? (external ? 'internal_sales.list.externalQuote.description' : 'internal_sales.list.quote.description')
    : (external ? 'internal_sales.list.externalOrder.description' : 'internal_sales.list.order.description')
  const createTitleKey = kind === 'quote'
    ? (external ? 'internal_sales.form.externalQuote.createTitle' : 'internal_sales.form.quote.createTitle')
    : (external ? 'internal_sales.form.externalOrder.createTitle' : 'internal_sales.form.order.createTitle')
  const emptyKey = kind === 'quote'
    ? (external ? 'internal_sales.list.externalQuote.empty' : 'internal_sales.list.quote.empty')
    : (external ? 'internal_sales.list.externalOrder.empty' : 'internal_sales.list.order.empty')

  return (
    <>
      {unmarkedCount > 0 ? (
        <p className="mb-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {t(
            'internal_sales.list.unmarkedHintFiltered',
            'This organization has {{count}} document(s) with no trade-type marker, so neither sales entry lists them. The backfill command (yarn mercato internal_sales backfill-trade-type --apply) classifies the ones with a buyer link; the rest must be saved one by one from the entry that owns them.',
            { count: unmarkedCount },
          )}
        </p>
      ) : null}
      <DataTable<DocumentRecord>
        title={(
          <div className="flex flex-col gap-1">
            <h1 className="text-base font-semibold leading-tight">
              {t(titleKey)}
            </h1>
            <p className="text-sm font-normal text-muted-foreground">
              {t(descriptionKey)}
            </p>
          </div>
        )}
        columns={columns}
        data={rows}
        actions={(
          canManage ? (
            <Button asChild>
              <Link href={`${listHref}/create`}>
                {t(createTitleKey)}
              </Link>
            </Button>
          ) : null
        )}
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPage(1)
        }}
        searchPlaceholder={t('internal_sales.list.searchPlaceholder')}
        searchAlign="right"
        emptyState={(
          <ListEmptyState
            title={t(emptyKey)}
            {...(canManage
              ? {
                  createHref: `${listHref}/create`,
                  createLabel: t(createTitleKey),
                }
              : {})}
          />
      )}
      rowActions={(row) => {
        // Everything the row offers is derived from its status (`lib/salesStatus.ts`): a draft
        // quote cannot be ordered, a canceled document offers neither send nor order nor edit, and
        // an order can only be confirmed while it is a draft. Legacy rows carry `null` and keep
        // their actions — see `salesStatusActions`.
        const allowed = salesStatusActions(kind === 'quote' ? 'quote' : 'order', row.status)
        return (
          <RowActions
            items={[
              ...(canManage && allowed.canEdit
                ? [{ id: 'edit', label: t('internal_sales.list.actions.edit'), href: `${listHref}/${row.id}/edit` }]
                : []),
              ...(canManage && kind === 'quote' && allowed.canSend
                ? [{
                    id: 'send-quote',
                    label: row.status === SALES_STATUS_SENT
                      ? t('internal_sales.list.actions.resend')
                      : t('internal_sales.list.actions.send'),
                    onSelect: () => { setSendTarget(row); setSendValidDays(14) },
                  }]
                : []),
              ...(canManage && kind === 'order' && allowed.canConfirm
                ? [{
                    id: 'confirm-order',
                    label: t('internal_sales.list.actions.confirm'),
                    onSelect: () => { void handleConfirmOrder(row) },
                  }]
                : []),
              ...(canOrderFromQuote && allowed.canOrderFrom
                ? [
                    {
                      id: 'new-order-from-quote',
                      label: t('internal_sales.list.actions.newOrderFromQuote'),
                      href: `${ordersCreateHref}?fromQuote=${row.id}`,
                    },
                    {
                      id: 'convert-to-order',
                      label: t('internal_sales.list.actions.convert'),
                      onSelect: () => { void handleConvertToOrder(row) },
                    },
                  ]
                : []),
              ...(canManage && allowed.canCancel
                ? [{
                    id: 'cancel-document',
                    label: t('internal_sales.list.actions.cancel'),
                    onSelect: () => { void handleCancel(row) },
                  }]
                : []),
            ]}
          />
        )
      }}
      pagination={{
        page,
        pageSize: PAGE_SIZE,
        total: data?.total ?? 0,
        totalPages: data?.totalPages ?? 0,
        totalIsCapped: data?.totalIsCapped === true,
        onPageChange: setPage,
      }}
        isLoading={isLoading || channelsLoading}
        error={listError ?? channelError}
        onRowClick={(row) => router.push(`${listHref}/${row.id}/edit`)}
      />
      {ConfirmDialogElement}
      {/* Sending is the engine's own quote route: it stamps `sent`, writes the validity deadline,
          mints the acceptance link and mails it to the buyer — the dialog only asks how long the
          offer stands. */}
      <Dialog
        open={sendTarget !== null}
        onOpenChange={(next) => { if (!next && !sendBusy) setSendTarget(null) }}
      >
        <DialogContent
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && sendTarget && !sendBusy) {
              event.preventDefault()
              void handleSendQuote(sendTarget, sendValidDays)
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('internal_sales.list.actions.sendDialogTitle', 'Send this quote to the buyer')}</DialogTitle>
            <DialogDescription>
              {t(
                'internal_sales.list.actions.sendDialogBody',
                'The quote is marked as sent, gets an acceptance link for the buyer and an email is queued. Editing the quote afterwards returns it to draft and invalidates the link.',
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <FieldLabel htmlFor="send-valid-days">
                {t('internal_sales.list.actions.sendValidDays', 'Valid for (days)')}
              </FieldLabel>
              <Input
                id="send-valid-days"
                type="number"
                min={1}
                max={365}
                value={String(sendValidDays)}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.target.value, 10)
                  setSendValidDays(Number.isFinite(parsed) ? Math.min(365, Math.max(1, parsed)) : 14)
                }}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {sendTarget && !sendTarget.buyerEmail
                ? t(
                    'internal_sales.list.actions.sendNoEmail',
                    'Fill in the buyer email on this quote before sending it.',
                  )
                : sendTarget && !isSendableEmail(sendTarget.buyerEmail)
                  ? t('internal_sales.list.actions.sendBadEmail', 'That buyer email does not look like an address.')
                  : t(
                      'internal_sales.list.actions.sendEmailHint',
                      'The buyer email comes from the quote’s buyer field (Client email); fill it on the quote before sending.',
                    )}
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setSendTarget(null)} disabled={sendBusy}>
              {t('ui.actions.cancel', 'Cancel')}
            </Button>
            <Button
              type="button"
              disabled={sendBusy || !isSendableEmail(sendTarget?.buyerEmail)}
              onClick={() => { if (sendTarget) void handleSendQuote(sendTarget, sendValidDays) }}
            >
              {sendBusy ? t('internal_sales.list.actions.sending', 'Sending…') : t('internal_sales.list.actions.send')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
