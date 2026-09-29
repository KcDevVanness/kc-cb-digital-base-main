"use client"

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
import { CONTRACT_ORDER_KINDS } from '../data/validators'
import { loadPurchaseOrderOptions, loadSalesOrderOptions } from './formOptions'

const CONTRACT_ORDERS_API_PATH = 'trade_docs/contracts/orders'

/** The maximum the replace schema accepts; the dialog refuses to grow past it. */
const MAX_ORDER_LINKS = 200

export type ContractOrderKind = (typeof CONTRACT_ORDER_KINDS)[number]

const ORDER_KIND_LABELS: Record<ContractOrderKind, { key: string; fallback: string }> = {
  purchase_order: {
    key: 'trade_docs.contracts.detail.orders.kind.purchase_order',
    fallback: 'Purchase order',
  },
  internal_sales_order: {
    key: 'trade_docs.contracts.detail.orders.kind.internal_sales_order',
    fallback: 'Internal sales order',
  },
  external_sales_order: {
    key: 'trade_docs.contracts.detail.orders.kind.external_sales_order',
    fallback: 'External sales order',
  },
}

/**
 * The wording of an order kind, shared by the dialog's picker and the contract detail's rows so the
 * two can never name the same relation differently.
 */
export function orderKindLabel(t: TranslateFn, kind: string): string {
  const entry = ORDER_KIND_LABELS[kind as ContractOrderKind]
  return entry ? t(entry.key, entry.fallback) : kind
}

/**
 * One option source per kind, module level so the identity stays stable: `ComboboxInput` re-runs its
 * eager label resolution whenever `loadSuggestions` changes, and an inline loader would re-fetch on
 * every render of the row.
 *
 * `external_sales_order` is a *reserved* value — the capability that would own those orders is not
 * installed — so its loader answers nothing rather than listing the wrong family's orders.
 */
const ORDER_OPTION_LOADERS: Record<ContractOrderKind, (query?: string) => Promise<ComboboxOption[]>> = {
  purchase_order: (query) => loadPurchaseOrderOptions(query),
  internal_sales_order: (query) => loadSalesOrderOptions(query),
  external_sales_order: async () => [],
}

type OrderRow = {
  /** Stable identity: the stored link's id, or a counter for a row the operator just added. */
  key: string
  orderKind: ContractOrderKind
  orderId: string
}

function isContractOrderKind(value: unknown): value is ContractOrderKind {
  return typeof value === 'string' && (CONTRACT_ORDER_KINDS as readonly string[]).includes(value)
}

/**
 * `{number} — {counterparty}` for the option list and for re-seeding a stored link, which the
 * paginated suggestion list may not cover.
 */
function orderLinkLabel(item: Record<string, unknown>): string {
  const orderId = String(item.orderId ?? '')
  const number = typeof item.orderNumber === 'string' && item.orderNumber.trim().length > 0
    ? item.orderNumber
    : orderId.slice(0, 8)
  const counterparty = typeof item.counterpartyName === 'string' ? item.counterpartyName : ''
  return counterparty ? `${number} — ${counterparty}` : number
}

type OrderLinkRowProps = {
  row: OrderRow
  label: string | undefined
  disabled: boolean
  onChange: (patch: Partial<Pick<OrderRow, 'orderKind' | 'orderId'>>) => void
  onRemove: () => void
}

function OrderLinkRow({ row, label, disabled, onChange, onRemove }: OrderLinkRowProps) {
  const t = useT()
  const reservedKind = row.orderKind === 'external_sales_order'
  const kindId = `contract-order-kind-${row.key}`
  return (
    <div className="grid items-end gap-2 sm:grid-cols-12">
      <div className="space-y-1.5 sm:col-span-4">
        <FieldLabel htmlFor={kindId}>{t('trade_docs.contracts.detail.orders.dialog.kind', 'Kind')}</FieldLabel>
        <Select
          value={row.orderKind}
          onValueChange={(next) => {
            if (!isContractOrderKind(next)) return
            // Another family's orders are not valid links, so the picked order never survives a kind
            // switch: the operator picks the order that belongs to the kind they just chose.
            onChange({ orderKind: next, orderId: '' })
          }}
        >
          <SelectTrigger id={kindId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONTRACT_ORDER_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {orderKindLabel(t, kind)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5 sm:col-span-7">
        <FieldLabel htmlFor={`contract-order-${row.key}`}>
          {t('trade_docs.contracts.detail.orders.dialog.order', 'Order')}
        </FieldLabel>
        <ComboboxInput
          value={row.orderId}
          onChange={(next) => onChange({ orderId: next })}
          disabled={disabled || reservedKind}
          clearable
          allowCustomValues={false}
          placeholder={t('trade_docs.contracts.detail.orders.dialog.orderPlaceholder', 'Search by order number')}
          seedOptions={row.orderId && label ? [{ value: row.orderId, label }] : undefined}
          loadSuggestions={ORDER_OPTION_LOADERS[row.orderKind]}
        />
        {reservedKind ? (
          <p className="text-xs text-muted-foreground">
            {t(
              'trade_docs.contracts.detail.orders.dialog.externalReserved',
              'External sales orders are not available in this deployment yet.',
            )}
          </p>
        ) : null}
      </div>
      <IconButton
        type="button"
        variant="ghost"
        className="sm:col-span-1"
        aria-label={t('trade_docs.contracts.detail.orders.dialog.remove', 'Remove this order')}
        disabled={disabled}
        onClick={onRemove}
      >
        <Trash2 className="size-4" aria-hidden="true" />
      </IconButton>
    </div>
  )
}

/**
 * 「管理订单关联」 — the one surface that writes a contract's order links.
 *
 * The write is a **replace-all** (`trade_docs.contracts.orders.replace`), so the dialog always
 * re-reads the stored set when it opens and refuses to save on top of a failed read: seeding from a
 * stale local copy is exactly how someone else's link gets dropped. The save carries the contract
 * version the page rendered with, so a contract changed in another tab answers 409 and lands on the
 * platform's conflict bar (refresh) instead of silently overwriting it.
 */
export function ContractOrdersDialog({
  open,
  onOpenChange,
  contractId,
  contractUpdatedAt,
  cancelled,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  contractId: string
  /** The contract head's version the dialog rendered with; the replace command locks on it. */
  contractUpdatedAt: string | null
  /** A cancelled contract refuses order links (server 422), so the save is never offered. */
  cancelled: boolean
  /** Called after a successful replace (and after a conflict refresh) so the hub re-reads its rows. */
  onSaved: () => Promise<void> | void
}) {
  const t = useT()
  const [rows, setRows] = React.useState<OrderRow[]>([])
  const [labels, setLabels] = React.useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [isSaving, setIsSaving] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)
  const addedRowsRef = React.useRef(0)

  const loadFailedMessage = t('trade_docs.contracts.detail.orders.dialog.loadFailed', 'Could not load the linked orders.')
  const saveFailedMessage = t('trade_docs.contracts.detail.orders.dialog.saveFailed', 'Could not save the order links')

  // Re-read on open and on every reload request: see the replace-all note above.
  React.useEffect(() => {
    if (!open) return
    let stale = false
    setIsLoading(true)
    setLoadError(null)
    void fetchCrudList<Record<string, unknown>>(CONTRACT_ORDERS_API_PATH, {
      contractId,
      pageSize: MAX_ORDER_LINKS,
    })
      .then((payload) => {
        if (stale) return
        const links = payload.items ?? []
        setRows(
          links.map((item) => ({
            key: `link-${String(item.id)}`,
            orderKind: isContractOrderKind(item.orderKind) ? item.orderKind : 'purchase_order',
            orderId: String(item.orderId ?? ''),
          })),
        )
        setLabels(
          Object.fromEntries(
            links.map((item) => [String(item.orderId ?? ''), orderLinkLabel(item)]),
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
  }, [contractId, loadFailedMessage, open, reloadToken])

  const addRow = React.useCallback(() => {
    addedRowsRef.current += 1
    setRows((prev) => [...prev, { key: `added-${addedRowsRef.current}`, orderKind: 'purchase_order', orderId: '' }])
  }, [])

  const updateRow = React.useCallback(
    (key: string, patch: Partial<Pick<OrderRow, 'orderKind' | 'orderId'>>) => {
      setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)))
    },
    [],
  )

  const removeRow = React.useCallback((key: string) => {
    setRows((prev) => prev.filter((row) => row.key !== key))
  }, [])

  const handleSave = React.useCallback(async () => {
    const orders = rows.map((row) => ({ orderKind: row.orderKind, orderId: row.orderId.trim() }))
    if (orders.some((order) => order.orderId.length === 0)) {
      flash(
        t(
          'trade_docs.contracts.detail.orders.dialog.incomplete',
          'Pick an order for every row, or remove the row.',
        ),
        'error',
      )
      return
    }
    if (new Set(orders.map((order) => `${order.orderKind}:${order.orderId}`)).size !== orders.length) {
      flash(t('trade_docs.contracts.detail.orders.dialog.duplicate', 'The same order is listed twice.'), 'error')
      return
    }
    setIsSaving(true)
    try {
      await createCrud(
        CONTRACT_ORDERS_API_PATH,
        {
          contractId,
          orders,
          ...(contractUpdatedAt ? { updatedAt: contractUpdatedAt } : {}),
        },
        { errorMessage: saveFailedMessage },
      )
      flash(t('trade_docs.contracts.detail.orders.dialog.saved', 'Order links updated'), 'success')
      onOpenChange(false)
      await onSaved()
    } catch (error) {
      // A stale contract version (or a cancelled one) keeps the dialog open: the conflict bar offers
      // the reload, which re-reads the stored set so the next save is made against what is there.
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
  }, [contractId, contractUpdatedAt, onOpenChange, onSaved, rows, saveFailedMessage, t])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !isSaving && !cancelled && !isLoading) {
            event.preventDefault()
            void handleSave()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('trade_docs.contracts.detail.orders.dialog.title', 'Order links')}</DialogTitle>
          <DialogDescription>
            {t(
              'trade_docs.contracts.detail.orders.dialog.body',
              'Links the purchase orders and sales orders this contract covers; saving replaces the whole set.',
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {cancelled ? (
            <p className="text-sm text-destructive">
              {t('trade_docs.contracts.detail.orders.dialog.cancelled', 'A cancelled contract cannot link orders.')}
            </p>
          ) : null}
          {isLoading ? (
            <p className="text-sm text-muted-foreground">
              {t('trade_docs.contracts.detail.orders.dialog.loading', 'Loading linked orders…')}
            </p>
          ) : loadError ? (
            <div className="space-y-2">
              <p className="text-sm text-destructive">{loadError}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => setReloadToken((token) => token + 1)}>
                {t('trade_docs.contracts.detail.orders.dialog.retry', 'Reload')}
              </Button>
            </div>
          ) : (
            <>
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('trade_docs.contracts.detail.orders.dialog.empty', 'No orders linked yet.')}
                </p>
              ) : null}
              {rows.map((row) => (
                <OrderLinkRow
                  key={row.key}
                  row={row}
                  label={labels[row.orderId]}
                  disabled={isSaving}
                  onChange={(patch) => updateRow(row.key, patch)}
                  onRemove={() => removeRow(row.key)}
                />
              ))}
              <Button
                type="button"
                variant="outline"
                disabled={isSaving || rows.length >= MAX_ORDER_LINKS}
                onClick={addRow}
              >
                <Plus className="size-4" aria-hidden="true" />
                {t('trade_docs.contracts.detail.orders.dialog.addRow', 'Add order')}
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
            disabled={cancelled || isSaving || isLoading || loadError !== null}
            onClick={() => void handleSave()}
          >
            {t('trade_docs.contracts.detail.orders.dialog.save', 'Save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default ContractOrdersDialog
