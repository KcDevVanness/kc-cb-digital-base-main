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
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { pushWithFlash } from '@open-mercato/ui/backend/utils/flash'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { FieldLabel } from '@open-mercato/ui/primitives/label'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { formatCurrency } from '@open-mercato/ui/utils/format'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useLocale, useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { directionLabel, invoiceStatusLabel, INVOICE_DIRECTIONS, type InvoiceStatus } from './contractLabels'
import {
  loadContractLineOptions,
  loadContractOptions,
  loadCounterpartyOptions,
  loadCurrencyOptions,
  loadProductOptions,
  readText,
  type ProductOption,
} from './formOptions'

const INVOICES_API_PATH = 'trade_docs/invoices'
const INVOICE_LINES_API_PATH = 'trade_docs/invoices/lines'
const INVOICE_TRANSITIONS_API_PATH = 'trade_docs/invoices/transitions'
const INVOICE_ATTACH_API_PATH = 'trade_docs/invoices/attach'
const CONTRACTS_HREF = '/backend/trade-docs/contracts'
const LIST_HREF = '/backend/trade-docs/invoices'

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
  contractLineId: string
}

export type InvoiceFormValues = {
  id?: string
  number: string
  direction: string
  counterpartyKind: string
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
  contractLineId: '',
}

const EMPTY_INVOICE_VALUES: InvoiceFormValues = {
  number: '',
  direction: 'inbound',
  counterpartyKind: 'supplier',
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

export function toInvoiceFormValues(
  item: Record<string, unknown>,
  lines: InvoiceLineValues[] = [],
): InvoiceFormValues {
  const updatedAt = item.updatedAt ?? item.updated_at
  return {
    id: readText(item, 'id'),
    number: readText(item, 'number'),
    direction: readText(item, 'direction') || 'inbound',
    counterpartyKind: readText(item, 'counterpartyKind', 'counterparty_kind') || 'supplier',
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
      contractLineId: line.contractLineId.trim() ? line.contractLineId.trim() : null,
    }))

  return {
    number: trimmedOrNull(values.number),
    direction: values.direction,
    counterpartyKind: values.counterpartyKind,
    counterpartyId: values.counterpartyId.trim() ? values.counterpartyId.trim() : null,
    counterpartySnapshot: values.counterpartyName.trim() ? { name: values.counterpartyName.trim() } : null,
    contractId: values.contractId.trim() ? values.contractId.trim() : null,
    currencyCode: values.currencyCode.trim().toUpperCase(),
    issuedAt: trimmedOrNull(values.issuedAt),
    notes: trimmedOrNull(values.notes),
    lines,
  }
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

function useInvoiceFields(t: TranslateFn): CrudField[] {
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
      id: 'counterpartyKind',
      label: t('trade_docs.invoices.form.field.counterpartyKind'),
      type: 'select',
      options: [
        { value: 'supplier', label: t('trade_docs.contracts.form.counterpartyKind.supplier') },
        { value: 'customer', label: t('trade_docs.contracts.form.counterpartyKind.customer') },
      ],
      layout: 'half',
    },
    {
      id: 'counterpartyId',
      label: t('trade_docs.invoices.form.field.counterpartyId'),
      type: 'select',
      layout: 'half',
      loadOptions: () =>
        loadCounterpartyOptions({
          supplierLabel: t('trade_docs.contracts.form.counterpartyKind.supplier'),
          customerLabel: t('trade_docs.contracts.form.counterpartyKind.customer'),
          errorMessage: t('trade_docs.contracts.form.counterpartyLoadFailed'),
          organizationId,
        }),
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
  ], [t, organizationId])
}

function useInvoiceGroups(t: TranslateFn): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'header',
      column: 1,
      fields: ['number', 'direction', 'counterpartyKind', 'counterpartyId', 'counterpartyName', 'contractId', 'currencyCode', 'issuedAt', 'notes'],
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
  const fields = useInvoiceFields(t)
  const groups = useInvoiceGroups(t)
  const initialValues = React.useMemo<InvoiceFormValues>(() => {
    const contractId = searchParams.get('contractId') ?? ''
    return { ...EMPTY_INVOICE_VALUES, contractId, lines: [{ ...EMPTY_LINE }] }
  }, [searchParams])

  const handleSubmit = React.useCallback(async (values: InvoiceFormValues) => {
    try {
      const created = await createCrud<{ id?: string }>(INVOICES_API_PATH, buildInvoicePayload(values))
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
  }, [router, t])

  return (
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
          <a
            className="text-sm font-medium hover:underline"
            href={`/api/attachments/file/${encodeURIComponent(attachmentId)}?download=1`}
            target="_blank"
            rel="noreferrer"
          >
            {t('trade_docs.invoices.form.attachment.open')}
          </a>
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
  const locale = useLocale()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const fields = useInvoiceFields(t)
  const groups = useInvoiceGroups(t)
  const [initial, setInitial] = React.useState<InvoiceFormValues | null>(null)
  const [head, setHead] = React.useState<{
    status: InvoiceStatus
    total: string
    currencyCode: string
    contractId: string | null
    contractNumber: string | null
    attachmentId: string | null
    updatedAt: string | null
  } | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)
  const [isMutating, setIsMutating] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)

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
          currencyCode: String(item.currencyCode ?? 'CNY'),
          contractId: (item.contractId ?? null) as string | null,
          contractNumber: (item.contractNumber ?? null) as string | null,
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

  if (loading) return <LoadingMessage label={t('trade_docs.common.loading')} />
  if (isNotFound) return <RecordNotFoundState label={t('trade_docs.invoices.form.notFound')} backHref={LIST_HREF} />
  if (error) return <ErrorMessage label={error} />
  if (!initial || !head) return null

  const isDraft = head.status === 'draft'

  return (
    <div className="space-y-6">
      <FormHeader
        mode="detail"
        backHref={LIST_HREF}
        entityTypeLabel={t('trade_docs.invoices.page.title')}
        title={initial.number || t(`trade_docs.invoices.status.${head.status}`)}
        statusBadge={(
          <StatusBadge variant={head.status === 'confirmed' ? 'success' : head.status === 'void' ? 'error' : 'neutral'} dot>
            {invoiceStatusLabel(t, head.status)}
          </StatusBadge>
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
            <p className="text-lg font-semibold tabular-nums">
              {formatCurrency(head.total, head.currencyCode, locale) ?? head.total}
            </p>
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
          </div>
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
                  <span className="tabular-nums">
                    {formatCurrency(row.original.amount, head.currencyCode, locale) ?? row.original.amount}
                  </span>
                ),
              },
            ]}
            data={initial.lines.map((line, index) => ({ ...line, id: line.contractLineId || `line-${index}` }))}
            emptyState={<EmptyState title={t('trade_docs.invoices.form.lines.empty')} />}
          />
        </section>
      )}
      {ConfirmDialogElement}
    </div>
  )
}
