"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import {
  CrudForm,
  type CrudField,
  type CrudFormGroup,
  type CrudFormGroupComponentProps,
} from '@open-mercato/ui/backend/CrudForm'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { pushWithFlash } from '@open-mercato/ui/backend/utils/flash'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { FieldLabel } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { parseExactDecimal } from '@open-mercato/core/modules/dashboards/lib/exactDecimal'
import { AMOUNT_SCALE, multiplyExactDecimal, toAmountString } from '../lib/money'
import { OurPartyPicker } from './ContractForm'
import {
  DOCUMENT_DIRECTIONS,
  DOCUMENT_SOURCE_KINDS,
  documentDirectionLabel,
  documentListHref,
  documentSourceKindLabel,
  type DocumentKind,
} from './DocumentsTable'
import {
  loadContractOptions,
  loadContractSourceHeadFacts,
  loadCurrencyOptions,
  loadOrderSourceHeadFacts,
  loadPaymentTermOptions,
  loadProductOption,
  loadProductOptions,
  loadPurchaseOrderOptions,
  loadSalesOrderOptions,
  loadShipmentOptions,
  readText,
  snapshotText,
  useUnitOptions,
  withCurrentUnit,
  type ProductOption,
} from './formOptions'
import { directionLabel } from './contractLabels'
import { CounterpartyPicker } from './CounterpartyPicker'
import { COUNTERPARTY_KIND_BY_DIRECTION } from '../data/validators'
import {
  SourcePreviewDrawer,
  type SourcePreviewField,
  type SourcePreviewLine,
} from '@/lib/source-preview/SourcePreviewDrawer'
import { contractPreviewLines, orderPreviewLines, sourcePreviewFields } from './sourcePreview'

const DOCUMENTS_API_PATH = 'trade_docs/documents'
const DOCUMENT_LINES_API_PATH = 'trade_docs/documents/lines'
const CONTRACTS_API_PATH = 'trade_docs/contracts'
const CONTRACT_LINES_API_PATH = 'trade_docs/contracts/lines'
const SALES_ORDER_LINES_API_PATH = 'sales/order-lines'
const PURCHASE_ORDER_LINES_API_PATH = 'purchasing/purchase-orders/lines'
/**
 * The installed sales line collections answer a larger `pageSize` with a 400 — 100 is their cap, the
 * same limit `internal_sales/lib/quoteLoad` documents — while this module's own contract lines route
 * accepts 500 (the limit the contract-reference copy has always read with).
 */
const ORDER_LINES_PAGE_SIZE = 100
const CONTRACT_LINES_PAGE_SIZE = 500

/** The order anchor the "copy lines from an order" dialog can draw from. */
type OrderAnchorKind = 'sales_order' | 'purchase_order'

export type DocumentLineValues = {
  productId: string
  name: string
  sku: string
  model: string
  spec: string
  unit: string
  quantity: string
  unitPrice: string
  amount: string
  note: string
  /** True once the operator typed an amount; a later quantity/price edit then leaves it alone. */
  amountTouched: boolean
  /** Frozen provenance of a copied line (`{kind:'order_line', id, orderKind, copiedAt}`). */
  sourceSnapshot: Record<string, unknown> | null
}

export type DocumentFormValues = {
  id?: string
  direction: string
  counterpartyId: string
  /** Bank account id the counterparty bank text was filled from; carried into the snapshot. */
  counterpartyBankAccountId: string
  counterpartyName: string
  counterpartyAddress: string
  counterpartyContact: string
  counterpartyBank: string
  ourPartyId: string
  ourPartyBankAccountId: string
  ourPartyName: string
  ourPartyAddress: string
  ourPartyContact: string
  ourPartyBank: string
  currencyCode: string
  exchangeRate: string
  paymentTerms: string
  incoterms: string
  validUntil: string
  deliveryDate: string
  notes: string
  sourceKind: string
  sourceId: string
  /** Display fields of the picked anchor record; they become `sourceSnapshot`. */
  sourceNumber: string
  sourceCounterparty: string
  /** The contract this document belongs to (0..1); only the id travels, the server resolves the snapshot. */
  contractId: string
  /** CI-only head: consignee and notify party are frozen snapshots, not master-data references. */
  consigneeName: string
  consigneeAddress: string
  notifyPartyName: string
  notifyPartyAddress: string
  lines: DocumentLineValues[]
  updatedAt?: string | null
}

export type DocumentRecord = DocumentFormValues & { id: string }

function emptyLine(): DocumentLineValues {
  return {
    productId: '',
    name: '',
    sku: '',
    model: '',
    spec: '',
    unit: 'PCS',
    quantity: '1',
    unitPrice: '0',
    amount: '0',
    note: '',
    amountTouched: false,
    sourceSnapshot: null,
  }
}

function emptyDocumentValues(): DocumentFormValues {
  return {
    direction: 'sales',
    counterpartyId: '',
    counterpartyBankAccountId: '',
    counterpartyName: '',
    counterpartyAddress: '',
    counterpartyContact: '',
    counterpartyBank: '',
    ourPartyId: '',
    ourPartyBankAccountId: '',
    ourPartyName: '',
    ourPartyAddress: '',
    ourPartyContact: '',
    ourPartyBank: '',
    currencyCode: '',
    exchangeRate: '',
    paymentTerms: '',
    incoterms: '',
    validUntil: '',
    deliveryDate: '',
    notes: '',
    sourceKind: 'manual',
    sourceId: '',
    sourceNumber: '',
    sourceCounterparty: '',
    contractId: '',
    consigneeName: '',
    consigneeAddress: '',
    notifyPartyName: '',
    notifyPartyAddress: '',
    lines: [emptyLine()],
    updatedAt: null,
  }
}

/**
 * Default face amount: `HALF_UP(quantity × unitPrice, 2)` — the system-wide amount scale. The
 * operator can always override the figure, and the server recomputes the head totals from the
 * stored amount.
 */
function defaultLineAmount(quantity: string, unitPrice: string): string {
  const q = parseExactDecimal(quantity)
  const p = parseExactDecimal(unitPrice)
  if (!q || !p) return '0'
  return toAmountString(multiplyExactDecimal(q, p), AMOUNT_SCALE)
}

function toDocumentLineValues(item: Record<string, unknown>): DocumentLineValues {
  return {
    productId: readText(item, 'productId', 'product_id'),
    name: readText(item, 'name'),
    sku: readText(item, 'sku'),
    model: readText(item, 'model'),
    spec: readText(item, 'spec'),
    unit: readText(item, 'unit'),
    quantity: readText(item, 'quantity') || '0',
    unitPrice: readText(item, 'unitPrice', 'unit_price') || '0',
    amount: readText(item, 'amount') || '0',
    note: readText(item, 'note'),
    amountTouched: false,
    sourceSnapshot: (item.sourceSnapshot ?? item.source_snapshot ?? null) as Record<string, unknown> | null,
  }
}

export function toDocumentFormValues(
  item: Record<string, unknown>,
  lines: DocumentLineValues[],
): DocumentRecord {
  const counterpartySnapshot = item.counterpartySnapshot ?? item.counterparty_snapshot
  const ourPartySnapshot = item.ourPartySnapshot ?? item.our_party_snapshot
  const consigneeSnapshot = (item.consigneeSnapshot ?? item.consignee_snapshot ?? null) as Record<string, unknown> | null
  const notifyPartySnapshot = (item.notifyPartySnapshot ?? item.notify_party_snapshot ?? null) as Record<string, unknown> | null
  const sourceSnapshot = (item.sourceSnapshot ?? item.source_snapshot ?? null) as Record<string, unknown> | null
  const updatedAt = item.updatedAt ?? item.updated_at
  return {
    id: readText(item, 'id'),
    direction: readText(item, 'direction') || 'sales',
    counterpartyId: readText(item, 'counterpartyId', 'counterparty_id'),
    counterpartyBankAccountId: snapshotText(counterpartySnapshot, 'bankAccountId'),
    counterpartyName: readText(item, 'counterpartyName', 'counterparty_name') || snapshotText(counterpartySnapshot),
    counterpartyAddress: snapshotText(counterpartySnapshot, 'address'),
    counterpartyContact: snapshotText(counterpartySnapshot, 'contact'),
    counterpartyBank: snapshotText(counterpartySnapshot, 'bank'),
    ourPartyId: snapshotText(ourPartySnapshot, 'organizationId'),
    ourPartyBankAccountId: snapshotText(ourPartySnapshot, 'bankAccountId'),
    ourPartyName: snapshotText(ourPartySnapshot, 'name'),
    ourPartyAddress: snapshotText(ourPartySnapshot, 'address'),
    ourPartyContact: snapshotText(ourPartySnapshot, 'contact'),
    ourPartyBank: snapshotText(ourPartySnapshot, 'bank'),
    currencyCode: readText(item, 'currencyCode', 'currency_code'),
    exchangeRate: readText(item, 'exchangeRate', 'exchange_rate'),
    paymentTerms: readText(item, 'paymentTerms', 'payment_terms'),
    incoterms: readText(item, 'incoterms'),
    validUntil: (item.validUntil ?? item.valid_until ?? '') as string,
    deliveryDate: (item.deliveryDate ?? item.delivery_date ?? '') as string,
    notes: readText(item, 'notes'),
    sourceKind: readText(item, 'sourceKind', 'source_kind') || 'manual',
    sourceId: readText(item, 'sourceId', 'source_id'),
    sourceNumber: snapshotText(sourceSnapshot, 'number'),
    sourceCounterparty: snapshotText(sourceSnapshot, 'counterparty'),
    contractId: readText(item, 'contractId', 'contract_id'),
    consigneeName: snapshotText(consigneeSnapshot, 'name'),
    consigneeAddress: snapshotText(consigneeSnapshot, 'address'),
    notifyPartyName: snapshotText(notifyPartySnapshot, 'name'),
    notifyPartyAddress: snapshotText(notifyPartySnapshot, 'address'),
    lines: lines.length > 0 ? lines : [emptyLine()],
    updatedAt: typeof updatedAt === 'string' ? updatedAt : null,
  }
}

function trimmedOrNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function partySnapshot(values: { name: string; address: string; contact: string; bank: string }): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {}
  if (values.name.trim()) snapshot.name = values.name.trim()
  if (values.address.trim()) snapshot.address = values.address.trim()
  if (values.contact.trim()) snapshot.contact = values.contact.trim()
  if (values.bank.trim()) snapshot.bank = values.bank.trim()
  return snapshot
}

/** Builds the head payload; lines travel through the dedicated lines endpoint. `kind` is create-only. */
export function buildDocumentPayload(values: DocumentFormValues): Record<string, unknown> {
  const ourParty = partySnapshot({
    name: values.ourPartyName,
    address: values.ourPartyAddress,
    contact: values.ourPartyContact,
    bank: values.ourPartyBank,
  })
  if (values.ourPartyId.trim()) ourParty.organizationId = values.ourPartyId.trim()
  if (values.ourPartyBankAccountId.trim()) ourParty.bankAccountId = values.ourPartyBankAccountId.trim()

  const counterparty = partySnapshot({
    name: values.counterpartyName,
    address: values.counterpartyAddress,
    contact: values.counterpartyContact,
    bank: values.counterpartyBank,
  })
  if (counterparty && values.counterpartyBankAccountId.trim()) {
    counterparty.bankAccountId = values.counterpartyBankAccountId.trim()
  }

  const sourceSnapshot: Record<string, unknown> = {}
  if (values.sourceNumber.trim()) sourceSnapshot.number = values.sourceNumber.trim()
  if (values.sourceCounterparty.trim()) sourceSnapshot.counterparty = values.sourceCounterparty.trim()

  const consignee = partySnapshot({
    name: values.consigneeName,
    address: values.consigneeAddress,
    contact: '',
    bank: '',
  })
  const notifyParty = partySnapshot({
    name: values.notifyPartyName,
    address: values.notifyPartyAddress,
    contact: '',
    bank: '',
  })

  const hasAnchor = values.sourceKind !== 'manual' && values.sourceId.trim().length > 0

  return {
    direction: values.direction,
    // Derived, never a separate operator choice: the direction decides who the counterparty can be.
    counterpartyKind: COUNTERPARTY_KIND_BY_DIRECTION[values.direction as keyof typeof COUNTERPARTY_KIND_BY_DIRECTION],
    counterpartyId: values.counterpartyId.trim() ? values.counterpartyId.trim() : null,
    counterpartySnapshot: Object.keys(counterparty).length > 0 ? counterparty : null,
    ourPartySnapshot: Object.keys(ourParty).length > 0 ? ourParty : null,
    consigneeSnapshot: Object.keys(consignee).length > 0 ? consignee : null,
    notifyPartySnapshot: Object.keys(notifyParty).length > 0 ? notifyParty : null,
    currencyCode: values.currencyCode.trim().toUpperCase(),
    exchangeRate: values.exchangeRate.trim() ? values.exchangeRate.trim() : null,
    paymentTerms: trimmedOrNull(values.paymentTerms),
    incoterms: trimmedOrNull(values.incoterms),
    validUntil: trimmedOrNull(values.validUntil),
    deliveryDate: trimmedOrNull(values.deliveryDate),
    notes: trimmedOrNull(values.notes),
    sourceKind: hasAnchor ? values.sourceKind : 'manual',
    sourceId: hasAnchor ? values.sourceId.trim() : null,
    sourceSnapshot: hasAnchor && Object.keys(sourceSnapshot).length > 0 ? sourceSnapshot : null,
    // `null` unbinds the document; the server resolves the number/direction snapshot from the id.
    contractId: values.contractId.trim() ? values.contractId.trim() : null,
  }
}

/** Rows the operator meant to add: a blank row is dropped before it reaches the API. */
export function buildDocumentLines(values: DocumentFormValues): Array<Record<string, unknown>> {
  return values.lines
    .filter((line) => line.productId.trim().length > 0 || line.name.trim().length > 0)
    .map((line) => ({
      productId: line.productId.trim() ? line.productId.trim() : null,
      name: trimmedOrNull(line.name),
      sku: trimmedOrNull(line.sku),
      model: trimmedOrNull(line.model),
      spec: trimmedOrNull(line.spec),
      unit: trimmedOrNull(line.unit),
      quantity: line.quantity.trim() ? line.quantity.trim() : '0',
      unitPrice: line.unitPrice.trim() ? line.unitPrice.trim() : '0',
      amount: line.amount.trim() ? line.amount.trim() : '0',
      note: trimmedOrNull(line.note),
      sourceSnapshot: line.sourceSnapshot,
    }))
}

/**
 * Anchor selector (F-108): the document's 来源单据 plus the id it points at.
 *
 * The picker's option source follows the kind, and picking an order records its display fields
 * (`number` + counterparty) so `sourceSnapshot` survives a later change to that order. `manual`
 * clears the anchor; the document then carries no source.
 */
function DocumentAnchorEditor({ values, setValue, t, kind }: CrudFormGroupComponentProps & { t: TranslateFn; kind: DocumentKind }) {
  const sourceKind = typeof values.sourceKind === 'string' ? values.sourceKind : 'manual'
  const sourceId = typeof values.sourceId === 'string' ? values.sourceId : ''
  const sourceNumber = typeof values.sourceNumber === 'string' ? values.sourceNumber : ''
  const sourceCounterparty = typeof values.sourceCounterparty === 'string' ? values.sourceCounterparty : ''
  const anchorCache = React.useRef(new Map<string, { number: string; counterparty: string }>())
  // A shipment anchor is CI-only: a PI is raised before anything ships.
  const anchorKinds = kind === 'commercial'
    ? DOCUMENT_SOURCE_KINDS
    : DOCUMENT_SOURCE_KINDS.filter((value) => value !== 'shipment')

  const handleKindChange = React.useCallback(
    (next: string) => {
      setValue('sourceKind', next)
      setValue('sourceId', '')
      setValue('sourceNumber', '')
      setValue('sourceCounterparty', '')
    },
    [setValue],
  )

  const handleAnchorChange = React.useCallback(
    (next: string) => {
      setValue('sourceId', next)
      const cached = anchorCache.current.get(next)
      setValue('sourceNumber', cached?.number ?? '')
      setValue('sourceCounterparty', cached?.counterparty ?? '')
    },
    [setValue],
  )

  const seedLabel = [sourceNumber, sourceCounterparty].filter((part) => part.length > 0).join(' — ')

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="space-y-1.5">
        <FieldLabel htmlFor="document-source-kind">
          {t('trade_docs.documents.form.field.sourceKind', '来源单据')}
        </FieldLabel>
        <Select value={sourceKind} onValueChange={handleKindChange}>
          <SelectTrigger id="document-source-kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {anchorKinds.map((value) => (
              <SelectItem key={value} value={value}>
                {documentSourceKindLabel(t, value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <FieldLabel htmlFor="document-source-id">
          {t('trade_docs.documents.form.field.sourceId', '来源单号')}
        </FieldLabel>
        <ComboboxInput
          value={sourceId}
          onChange={handleAnchorChange}
          disabled={sourceKind === 'manual'}
          placeholder={
            sourceKind === 'manual'
              ? t('trade_docs.documents.form.field.sourceManualHint', '手工录入的单据没有来源')
              : t('trade_docs.documents.form.field.sourceIdPlaceholder', '搜索并选择来源单据')
          }
          seedOptions={sourceId && seedLabel ? [{ value: sourceId, label: seedLabel }] : undefined}
          loadSuggestions={async (query) => {
            if (sourceKind === 'manual') return []
            const options =
              sourceKind === 'purchase_order'
                ? await loadPurchaseOrderOptions(query)
                : sourceKind === 'shipment'
                  ? await loadShipmentOptions(query)
                  : await loadSalesOrderOptions(query)
            for (const option of options) {
              const [number, ...rest] = option.label.split(' — ')
              anchorCache.current.set(option.value, { number, counterparty: rest.join(' — ') })
            }
            return options.map<ComboboxOption>((option) => ({ value: option.value, label: option.label }))
          }}
          allowCustomValues={false}
          clearable
        />
        <p className="text-xs text-muted-foreground">
          {t('trade_docs.documents.form.field.sourceIdHelp', '一张订单可以关联多张单据；来源单号与对方会写入快照。')}
        </p>
      </div>
    </div>
  )
}

type OrderLineDraft = {
  productId: string
  name: string
  sku: string
  unit: string
  quantity: string
  unitPrice: string
  note: string
}

function salesLineToDraft(item: Record<string, unknown>): OrderLineDraft {
  return {
    productId: readText(item, 'productId', 'product_id'),
    name: readText(item, 'name'),
    sku: readText(item, 'sku') || snapshotText(item.catalogSnapshot ?? item.catalog_snapshot, 'sku'),
    unit: readText(item, 'quantityUnit', 'quantity_unit') || snapshotText(item.catalogSnapshot ?? item.catalog_snapshot, 'unit'),
    quantity: readText(item, 'quantity') || '0',
    unitPrice: readText(item, 'unitPriceNet', 'unit_price_net') || '0',
    note: readText(item, 'comment'),
  }
}

function purchaseLineToDraft(item: Record<string, unknown>): OrderLineDraft {
  return {
    productId: readText(item, 'productId', 'product_id'),
    name: readText(item, 'productTitle', 'product_title'),
    sku: readText(item, 'productSku', 'product_sku') || readText(item, 'supplierSku', 'supplier_sku'),
    unit: readText(item, 'productUnit', 'product_unit'),
    quantity: readText(item, 'quantity') || '0',
    unitPrice: readText(item, 'unitPrice', 'unit_price') || '0',
    note: readText(item, 'note'),
  }
}

function DocumentLinesEditor({ values, setValue, t }: CrudFormGroupComponentProps & { t: TranslateFn }) {
  const { organizationId } = useOrganizationScopeDetail()
  const unitOptions = useUnitOptions()
  const lines = React.useMemo(() => {
    const raw = values.lines
    return Array.isArray(raw) ? (raw as DocumentLineValues[]) : []
  }, [values.lines])
  const productCache = React.useRef(new Map<string, ProductOption>())
  const linesRef = React.useRef(lines)
  linesRef.current = lines

  const [copyOpen, setCopyOpen] = React.useState(false)
  const [copyKind, setCopyKind] = React.useState<OrderAnchorKind>('sales_order')
  const [copyOrderId, setCopyOrderId] = React.useState('')
  const [copyOrderLabel, setCopyOrderLabel] = React.useState('')
  const [isCopying, setIsCopying] = React.useState(false)
  const [refOpen, setRefOpen] = React.useState(false)
  const [refContractId, setRefContractId] = React.useState('')
  const [isReferencing, setIsReferencing] = React.useState(false)
  /** The read-only source preview (order or contract) the copy dialogs open. */
  const [previewOpen, setPreviewOpen] = React.useState(false)
  const [previewBusy, setPreviewBusy] = React.useState(false)
  const [previewError, setPreviewError] = React.useState<string | null>(null)
  const [previewTitle, setPreviewTitle] = React.useState('')
  const [previewSubtitle, setPreviewSubtitle] = React.useState('')
  const [previewFields, setPreviewFields] = React.useState<SourcePreviewField[]>([])
  const [previewLines, setPreviewLines] = React.useState<SourcePreviewLine[]>([])
  /** Guards the preview state against a read that a newer click has superseded. */
  const previewRequest = React.useRef(0)
  /** Lines already read per source, so preview → copy never fetches the same document twice. */
  const sourceLinesCache = React.useRef(new Map<string, Record<string, unknown>[]>())
  const formContractId = typeof values.contractId === 'string' ? values.contractId.trim() : ''

  const cacheProducts = React.useCallback((options: ProductOption[]) => {
    for (const option of options) productCache.current.set(option.value, option)
  }, [])

  const updateLine = React.useCallback(
    (index: number, patch: Partial<DocumentLineValues>) => {
      const next = lines.map((line, position) => (position === index ? { ...line, ...patch } : line))
      setValue('lines', next)
    },
    [lines, setValue],
  )

  const addLine = React.useCallback(() => {
    setValue('lines', [...lines, emptyLine()])
  }, [lines, setValue])

  const removeLine = React.useCallback(
    (index: number) => {
      const next = lines.filter((_, position) => position !== index)
      setValue('lines', next.length > 0 ? next : [emptyLine()])
    },
    [lines, setValue],
  )

  const handleQuantityOrPrice = React.useCallback(
    (index: number, patch: Partial<DocumentLineValues>) => {
      const current = linesRef.current[index]
      if (!current) return
      const merged = { ...current, ...patch }
      updateLine(index, {
        ...patch,
        ...(merged.amountTouched ? {} : { amount: defaultLineAmount(merged.quantity, merged.unitPrice) }),
      })
    },
    [updateLine],
  )

  const handleProductChange = React.useCallback(
    (index: number, productId: string) => {
      if (!productId) {
        updateLine(index, { productId: '' })
        return
      }
      updateLine(index, { productId })
      const cached = productCache.current.get(productId)
      if (cached) {
        updateLine(index, {
          productId,
          name: cached.name,
          sku: cached.sku,
          model: cached.model,
          spec: cached.spec,
          unit: cached.unit || 'PCS',
        })
        return
      }
      void loadProductOption(productId, t('trade_docs.documents.form.lines.productLoadFailed', '商品列表加载失败'), organizationId)
        .then((option) => {
          if (!option) return
          cacheProducts([option])
          const current = linesRef.current[index]
          if (!current || current.productId !== productId) return
          updateLine(index, {
            name: current.name?.trim() ? current.name : option.name,
            sku: current.sku?.trim() ? current.sku : option.sku,
            model: current.model?.trim() ? current.model : option.model,
            spec: current.spec?.trim() ? current.spec : option.spec,
            unit: current.unit?.trim() ? current.unit : option.unit || 'PCS',
          })
        })
        .catch(() => undefined)
    },
    [cacheProducts, organizationId, t, updateLine],
  )

  const openCopyDialog = React.useCallback(() => {
    const anchorKind = typeof values.sourceKind === 'string' ? values.sourceKind : 'manual'
    if (anchorKind === 'sales_order' || anchorKind === 'purchase_order') {
      setCopyKind(anchorKind)
    }
    const anchorId = typeof values.sourceId === 'string' ? values.sourceId : ''
    setCopyOrderId(anchorKind === 'sales_order' || anchorKind === 'purchase_order' ? anchorId : '')
    setCopyOrderLabel('')
    setCopyOpen(true)
  }, [values.sourceId, values.sourceKind])

  /** One read per source, shared by the preview and the copy that follows it. */
  const readSourceItems = React.useCallback(
    async (cacheKey: string, path: string, parentParam: string, parentId: string, pageSize: number) => {
      const cached = sourceLinesCache.current.get(cacheKey)
      if (cached) return cached
      const payload = await fetchCrudList<Record<string, unknown>>(path, {
        [parentParam]: parentId,
        pageSize,
      })
      const items = payload.items ?? []
      sourceLinesCache.current.set(cacheKey, items)
      return items
    },
    [],
  )

  const readOrderItems = React.useCallback(
    (kind: OrderAnchorKind, id: string) =>
      readSourceItems(
        `${kind}:${id}`,
        kind === 'purchase_order' ? PURCHASE_ORDER_LINES_API_PATH : SALES_ORDER_LINES_API_PATH,
        'orderId',
        id,
        ORDER_LINES_PAGE_SIZE,
      ),
    [readSourceItems],
  )

  const readContractItems = React.useCallback(
    (id: string) =>
      readSourceItems(`contract:${id}`, CONTRACT_LINES_API_PATH, 'contractId', id, CONTRACT_LINES_PAGE_SIZE),
    [readSourceItems],
  )

  const handlePreviewOrder = React.useCallback(async () => {
    const id = copyOrderId.trim()
    if (!id) {
      flash(t('trade_docs.documents.form.lines.copyOrderRequired', '请先选择一张订单'), 'error')
      return
    }
    const request = previewRequest.current + 1
    previewRequest.current = request
    setPreviewTitle(t('trade_docs.documents.form.lines.preview.orderTitle', 'Order preview'))
    setPreviewOpen(true)
    setPreviewBusy(true)
    setPreviewError(null)
    setPreviewFields([])
    setPreviewLines([])
    setPreviewSubtitle(id.slice(0, 8))
    try {
      const [facts, items] = await Promise.all([loadOrderSourceHeadFacts(copyKind, id), readOrderItems(copyKind, id)])
      if (previewRequest.current !== request) return
      setPreviewSubtitle(
        facts ? [facts.number, facts.counterparty].filter((part) => part.length > 0).join(' — ') : id.slice(0, 8),
      )
      setPreviewFields(sourcePreviewFields(facts, t, id))
      setPreviewLines(
        orderPreviewLines(
          items,
          copyKind === 'purchase_order' ? 'purchase_order' : 'sales',
          facts?.currencyCode ?? '',
          t('ui.sourcePreview.unnamedLine', '(Unnamed line)'),
        ),
      )
    } catch (error) {
      if (previewRequest.current !== request) return
      setPreviewError(
        error instanceof Error && error.message
          ? error.message
          : t('ui.sourcePreview.previewFailed', 'Could not load the source document preview'),
      )
    } finally {
      if (previewRequest.current === request) setPreviewBusy(false)
    }
  }, [copyKind, copyOrderId, readOrderItems, t])

  const handlePreviewContract = React.useCallback(async () => {
    const id = refContractId.trim()
    if (!id) {
      flash(t('trade_docs.documents.form.lines.contractRefRequired', '请先选择一张合同'), 'error')
      return
    }
    const request = previewRequest.current + 1
    previewRequest.current = request
    setPreviewTitle(t('trade_docs.documents.form.lines.preview.contractTitle', 'Contract preview'))
    setPreviewOpen(true)
    setPreviewBusy(true)
    setPreviewError(null)
    setPreviewFields([])
    setPreviewLines([])
    setPreviewSubtitle(id.slice(0, 8))
    try {
      const [facts, items] = await Promise.all([loadContractSourceHeadFacts(id), readContractItems(id)])
      if (previewRequest.current !== request) return
      setPreviewSubtitle(
        facts ? [facts.number, facts.counterparty].filter((part) => part.length > 0).join(' — ') : id.slice(0, 8),
      )
      setPreviewFields(sourcePreviewFields(facts, t, id))
      setPreviewLines(
        contractPreviewLines(items, facts?.currencyCode ?? '', t('ui.sourcePreview.unnamedLine', '(Unnamed line)')),
      )
    } catch (error) {
      if (previewRequest.current !== request) return
      setPreviewError(
        error instanceof Error && error.message
          ? error.message
          : t('ui.sourcePreview.previewFailed', 'Could not load the source document preview'),
      )
    } finally {
      if (previewRequest.current === request) setPreviewBusy(false)
    }
  }, [readContractItems, refContractId, t])

  const handleCopyLines = React.useCallback(async () => {
    if (!copyOrderId.trim()) {
      flash(t('trade_docs.documents.form.lines.copyOrderRequired', '请先选择一张订单'), 'error')
      return
    }
    setIsCopying(true)
    try {
      const items = await readOrderItems(copyKind, copyOrderId.trim())
      const copiedAt = new Date().toISOString()
      const appended: DocumentLineValues[] = items.map((item) => {
        const draft = copyKind === 'purchase_order' ? purchaseLineToDraft(item) : salesLineToDraft(item)
        return {
          productId: draft.productId,
          name: draft.name,
          sku: draft.sku,
          model: '',
          spec: '',
          unit: draft.unit || 'PCS',
          quantity: draft.quantity || '0',
          unitPrice: draft.unitPrice || '0',
          amount: defaultLineAmount(draft.quantity, draft.unitPrice),
          note: draft.note,
          amountTouched: false,
          sourceSnapshot: {
            kind: 'order_line',
            id: readText(item, 'id'),
            orderKind: copyKind,
            copiedAt,
          },
        }
      })
      const existing = linesRef.current.filter((line) => line.productId.trim() || line.name.trim())
      if (appended.length === 0) {
        flash(t('trade_docs.documents.form.lines.copyOrderEmpty', '该订单没有可复制的行'), 'error')
        return
      }
      setValue('lines', existing.length > 0 ? [...existing, ...appended] : appended)
      flash(t('trade_docs.documents.form.lines.copied', '已从订单复制行'), 'success')
      setCopyOpen(false)
    } catch (error) {
      flash(
        error instanceof Error && error.message
          ? error.message
          : t('trade_docs.documents.form.lines.copyFailed', '复制行失败'),
        'error',
      )
    } finally {
      setIsCopying(false)
    }
  }, [copyKind, copyOrderId, readOrderItems, setValue, t])

  /**
   * 「从合同引用商品行」: one-shot copy of a contract's lines into editable document lines. Re-running
   * replaces the previously contract-copied batch (identified by `sourceSnapshot.kind === 'contract_line'`)
   * instead of appending duplicates, and never touches hand-typed or order-copied rows.
   */
  const copyContractLines = React.useCallback(
    async (targetContractId: string) => {
      const scopedContractId = targetContractId.trim()
      if (!scopedContractId) {
        flash(t('trade_docs.documents.form.lines.contractRefRequired', '请先选择一张合同'), 'error')
        return
      }
      setIsReferencing(true)
      try {
        const [facts, items] = await Promise.all([
          loadContractSourceHeadFacts(scopedContractId),
          readContractItems(scopedContractId),
        ])
        const contractNumber = facts?.number ?? ''
        const copiedAt = new Date().toISOString()
        const copied: DocumentLineValues[] = items.map((item) => {
          const quantity = readText(item, 'quantity') || '0'
          const unitPrice = readText(item, 'unitPrice', 'unit_price') || '0'
          return {
            productId: readText(item, 'productId', 'product_id'),
            name: readText(item, 'name'),
            sku: readText(item, 'sku'),
            model: readText(item, 'model'),
            spec: readText(item, 'spec'),
            unit: readText(item, 'unit') || 'PCS',
            quantity,
            unitPrice,
            amount: defaultLineAmount(quantity, unitPrice),
            note: '',
            amountTouched: false,
            // Freeze the contract-line origin per row, like the order copy does.
            sourceSnapshot: {
              kind: 'contract_line',
              contractId: scopedContractId,
              lineId: readText(item, 'id'),
              number: contractNumber,
              copiedAt,
            },
          }
        })
        if (copied.length === 0) {
          flash(t('trade_docs.documents.form.lines.contractRefEmpty', '该合同没有可引用的商品行'), 'error')
          return
        }
        const kept = linesRef.current.filter(
          (line) =>
            (line.productId.trim() || line.name.trim()) &&
            (line.sourceSnapshot?.kind ?? '') !== 'contract_line',
        )
        setValue('lines', kept.length > 0 ? [...kept, ...copied] : copied)
        flash(t('trade_docs.documents.form.lines.contractRefCopied', '已从合同引用商品行'), 'success')
        setRefOpen(false)
      } catch (error) {
        flash(
          error instanceof Error && error.message
            ? error.message
            : t('trade_docs.documents.form.lines.contractRefFailed', '引用商品行失败'),
          'error',
        )
      } finally {
        setIsReferencing(false)
      }
    },
    [readContractItems, setValue, t],
  )

  // With a contract already on the form, copy straight from it; otherwise ask which contract first.
  const openContractReference = React.useCallback(() => {
    if (formContractId) {
      void copyContractLines(formContractId)
      return
    }
    setRefContractId('')
    setRefOpen(true)
  }, [copyContractLines, formContractId])

  return (
    <div className="space-y-4">
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('trade_docs.documents.form.lines.empty', '还没有明细。添加一行或从订单复制行。')}
        </p>
      ) : null}
      {lines.map((line, index) => (
        <div key={line.productId || `line-${index}`} className="space-y-3 rounded-lg border border-border p-3">
          <div className="grid gap-3 md:grid-cols-12">
            <div className="space-y-1.5 md:col-span-6">
              <FieldLabel htmlFor={`document-line-product-${index}`}>
                {t('trade_docs.documents.form.lines.product', '商品')}
              </FieldLabel>
              <ComboboxInput
                value={line.productId}
                onChange={(next) => handleProductChange(index, next)}
                placeholder={t('trade_docs.documents.form.lines.selectProduct', '选择商品（可留空手填品名）')}
                seedOptions={
                  line.productId && (line.sku || line.name)
                    ? [{ value: line.productId, label: line.sku ? `${line.sku} — ${line.name}` : line.name }]
                    : undefined
                }
                loadSuggestions={async (query) => {
                  const options = await loadProductOptions(
                    t('trade_docs.documents.form.lines.productLoadFailed', '商品列表加载失败'),
                    query,
                    organizationId,
                  )
                  cacheProducts(options)
                  return options.map<ComboboxOption>((option) => ({ value: option.value, label: option.label }))
                }}
                allowCustomValues={false}
                clearable
              />
            </div>
            <div className="space-y-1.5 md:col-span-5">
              <FieldLabel htmlFor={`document-line-name-${index}`}>
                {t('trade_docs.documents.form.lines.name', '品名')}
              </FieldLabel>
              <Input
                id={`document-line-name-${index}`}
                value={line.name}
                onChange={(event) => updateLine(index, { name: event.target.value })}
              />
            </div>
            <div className="flex items-end justify-end md:col-span-1">
              <IconButton
                type="button"
                variant="ghost"
                size="lg"
                aria-label={t('trade_docs.documents.form.lines.remove', '删除')}
                onClick={() => removeLine(index)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            </div>
            <div className="space-y-1.5 md:col-span-3">
              <FieldLabel htmlFor={`document-line-sku-${index}`}>
                {t('trade_docs.documents.form.lines.sku', 'SKU')}
              </FieldLabel>
              <Input
                id={`document-line-sku-${index}`}
                value={line.sku}
                onChange={(event) => updateLine(index, { sku: event.target.value })}
              />
            </div>
            <div className="space-y-1.5 md:col-span-3">
              <FieldLabel htmlFor={`document-line-model-${index}`}>
                {t('trade_docs.documents.form.lines.model', '型号')}
              </FieldLabel>
              <Input
                id={`document-line-model-${index}`}
                value={line.model}
                onChange={(event) => updateLine(index, { model: event.target.value })}
              />
            </div>
            <div className="space-y-1.5 md:col-span-3">
              <FieldLabel htmlFor={`document-line-spec-${index}`}>
                {t('trade_docs.documents.form.lines.spec', '规格')}
              </FieldLabel>
              <Input
                id={`document-line-spec-${index}`}
                value={line.spec}
                onChange={(event) => updateLine(index, { spec: event.target.value })}
              />
            </div>
            <div className="space-y-1.5 md:col-span-3">
              <FieldLabel htmlFor={`document-line-unit-${index}`}>
                {t('trade_docs.documents.form.lines.unit', '单位')}
              </FieldLabel>
              <Select value={line.unit} onValueChange={(next) => updateLine(index, { unit: next })}>
                <SelectTrigger id={`document-line-unit-${index}`}>
                  <SelectValue placeholder={t('trade_docs.documents.form.lines.selectUnit', '选择单位')} />
                </SelectTrigger>
                <SelectContent>
                  {withCurrentUnit(unitOptions, line.unit).map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 md:col-span-3">
              <FieldLabel htmlFor={`document-line-quantity-${index}`}>
                {t('trade_docs.documents.form.lines.quantity', '数量')}
              </FieldLabel>
              <Input
                id={`document-line-quantity-${index}`}
                inputMode="decimal"
                value={line.quantity}
                onChange={(event) => handleQuantityOrPrice(index, { quantity: event.target.value })}
              />
            </div>
            <div className="space-y-1.5 md:col-span-3">
              <FieldLabel htmlFor={`document-line-price-${index}`}>
                {t('trade_docs.documents.form.lines.unitPrice', '单价')}
              </FieldLabel>
              <Input
                id={`document-line-price-${index}`}
                inputMode="decimal"
                value={line.unitPrice}
                onChange={(event) => handleQuantityOrPrice(index, { unitPrice: event.target.value })}
              />
            </div>
            <div className="space-y-1.5 md:col-span-3">
              <FieldLabel htmlFor={`document-line-amount-${index}`}>
                {t('trade_docs.documents.form.lines.amount', '金额')}
              </FieldLabel>
              <Input
                id={`document-line-amount-${index}`}
                inputMode="decimal"
                value={line.amount}
                onChange={(event) => updateLine(index, { amount: event.target.value, amountTouched: true })}
              />
            </div>
            <div className="space-y-1.5 md:col-span-6">
              <FieldLabel htmlFor={`document-line-note-${index}`}>
                {t('trade_docs.documents.form.lines.note', '备注')}
              </FieldLabel>
              <Input
                id={`document-line-note-${index}`}
                value={line.note}
                onChange={(event) => updateLine(index, { note: event.target.value })}
              />
            </div>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={addLine}>
          <Plus className="size-4" aria-hidden="true" />
          {t('trade_docs.documents.form.lines.add', '添加明细')}
        </Button>
        <Button type="button" variant="outline" onClick={openCopyDialog}>
          {t('trade_docs.documents.form.lines.copyFromOrder', '从订单复制行')}
        </Button>
        <Button type="button" variant="outline" onClick={openContractReference} disabled={isReferencing}>
          {t('trade_docs.documents.form.lines.copyFromContract', '从合同引用商品行')}
        </Button>
      </div>

      <Dialog open={copyOpen} onOpenChange={setCopyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('trade_docs.documents.form.lines.copyDialogTitle', '从订单复制行')}</DialogTitle>
            <DialogDescription>
              {t('trade_docs.documents.form.lines.copyDialogBody', '选择一张订单，把它现有的行追加到本单据；已录入的行不受影响。')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <FieldLabel htmlFor="document-copy-order-kind">
                {t('trade_docs.documents.form.lines.copyOrderKind', '订单类型')}
              </FieldLabel>
              <Select
                value={copyKind}
                onValueChange={(next) => {
                  setCopyKind(next as OrderAnchorKind)
                  setCopyOrderId('')
                  setCopyOrderLabel('')
                }}
              >
                <SelectTrigger id="document-copy-order-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sales_order">
                    {documentSourceKindLabel(t, 'sales_order')}
                  </SelectItem>
                  <SelectItem value="purchase_order">
                    {documentSourceKindLabel(t, 'purchase_order')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="document-copy-order">
                {t('trade_docs.documents.form.lines.copyOrder', '订单')}
              </FieldLabel>
              <ComboboxInput
                value={copyOrderId}
                onChange={(next) => {
                  setCopyOrderId(next)
                  setCopyOrderLabel('')
                }}
                seedOptions={
                  copyOrderId && copyOrderLabel ? [{ value: copyOrderId, label: copyOrderLabel }] : undefined
                }
                loadSuggestions={async (query) => {
                  const options =
                    copyKind === 'purchase_order'
                      ? await loadPurchaseOrderOptions(query)
                      : await loadSalesOrderOptions(query)
                  return options.map<ComboboxOption>((option) => ({ value: option.value, label: option.label }))
                }}
                allowCustomValues={false}
                clearable
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCopyOpen(false)} disabled={isCopying}>
              {t('ui.actions.cancel')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isCopying || copyOrderId.trim().length === 0}
              onClick={() => void handlePreviewOrder()}
            >
              {t('ui.actions.preview', 'Preview')}
            </Button>
            <Button type="button" disabled={isCopying || copyOrderId.trim().length === 0} onClick={() => void handleCopyLines()}>
              {t('trade_docs.documents.form.lines.copyConfirm', '复制行')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={refOpen} onOpenChange={setRefOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('trade_docs.documents.form.lines.contractRefTitle', '从合同引用商品行')}</DialogTitle>
            <DialogDescription>
              {t(
                'trade_docs.documents.form.lines.contractRefBody',
                '选择一张合同，把它现有的商品行复制成可编辑明细；再次执行会替换上一次复制的行，手工与订单行不受影响。',
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <FieldLabel htmlFor="document-contract-reference">
              {t('trade_docs.documents.form.field.contractId', '所属合同')}
            </FieldLabel>
            <ComboboxInput
              value={refContractId}
              onChange={setRefContractId}
              placeholder={t('trade_docs.documents.form.field.contractIdPlaceholder', '搜索并选择合同')}
              loadSuggestions={async (query) => {
                const options = await loadContractOptions(
                  t('trade_docs.documents.form.contractLoadFailed', '合同列表加载失败'),
                  organizationId,
                )
                const term = (query ?? '').trim().toLowerCase()
                return options
                  .filter((option) => (term ? option.label.toLowerCase().includes(term) : true))
                  .map<ComboboxOption>((option) => ({ value: option.value, label: option.label }))
              }}
              allowCustomValues={false}
              clearable
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setRefOpen(false)} disabled={isReferencing}>
              {t('ui.actions.cancel')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isReferencing || refContractId.trim().length === 0}
              onClick={() => void handlePreviewContract()}
            >
              {t('ui.actions.preview', 'Preview')}
            </Button>
            <Button
              type="button"
              disabled={isReferencing || refContractId.trim().length === 0}
              onClick={() => void copyContractLines(refContractId)}
            >
              {t('trade_docs.documents.form.lines.contractRefConfirm', '引用商品行')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <SourcePreviewDrawer
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        title={previewTitle}
        subtitle={previewSubtitle}
        busy={previewBusy}
        error={previewError}
        fields={previewFields}
        lines={previewLines}
      />
    </div>
  )
}

function useDocumentFields(t: TranslateFn, kind: DocumentKind): CrudField[] {
  const { organizationId } = useOrganizationScopeDetail()
  return React.useMemo<CrudField[]>(() => {
    const directionOptions = (kind === 'commercial' ? ['sales'] : DOCUMENT_DIRECTIONS).map((value) => ({
      value,
      label: documentDirectionLabel(t, value),
    }))
    return [
      {
        id: 'direction',
        label: t('trade_docs.documents.form.field.direction', '方向'),
        type: 'select',
        required: true,
        options: directionOptions,
        layout: 'half',
      },
      {
        id: 'contractId',
        label: t('trade_docs.documents.form.field.contractId', '所属合同'),
        type: 'combobox',
        layout: 'half',
        placeholder: t('trade_docs.documents.form.field.contractIdPlaceholder', '搜索并选择合同'),
        description: t('trade_docs.documents.form.field.contractIdHelp', '该单据属于哪张购销合同；留空表示不关联。'),
        allowCustomValues: false,
        loadOptions: () =>
          loadContractOptions(t('trade_docs.documents.form.contractLoadFailed', '合同列表加载失败'), organizationId),
        // A contract outside the loaded page (an older one) still renders its number/direction via
        // the contract's list route, exactly like the option label `loadContractOptions` builds.
        resolveLabel: async (value) => {
          const payload = await fetchCrudList<Record<string, unknown>>(CONTRACTS_API_PATH, { ids: value, pageSize: 1 })
          const item = payload.items?.[0]
          if (!item) return value
          const number = readText(item, 'number') || value.slice(0, 8)
          const counterparty = readText(item, 'counterpartyName')
          const label = [number, counterparty].filter((part) => part.length > 0).join(' · ')
          return readText(item, 'direction') === 'sales' ? `${label} (${directionLabel(t, 'sales')})` : label
        },
      },
      {
        id: 'currencyCode',
        label: t('trade_docs.documents.form.field.currencyCode', '币种'),
        type: 'select',
        required: true,
        layout: 'half',
        loadOptions: () => loadCurrencyOptions(t('trade_docs.documents.form.currencyLoadFailed', '币种列表加载失败')),
      },
      {
        id: 'exchangeRate',
        label: t('trade_docs.documents.form.field.exchangeRate', '汇率（快照）'),
        type: 'text',
        layout: 'half',
      },
      {
        id: 'paymentTerms',
        label: t('trade_docs.documents.form.field.paymentTerms', '付款方式'),
        type: 'combobox',
        layout: 'half',
        description: t('trade_docs.documents.form.field.paymentTermsHelp', '选项来自付款方式字典；也可直接输入谈定的措辞。'),
        allowCustomValues: true,
        resolveLabel: (value) => value,
        loadOptions: (query) => loadPaymentTermOptions(query),
      },
      {
        id: 'incoterms',
        label: t('trade_docs.documents.form.field.incoterms', '贸易术语'),
        // Free text, like the contract's own field: the term is whatever the deal was signed with.
        type: 'text',
        layout: 'half',
        description: t('trade_docs.documents.form.field.incotermsHelp', 'Free text — type the term the contract was signed with.'),
      },
      {
        id: 'validUntil',
        label: t('trade_docs.documents.form.field.validUntil', '有效期'),
        type: 'date',
        layout: 'half',
      },
      {
        id: 'deliveryDate',
        label: t('trade_docs.documents.form.field.deliveryDate', '交期'),
        type: 'date',
        layout: 'half',
      },
      {
        id: 'notes',
        label: t('trade_docs.documents.form.field.notes', '备注'),
        type: 'textarea',
        layout: 'half',
      },
      {
        id: 'counterpartyName',
        label: t('trade_docs.documents.form.field.counterpartyName', '对方名称'),
        type: 'text',
        layout: 'half',
      },
      {
        id: 'counterpartyAddress',
        label: t('trade_docs.documents.form.field.counterpartyAddress', '对方地址'),
        type: 'textarea',
        layout: 'half',
      },
      {
        id: 'counterpartyContact',
        label: t('trade_docs.documents.form.field.counterpartyContact', '对方联系人'),
        type: 'text',
        layout: 'half',
      },
      {
        id: 'counterpartyBank',
        label: t('trade_docs.documents.form.field.counterpartyBank', '对方银行信息'),
        type: 'text',
        layout: 'half',
      },
      {
        id: 'ourPartyName',
        label: t('trade_docs.documents.form.field.ourParty.name', '名称'),
        type: 'text',
        layout: 'half',
      },
      {
        id: 'ourPartyAddress',
        label: t('trade_docs.documents.form.field.ourParty.address', '地址'),
        type: 'textarea',
        layout: 'half',
      },
      {
        id: 'ourPartyContact',
        label: t('trade_docs.documents.form.field.ourParty.contact', '联系人'),
        type: 'text',
        layout: 'half',
      },
      {
        id: 'ourPartyBank',
        label: t('trade_docs.documents.form.field.ourParty.bank', '银行信息'),
        type: 'text',
        layout: 'half',
      },
      ...(kind === 'commercial'
        ? ([
            {
              id: 'consigneeName',
              label: t('trade_docs.documents.form.field.consignee.name', '收货人'),
              type: 'text',
              layout: 'half',
            },
            {
              id: 'consigneeAddress',
              label: t('trade_docs.documents.form.field.consignee.address', '收货人地址'),
              type: 'textarea',
              layout: 'half',
            },
            {
              id: 'notifyPartyName',
              label: t('trade_docs.documents.form.field.notifyParty.name', '通知方'),
              type: 'text',
              layout: 'half',
            },
            {
              id: 'notifyPartyAddress',
              label: t('trade_docs.documents.form.field.notifyParty.address', '通知方地址'),
              type: 'textarea',
              layout: 'half',
            },
          ] as CrudField[])
        : []),
    ]
  }, [kind, organizationId, t])
}

export default function DocumentsForm({
  kind,
  documentId,
}: {
  kind: DocumentKind
  documentId?: string
}) {
  const t = useT()
  const router = useRouter()
  const listHref = documentListHref(kind)
  const fields = useDocumentFields(t, kind)

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'header',
        column: 1,
        fields: [
          'direction',
          'currencyCode',
          'exchangeRate',
          'validUntil',
          'deliveryDate',
        ],
      },
      {
        id: 'counterpartyPicker',
        column: 1,
        bare: true,
        component: (context) => <CounterpartyPicker {...context} t={t} directionKind="trade" idPrefix="document" />,
      },
      {
        id: 'contract',
        column: 1,
        fields: ['contractId'],
      },
      {
        id: 'terms',
        column: 2,
        fields: ['paymentTerms', 'incoterms', 'notes'],
      },
      {
        id: 'anchor',
        column: 2,
        bare: true,
        component: (context) => <DocumentAnchorEditor {...context} t={t} kind={kind} />,
      },
      {
        id: 'ourPartyMaster',
        column: 2,
        bare: true,
        component: (context) => <OurPartyPicker {...context} t={t} idPrefix="document" />,
      },
      {
        id: 'parties',
        column: 2,
        fields: [
          'counterpartyName',
          'counterpartyAddress',
          'counterpartyContact',
          'counterpartyBank',
          'ourPartyName',
          'ourPartyAddress',
          'ourPartyContact',
          'ourPartyBank',
        ],
      },
      ...(kind === 'commercial'
        ? [
            {
              id: 'consignee',
              column: 2,
              fields: ['consigneeName', 'consigneeAddress', 'notifyPartyName', 'notifyPartyAddress'],
            } as CrudFormGroup,
          ]
        : []),
      {
        id: 'lines',
        column: 1,
        bare: true,
        component: (context) => <DocumentLinesEditor {...context} t={t} />,
      },
    ],
    [kind, t],
  )

  if (documentId) {
    return <DocumentEditForm documentId={documentId} kind={kind} listHref={listHref} fields={fields} groups={groups} />
  }
  return <DocumentCreateForm kind={kind} listHref={listHref} fields={fields} groups={groups} />
}

type FormWiring = { kind: DocumentKind; listHref: string; fields: CrudField[]; groups: CrudFormGroup[] }

function DocumentCreateForm({ kind, listHref, fields, groups }: FormWiring) {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()

  // Arriving from a contract's hub (`?contractId=`) starts the document bound to that contract;
  // the picker still lets the operator change or clear it.
  const initialValues = React.useMemo<DocumentFormValues>(
    () => ({ ...emptyDocumentValues(), contractId: searchParams.get('contractId')?.trim() ?? '' }),
    [searchParams],
  )

  const handleSubmit = React.useCallback(
    async (values: DocumentFormValues) => {
      try {
        const created = await createCrud<{ id?: string }>(
          DOCUMENTS_API_PATH,
          { kind, ...buildDocumentPayload(values), lines: buildDocumentLines(values) },
        )
        const createdId = typeof created.result?.id === 'string' ? created.result.id : null
        if (createdId) {
          pushWithFlash(router, `${listHref}/${encodeURIComponent(createdId)}`, t('trade_docs.documents.form.saved', '单据已保存'), 'success')
          return
        }
        pushWithFlash(router, listHref, t('trade_docs.documents.form.saved', '单据已保存'), 'success')
      } catch (error) {
        flash(t('trade_docs.documents.form.saveFailed', '单据保存失败'), 'error')
        throw error
      }
    },
    [kind, listHref, router, t],
  )

  return (
    <CrudForm<DocumentFormValues>
      title={kind === 'commercial'
        ? t('trade_docs.documents.form.createTitleCommercial', '新建商业发票（CI）')
        : t('trade_docs.documents.form.createTitleProforma', '新建形式发票（PI）')}
      titleHeadingLevel={1}
      backHref={listHref}
      fields={fields}
      groups={groups}
      initialValues={initialValues}
      submitLabel={t('trade_docs.documents.form.save', '保存')}
      cancelHref={listHref}
      injectionSpotId="crud-form:trade_docs.documents"
      onSubmit={handleSubmit}
    />
  )
}

function DocumentEditForm({
  documentId,
  kind,
  listHref,
  fields,
  groups,
}: FormWiring & { documentId: string }) {
  const t = useT()
  const [initial, setInitial] = React.useState<DocumentRecord | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setIsNotFound(false)
      try {
        const payload = await fetchCrudList<Record<string, unknown>>(DOCUMENTS_API_PATH, {
          ids: documentId,
          pageSize: 1,
        })
        const item = payload?.items?.[0]
        if (!item) {
          if (!cancelled) setIsNotFound(true)
          return
        }
        const linePayload = await fetchCrudList<Record<string, unknown>>(DOCUMENT_LINES_API_PATH, {
          documentId,
          pageSize: 100,
        })
        const lines = (linePayload.items ?? []).map(toDocumentLineValues)
        if (!cancelled) setInitial(toDocumentFormValues(item, lines))
      } catch (loadError: unknown) {
        if (!cancelled) {
          if ((loadError as { status?: number }).status === 404) {
            setIsNotFound(true)
          } else {
            setError(t('trade_docs.documents.form.loadFailed', '单据加载失败'))
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [documentId, t])

  const fallbackInitialValues = React.useMemo<DocumentFormValues>(
    () => ({ ...emptyDocumentValues(), id: documentId, updatedAt: null }),
    [documentId],
  )

  const handleSubmit = React.useCallback(
    async (values: DocumentFormValues) => {
      const id = initial?.id || documentId
      try {
        await withScopedApiRequestHeaders(buildOptimisticLockHeader(initial?.updatedAt ?? null), () =>
          updateCrud(DOCUMENTS_API_PATH, {
            id,
            ...buildDocumentPayload(values),
            lines: buildDocumentLines(values),
          }),
        )
      } catch (updateError) {
        flash(t('trade_docs.documents.form.saveFailed', '单据保存失败'), 'error')
        throw updateError
      }
    },
    [documentId, initial, t],
  )

  if (isNotFound) {
    return <RecordNotFoundState label={t('trade_docs.documents.form.notFound', '未找到该单据，或你没有访问权限。')} backHref={listHref} />
  }
  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<DocumentFormValues>
      title={kind === 'commercial'
        ? t('trade_docs.documents.form.editTitleCommercial', '编辑商业发票（CI）')
        : t('trade_docs.documents.form.editTitleProforma', '编辑形式发票（PI）')}
      titleHeadingLevel={1}
      backHref={listHref}
      fields={fields}
      groups={groups}
      initialValues={initial ?? fallbackInitialValues}
      submitLabel={t('trade_docs.documents.form.save', '保存')}
      cancelHref={listHref}
      injectionSpotId="crud-form:trade_docs.documents"
      isLoading={loading}
      onSubmit={handleSubmit}
    />
  )
}
