"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, Trash2, Upload } from 'lucide-react'
import {
  CrudForm,
  type CrudField,
  type CrudFormGroup,
  type CrudFormGroupComponentProps,
} from '@open-mercato/ui/backend/CrudForm'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { pushWithFlash } from '@open-mercato/ui/backend/utils/flash'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { AttachmentPreviewLink } from '@/lib/attachments/AttachmentPreview'
import { FieldLabel } from '@open-mercato/ui/primitives/label'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { MoneyAmount } from '@/lib/money/MoneyAmount'
import { directionLabel, invoiceStatusLabel, INVOICE_DIRECTIONS, type InvoiceStatus } from './contractLabels'
import {
  INVOICE_KIND_UNCLASSIFIED,
  INVOICE_KINDS,
  asInvoiceKind,
  invoiceKindLabel,
} from './InvoicesTable'
import { documentKindLabel, documentListHref, type DocumentKind } from './DocumentsTable'
import { DocumentCopyFromDialog } from './DocumentDetail'
import {
  loadContractLineOptions,
  loadContractOptions,
  loadCurrencyOptions,
  loadProductOptions,
  readText,
  snapshotText,
  type ProductOption,
} from './formOptions'
import { CounterpartyPicker } from './CounterpartyPicker'
import { COUNTERPARTY_KIND_BY_INVOICE_DIRECTION } from '../data/validators'
import { parseSourceOrderParams, sourceOrderPayload } from '@/lib/orders/sourceOrderParams'

const INVOICES_API_PATH = 'trade_docs/invoices'
const INVOICE_LINES_API_PATH = 'trade_docs/invoices/lines'
const INVOICE_TRANSITIONS_API_PATH = 'trade_docs/invoices/transitions'
const INVOICE_ATTACH_API_PATH = 'trade_docs/invoices/attach'
const CONTRACTS_HREF = '/backend/trade-docs/contracts'
const LIST_HREF = '/backend/trade-docs/invoices'
/** A shipment's own page is where its per-container tax-refund package is filed (REQ-006 anchor). */
const SHIPMENTS_HREF = '/backend/cross_border/shipments'

/** Attachment assignment entity id; the partition resolves to the platform's private default. */
const ATTACHMENT_ENTITY_ID = 'trade_docs:trade_docs_invoice'

export type InvoiceLineValues = {
  productId: string
  description: string
  sku: string
  unit: string
  quantity: string
  unitPrice: string
  amount: string
  /** Tax rate as a percentage (`13` = 13%), the same caliber the purchase-order lines use. */
  taxRate: string
  /** Whether `amount` already includes the tax; the server derives the line's tax amount from it. */
  priceIncludesTax: boolean
  /** Server-computed tax for the line (`amount − amount/(1+rate)` or `amount × rate`). Read-only. */
  taxAmount: string
  contractLineId: string
}

export type InvoiceFormValues = {
  id?: string
  number: string
  direction: string
  /** `''` until chosen, a real kind, or `INVOICE_KIND_UNCLASSIFIED` for a row without one. */
  invoiceKind: string
  counterpartyId: string
  counterpartyName: string
  contractId: string
  currencyCode: string
  issuedAt: string
  notes: string
  lines: InvoiceLineValues[]
  updatedAt?: string | null
}

const EMPTY_LINE: InvoiceLineValues = {
  productId: '',
  description: '',
  sku: '',
  unit: 'PCS',
  quantity: '1',
  unitPrice: '0',
  amount: '0',
  taxRate: '0',
  priceIncludesTax: true,
  taxAmount: '0',
  contractLineId: '',
}

const EMPTY_INVOICE_VALUES: InvoiceFormValues = {
  number: '',
  direction: 'inbound',
  invoiceKind: '',
  counterpartyId: '',
  counterpartyName: '',
  contractId: '',
  currencyCode: '',
  issuedAt: '',
  notes: '',
  lines: [{ ...EMPTY_LINE }],
}

function trimmedOrNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * The family of a copied source document, read from the frozen `sourceSnapshot.documentKind` a
 * `trade_docs.invoices.copy-from` writes. An unknown/absent value yields null so the invoice prints
 * the snapshot text instead of a link to a guessed route.
 */
function readSourceDocumentKind(snapshot: Record<string, unknown> | null): DocumentKind | null {
  const value = snapshotText(snapshot, 'documentKind')
  return value === 'proforma' || value === 'commercial' ? value : null
}

/**
 * Reads a boolean that may arrive as a real boolean (the API's projection) or a string (a form
 * round trip); anything else falls back to the caller's default.
 */
function readBoolean(source: Record<string, unknown>, keys: string[], fallback: boolean): boolean {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'boolean') return value
    if (value === 'true') return true
    if (value === 'false') return false
  }
  return fallback
}

export function toInvoiceFormValues(
  item: Record<string, unknown>,
  lines: InvoiceLineValues[] = [],
): InvoiceFormValues {
  const updatedAt = item.updatedAt ?? item.updated_at
  return {
    id: readText(item, 'id'),
    number: readText(item, 'number'),
    direction: readText(item, 'direction') || 'inbound',
    invoiceKind: asInvoiceKind(item.invoiceKind ?? item.invoice_kind) ?? INVOICE_KIND_UNCLASSIFIED,
    counterpartyId: readText(item, 'counterpartyId', 'counterparty_id'),
    counterpartyName: readText(item, 'counterpartyName', 'counterparty_name'),
    contractId: readText(item, 'contractId', 'contract_id'),
    currencyCode: readText(item, 'currencyCode', 'currency_code'),
    issuedAt: (item.issuedAt ?? item.issued_at ?? '') as string,
    notes: readText(item, 'notes'),
    lines: lines.length > 0 ? lines : [{ ...EMPTY_LINE }],
    updatedAt: typeof updatedAt === 'string' ? updatedAt : null,
  }
}

export function toInvoiceLineValues(item: Record<string, unknown>): InvoiceLineValues {
  return {
    productId: readText(item, 'productId', 'product_id'),
    description: readText(item, 'description'),
    sku: readText(item, 'sku'),
    unit: readText(item, 'unit'),
    quantity: readText(item, 'quantity') || '0',
    unitPrice: readText(item, 'unitPrice', 'unit_price') || '0',
    amount: readText(item, 'amount') || '0',
    taxRate: readText(item, 'taxRate', 'tax_rate') || '0',
    priceIncludesTax: readBoolean(item, ['priceIncludesTax', 'price_includes_tax'], true),
    taxAmount: readText(item, 'taxAmount', 'tax_amount') || '0',
    contractLineId: readText(item, 'contractLineId', 'contract_line_id'),
  }
}

/** Blank rows are dropped; a line needs a product or a description or the API rejects it. */
export function buildInvoicePayload(values: InvoiceFormValues): Record<string, unknown> {
  const lines = values.lines
    .filter((line) => line.productId.trim().length > 0 || line.description.trim().length > 0)
    .map((line) => ({
      productId: line.productId.trim() ? line.productId.trim() : null,
      description: trimmedOrNull(line.description),
      sku: trimmedOrNull(line.sku),
      unit: trimmedOrNull(line.unit),
      quantity: line.quantity.trim() ? line.quantity.trim() : '0',
      unitPrice: line.unitPrice.trim() ? line.unitPrice.trim() : '0',
      amount: line.amount.trim() ? line.amount.trim() : '0',
      taxRate: line.taxRate.trim() ? line.taxRate.trim() : '0',
      priceIncludesTax: line.priceIncludesTax === true,
      contractLineId: line.contractLineId.trim() ? line.contractLineId.trim() : null,
    }))

  return {
    number: trimmedOrNull(values.number),
    direction: values.direction,
    invoiceKind: invoiceKindPayload(values.invoiceKind),
    // Derived, never a separate operator choice: the direction decides the namespace.
    counterpartyKind: COUNTERPARTY_KIND_BY_INVOICE_DIRECTION[values.direction as keyof typeof COUNTERPARTY_KIND_BY_INVOICE_DIRECTION],
    counterpartyId: values.counterpartyId.trim() ? values.counterpartyId.trim() : null,
    counterpartySnapshot: values.counterpartyName.trim() ? { name: values.counterpartyName.trim() } : null,
    contractId: values.contractId.trim() ? values.contractId.trim() : null,
    currencyCode: values.currencyCode.trim().toUpperCase(),
    issuedAt: trimmedOrNull(values.issuedAt),
    notes: trimmedOrNull(values.notes),
    lines,
  }
}

/** `未分类` (and a not-yet-chosen select) travels to the API as a real `null`, never a made-up kind. */
function invoiceKindPayload(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed === INVOICE_KIND_UNCLASSIFIED) return null
  return trimmed
}

function InvoiceLinesEditor(
  { values, setValue, t }: CrudFormGroupComponentProps & { t: TranslateFn },
) {
  const { organizationId } = useOrganizationScopeDetail()
  const lines = React.useMemo(() => {
    const raw = values.lines
    return Array.isArray(raw) ? (raw as InvoiceLineValues[]) : []
  }, [values.lines])
  const contractId = typeof values.contractId === 'string' ? values.contractId : ''
  const [contractLineOptions, setContractLineOptions] = React.useState<ComboboxOption[]>([])
  const productCache = React.useRef(new Map<string, ProductOption>())

  React.useEffect(() => {
    let cancelled = false
    if (!contractId) {
      setContractLineOptions([])
      return () => {
        cancelled = true
      }
    }
    loadContractLineOptions(contractId, t('trade_docs.invoices.form.contractLoadFailed'))
      .then((options) => {
        if (!cancelled) setContractLineOptions(options)
      })
      .catch(() => {
        if (!cancelled) setContractLineOptions([])
      })
    return () => {
      cancelled = true
    }
  }, [contractId, t])

  const updateLine = React.useCallback(
    (index: number, patch: Partial<InvoiceLineValues>) => {
      const next = lines.map((line, position) => (position === index ? { ...line, ...patch } : line))
      setValue('lines', next)
    },
    [lines, setValue],
  )

  const addLine = React.useCallback(() => {
    setValue('lines', [...lines, { ...EMPTY_LINE }])
  }, [lines, setValue])

  const removeLine = React.useCallback(
    (index: number) => {
      const next = lines.filter((_, position) => position !== index)
      setValue('lines', next.length > 0 ? next : [{ ...EMPTY_LINE }])
    },
    [lines, setValue],
  )

  return (
    <div className="space-y-4">
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('trade_docs.invoices.form.lines.empty')}</p>
      ) : null}
      {lines.map((line, index) => (
        <div key={line.productId || `line-${index}`} className="space-y-3 rounded-lg border border-border p-3">
          <div className="grid gap-3 md:grid-cols-12">
            <div className="space-y-1.5 md:col-span-5">
              <FieldLabel htmlFor={`invoice-line-product-${index}`}>
                {t('trade_docs.invoices.form.lines.product')}
              </FieldLabel>
              <ComboboxInput
                value={line.productId}
                onChange={(next) => {
                  updateLine(index, { productId: next })
                  const cached = productCache.current.get(next)
                  if (cached) {
                    updateLine(index, {
                      productId: next,
                      description: cached.name,
                      sku: cached.sku,
                      unit: cached.unit || 'PCS',
                    })
                  }
                }}
                placeholder={t('trade_docs.contracts.form.lines.selectProduct')}
                seedOptions={
                  line.productId && line.description
                    ? [{ value: line.productId, label: line.description }]
                    : undefined
                }
                loadSuggestions={async (query) => {
                  const options = await loadProductOptions(
                    t('trade_docs.contracts.form.lines.productLoadFailed'),
                    query,
                    organizationId,
                  )
                  for (const option of options) productCache.current.set(option.value, option)
                  return options.map<ComboboxOption>((option) => ({ value: option.value, label: option.label }))
                }}
                allowCustomValues={false}
                clearable
              />
            </div>
            <div className="space-y-1.5 md:col-span-4">
              <FieldLabel htmlFor={`invoice-line-description-${index}`}>
                {t('trade_docs.invoices.form.lines.description')}
              </FieldLabel>
              <Input
                id={`invoice-line-description-${index}`}
                value={line.description}
                onChange={(event) => updateLine(index, { description: event.target.value })}
              />
            </div>
            <div className="flex items-end justify-end md:col-span-3">
              <IconButton
                type="button"
                variant="ghost"
                size="lg"
                aria-label={t('trade_docs.invoices.form.lines.remove')}
                onClick={() => removeLine(index)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <FieldLabel htmlFor={`invoice-line-quantity-${index}`}>
                {t('trade_docs.invoices.form.lines.quantity')}
              </FieldLabel>
              <Input
                id={`invoice-line-quantity-${index}`}
                inputMode="decimal"
                value={line.quantity}
                onChange={(event) => updateLine(index, { quantity: event.target.value })}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <FieldLabel htmlFor={`invoice-line-price-${index}`}>
                {t('trade_docs.invoices.form.lines.unitPrice')}
              </FieldLabel>
              <Input
                id={`invoice-line-price-${index}`}
                inputMode="decimal"
                value={line.unitPrice}
                onChange={(event) => updateLine(index, { unitPrice: event.target.value })}
              />
            </div>
            <div className="space-y-1.5 md:col-span-3">
              <FieldLabel htmlFor={`invoice-line-amount-${index}`} required>
                {t('trade_docs.invoices.form.lines.amount')}
              </FieldLabel>
              <Input
                id={`invoice-line-amount-${index}`}
                inputMode="decimal"
                value={line.amount}
                onChange={(event) => updateLine(index, { amount: event.target.value })}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <FieldLabel htmlFor={`invoice-line-tax-rate-${index}`}>
                {t('trade_docs.invoices.form.lines.taxRate', 'Tax rate (%)')}
              </FieldLabel>
              <Input
                id={`invoice-line-tax-rate-${index}`}
                inputMode="decimal"
                value={line.taxRate}
                onChange={(event) => updateLine(index, { taxRate: event.target.value })}
              />
            </div>
            <div className="flex items-end md:col-span-3">
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={line.priceIncludesTax}
                  onCheckedChange={(next) => updateLine(index, { priceIncludesTax: next === true })}
                />
                {t('trade_docs.invoices.form.lines.priceIncludesTax', 'Amount is tax-inclusive')}
              </label>
            </div>
            <div className="space-y-1.5 md:col-span-5">
              <FieldLabel htmlFor={`invoice-line-binding-${index}`}>
                {t('trade_docs.invoices.form.lines.contractLine')}
              </FieldLabel>
              <ComboboxInput
                value={line.contractLineId}
                onChange={(next) => updateLine(index, { contractLineId: next })}
                suggestions={contractLineOptions}
                allowCustomValues={false}
                clearable
                disabled={!contractId}
              />
              <p className="text-xs text-muted-foreground">
                {t('trade_docs.invoices.form.lines.contractLineHint')}
              </p>
            </div>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" onClick={addLine}>
        <Plus className="size-4" aria-hidden="true" />
        {t('trade_docs.invoices.form.lines.add')}
      </Button>
    </div>
  )
}

function useInvoiceFields(t: TranslateFn, mode: 'create' | 'edit'): CrudField[] {
  const { organizationId } = useOrganizationScopeDetail()
  return React.useMemo<CrudField[]>(() => [
    { id: 'number', label: t('trade_docs.invoices.form.field.number'), type: 'text', layout: 'half' },
    {
      id: 'direction',
      label: t('trade_docs.invoices.form.field.direction'),
      type: 'select',
      required: true,
      options: INVOICE_DIRECTIONS.map((value) => ({ value, label: directionLabel(t, value) })),
      layout: 'half',
    },
    {
      id: 'invoiceKind',
      label: t('trade_docs.invoices.form.field.invoiceKind', 'Invoice kind'),
      type: 'select',
      /*
       * Required while creating (the ledger must say which tax document this is), but never on edit:
       * a historical row's kind is `null` and re-saving it must keep working untouched. The explicit
       * 「未分类」 option is a real value the operator can pick, so "required" still means "choose one".
       */
      required: mode === 'create',
      options: [
        ...INVOICE_KINDS.map((value) => ({ value, label: invoiceKindLabel(t, value) })),
        { value: INVOICE_KIND_UNCLASSIFIED, label: invoiceKindLabel(t, null) },
      ],
      layout: 'half',
    },
    {
      id: 'counterpartyName',
      label: t('trade_docs.invoices.form.field.counterpartyName'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'contractId',
      label: t('trade_docs.invoices.form.field.contract'),
      type: 'select',
      layout: 'half',
      loadOptions: () => loadContractOptions(t('trade_docs.invoices.form.contractLoadFailed'), organizationId),
    },
    {
      id: 'currencyCode',
      label: t('trade_docs.invoices.form.field.currencyCode'),
      type: 'select',
      required: true,
      layout: 'half',
      loadOptions: () => loadCurrencyOptions(t('trade_docs.contracts.form.counterpartyLoadFailed')),
    },
    { id: 'issuedAt', label: t('trade_docs.invoices.form.field.issuedAt'), type: 'date', layout: 'half' },
    { id: 'notes', label: t('trade_docs.invoices.form.field.notes'), type: 'textarea', layout: 'half' },
  ], [t, mode, organizationId])
}

function useInvoiceGroups(t: TranslateFn): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'header',
      column: 1,
      fields: ['number', 'direction', 'invoiceKind', 'counterpartyName', 'contractId', 'currencyCode', 'issuedAt', 'notes'],
    },
    {
      id: 'counterpartyPicker',
      column: 1,
      bare: true,
      component: (context) => (
        // An invoice prints the counterparty's name only — no bank block on this document.
        <CounterpartyPicker {...context} t={t} directionKind="invoice" idPrefix="invoice" showBankAccount={false} />
      ),
    },
    {
      id: 'lines',
      column: 1,
      bare: true,
      component: (context) => <InvoiceLinesEditor {...context} t={t} />,
    },
  ], [t])
}

function InvoiceCreateForm() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const fields = useInvoiceFields(t, 'create')
  const groups = useInvoiceGroups(t)
  // Arriving from an order's hub (`?orderKind=&orderId=`): the create records the order ↔ invoice
  // link in the same transaction, so the order's Documents block shows the new tax invoice without a
  // second call. The invoice carries no line prefill from the order (its lines come from the scan or
  // the contract), so only the link travels.
  const sourceParam = React.useMemo(() => parseSourceOrderParams(searchParams), [searchParams])
  const initialValues = React.useMemo<InvoiceFormValues>(() => {
    const contractId = searchParams.get('contractId') ?? ''
    return { ...EMPTY_INVOICE_VALUES, contractId, lines: [{ ...EMPTY_LINE }] }
  }, [searchParams])

  const handleSubmit = React.useCallback(async (values: InvoiceFormValues) => {
    try {
      const created = await createCrud<{ id?: string }>(INVOICES_API_PATH, {
        ...buildInvoicePayload(values),
        ...sourceOrderPayload(sourceParam),
      })
      const createdId = typeof created.result?.id === 'string' ? created.result.id : null
      // The edit page is where the scan is uploaded and the invoice confirmed, so the create flow
      // lands there instead of the list.
      pushWithFlash(
        router,
        createdId ? `${LIST_HREF}/${encodeURIComponent(createdId)}/edit` : LIST_HREF,
        t('trade_docs.invoices.form.saved'),
        'success',
      )
    } catch (error) {
      flash(t('trade_docs.invoices.form.saveFailed'), 'error')
      throw error
    }
  }, [router, sourceParam, t])

  return (
    <>
      {/* The pair only feeds the link write, so an unusable one never blocks the create — it is
          reported and the invoice is simply raised without an order link. */}
      {sourceParam.status === 'invalid' ? (
        <p className="mb-3 rounded-md border border-status-warning-border bg-status-warning-bg px-3 py-2 text-xs text-status-warning-text" role="alert">
          {t('trade_docs.form.sourceOrder.invalid')}
        </p>
      ) : null}
      <CrudForm<InvoiceFormValues>
        title={t('trade_docs.invoices.form.createTitle')}
        titleHeadingLevel={1}
        backHref={LIST_HREF}
        fields={fields}
        groups={groups}
        initialValues={initialValues}
        submitLabel={t('trade_docs.invoices.form.save')}
        cancelHref={LIST_HREF}
        onSubmit={handleSubmit}
      />
    </>
  )
}

type InvoiceAttachmentProps = {
  invoiceId: string
  attachmentId: string | null
  updatedAt: string | null
  onChanged: () => Promise<void>
}

/**
 * Upload-then-bind, exactly like the purchasing payment vouchers: the invoice already exists, the
 * file is uploaded against the platform's attachment route, and only then is the pointer recorded
 * through `trade_docs.invoices.attach`. A failed upload never loses the invoice, and the section
 * keeps offering a retry.
 */
function InvoiceAttachmentSection({ invoiceId, attachmentId, updatedAt, onChanged }: InvoiceAttachmentProps) {
  const t = useT()
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const [isUploading, setIsUploading] = React.useState(false)

  const handleFile = React.useCallback(async (files: FileList | null) => {
    const file = files?.[0]
    if (inputRef.current) inputRef.current.value = ''
    if (!file) return
    setIsUploading(true)
    try {
      const body = new FormData()
      body.set('entityId', ATTACHMENT_ENTITY_ID)
      body.set('recordId', invoiceId)
      body.set('file', file)
      const upload = await apiCall<{ item?: { id?: string }; error?: string }>(
        '/api/attachments',
        { method: 'POST', body },
        { fallback: null },
      )
      const uploadedId = upload.ok && typeof upload.result?.item?.id === 'string' ? upload.result.item.id : ''
      if (!uploadedId) {
        flash(upload.result?.error || t('trade_docs.invoices.form.attachment.failed'), 'error')
        return
      }
      try {
        await updateCrud(
          INVOICE_ATTACH_API_PATH,
          { id: invoiceId, attachmentId: uploadedId, updatedAt },
          { errorMessage: t('trade_docs.invoices.form.attachment.bindFailed') },
        )
        flash(t('trade_docs.invoices.form.attachment.uploaded'), 'success')
        await onChanged()
      } catch (bindError) {
        flash(
          bindError instanceof Error && bindError.message
            ? bindError.message
            : t('trade_docs.invoices.form.attachment.bindFailed'),
          'error',
        )
      }
    } catch {
      flash(t('trade_docs.invoices.form.attachment.failed'), 'error')
    } finally {
      setIsUploading(false)
    }
  }, [invoiceId, onChanged, t, updatedAt])

  return (
    <section className="space-y-3">
      <SectionHeader title={t('trade_docs.invoices.form.field.attachment')} />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={isUploading}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="size-4" aria-hidden="true" />
          {attachmentId ? t('trade_docs.invoices.form.attachment.retry') : t('trade_docs.invoices.form.attachment.upload')}
        </Button>
        {attachmentId ? (
          <>
            <AttachmentPreviewLink
              attachmentId={attachmentId}
              label={t('trade_docs.invoices.form.attachment.open')}
            />
            <a
              className="text-sm font-medium hover:underline"
              href={`/api/attachments/file/${encodeURIComponent(attachmentId)}?download=1`}
              target="_blank"
              rel="noreferrer"
            >
              {t('trade_docs.invoices.form.attachment.download')}
            </a>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">{t('trade_docs.invoices.list.attachment.no')}</span>
        )}
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(event) => void handleFile(event.target.files)}
        />
      </div>
    </section>
  )
}

export default function InvoiceForm({ mode, invoiceId }: { mode: 'create' | 'edit'; invoiceId?: string }) {
  if (mode === 'edit') {
    if (!invoiceId) return null
    return <InvoiceEditPage invoiceId={invoiceId} />
  }
  return <InvoiceCreateForm />
}

function InvoiceEditPage({ invoiceId }: { invoiceId: string }) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const fields = useInvoiceFields(t, 'edit')
  const groups = useInvoiceGroups(t)
  const [initial, setInitial] = React.useState<InvoiceFormValues | null>(null)
  const [head, setHead] = React.useState<{
    status: InvoiceStatus
    total: string
    taxTotal: string
    grossTotal: string
    invoiceKind: string | null
    ourNumber: string | null
    currencyCode: string
    contractId: string | null
    contractNumber: string | null
    sourceKind: string | null
    sourceId: string | null
    sourceSnapshot: Record<string, unknown> | null
    attachmentId: string | null
    updatedAt: string | null
  } | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)
  const [isMutating, setIsMutating] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [copyOpen, setCopyOpen] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setIsNotFound(false)
      try {
        const payload = await fetchCrudList<Record<string, unknown>>(INVOICES_API_PATH, {
          ids: invoiceId,
          pageSize: 1,
        })
        const item = payload.items?.[0]
        if (!item) {
          if (!cancelled) setIsNotFound(true)
          return
        }
        const linePayload = await fetchCrudList<Record<string, unknown>>(INVOICE_LINES_API_PATH, {
          invoiceId,
          pageSize: 500,
        })
        const lines = (linePayload.items ?? []).map(toInvoiceLineValues)
        if (cancelled) return
        setInitial(toInvoiceFormValues(item, lines))
        setHead({
          status: String(item.status ?? 'draft') as InvoiceStatus,
          total: String(item.total ?? '0'),
          taxTotal: String(item.taxTotal ?? item.tax_total ?? '0'),
          grossTotal: String(item.grossTotal ?? item.gross_total ?? '0'),
          invoiceKind: asInvoiceKind(item.invoiceKind ?? item.invoice_kind),
          ourNumber: (item.ourNumber ?? item.our_number ?? null) as string | null,
          currencyCode: String(item.currencyCode ?? 'CNY'),
          contractId: (item.contractId ?? null) as string | null,
          contractNumber: (item.contractNumber ?? null) as string | null,
          sourceKind: (item.sourceKind ?? item.source_kind ?? null) as string | null,
          sourceId: (item.sourceId ?? item.source_id ?? null) as string | null,
          sourceSnapshot: (item.sourceSnapshot ?? item.source_snapshot ?? null) as Record<string, unknown> | null,
          attachmentId: (item.attachmentId ?? null) as string | null,
          updatedAt: (item.updatedAt ?? null) as string | null,
        })
      } catch (loadError: unknown) {
        if (!cancelled) {
          if ((loadError as { status?: number }).status === 404) setIsNotFound(true)
          else setError(t('trade_docs.invoices.form.loadFailed'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [invoiceId, reloadToken, t])

  const reload = React.useCallback(async () => {
    setReloadToken((token) => token + 1)
  }, [])

  const runTransition = React.useCallback(async (action: 'confirm' | 'void') => {
    setIsMutating(true)
    try {
      await createCrud(INVOICE_TRANSITIONS_API_PATH, { id: invoiceId, action })
      await reload()
    } catch (transitionError) {
      flash(
        transitionError instanceof Error && transitionError.message
          ? transitionError.message
          : t('trade_docs.invoices.transitions.failed'),
        'error',
      )
    } finally {
      setIsMutating(false)
    }
  }, [invoiceId, reload, t])

  const handleSubmit = React.useCallback(async (values: InvoiceFormValues) => {
    try {
      await updateCrud(INVOICES_API_PATH, {
        id: initial?.id || invoiceId,
        ...buildInvoicePayload(values),
        updatedAt: initial?.updatedAt ?? null,
      })
      await reload()
    } catch (updateError) {
      flash(t('trade_docs.invoices.form.saveFailed'), 'error')
      throw updateError
    }
  }, [initial, invoiceId, reload, t])

  /**
   * One-shot copy of a commercial invoice's head + lines into this draft tax invoice — the
   * "从商业发票复制" flow. The command maps the document's lines onto invoice lines (VAT rate left at
   * its default for the operator) and freezes a link back; the totals are recomputed server-side, so
   * a reload is all the UI has to do. Running it again replaces the lines, never duplicates them.
   */
  const handleCopyFrom = React.useCallback(
    async (sourceDocumentId: string) => {
      try {
        await apiCallOrThrow<{ ok: true; lineCount: number }>(
          `/api/trade_docs/invoices/${encodeURIComponent(invoiceId)}/copy-from`,
          {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sourceDocumentId }),
          },
          { errorMessage: t('trade_docs.invoices.detail.copy.failed', 'Could not copy from the commercial invoice') },
        )
        flash(
          t('trade_docs.invoices.detail.copy.success', "Copied the commercial invoice's head and lines"),
          'success',
        )
        await reload()
      } catch (copyError) {
        flash(
          copyError instanceof Error && copyError.message
            ? copyError.message
            : t('trade_docs.invoices.detail.copy.failed', 'Could not copy from the commercial invoice'),
          'error',
        )
        throw copyError
      }
    },
    [invoiceId, reload, t],
  )

  if (loading) return <LoadingMessage label={t('trade_docs.common.loading')} />
  if (isNotFound) return <RecordNotFoundState label={t('trade_docs.invoices.form.notFound')} backHref={LIST_HREF} />
  if (error) return <ErrorMessage label={error} />
  if (!initial || !head) return null

  const isDraft = head.status === 'draft'
  const isExportInvoice = head.invoiceKind === 'export'
  const isShipmentAnchor =
    head.sourceKind === 'shipment' && typeof head.sourceId === 'string' && head.sourceId.length > 0
  // A trade-document source is linked by its frozen family + number; a draft source (no number) is
  // labelled by its family, and a snapshot without a known family degrades to the plain snapshot text.
  const isDocumentAnchor = head.sourceKind === 'trade_document'
  const sourceDocumentKind = isDocumentAnchor ? readSourceDocumentKind(head.sourceSnapshot) : null
  const sourceNumber = snapshotText(head.sourceSnapshot, 'number') || null
  const sourceHref =
    sourceDocumentKind && head.sourceId
      ? `${documentListHref(sourceDocumentKind)}/${encodeURIComponent(head.sourceId)}`
      : null
  const sourceLabel = sourceDocumentKind
    ? [documentKindLabel(t, sourceDocumentKind), sourceNumber].filter(Boolean).join(' ')
    : (sourceNumber ?? '—')

  return (
    <div className="space-y-6">
      <FormHeader
        mode="detail"
        backHref={LIST_HREF}
        entityTypeLabel={t('trade_docs.invoices.page.title')}
        title={(
          <span className="flex flex-wrap items-baseline gap-2">
            <span>{initial.number || t(`trade_docs.invoices.status.${head.status}`)}</span>
            {head.ourNumber ? (
              <span className="text-sm font-normal text-muted-foreground">
                {t('trade_docs.invoices.detail.ourNumber', 'Our number')}
                {': '}
                <span className="font-medium tabular-nums text-foreground">{head.ourNumber}</span>
              </span>
            ) : null}
          </span>
        )}
        statusBadge={(
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge variant={head.status === 'confirmed' ? 'success' : head.status === 'void' ? 'error' : 'neutral'} dot>
              {invoiceStatusLabel(t, head.status)}
            </StatusBadge>
            <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
              {invoiceKindLabel(t, head.invoiceKind)}
            </span>
          </div>
        )}
        actionsContent={(
          <div className="flex flex-wrap items-center gap-2">
            {isDraft ? (
              <Button
                type="button"
                disabled={isMutating}
                onClick={async () => {
                  const confirmed = await confirm({
                    title: t('trade_docs.invoices.transitions.confirm'),
                    description: t('trade_docs.invoices.transitions.confirmBody'),
                    confirmText: t('trade_docs.invoices.transitions.confirm'),
                  })
                  if (confirmed) await runTransition('confirm')
                }}
              >
                {t('trade_docs.invoices.transitions.confirm')}
              </Button>
            ) : null}
            {head.status === 'confirmed' ? (
              <Button
                type="button"
                variant="outline"
                disabled={isMutating}
                onClick={async () => {
                  const confirmed = await confirm({
                    title: t('trade_docs.invoices.transitions.voidConfirmTitle'),
                    description: t('trade_docs.invoices.transitions.voidConfirmBody'),
                    confirmText: t('trade_docs.invoices.transitions.void'),
                    variant: 'destructive',
                  })
                  if (confirmed) await runTransition('void')
                }}
              >
                {t('trade_docs.invoices.transitions.void')}
              </Button>
            ) : null}
            {isDraft ? (
              <Button type="button" variant="outline" onClick={() => setCopyOpen(true)}>
                {t('trade_docs.invoices.detail.copy.action', 'Copy from a commercial invoice')}
              </Button>
            ) : null}
          </div>
        )}
      />

      <section className="space-y-3">
        <SectionHeader title={t('trade_docs.invoices.detail.summary.title')} />
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-0.5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('trade_docs.invoices.list.columns.total')}
            </p>
            {/*
              The invoice total is computed by the sales engine, not typed here, so the reader has only
              this figure to trust: the CNY pair and the rate behind it are printed beside it rather
              than hidden in the tooltip a dense table cell would use.
            */}
            <div className="text-lg font-semibold">
              <MoneyAmount currencyCode={head.currencyCode} amount={head.total} showRate />
            </div>
          </div>
          {/*
            Both figures are the server's (`tax_total` = Σ line tax, `gross_total` = Σ tax-inclusive
            line amounts, recomputed by the command on every save), so they print read-only here and
            the browser never derives a tax of its own.
          */}
          <div className="space-y-0.5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('trade_docs.invoices.detail.taxTotal', 'Tax amount')}
            </p>
            <div className="text-sm">
              <MoneyAmount currencyCode={head.currencyCode} amount={head.taxTotal} />
            </div>
          </div>
          <div className="space-y-0.5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('trade_docs.invoices.detail.grossTotal', 'Gross total')}
            </p>
            <div className="text-sm">
              <MoneyAmount currencyCode={head.currencyCode} amount={head.grossTotal} />
            </div>
          </div>
          <div className="space-y-0.5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('trade_docs.invoices.detail.influence.contract')}
            </p>
            <p className="text-sm">
              {head.contractId ? (
                <Link className="hover:underline" href={`${CONTRACTS_HREF}/${head.contractId}`}>
                  {head.contractNumber ?? head.contractId.slice(0, 8)}
                </Link>
              ) : (
                '—'
              )}
            </p>
          </div>
          <div className="space-y-0.5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('trade_docs.invoices.detail.influence.title')}
            </p>
            <p className="text-xs text-muted-foreground">{t('trade_docs.invoices.detail.influence.hint')}</p>
            {isExportInvoice ? (
              <p className="text-xs text-muted-foreground">
                {t(
                  'trade_docs.invoices.detail.influence.exportHint',
                  'An export invoice is a tax-refund document, not a settlement one: it leaves the contract totals untouched.',
                )}
              </p>
            ) : null}
          </div>
          {isShipmentAnchor ? (
            <div className="space-y-0.5">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {t('trade_docs.invoices.detail.refundAnchor.title', 'Tax-refund anchor')}
              </p>
              <p className="text-sm">
                <Link className="hover:underline" href={`${SHIPMENTS_HREF}/${head.sourceId}`}>
                  {t('trade_docs.invoices.detail.refundAnchor.shipment', 'Shipment')}
                </Link>
              </p>
              <p className="text-xs text-muted-foreground">
                {t(
                  'trade_docs.invoices.detail.refundAnchor.hint',
                  'The tax-refund package is filed per container and hangs off this shipment; the link is read-only.',
                )}
              </p>
            </div>
          ) : null}
          {isDocumentAnchor ? (
            <div className="space-y-0.5">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {t('trade_docs.invoices.detail.source.title', 'Source document')}
              </p>
              <p className="text-sm">
                {sourceHref ? (
                  <Link className="hover:underline" href={sourceHref}>
                    {sourceLabel}
                  </Link>
                ) : (
                  sourceLabel
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {t(
                  'trade_docs.invoices.detail.source.hint',
                  'After copying, this invoice and its source are independent and never sync.',
                )}
              </p>
            </div>
          ) : null}
        </div>
      </section>

      <InvoiceAttachmentSection
        invoiceId={invoiceId}
        attachmentId={head.attachmentId}
        updatedAt={head.updatedAt}
        onChanged={reload}
      />

      {isDraft ? (
        <CrudForm<InvoiceFormValues>
          title={t('trade_docs.invoices.form.editTitle')}
          titleHeadingLevel={2}
          fields={fields}
          groups={groups}
          initialValues={initial}
          submitLabel={t('trade_docs.invoices.form.save')}
          cancelHref={LIST_HREF}
          onSubmit={handleSubmit}
        />
      ) : (
        <section className="space-y-3">
          <SectionHeader title={t('trade_docs.invoices.form.lines.title')} />
          <DataTable<InvoiceLineValues & { id: string }>
            columns={[
              {
                id: 'description',
                header: t('trade_docs.invoices.form.lines.description'),
                cell: ({ row }) => row.original.description || '—',
              },
              {
                id: 'quantity',
                header: t('trade_docs.invoices.form.lines.quantity'),
                cell: ({ row }) => <span className="tabular-nums">{row.original.quantity}</span>,
              },
              {
                id: 'unitPrice',
                header: t('trade_docs.invoices.form.lines.unitPrice'),
                cell: ({ row }) => <span className="tabular-nums">{row.original.unitPrice}</span>,
              },
              {
                id: 'amount',
                header: t('trade_docs.invoices.form.lines.amount'),
                cell: ({ row }) => (
                  <MoneyAmount currencyCode={head.currencyCode} amount={row.original.amount} />
                ),
              },
              {
                id: 'taxRate',
                header: t('trade_docs.invoices.form.lines.taxRate', 'Tax rate (%)'),
                cell: ({ row }) => <span className="tabular-nums">{row.original.taxRate}</span>,
              },
              {
                id: 'taxAmount',
                header: t('trade_docs.invoices.form.lines.taxAmount', 'Tax amount'),
                cell: ({ row }) => (
                  <MoneyAmount currencyCode={head.currencyCode} amount={row.original.taxAmount} />
                ),
              },
            ]}
            data={initial.lines.map((line, index) => ({ ...line, id: line.contractLineId || `line-${index}` }))}
            emptyState={<EmptyState title={t('trade_docs.invoices.form.lines.empty')} />}
          />
        </section>
      )}
      <DocumentCopyFromDialog
        open={copyOpen}
        sourceKind="commercial"
        title={t('trade_docs.invoices.detail.copy.title', 'Copy from a commercial invoice')}
        description={t(
          'trade_docs.invoices.detail.copy.description',
          "Copies the selected CI's head and lines into this invoice once; the tax rate and price-includes-tax stay at their defaults for you to set here.",
        )}
        searchPlaceholder={t(
          'trade_docs.invoices.detail.copy.searchPlaceholder',
          'Search commercial invoices by number',
        )}
        confirmLabel={t('trade_docs.invoices.detail.copy.confirm', 'Copy')}
        onOpenChange={setCopyOpen}
        onSubmit={handleCopyFrom}
      />
      {ConfirmDialogElement}
    </div>
  )
}
