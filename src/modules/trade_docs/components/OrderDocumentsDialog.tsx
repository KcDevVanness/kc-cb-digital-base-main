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
import { ORDER_DOCUMENT_KINDS } from '../data/validators'
import { loadDocumentOptions, loadTaxInvoiceOptions, type DocumentOption } from './formOptions'

const ORDER_DOCUMENTS_API_PATH = 'trade_docs/orders/documents'

/** The maximum the replace schema accepts; the dialog refuses to grow past it. */
const MAX_DOCUMENT_LINKS = 200

export type OrderDocumentKind = (typeof ORDER_DOCUMENT_KINDS)[number]

const DOCUMENT_KIND_LABELS: Record<OrderDocumentKind, { key: string; fallback: string }> = {
  proforma: { key: 'trade_docs.documents.kind.proforma', fallback: 'Proforma invoice (PI)' },
  commercial: { key: 'trade_docs.documents.kind.commercial', fallback: 'Commercial invoice (CI)' },
  tax_invoice: { key: 'order_hub.detail.documents.kind.taxInvoice', fallback: 'Tax invoice' },
}

/** The wording of a document kind, shared by the picker and the hub's rows. */
export function orderDocumentKindLabel(t: TranslateFn, kind: string): string {
  const entry = DOCUMENT_KIND_LABELS[kind as OrderDocumentKind]
  return entry ? t(entry.key, entry.fallback) : kind
}

/**
 * One option source per kind, module level so the identity stays stable: `ComboboxInput` re-runs its
 * eager label resolution whenever `loadSuggestions` changes, and an inline loader would re-fetch on
 * every render of the row.
 */
const DOCUMENT_OPTION_LOADERS: Record<OrderDocumentKind, (query?: string) => Promise<ComboboxOption[]>> = {
  proforma: async (query) => (await loadDocumentOptions('proforma', query)).map(toComboboxOption),
  commercial: async (query) => (await loadDocumentOptions('commercial', query)).map(toComboboxOption),
  tax_invoice: async (query) => (await loadTaxInvoiceOptions(query)).map(toComboboxOption),
}

function toComboboxOption(option: DocumentOption): ComboboxOption {
  return { value: option.value, label: documentOptionLabel(option) }
}

/**
 * `{number} — {counterparty}` for the option list and for re-seeding a stored link, which the
 * paginated suggestion list may not cover.
 */
function documentOptionLabel(option: DocumentOption): string {
  const number = option.number && option.number.trim().length > 0 ? option.number : option.value.slice(0, 8)
  return option.counterpartyName ? `${number} — ${option.counterpartyName}` : number
}

type DocumentRow = {
  /** Stable identity: the stored link's id, or a counter for a row the operator just added. */
  key: string
  documentKind: OrderDocumentKind
  documentId: string
}

function isOrderDocumentKind(value: unknown): value is OrderDocumentKind {
  return typeof value === 'string' && (ORDER_DOCUMENT_KINDS as readonly string[]).includes(value)
}

/** `{number}` (falling back to the frozen link label) for one stored link. */
function storedLinkLabel(item: Record<string, unknown>): string {
  const documentId = String(item.documentId ?? '')
  const number = typeof item.documentNumber === 'string' && item.documentNumber.trim().length > 0
    ? item.documentNumber
    : documentId.slice(0, 8)
  return number
}

type DocumentLinkRowProps = {
  row: DocumentRow
  label: string | undefined
  disabled: boolean
  onChange: (patch: Partial<Pick<DocumentRow, 'documentKind' | 'documentId'>>) => void
  onRemove: () => void
}

function DocumentLinkRow({ row, label, disabled, onChange, onRemove }: DocumentLinkRowProps) {
  const t = useT()
  const kindId = `order-document-kind-${row.key}`
  return (
    <div className="grid items-end gap-2 sm:grid-cols-12">
      <div className="space-y-1.5 sm:col-span-4">
        <FieldLabel htmlFor={kindId}>{t('order_hub.detail.documents.dialog.kind', 'Kind')}</FieldLabel>
        <Select
          value={row.documentKind}
          onValueChange={(next) => {
            if (!isOrderDocumentKind(next)) return
            // Another table's documents are not valid links here, so the picked document never
            // survives a kind switch: the operator picks the one that belongs to the kind chosen.
            onChange({ documentKind: next, documentId: '' })
          }}
        >
          <SelectTrigger id={kindId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ORDER_DOCUMENT_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {orderDocumentKindLabel(t, kind)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5 sm:col-span-7">
        <FieldLabel htmlFor={`order-document-${row.key}`}>
          {t('order_hub.detail.documents.dialog.document', 'Document')}
        </FieldLabel>
        <ComboboxInput
          value={row.documentId}
          onChange={(next) => onChange({ documentId: next })}
          disabled={disabled}
          clearable
          allowCustomValues={false}
          placeholder={t('order_hub.detail.documents.dialog.documentPlaceholder', 'Search by number')}
          seedOptions={row.documentId && label ? [{ value: row.documentId, label }] : undefined}
          loadSuggestions={DOCUMENT_OPTION_LOADERS[row.documentKind]}
        />
      </div>
      <IconButton
        type="button"
        variant="ghost"
        className="sm:col-span-1"
        aria-label={t('order_hub.detail.documents.dialog.remove', 'Remove this document')}
        disabled={disabled}
        onClick={onRemove}
      >
        <Trash2 className="size-4" aria-hidden="true" />
      </IconButton>
    </div>
  )
}

/**
 * 「管理单据关联」 — the one surface that writes a sales order's document links.
 *
 * The write is a **replace-all** (`trade_docs.orders.documents.replace`), so the dialog always
 * re-reads the stored set when it opens and refuses to save on top of a failed read: seeding from a
 * stale local copy is exactly how someone else's link gets dropped. The save carries the order
 * version the hub rendered with, so an order changed in another tab answers 409 and lands on the
 * platform's conflict bar (refresh) instead of silently overwriting it.
 *
 * A document raised from the order's own create links (`?orderKind=&orderId=`) is already in the set:
 * both writers go through the same table.
 */
export function OrderDocumentsDialog({
  open,
  onOpenChange,
  orderKind,
  orderId,
  orderUpdatedAt,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orderKind: string
  orderId: string
  /** The order head's version the dialog rendered with; the replace command locks on it. */
  orderUpdatedAt: string | null
  /** Called after a successful replace (and after a conflict refresh) so the hub re-reads its rows. */
  onSaved: () => Promise<void> | void
}) {
  const t = useT()
  const [rows, setRows] = React.useState<DocumentRow[]>([])
  const [labels, setLabels] = React.useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [isSaving, setIsSaving] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)
  const addedRowsRef = React.useRef(0)

  const loadFailedMessage = t('order_hub.detail.documents.dialog.loadFailed', 'Could not load the linked documents.')
  const saveFailedMessage = t('order_hub.detail.documents.dialog.saveFailed', 'Could not save the document links')

  // Re-read on open and on every reload request: see the replace-all note above.
  React.useEffect(() => {
    if (!open) return
    let stale = false
    setIsLoading(true)
    setLoadError(null)
    void fetchCrudList<Record<string, unknown>>(ORDER_DOCUMENTS_API_PATH, {
      orderKind,
      orderId,
      pageSize: MAX_DOCUMENT_LINKS,
    })
      .then((payload) => {
        if (stale) return
        const links = payload.items ?? []
        setRows(
          links.map((item) => ({
            key: `link-${String(item.id)}`,
            documentKind: isOrderDocumentKind(item.documentKind) ? item.documentKind : 'proforma',
            documentId: String(item.documentId ?? ''),
          })),
        )
        setLabels(
          Object.fromEntries(
            links.map((item) => [String(item.documentId ?? ''), storedLinkLabel(item)]),
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
  }, [loadFailedMessage, open, orderId, orderKind, reloadToken])

  const addRow = React.useCallback(() => {
    addedRowsRef.current += 1
    setRows((prev) => [...prev, { key: `added-${addedRowsRef.current}`, documentKind: 'proforma', documentId: '' }])
  }, [])

  const updateRow = React.useCallback(
    (key: string, patch: Partial<Pick<DocumentRow, 'documentKind' | 'documentId'>>) => {
      setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)))
    },
    [],
  )

  const removeRow = React.useCallback((key: string) => {
    setRows((prev) => prev.filter((row) => row.key !== key))
  }, [])

  const handleSave = React.useCallback(async () => {
    const documents = rows.map((row) => ({ documentKind: row.documentKind, documentId: row.documentId.trim() }))
    if (documents.some((row) => row.documentId.length === 0)) {
      flash(
        t(
          'order_hub.detail.documents.dialog.incomplete',
          'Pick a document for every row, or remove the row.',
        ),
        'error',
      )
      return
    }
    if (new Set(documents.map((row) => `${row.documentKind}:${row.documentId}`)).size !== documents.length) {
      flash(t('order_hub.detail.documents.dialog.duplicate', 'The same document is listed twice.'), 'error')
      return
    }
    setIsSaving(true)
    try {
      await createCrud(
        ORDER_DOCUMENTS_API_PATH,
        {
          orderKind,
          orderId,
          rows: documents,
          ...(orderUpdatedAt ? { orderUpdatedAt } : {}),
        },
        { errorMessage: saveFailedMessage },
      )
      flash(t('order_hub.detail.documents.dialog.saved', 'Document links updated'), 'success')
      onOpenChange(false)
      await onSaved()
    } catch (error) {
      // A stale order version keeps the dialog open: the conflict bar offers the reload, which
      // re-reads the stored set so the next save is made against what is there.
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
  }, [onOpenChange, onSaved, orderId, orderKind, orderUpdatedAt, rows, saveFailedMessage, t])

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
          <DialogTitle>{t('order_hub.detail.documents.dialog.title', 'Document links')}</DialogTitle>
          <DialogDescription>
            {t(
              'order_hub.detail.documents.dialog.body',
              'Links the proforma invoices, commercial invoices and tax invoices this order carries; saving replaces the whole set.',
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">
              {t('order_hub.detail.documents.dialog.loading', 'Loading linked documents…')}
            </p>
          ) : loadError ? (
            <div className="space-y-2">
              <p className="text-sm text-destructive">{loadError}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => setReloadToken((token) => token + 1)}>
                {t('order_hub.detail.documents.dialog.retry', 'Reload')}
              </Button>
            </div>
          ) : (
            <>
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('order_hub.detail.documents.dialog.empty', 'No documents linked yet.')}
                </p>
              ) : null}
              {rows.map((row) => (
                <DocumentLinkRow
                  key={row.key}
                  row={row}
                  label={labels[row.documentId]}
                  disabled={isSaving}
                  onChange={(patch) => updateRow(row.key, patch)}
                  onRemove={() => removeRow(row.key)}
                />
              ))}
              <Button
                type="button"
                variant="outline"
                disabled={isSaving || rows.length >= MAX_DOCUMENT_LINKS}
                onClick={addRow}
              >
                <Plus className="size-4" aria-hidden="true" />
                {t('order_hub.detail.documents.dialog.addRow', 'Add document')}
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
            {t('order_hub.detail.documents.dialog.save', 'Save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default OrderDocumentsDialog
