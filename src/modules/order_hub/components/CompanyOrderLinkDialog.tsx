'use client'

import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { createCrud, fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { FieldLabel } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { useTradeTypeChannels } from '../../internal_sales/lib/tradeTypeChannels'
import type { SalesTradeType } from '../../internal_sales/lib/tradeType'
import { COMPANY_ORDER_LINK_KINDS, type CompanyOrderLinkKind } from '../data/validators'
import { loadPurchaseOrderCandidates, purchaseOrderCandidateLabel } from './companyOrderOptions'

const LINKS_API_PATH = 'order_hub/orders/links'
const SALES_ORDERS_API_PATH = 'sales/orders'

/** The replace schema accepts at most 200 links; the dialog refuses to grow past it. */
const MAX_LINKS = 200

/** The trade type a sales kind belongs to; a purchase child has none. */
const TRADE_TYPE_BY_KIND: Partial<Record<CompanyOrderLinkKind, SalesTradeType>> = {
  internal_sales_order: 'internal',
  external_sales_order: 'external',
}

const KIND_TITLE_KEYS: Record<CompanyOrderLinkKind, string> = {
  internal_sales_order: 'order_hub.companyOrders.links.title.internal',
  external_sales_order: 'order_hub.companyOrders.links.title.external',
  purchase_order: 'order_hub.companyOrders.links.title.purchase',
}

const KIND_ROW_KEYS: Record<CompanyOrderLinkKind, string> = {
  internal_sales_order: 'order_hub.companyOrders.links.row.internal',
  external_sales_order: 'order_hub.companyOrders.links.row.external',
  purchase_order: 'order_hub.companyOrders.links.row.purchase',
}

export function companyOrderLinkKindTitle(t: TranslateFn, kind: CompanyOrderLinkKind): string {
  return t(KIND_TITLE_KEYS[kind])
}

function readText(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return ''
}

/** `{number} — {counterparty}` for a picker option; falls back to the id's head when unnamed. */
function optionLabel(number: string, counterparty: string, id: string): string {
  const display = number.trim().length > 0 ? number : id.slice(0, 8)
  return counterparty.trim().length > 0 ? `${display} — ${counterparty}` : display
}

type LinkRow = {
  /** Stable identity: the stored link's id, or a counter for a row the operator just added. */
  key: string
  refId: string
}

/**
 * The whole-set replace of one kind's child links.
 *
 * The write is a **replace-all** (`order_hub.orders.links.replace`), so the dialog always re-reads
 * the stored set when it opens and refuses to save on top of a failed read: seeding from a stale
 * local copy is exactly how someone else's link gets dropped. The save carries the company order
 * version the hub rendered with, so a root changed in another tab answers 409 and lands on the
 * platform's conflict bar (refresh) instead of silently overwriting it.
 *
 * The kind is fixed by the block that opened the dialog — each attach block owns one kind — so a row
 * is just a child picker. The picker is the owning module's own list: an `internal_sales_order` is a
 * sales order on the internal trade-type channel, an `external_sales_order` one on the external
 * channel (both resolved through the module's own channel route), and a `purchase_order` is a
 * purchasing order.
 */
export function CompanyOrderLinkDialog({
  open,
  onOpenChange,
  companyOrderId,
  kind,
  kinds,
  companyOrderUpdatedAt,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyOrderId: string
  kind: CompanyOrderLinkKind
  /**
   * Every kind this dialog may switch between. The merged 出口销售 block passes both sales kinds and
   * lets the operator pick one; a block that owns a single kind leaves it out and the kind stays the
   * caller's fixed value (a row is then just a child picker).
   */
  kinds?: CompanyOrderLinkKind[]
  /** The root's version the dialog rendered with; the replace command locks on it. */
  companyOrderUpdatedAt: string | null
  /** Called after a successful replace (and after a conflict refresh) so the hub re-reads its rows. */
  onSaved: () => Promise<void> | void
}) {
  const t = useT()
  const { channels } = useTradeTypeChannels('order')
  const availableKinds = React.useMemo(
    () => (kinds && kinds.length > 0 ? kinds : [kind]),
    [kind, kinds],
  )
  const [activeKind, setActiveKind] = React.useState<CompanyOrderLinkKind>(kind)
  const [rows, setRows] = React.useState<LinkRow[]>([])
  const [labels, setLabels] = React.useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [isSaving, setIsSaving] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)
  const addedRowsRef = React.useRef(0)

  const loadFailedMessage = t('order_hub.companyOrders.links.loadFailed')
  const saveFailedMessage = t('order_hub.companyOrders.links.saveFailed')

  // Re-entering the dialog starts on the caller's kind again; switching is a within-open choice.
  React.useEffect(() => {
    if (open) setActiveKind(kind)
  }, [kind, open])

  // Re-read on open and on every reload request: see the replace-all note above.
  React.useEffect(() => {
    if (!open) return
    let stale = false
    setIsLoading(true)
    setLoadError(null)
    void fetchCrudList<Record<string, unknown>>(LINKS_API_PATH, {
      companyOrderId,
      kind: activeKind,
      pageSize: MAX_LINKS,
    })
      .then((payload) => {
        if (stale) return
        const links = payload.items ?? []
        setRows(
          links.map((item) => ({
            key: `link-${String(item.id)}`,
            refId: String(item.refId ?? ''),
          })),
        )
        setLabels(
          Object.fromEntries(
            links.map((item) => [
              String(item.refId ?? ''),
              optionLabel(
                typeof item.refNumber === 'string' ? item.refNumber : '',
                typeof item.refCounterparty === 'string' ? item.refCounterparty : '',
                String(item.refId ?? ''),
              ),
            ]),
          ),
        )
      })
      .catch((error) => {
        if (stale) return
        setRows([])
        setLabels({})
        setLoadError(error instanceof Error && error.message ? error.message : loadFailedMessage)
      })
      .finally(() => {
        if (!stale) setIsLoading(false)
      })
    return () => {
      stale = true
    }
  }, [activeKind, companyOrderId, loadFailedMessage, open, reloadToken])

  /**
   * The one option source this dialog offers, over the kind's owning module list.
   *
   * Memoised on the resolved channel id so `ComboboxInput`'s eager label resolution does not re-fetch
   * on every render; a purchase child needs no channel.
   */
  const loadSuggestions = React.useCallback(
    async (query?: string): Promise<ComboboxOption[]> => {
      const term = query?.trim()
      const tradeType = TRADE_TYPE_BY_KIND[activeKind]
      if (tradeType) {
        const channelId = channels[tradeType]
        // No channel yet: the organization has not been seeded, so the picker can offer nothing.
        if (!channelId) return []
        const payload = await fetchCrudList<Record<string, unknown>>(SALES_ORDERS_API_PATH, {
          channelIds: channelId,
          pageSize: 50,
          sortField: 'created_at',
          sortDir: 'desc',
          ...(term ? { search: term } : {}),
        })
        return (payload.items ?? [])
          .map((item) => {
            const id = String(item.id ?? '')
            const snapshot = (item.customerSnapshot ?? item.customer_snapshot) as
              | Record<string, unknown>
              | null
              | undefined
            const buyer =
              snapshot && typeof snapshot.name === 'string'
                ? snapshot.name
                : readText(item, 'customerName', 'customer_name')
            return { value: id, label: optionLabel(readText(item, 'orderNumber', 'order_number'), buyer, id) }
          })
          .filter((option) => option.value.length > 0)
      }
      const candidates = await loadPurchaseOrderCandidates(term)
      return candidates.map((candidate) => ({
        value: candidate.refId,
        label: purchaseOrderCandidateLabel(candidate),
      }))
    },
    [activeKind, channels],
  )

  const addRow = React.useCallback(() => {
    addedRowsRef.current += 1
    setRows((prev) => [...prev, { key: `added-${addedRowsRef.current}`, refId: '' }])
  }, [])

  const updateRow = React.useCallback((key: string, refId: string) => {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, refId } : row)))
  }, [])

  const removeRow = React.useCallback((key: string) => {
    setRows((prev) => prev.filter((row) => row.key !== key))
  }, [])

  const handleSave = React.useCallback(async () => {
    const refs = rows.map((row) => ({ refId: row.refId.trim() }))
    if (refs.some((row) => row.refId.length === 0)) {
      flash(t('order_hub.companyOrders.links.incomplete'), 'error')
      return
    }
    if (new Set(refs.map((row) => row.refId)).size !== refs.length) {
      flash(t('order_hub.companyOrders.links.duplicate'), 'error')
      return
    }
    setIsSaving(true)
    try {
      await createCrud(
        LINKS_API_PATH,
        {
          companyOrderId,
          kind: activeKind,
          refs,
          ...(companyOrderUpdatedAt ? { updatedAt: companyOrderUpdatedAt } : {}),
        },
        { errorMessage: saveFailedMessage },
      )
      flash(t('order_hub.companyOrders.links.saved'), 'success')
      onOpenChange(false)
      await onSaved()
    } catch (error) {
      // A stale company-order version keeps the dialog open: the conflict bar offers the reload,
      // which re-reads the stored set so the next save is made against what is there.
      if (
        surfaceRecordConflict(error, t, {
          onRefresh: () => {
            setReloadToken((token) => token + 1)
            void onSaved()
          },
        })
      ) {
        return
      }
      flash(error instanceof Error && error.message ? error.message : saveFailedMessage, 'error')
    } finally {
      setIsSaving(false)
    }
  }, [activeKind, companyOrderId, companyOrderUpdatedAt, onOpenChange, onSaved, rows, saveFailedMessage, t])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !isSaving && !isLoading) {
            event.preventDefault()
            void handleSave()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{companyOrderLinkKindTitle(t, activeKind)}</DialogTitle>
          <DialogDescription>{t('order_hub.companyOrders.links.body')}</DialogDescription>
        </DialogHeader>
        {/* One kind per replace: the dialog owned a fixed kind before the merged 出口销售 block, and
            switching here re-reads that kind's stored set before it can be saved. */}
        {availableKinds.length > 1 ? (
          <div className="space-y-1.5">
            <FieldLabel htmlFor="company-order-link-kind">
              {t('order_hub.companyOrders.links.kindLabel')}
            </FieldLabel>
            <Select
              value={activeKind}
              disabled={isSaving}
              onValueChange={(next) => setActiveKind(next as CompanyOrderLinkKind)}
            >
              <SelectTrigger id="company-order-link-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableKinds.map((option) => (
                  <SelectItem key={option} value={option}>
                    {companyOrderLinkKindTitle(t, option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="space-y-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t('order_hub.companyOrders.links.loading')}</p>
          ) : loadError ? (
            <div className="space-y-2">
              <p className="text-sm text-destructive">{loadError}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => setReloadToken((token) => token + 1)}>
                {t('order_hub.companyOrders.links.reload')}
              </Button>
            </div>
          ) : (
            <>
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('order_hub.companyOrders.links.empty')}</p>
              ) : null}
              {rows.map((row) => (
                <div key={row.key} className="grid items-end gap-2 sm:grid-cols-12">
                  <div className="space-y-1.5 sm:col-span-11">
                    <FieldLabel htmlFor={`company-order-link-${row.key}`}>
                      {t(KIND_ROW_KEYS[activeKind])}
                    </FieldLabel>
                    <ComboboxInput
                      value={row.refId}
                      onChange={(next) => updateRow(row.key, next)}
                      disabled={isSaving}
                      clearable
                      allowCustomValues={false}
                      placeholder={t('order_hub.companyOrders.links.search')}
                      seedOptions={row.refId && labels[row.refId] ? [{ value: row.refId, label: labels[row.refId] }] : undefined}
                      loadSuggestions={loadSuggestions}
                    />
                  </div>
                  <IconButton
                    type="button"
                    variant="ghost"
                    className="sm:col-span-1"
                    aria-label={t('order_hub.companyOrders.links.remove')}
                    disabled={isSaving}
                    onClick={() => removeRow(row.key)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </IconButton>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                disabled={isSaving || rows.length >= MAX_LINKS}
                onClick={addRow}
              >
                <Plus className="size-4" aria-hidden="true" />
                {t('order_hub.companyOrders.links.addRow')}
              </Button>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t('ui.actions.cancel')}
          </Button>
          <Button
            type="button"
            disabled={isSaving || isLoading || loadError !== null}
            onClick={() => void handleSave()}
          >
            {t('order_hub.companyOrders.links.save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export { COMPANY_ORDER_LINK_KINDS }
export default CompanyOrderLinkDialog
