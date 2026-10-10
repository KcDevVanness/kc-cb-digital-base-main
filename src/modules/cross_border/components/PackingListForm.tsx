"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import {
  CrudForm,
  type CrudField,
  type CrudFieldOption,
  type CrudFormGroup,
  type CrudFormGroupComponentProps,
} from '@open-mercato/ui/backend/CrudForm'
import { ComboboxInput } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { Button } from '@open-mercato/ui/primitives/button'
import { FieldLabel } from '@open-mercato/ui/primitives/label'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { useReturnHref } from '@/lib/navigation/returnTo'
import { loadProductOption } from '../../products/components/formOptions'
import {
  PACKING_LISTS_LIST_HREF,
  SHIPMENT_CONTRACTS_API_PATH,
  SHIPMENT_DOCUMENTS_API_PATH,
  SHIPMENTS_API_PATH,
  shipmentDisplayLabel,
  toShipmentRecord,
} from './ShipmentForm'
import { toShipmentDocumentRecord, type ShipmentDocumentRecord } from './ShipmentDetail'
import { ShipmentDocumentAttachmentField } from './shipmentDocumentAttachmentField'
import { loadContractLines, loadContractOptions, type ContractLineOption } from './shipmentFormOptions'

/**
 * The packing-list form: the document head, the optional file, and the **line items** that make a
 * packing list a measured document (数量/箱数/毛重/净重/体积) rather than a bare attachment.
 *
 * Lines can be typed by hand, picked from the product master one row at a time, or pulled in bulk
 * from a linked contract's line items («从合同引用商品行») — the same one-shot copy caliber the
 * trade documents use: whatever the reference brings in stays an ordinary, editable row.
 */

const PAGE_SIZE = 50
const SHIPMENT_OPTION_PAGE_SIZE = 50

export type PackingListLineValues = {
  key: string
  productId: string
  name: string
  sku: string
  unit: string
  quantity: string
  cartons: string
  grossWeight: string
  netWeight: string
  volume: string
  note: string
  /** Where the row came from; display-only bookkeeping the command persists per line. */
  sourceSnapshot: Record<string, unknown> | null
}

export type PackingListFormValues = {
  shipmentId: string
  documentNumber: string
  issuedAt: string
  attachmentId: string
  note: string
  lines: PackingListLineValues[]
}

export const EMPTY_PACKING_LIST_VALUES: PackingListFormValues = {
  shipmentId: '',
  documentNumber: '',
  issuedAt: '',
  attachmentId: '',
  note: '',
  lines: [],
}

function newRowKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `packing-list-line-${Date.now()}-${Math.round(performance.now())}`
}

function readText(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.length > 0) return value
    if (typeof value === 'number') return String(value)
  }
  return ''
}

function toOptionalText(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length > 0 ? text : null
}

/** One line as the read-only lines route projects it. */
export function readPackingListLines(value: unknown): PackingListLineValues[] {
  if (!Array.isArray(value)) return []
  return value.flatMap<PackingListLineValues>((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const row = entry as Record<string, unknown>
    return [{
      key: typeof row.key === 'string' && row.key.length ? row.key : newRowKey(),
      productId: readText(row, 'productId', 'product_id'),
      name: readText(row, 'name'),
      sku: readText(row, 'sku'),
      unit: readText(row, 'unit'),
      quantity: readText(row, 'quantity'),
      cartons: readText(row, 'cartons'),
      grossWeight: readText(row, 'grossWeight', 'gross_weight'),
      netWeight: readText(row, 'netWeight', 'net_weight'),
      volume: readText(row, 'volume'),
      note: readText(row, 'note'),
      sourceSnapshot: (row.sourceSnapshot ?? row.source_snapshot ?? null) as Record<string, unknown> | null,
    }]
  })
}

/**
 * The document body: `docType` is fixed to `packing_list` (lines only exist on that kind), decimal
 * fields travel as trimmed strings so the validator's fixed-scale normalization is the only
 * rounding point, and an empty measurement is sent as `null` so clearing a cell really clears it.
 */
export function buildPackingListPayload(values: PackingListFormValues): Record<string, unknown> {
  return {
    shipmentId: values.shipmentId.trim(),
    docType: 'packing_list',
    documentNumber: toOptionalText(values.documentNumber),
    issuedAt: toOptionalText(values.issuedAt),
    attachmentId: toOptionalText(values.attachmentId),
    note: toOptionalText(values.note),
    lines: readPackingListLines(values.lines)
      .filter((line) => line.name.trim().length > 0 || line.productId.trim().length > 0)
      .map((line) => ({
        productId: toOptionalText(line.productId),
        name: toOptionalText(line.name),
        sku: toOptionalText(line.sku),
        unit: toOptionalText(line.unit),
        quantity: toOptionalText(line.quantity),
        cartons: toOptionalText(line.cartons),
        grossWeight: toOptionalText(line.grossWeight),
        netWeight: toOptionalText(line.netWeight),
        volume: toOptionalText(line.volume),
        note: toOptionalText(line.note),
        sourceSnapshot: line.sourceSnapshot ?? null,
      })),
  }
}

/** Shipments a packing list can be filed against, newest first. */
export async function loadShipmentOptions(t: TranslateFn, query?: string): Promise<CrudFieldOption[]> {
  const params: Record<string, string> = {
    page: '1',
    pageSize: String(SHIPMENT_OPTION_PAGE_SIZE),
    sortField: 'created_at',
    sortDir: 'desc',
  }
  const term = query?.trim()
  if (term) params.search = term
  const payload = await fetchCrudList<Record<string, unknown>>(SHIPMENTS_API_PATH, params)
  return (payload.items ?? [])
    .map(toShipmentRecord)
    .map((shipment) => ({ value: shipment.id, label: shipmentDisplayLabel(t, shipment) }))
}

/**
 * The same picker narrowed to one contract's shipments — the entry point from a contract's hub,
 * where every candidate container is already known to belong to that contract.
 */
export async function loadContractShipmentOptions(
  t: TranslateFn,
  contractId: string,
  query?: string,
): Promise<CrudFieldOption[]> {
  const payload = await fetchCrudList<Record<string, unknown>>(SHIPMENTS_API_PATH, {
    contractId,
    page: '1',
    pageSize: String(SHIPMENT_OPTION_PAGE_SIZE),
    sortField: 'created_at',
    sortDir: 'desc',
  })
  const term = query?.trim().toLowerCase() ?? ''
  return (payload.items ?? [])
    .map(toShipmentRecord)
    .map((shipment) => ({ value: shipment.id, label: shipmentDisplayLabel(t, shipment) }))
    .filter((option) => (term ? option.label.toLowerCase().includes(term) : true))
}

type ShipmentContractLink = {
  contractId: string
  contractNumber: string | null
}

/**
 * The line editor: one row per packed item with the measurements a packing list prints.
 *
 * The product picker is the ordinary product-master picker; picking a product fills the display
 * fields it owns (name/SKU/unit) without touching measurements an operator already typed.
 * «从合同引用商品行» opens the reference dialog — a bulk copy, never a live binding.
 */
export function PackingListLinesEditor({
  t,
  values,
  setValue,
  errors,
}: CrudFormGroupComponentProps & { t: TranslateFn }) {
  const lines = readPackingListLines(values.lines)
  const productCache = React.useRef(new Map<string, { name: string; sku: string; unit: string }>())

  const updateLine = React.useCallback((index: number, patch: Partial<PackingListLineValues>) => {
    setValue('lines', lines.map((line, position) => (position === index ? { ...line, ...patch } : line)))
  }, [lines, setValue])

  const removeLine = React.useCallback((index: number) => {
    setValue('lines', lines.filter((_, position) => position !== index))
  }, [lines, setValue])

  const addLine = React.useCallback((line?: Partial<PackingListLineValues>) => {
    setValue('lines', [...lines, {
      key: newRowKey(),
      productId: '',
      name: '',
      sku: '',
      unit: '',
      quantity: '',
      cartons: '',
      grossWeight: '',
      netWeight: '',
      volume: '',
      note: '',
      sourceSnapshot: null,
      ...line,
    }])
  }, [lines, setValue])

  const appendLines = React.useCallback((incoming: PackingListLineValues[]) => {
    if (incoming.length === 0) return
    setValue('lines', [...lines, ...incoming])
  }, [lines, setValue])

  const handleProductChange = React.useCallback((index: number, productId: string) => {
    if (!productId) {
      updateLine(index, { productId: '' })
      return
    }
    const cached = productCache.current.get(productId)
    if (cached) {
      const current = lines[index]
      if (!current) return
      updateLine(index, {
        productId,
        name: current.name.trim() ? current.name : cached.name,
        sku: current.sku.trim() ? current.sku : cached.sku,
        unit: current.unit.trim() ? current.unit : cached.unit || 'PCS',
      })
      return
    }
    updateLine(index, { productId })
    void loadProductOption(productId, t('cross_border.packingLists.form.lines.productLoadFailed'))
      .then((option) => {
        if (!option) return
        productCache.current.set(productId, { name: option.name, sku: option.sku, unit: option.unit })
        const current = lines[index]
        if (!current || current.productId !== productId) return
        updateLine(index, {
          name: current.name.trim() ? current.name : option.name,
          sku: current.sku.trim() ? current.sku : option.sku,
          unit: current.unit.trim() ? current.unit : option.unit || 'PCS',
        })
      })
      .catch(() => undefined)
  }, [lines, t, updateLine])

  const lineError = typeof errors.lines === 'string'
    ? errors.lines
    : Object.entries(errors).find(([key]) => key.startsWith('lines.'))?.[1]

  return (
    <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{t('cross_border.packingLists.form.lines.title')}</h3>
        <ContractReferenceDialog t={t} shipmentId={typeof values.shipmentId === 'string' ? values.shipmentId : ''} onImport={appendLines} />
      </div>
      <p className="text-xs text-muted-foreground">{t('cross_border.packingLists.form.lines.help')}</p>

      {lineError ? <p className="text-xs text-status-error-text" role="alert">{lineError}</p> : null}

      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('cross_border.packingLists.form.lines.empty')}</p>
      ) : null}

      {lines.map((line, index) => (
        <div key={line.key} className="space-y-3 rounded-lg border border-border p-3">
          <div className="grid gap-3 md:grid-cols-12">
            <div className="space-y-1.5 md:col-span-5">
              <FieldLabel htmlFor={`packing-line-product-${index}`}>
                {t('cross_border.packingLists.form.lines.product')}
              </FieldLabel>
              <ComboboxInput
                value={line.productId}
                onChange={(next) => handleProductChange(index, next)}
                placeholder={t('cross_border.packingLists.form.lines.selectProduct')}
                seedOptions={
                  line.productId && (line.sku || line.name)
                    ? [{ value: line.productId, label: line.sku ? `${line.sku} — ${line.name}` : line.name }]
                    : undefined
                }
                loadSuggestions={async (query) => {
                  const payload = await fetchCrudList<Record<string, unknown>>('products/items', {
                    search: query?.trim() || undefined,
                    status: 'active',
                    pageSize: String(PAGE_SIZE),
                  })
                  const options = (payload.items ?? []).map((item) => ({
                    value: readText(item, 'id'),
                    label: [readText(item, 'sku'), readText(item, 'name')].filter(Boolean).join(' — '),
                    name: readText(item, 'name'),
                    sku: readText(item, 'sku'),
                    unit: readText(item, 'unit'),
                  }))
                  for (const option of options) {
                    productCache.current.set(option.value, { name: option.name, sku: option.sku, unit: option.unit })
                  }
                  return options
                }}
                allowCustomValues={false}
                clearable
              />
            </div>
            <div className="space-y-1.5 md:col-span-5">
              <FieldLabel htmlFor={`packing-line-name-${index}`}>
                {t('cross_border.packingLists.form.lines.name')}
              </FieldLabel>
              <Input
                id={`packing-line-name-${index}`}
                value={line.name}
                onChange={(event) => updateLine(index, { name: event.target.value })}
              />
            </div>
            <div className="flex items-end justify-end md:col-span-2">
              <IconButton
                type="button"
                variant="ghost"
                size="lg"
                aria-label={t('cross_border.packingLists.form.lines.remove')}
                onClick={() => removeLine(index)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            </div>

            <div className="space-y-1.5 md:col-span-3">
              <FieldLabel htmlFor={`packing-line-sku-${index}`}>
                {t('cross_border.packingLists.form.lines.sku')}
              </FieldLabel>
              <Input
                id={`packing-line-sku-${index}`}
                value={line.sku}
                onChange={(event) => updateLine(index, { sku: event.target.value })}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <FieldLabel htmlFor={`packing-line-unit-${index}`}>
                {t('cross_border.packingLists.form.lines.unit')}
              </FieldLabel>
              <Input
                id={`packing-line-unit-${index}`}
                value={line.unit}
                onChange={(event) => updateLine(index, { unit: event.target.value })}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <FieldLabel htmlFor={`packing-line-quantity-${index}`}>
                {t('cross_border.packingLists.form.lines.quantity')}
              </FieldLabel>
              <Input
                id={`packing-line-quantity-${index}`}
                type="number"
                min="0"
                step="0.0001"
                value={line.quantity}
                onChange={(event) => updateLine(index, { quantity: event.target.value })}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <FieldLabel htmlFor={`packing-line-cartons-${index}`}>
                {t('cross_border.packingLists.form.lines.cartons')}
              </FieldLabel>
              <Input
                id={`packing-line-cartons-${index}`}
                type="number"
                min="0"
                step="1"
                value={line.cartons}
                onChange={(event) => updateLine(index, { cartons: event.target.value })}
              />
            </div>
            <div className="space-y-1.5 md:col-span-3">
              <FieldLabel htmlFor={`packing-line-volume-${index}`}>
                {t('cross_border.packingLists.form.lines.volume')}
              </FieldLabel>
              <Input
                id={`packing-line-volume-${index}`}
                type="number"
                min="0"
                step="1"
                value={line.volume}
                onChange={(event) => updateLine(index, { volume: event.target.value })}
              />
            </div>

            <div className="space-y-1.5 md:col-span-3">
              <FieldLabel htmlFor={`packing-line-gross-${index}`}>
                {t('cross_border.packingLists.form.lines.grossWeight')}
              </FieldLabel>
              <Input
                id={`packing-line-gross-${index}`}
                type="number"
                min="0"
                step="0.0001"
                value={line.grossWeight}
                onChange={(event) => updateLine(index, { grossWeight: event.target.value })}
              />
            </div>
            <div className="space-y-1.5 md:col-span-3">
              <FieldLabel htmlFor={`packing-line-net-${index}`}>
                {t('cross_border.packingLists.form.lines.netWeight')}
              </FieldLabel>
              <Input
                id={`packing-line-net-${index}`}
                type="number"
                min="0"
                step="0.0001"
                value={line.netWeight}
                onChange={(event) => updateLine(index, { netWeight: event.target.value })}
              />
            </div>
            <div className="space-y-1.5 md:col-span-6">
              <FieldLabel htmlFor={`packing-line-note-${index}`}>
                {t('cross_border.packingLists.form.lines.note')}
              </FieldLabel>
              <Input
                id={`packing-line-note-${index}`}
                value={line.note}
                onChange={(event) => updateLine(index, { note: event.target.value })}
              />
            </div>
          </div>
          {line.sourceSnapshot ? (
            <p className="text-xs text-muted-foreground">{t('cross_border.packingLists.form.lines.fromContract')}</p>
          ) : null}
        </div>
      ))}

      <Button type="button" variant="outline" onClick={() => addLine()}>
        <Plus className="size-4" aria-hidden="true" />
        {t('cross_border.packingLists.form.lines.add')}
      </Button>
    </div>
  )
}

/**
 * The bulk-copy dialog: pick one of the shipment's contracts, see its line items, and append them
 * as ordinary editable rows. A shipment whose contracts are not linked yet falls back to a
 * searchable contract picker, so a packing list is never blocked by a missing link.
 */
function ContractReferenceDialog({
  t,
  shipmentId,
  onImport,
}: {
  t: TranslateFn
  shipmentId: string
  onImport: (lines: PackingListLineValues[]) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [contracts, setContracts] = React.useState<ShipmentContractLink[]>([])
  const [contractId, setContractId] = React.useState('')
  const [lines, setLines] = React.useState<ContractLineOption[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const dialogContentRef = React.useRef<HTMLDivElement | null>(null)

  const loadContracts = React.useCallback(async () => {
    const scopedShipmentId = shipmentId.trim()
    if (!scopedShipmentId) {
      setContracts([])
      return
    }
    const payload = await fetchCrudList<Record<string, unknown>>(SHIPMENT_CONTRACTS_API_PATH, {
      shipmentId: scopedShipmentId,
      pageSize: String(PAGE_SIZE),
    })
    setContracts((payload.items ?? []).map((item) => ({
      contractId: readText(item, 'contractId', 'contract_id'),
      contractNumber: (item.contractNumber ?? item.contract_number ?? null) as string | null,
    })))
  }, [shipmentId])

  React.useEffect(() => {
    if (!open) return
    setContractId('')
    setLines([])
    setError(null)
    void loadContracts().catch(() => setContracts([]))
  }, [loadContracts, open])

  const loadLines = React.useCallback(async (nextContractId: string) => {
    const scopedContractId = nextContractId.trim()
    if (!scopedContractId) {
      setLines([])
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      setLines(await loadContractLines(t('cross_border.packingLists.form.reference.loadFailed'), scopedContractId))
    } catch {
      setLines([])
      setError(t('cross_border.packingLists.form.reference.loadFailed'))
    } finally {
      setIsLoading(false)
    }
  }, [t])

  const importLines = React.useCallback((selected: ContractLineOption[]) => {
    const copiedAt = new Date().toISOString()
    onImport(selected.map((line) => ({
      key: newRowKey(),
      productId: line.productId,
      name: line.name,
      sku: line.sku,
      unit: line.unit,
      quantity: line.quantity,
      cartons: '',
      grossWeight: '',
      netWeight: '',
      volume: '',
      note: '',
      sourceSnapshot: {
        kind: 'contract_line',
        contractId: contractId.trim(),
        lineId: line.id,
        copiedAt,
      },
    })))
    setOpen(false)
  }, [contractId, onImport])

  const handleDialogKeyDown = useDialogKeyHandler({
    onCancel: () => setOpen(false),
  })

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        {t('cross_border.packingLists.form.reference.action')}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent ref={dialogContentRef} onKeyDown={handleDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>{t('cross_border.packingLists.form.reference.title')}</DialogTitle>
            <DialogDescription>{t('cross_border.packingLists.form.reference.description')}</DialogDescription>
          </DialogHeader>

          {contracts.length > 0 ? (
            <div className="space-y-1.5">
              <FieldLabel htmlFor="packing-list-reference-contract">
                {t('cross_border.packingLists.form.reference.contract')}
              </FieldLabel>
              <Select
                value={contractId}
                onValueChange={(next) => {
                  setContractId(next)
                  void loadLines(next)
                }}
              >
                <SelectTrigger id="packing-list-reference-contract">
                  <SelectValue placeholder={t('cross_border.packingLists.form.reference.selectContract')} />
                </SelectTrigger>
                <SelectContent>
                  {contracts.map((contract) => (
                    <SelectItem key={contract.contractId} value={contract.contractId}>
                      {contract.contractNumber ?? contract.contractId.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-1.5">
              <FieldLabel htmlFor="packing-list-reference-contract-search">
                {t('cross_border.packingLists.form.reference.contract')}
              </FieldLabel>
              <ComboboxInput
                value={contractId}
                onChange={(next) => {
                  setContractId(next)
                  void loadLines(next)
                }}
                placeholder={t('cross_border.packingLists.form.reference.selectContract')}
                loadSuggestions={async (query) => loadContractOptions(query)}
                allowCustomValues={false}
                clearable
              />
              <p className="text-xs text-muted-foreground">{t('cross_border.packingLists.form.reference.noLinkedContract')}</p>
            </div>
          )}

          {error ? <p className="text-xs text-status-error-text" role="alert">{error}</p> : null}

          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t('cross_border.packingLists.form.reference.loading')}</p>
          ) : null}

          {!isLoading && contractId && lines.length === 0 && !error ? (
            <p className="text-sm text-muted-foreground">{t('cross_border.packingLists.form.reference.empty')}</p>
          ) : null}

          {lines.length > 0 ? (
            <>
              <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {lines.map((line) => (
                  <li key={line.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div>
                      <p className="text-sm">{line.name || line.sku || line.id.slice(0, 8)}</p>
                      <p className="text-xs text-muted-foreground">
                        {[line.sku, line.unit, line.quantity].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => importLines([line])}>
                      {t('cross_border.packingLists.form.reference.add')}
                    </Button>
                  </li>
                ))}
              </ul>
              <div className="flex justify-end">
                <Button type="button" onClick={() => importLines(lines)}>
                  {t('cross_border.packingLists.form.reference.addAll')}
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}

type PackingListFormProps = {
  mode: 'create' | 'edit'
  documentId?: string
}

/**
 * The create/edit surface of a packing list. Create picks the shipment once (the document belongs
 * to it, and its attachments are partitioned by it); edit keeps the shipment fixed and edits the
 * lines the way the detail page shows them.
 */
export default function PackingListForm({ mode, documentId }: PackingListFormProps) {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const backHref = useReturnHref(PACKING_LISTS_LIST_HREF)
  const contractId = searchParams.get('contractId')?.trim() ?? ''
  const [record, setRecord] = React.useState<ShipmentDocumentRecord | null>(null)
  const [initialValues, setInitialValues] = React.useState<PackingListFormValues | null>(
    mode === 'create' && !contractId ? EMPTY_PACKING_LIST_VALUES : null,
  )
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [shipmentRef, setShipmentRef] = React.useState<{ id: string; label: string } | null>(null)

  /**
   * Arriving from a contract's hub (`?contractId=`): the list is already narrowed to that
   * contract's shipments, so a single candidate is selected for the operator instead of asking
   * them to find the container they just clicked through. Several candidates (or none) leave the
   * picker to them — guessing among containers would file the list against the wrong shipment.
   */
  React.useEffect(() => {
    if (mode !== 'create' || !contractId) return
    let cancelled = false
    const load = async () => {
      try {
        const payload = await fetchCrudList<Record<string, unknown>>(SHIPMENTS_API_PATH, {
          contractId,
          page: '1',
          pageSize: '2',
          sortField: 'created_at',
          sortDir: 'desc',
        })
        const shipments = (payload.items ?? []).map(toShipmentRecord)
        if (cancelled) return
        if (shipments.length === 1) {
          setShipmentRef({ id: shipments[0].id, label: shipmentDisplayLabel(t, shipments[0]) })
          setInitialValues({ ...EMPTY_PACKING_LIST_VALUES, shipmentId: shipments[0].id })
          return
        }
        setInitialValues(EMPTY_PACKING_LIST_VALUES)
      } catch {
        if (cancelled) return
        // A failed narrowing must not block the create flow: fall back to the unrestricted picker.
        setInitialValues(EMPTY_PACKING_LIST_VALUES)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [contractId, mode, t])

  React.useEffect(() => {
    if (mode !== 'edit' || !documentId) return
    let cancelled = false
    const load = async () => {
      try {
        const [documentPayload, linePayload] = await Promise.all([
          fetchCrudList<Record<string, unknown>>(SHIPMENT_DOCUMENTS_API_PATH, { id: documentId, pageSize: 1 }),
          fetchCrudList<Record<string, unknown>>(`${SHIPMENT_DOCUMENTS_API_PATH}/lines`, {
            documentId,
            pageSize: '500',
          }),
        ])
        if (cancelled) return
        const item = documentPayload.items?.[0]
        if (!item) {
          setLoadError(t('cross_border.packingLists.form.loadFailed'))
          return
        }
        const document = toShipmentDocumentRecord(item)
        setRecord(document)
        setInitialValues({
          shipmentId: document.shipmentId,
          documentNumber: document.documentNumber ?? '',
          issuedAt: document.issuedAt ? document.issuedAt.slice(0, 10) : '',
          attachmentId: document.attachmentId ?? '',
          note: document.note ?? '',
          lines: readPackingListLines(linePayload.items ?? []),
        })
        const shipments = await readApiResultOrThrow<{ items?: Record<string, unknown>[] }>(
          `/api/${SHIPMENTS_API_PATH}?ids=${encodeURIComponent(document.shipmentId)}&pageSize=1`,
        )
        if (!cancelled && shipments?.items?.[0]) {
          const shipment = toShipmentRecord(shipments.items[0])
          setShipmentRef({ id: shipment.id, label: shipmentDisplayLabel(t, shipment) })
        }
      } catch {
        if (!cancelled) setLoadError(t('cross_border.packingLists.form.loadFailed'))
      }
    }
    void load()
    return () => { cancelled = true }
  }, [documentId, mode, t])

  const fields = React.useMemo<CrudField[]>(() => {
    // A document is filed against the shipment whose attachments it belongs to, so the shipment is
    // picked once, at registration, and never re-parented afterwards (the command ignores a new id
    // and the file would be stranded); the edit form seeds the picker with that one shipment.
    const shipmentField: CrudField = mode === 'edit'
      ? {
          id: 'shipmentId',
          label: t('cross_border.packingLists.form.field.shipment'),
          type: 'combobox',
          allowCustomValues: false,
          description: t('cross_border.packingLists.form.help.shipment'),
          loadOptions: async () => (
            shipmentRef ? [{ value: shipmentRef.id, label: shipmentRef.label }] : []
          ),
        }
      : {
          id: 'shipmentId',
          label: t('cross_border.packingLists.form.field.shipment'),
          description: t('cross_border.packingLists.form.help.shipment'),
          type: 'combobox',
          required: true,
          allowCustomValues: false,
          loadOptions: (query) =>
            contractId ? loadContractShipmentOptions(t, contractId, query) : loadShipmentOptions(t, query),
        }
    return [
      shipmentField,
      {
        id: 'documentNumber',
        label: t('cross_border.shipments.documents.field.documentNumber'),
        type: 'text',
        layout: 'half',
      },
      {
        id: 'issuedAt',
        label: t('cross_border.shipments.documents.field.issuedAt'),
        type: 'date',
        layout: 'half',
      },
      {
        id: 'attachmentId',
        label: t('cross_border.shipments.documents.field.attachment'),
        type: 'custom',
        rendersOwnError: true,
        component: (props) => (
          <ShipmentDocumentAttachmentField
            {...props}
            shipmentId={(values) => (typeof values?.shipmentId === 'string' ? values.shipmentId : '')}
          />
        ),
      },
      {
        id: 'note',
        label: t('cross_border.shipments.documents.field.note'),
        type: 'textarea',
      },
    ]
  }, [contractId, mode, shipmentRef, t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'packingListHead',
      column: 1,
      fields: ['shipmentId', 'documentNumber', 'issuedAt', 'attachmentId', 'note'],
    },
    {
      id: 'packingListLines',
      column: 1,
      bare: true,
      component: (context) => <PackingListLinesEditor {...context} t={t} />,
    },
  ], [t])

  const handleSubmit = React.useCallback(async (values: PackingListFormValues) => {
    const payload = buildPackingListPayload(values)
    try {
      if (mode === 'edit' && documentId) {
        await updateCrud(SHIPMENT_DOCUMENTS_API_PATH, { id: documentId, ...payload }, {
          errorMessage: t('cross_border.shipments.documents.saveFailed'),
        })
      } else {
        await createCrud<{ id?: string }>(SHIPMENT_DOCUMENTS_API_PATH, payload, {
          errorMessage: t('cross_border.shipments.documents.saveFailed'),
        })
      }
    } catch (cause) {
      if (surfaceRecordConflict(cause, t)) return
      throw cause
    }
    flash(
      mode === 'edit' ? t('cross_border.packingLists.form.updated') : t('cross_border.shipments.documents.saved'),
      'success',
    )
    router.push(PACKING_LISTS_LIST_HREF)
    router.refresh()
  }, [documentId, mode, router, t])

  if (loadError) {
    return (
      <p className="text-sm text-status-error-text" role="alert">
        {loadError}
      </p>
    )
  }

  if (!initialValues) {
    return <p className="text-sm text-muted-foreground">{t('cross_border.packingLists.form.loading')}</p>
  }

  return (
    <CrudForm<PackingListFormValues>
      title={mode === 'edit'
        ? t('cross_border.packingLists.form.editTitle')
        : t('cross_border.packingLists.form.createTitle')}
      titleHeadingLevel={1}
      backHref={backHref}
      fields={fields}
      groups={groups}
      initialValues={initialValues}
      submitLabel={t('cross_border.shipments.form.save')}
      cancelHref={PACKING_LISTS_LIST_HREF}
      onSubmit={handleSubmit}
    />
  )
}
