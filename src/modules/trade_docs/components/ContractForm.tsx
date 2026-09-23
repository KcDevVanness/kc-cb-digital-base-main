"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
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
import { pushWithFlash } from '@open-mercato/ui/backend/utils/flash'
import { Button } from '@open-mercato/ui/primitives/button'
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
import { CONTRACT_DIRECTIONS, CONTRACT_STATUSES, directionLabel } from './contractLabels'
import {
  loadCounterpartyOptions,
  loadCurrencyOptions,
  loadPaymentTermOptions,
  loadPortOptions,
  loadProductOption,
  loadProductOptions,
  loadShippingMethodOptions,
  readText,
  useUnitOptions,
  withCurrentUnit,
  type ProductOption,
} from './formOptions'

const CONTRACTS_API_PATH = 'trade_docs/contracts'
const CONTRACT_LINES_API_PATH = 'trade_docs/contracts/lines'
const LIST_HREF = '/backend/trade-docs/contracts'
const PRICE_TIERS = ['purchase', 'internal', 'export'] as const

export type ContractLineValues = {
  productId: string
  name: string
  sku: string
  model: string
  spec: string
  unit: string
  quantity: string
  unitPrice: string
  note: string
}

export type ContractFormValues = {
  id?: string
  direction: string
  counterpartyKind: string
  counterpartyId: string
  counterpartyName: string
  counterpartyAddress: string
  counterpartyContact: string
  counterpartyBank: string
  ourPartyName: string
  ourPartyAddress: string
  ourPartyContact: string
  ourPartyBank: string
  priceTier: string
  currencyCode: string
  exchangeRate: string
  signedAt: string
  deliveryDate: string
  paymentTerms: string
  shippingMethod: string
  destination: string
  marks: string
  notes: string
  lines: ContractLineValues[]
  /** Optimistic-lock version; `CrudForm` derives the expected-version header from it. */
  updatedAt?: string | null
}

export type ContractRecord = ContractFormValues & { id: string }

const EMPTY_LINE: ContractLineValues = {
  productId: '',
  name: '',
  sku: '',
  model: '',
  spec: '',
  unit: 'PCS',
  quantity: '1',
  unitPrice: '0',
  note: '',
}

const EMPTY_CONTRACT_VALUES: ContractFormValues = {
  direction: 'purchase',
  counterpartyKind: 'supplier',
  counterpartyId: '',
  counterpartyName: '',
  counterpartyAddress: '',
  counterpartyContact: '',
  counterpartyBank: '',
  ourPartyName: '',
  ourPartyAddress: '',
  ourPartyContact: '',
  ourPartyBank: '',
  priceTier: 'purchase',
  currencyCode: '',
  exchangeRate: '',
  signedAt: '',
  deliveryDate: '',
  paymentTerms: '',
  shippingMethod: '',
  destination: '',
  marks: '',
  notes: '',
  lines: [{ ...EMPTY_LINE }],
}

function snapshotText(snapshot: unknown, key: string): string {
  if (!snapshot || typeof snapshot !== 'object') return ''
  const value = (snapshot as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : ''
}

export function toContractFormValues(
  item: Record<string, unknown>,
  lines: ContractLineValues[] = [],
): ContractRecord {
  const counterpartySnapshot = item.counterpartySnapshot ?? item.counterparty_snapshot
  const ourPartySnapshot = item.ourPartySnapshot ?? item.our_party_snapshot
  const updatedAt = item.updatedAt ?? item.updated_at
  return {
    id: readText(item, 'id'),
    direction: readText(item, 'direction') || 'purchase',
    counterpartyKind: readText(item, 'counterpartyKind', 'counterparty_kind') || 'supplier',
    counterpartyId: readText(item, 'counterpartyId', 'counterparty_id'),
    counterpartyName: snapshotText(counterpartySnapshot, 'name'),
    counterpartyAddress: snapshotText(counterpartySnapshot, 'address'),
    counterpartyContact: snapshotText(counterpartySnapshot, 'contact'),
    counterpartyBank: snapshotText(counterpartySnapshot, 'bank'),
    ourPartyName: snapshotText(ourPartySnapshot, 'name'),
    ourPartyAddress: snapshotText(ourPartySnapshot, 'address'),
    ourPartyContact: snapshotText(ourPartySnapshot, 'contact'),
    ourPartyBank: snapshotText(ourPartySnapshot, 'bank'),
    priceTier: readText(item, 'priceTier', 'price_tier'),
    currencyCode: readText(item, 'currencyCode', 'currency_code'),
    exchangeRate: readText(item, 'exchangeRate', 'exchange_rate'),
    signedAt: (item.signedAt ?? item.signed_at ?? '') as string,
    deliveryDate: (item.deliveryDate ?? item.delivery_date ?? '') as string,
    paymentTerms: readText(item, 'paymentTerms', 'payment_terms'),
    shippingMethod: readText(item, 'shippingMethod', 'shipping_method'),
    destination: readText(item, 'destination'),
    marks: readText(item, 'marks'),
    notes: readText(item, 'notes'),
    lines: lines.length > 0 ? lines : [{ ...EMPTY_LINE }],
    updatedAt: typeof updatedAt === 'string' ? updatedAt : null,
  }
}

export function toContractLineValues(item: Record<string, unknown>): ContractLineValues {
  return {
    productId: readText(item, 'productId', 'product_id'),
    name: readText(item, 'name'),
    sku: readText(item, 'sku'),
    model: readText(item, 'model'),
    spec: readText(item, 'spec'),
    unit: readText(item, 'unit'),
    quantity: readText(item, 'quantity') || '0',
    unitPrice: readText(item, 'unitPrice', 'unit_price') || '0',
    note: readText(item, 'note'),
  }
}

function trimmedOrNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function partySnapshot(values: {
  name: string
  address: string
  contact: string
  bank: string
}): Record<string, unknown> | null {
  const snapshot: Record<string, unknown> = {}
  if (values.name.trim()) snapshot.name = values.name.trim()
  if (values.address.trim()) snapshot.address = values.address.trim()
  if (values.contact.trim()) snapshot.contact = values.contact.trim()
  if (values.bank.trim()) snapshot.bank = values.bank.trim()
  return Object.keys(snapshot).length > 0 ? snapshot : null
}

/**
 * Builds the create/update payload. Lines the operator never filled in are dropped: a blank row
 * would otherwise be rejected by the API (`Line N needs a product or a name`), and the contract's
 * totals must only describe rows the operator meant to add.
 */
export function buildContractPayload(values: ContractFormValues): Record<string, unknown> {
  const lines = values.lines
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
      note: trimmedOrNull(line.note),
    }))

  return {
    direction: values.direction,
    counterpartyKind: values.counterpartyKind,
    counterpartyId: values.counterpartyId.trim() ? values.counterpartyId.trim() : null,
    counterpartySnapshot: partySnapshot({
      name: values.counterpartyName,
      address: values.counterpartyAddress,
      contact: values.counterpartyContact,
      bank: values.counterpartyBank,
    }),
    ourPartySnapshot: partySnapshot({
      name: values.ourPartyName,
      address: values.ourPartyAddress,
      contact: values.ourPartyContact,
      bank: values.ourPartyBank,
    }),
    priceTier: values.priceTier.trim() ? values.priceTier.trim() : null,
    currencyCode: values.currencyCode.trim().toUpperCase(),
    exchangeRate: values.exchangeRate.trim() ? values.exchangeRate.trim() : null,
    signedAt: trimmedOrNull(values.signedAt),
    deliveryDate: trimmedOrNull(values.deliveryDate),
    paymentTerms: trimmedOrNull(values.paymentTerms),
    shippingMethod: trimmedOrNull(values.shippingMethod),
    destination: trimmedOrNull(values.destination),
    marks: trimmedOrNull(values.marks),
    notes: trimmedOrNull(values.notes),
    lines,
  }
}

function ContractLinesEditor(
  { values, setValue, t }: CrudFormGroupComponentProps & { t: TranslateFn },
) {
  const { organizationId } = useOrganizationScopeDetail()
  // The unit list is the app's dictionary; a code the row already carries is merged per line, so a
  // document saved before the dictionary changed opens with its own unit still selected.
  const unitOptions = useUnitOptions()
  const lines = React.useMemo(() => {
    const raw = values.lines
    return Array.isArray(raw) ? (raw as ContractLineValues[]) : []
  }, [values.lines])
  const productCache = React.useRef(new Map<string, ProductOption>())
  /**
   * Latest rows, for the reads that happen after an `await` — `setValue` has no functional form, so
   * an async continuation must not write from the rows captured at render time or the row loses the
   * product it was just given.
   */
  const linesRef = React.useRef(lines)
  linesRef.current = lines

  const cacheProducts = React.useCallback((options: ProductOption[]) => {
    for (const option of options) productCache.current.set(option.value, option)
  }, [])

  const updateLine = React.useCallback(
    (index: number, patch: Partial<ContractLineValues>) => {
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

  /**
   * Selecting a product fills the printed line from the product's current data. The fields stay
   * editable afterwards on purpose: the contract is what the parties sign, and a printed name may
   * legitimately differ from the master record.
   */
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
      void loadProductOption(productId, t('trade_docs.contracts.form.lines.productLoadFailed'), organizationId)
        .then((option) => {
          if (!option) return
          cacheProducts([option])
          // The row read after the await, not at render time; and a row whose product changed
          // meanwhile is left alone.
          const current = linesRef.current[index]
          if (!current || current.productId !== productId) return
          // Only fill what the operator has not already typed, so a late response cannot
          // overwrite an edit made while it was in flight.
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
    // `lines` is deliberately absent: the post-await read goes through `linesRef`, so depending on
    // the render-time rows would only re-create the callback on every keystroke.
    [cacheProducts, organizationId, t, updateLine],
  )

  return (
    <div className="space-y-4">
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('trade_docs.contracts.form.lines.empty')}</p>
      ) : null}
      {lines.map((line, index) => {
        const lineKey = line.productId || `line-${index}`
        return (
          <div key={lineKey} className="space-y-3 rounded-lg border border-border p-3">
            <div className="grid gap-3 md:grid-cols-12">
              <div className="space-y-1.5 md:col-span-6">
                <FieldLabel htmlFor={`contract-line-product-${index}`}>
                  {t('trade_docs.contracts.form.lines.product')}
                </FieldLabel>
                <ComboboxInput
                  value={line.productId}
                  onChange={(next) => handleProductChange(index, next)}
                  placeholder={t('trade_docs.contracts.form.lines.selectProduct')}
                  seedOptions={
                    line.productId && (line.sku || line.name)
                      ? [{ value: line.productId, label: line.sku ? `${line.sku} — ${line.name}` : line.name }]
                      : undefined
                  }
                  loadSuggestions={async (query) => {
                    const options = await loadProductOptions(
                      t('trade_docs.contracts.form.lines.productLoadFailed'),
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
                <FieldLabel htmlFor={`contract-line-name-${index}`}>
                  {t('trade_docs.contracts.form.lines.name')}
                </FieldLabel>
                <Input
                  id={`contract-line-name-${index}`}
                  value={line.name}
                  onChange={(event) => updateLine(index, { name: event.target.value })}
                />
              </div>
              <div className="flex items-end justify-end md:col-span-1">
                <IconButton
                  type="button"
                  variant="ghost"
                  size="lg"
                  aria-label={t('trade_docs.contracts.form.lines.remove')}
                  onClick={() => removeLine(index)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </IconButton>
              </div>
              <div className="space-y-1.5 md:col-span-3">
                <FieldLabel htmlFor={`contract-line-sku-${index}`}>
                  {t('trade_docs.contracts.form.lines.sku')}
                </FieldLabel>
                <Input
                  id={`contract-line-sku-${index}`}
                  value={line.sku}
                  onChange={(event) => updateLine(index, { sku: event.target.value })}
                />
              </div>
              <div className="space-y-1.5 md:col-span-3">
                <FieldLabel htmlFor={`contract-line-model-${index}`}>
                  {t('trade_docs.contracts.form.lines.model')}
                </FieldLabel>
                <Input
                  id={`contract-line-model-${index}`}
                  value={line.model}
                  onChange={(event) => updateLine(index, { model: event.target.value })}
                />
              </div>
              <div className="space-y-1.5 md:col-span-3">
                <FieldLabel htmlFor={`contract-line-spec-${index}`}>
                  {t('trade_docs.contracts.form.lines.spec')}
                </FieldLabel>
                <Input
                  id={`contract-line-spec-${index}`}
                  value={line.spec}
                  onChange={(event) => updateLine(index, { spec: event.target.value })}
                />
              </div>
              <div className="space-y-1.5 md:col-span-3">
                <FieldLabel htmlFor={`contract-line-unit-${index}`}>
                  {t('trade_docs.contracts.form.lines.unit')}
                </FieldLabel>
                {/*
                 * Picked from the app's unit dictionary: the code prints on the contract and travels
                 * into the export paperwork, so it must be the same spelling the product master
                 * stores. A value the dictionary does not list stays selectable on the row it is
                 * already on rather than being silently dropped.
                 */}
                <Select
                  value={line.unit}
                  onValueChange={(next) => updateLine(index, { unit: next })}
                >
                  <SelectTrigger id={`contract-line-unit-${index}`}>
                    <SelectValue placeholder={t('trade_docs.contracts.form.lines.selectUnit')} />
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
                <FieldLabel htmlFor={`contract-line-quantity-${index}`}>
                  {t('trade_docs.contracts.form.lines.quantity')}
                </FieldLabel>
                <Input
                  id={`contract-line-quantity-${index}`}
                  inputMode="decimal"
                  value={line.quantity}
                  onChange={(event) => updateLine(index, { quantity: event.target.value })}
                />
              </div>
              <div className="space-y-1.5 md:col-span-3">
                <FieldLabel htmlFor={`contract-line-price-${index}`}>
                  {t('trade_docs.contracts.form.lines.unitPrice')}
                </FieldLabel>
                <Input
                  id={`contract-line-price-${index}`}
                  inputMode="decimal"
                  value={line.unitPrice}
                  onChange={(event) => updateLine(index, { unitPrice: event.target.value })}
                />
              </div>
              <div className="space-y-1.5 md:col-span-6">
                <FieldLabel htmlFor={`contract-line-note-${index}`}>
                  {t('trade_docs.contracts.form.lines.note')}
                </FieldLabel>
                <Input
                  id={`contract-line-note-${index}`}
                  value={line.note}
                  onChange={(event) => updateLine(index, { note: event.target.value })}
                />
              </div>
            </div>
          </div>
        )
      })}
      <Button type="button" variant="outline" onClick={addLine}>
        <Plus className="size-4" aria-hidden="true" />
        {t('trade_docs.contracts.form.lines.add')}
      </Button>
    </div>
  )
}

function useContractFields(t: TranslateFn): CrudField[] {
  const { organizationId } = useOrganizationScopeDetail()
  return React.useMemo<CrudField[]>(() => [
    {
      id: 'direction',
      label: t('trade_docs.contracts.form.field.direction'),
      type: 'select',
      required: true,
      options: CONTRACT_DIRECTIONS.map((value) => ({ value, label: directionLabel(t, value) })),
      layout: 'half',
    },
    {
      id: 'counterpartyKind',
      label: t('trade_docs.contracts.form.field.counterpartyKind'),
      type: 'select',
      options: [
        { value: 'supplier', label: t('trade_docs.contracts.form.counterpartyKind.supplier') },
        { value: 'customer', label: t('trade_docs.contracts.form.counterpartyKind.customer') },
      ],
      layout: 'half',
    },
    {
      id: 'counterpartyId',
      label: t('trade_docs.contracts.form.field.counterpartyId'),
      type: 'select',
      placeholder: t('trade_docs.contracts.form.field.counterpartyName'),
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
      id: 'priceTier',
      label: t('trade_docs.contracts.form.field.priceTier'),
      type: 'select',
      options: [
        { value: '', label: t('trade_docs.contracts.form.priceTier.none') },
        { value: 'purchase', label: t('products.priceTier.purchase') },
        { value: 'internal', label: t('products.priceTier.internal') },
        { value: 'export', label: t('products.priceTier.export') },
      ],
      layout: 'half',
    },
    {
      id: 'currencyCode',
      label: t('trade_docs.contracts.form.field.currencyCode'),
      type: 'select',
      required: true,
      layout: 'half',
      loadOptions: () => loadCurrencyOptions(t('trade_docs.contracts.form.counterpartyLoadFailed')),
    },
    {
      id: 'exchangeRate',
      label: t('trade_docs.contracts.form.field.exchangeRate'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'signedAt',
      label: t('trade_docs.contracts.form.field.signedAt'),
      type: 'date',
      layout: 'half',
    },
    {
      id: 'deliveryDate',
      label: t('trade_docs.contracts.form.field.deliveryDate'),
      type: 'date',
      layout: 'half',
    },
    {
      id: 'paymentTerms',
      label: t('trade_docs.contracts.form.field.paymentTerms'),
      // The dictionary suggests the phrasings this business signs with; the contract prints what is
      // in the field, so a negotiated wording that is not in the list stays typeable.
      type: 'combobox',
      layout: 'half',
      description: t('trade_docs.contracts.form.field.paymentTermsHelp'),
      allowCustomValues: true,
      resolveLabel: (value) => value,
      loadOptions: (query) => loadPaymentTermOptions(query),
    },
    {
      id: 'shippingMethod',
      label: t('trade_docs.contracts.form.field.shippingMethod'),
      type: 'combobox',
      layout: 'half',
      description: t('trade_docs.contracts.form.field.shippingMethodHelp'),
      allowCustomValues: true,
      resolveLabel: (value) => value,
      loadOptions: (query) => loadShippingMethodOptions(query),
    },
    {
      id: 'destination',
      label: t('trade_docs.contracts.form.field.destination'),
      // Same `port` dictionary the shipment's 出口口岸 reads.
      type: 'combobox',
      layout: 'half',
      description: t('trade_docs.contracts.form.field.destinationHelp'),
      allowCustomValues: true,
      resolveLabel: (value) => value,
      loadOptions: (query) => loadPortOptions(query),
    },
    {
      id: 'marks',
      label: t('trade_docs.contracts.form.field.marks'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'counterpartyName',
      label: t('trade_docs.contracts.form.field.counterpartyName'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'counterpartyAddress',
      label: t('trade_docs.contracts.form.field.counterpartyAddress'),
      type: 'textarea',
      layout: 'half',
    },
    {
      id: 'counterpartyContact',
      label: t('trade_docs.contracts.form.field.counterpartyContact'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'counterpartyBank',
      label: t('trade_docs.contracts.form.field.counterpartyBank'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'ourPartyName',
      label: t('trade_docs.contracts.form.field.ourParty.name'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'ourPartyAddress',
      label: t('trade_docs.contracts.form.field.ourParty.address'),
      type: 'textarea',
      layout: 'half',
    },
    {
      id: 'ourPartyContact',
      label: t('trade_docs.contracts.form.field.ourParty.contact'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'ourPartyBank',
      label: t('trade_docs.contracts.form.field.ourParty.bank'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'notes',
      label: t('trade_docs.contracts.form.field.notes'),
      type: 'textarea',
      layout: 'half',
    },
  ], [t, organizationId])
}

export default function ContractForm({ mode, contractId }: { mode: 'create' | 'edit'; contractId?: string }) {
  const t = useT()
  const router = useRouter()
  const fields = useContractFields(t)

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'header',
      column: 1,
      fields: ['direction', 'counterpartyKind', 'counterpartyId', 'priceTier', 'currencyCode', 'exchangeRate', 'signedAt', 'deliveryDate'],
    },
    {
      id: 'terms',
      column: 2,
      fields: ['paymentTerms', 'shippingMethod', 'destination', 'marks', 'notes'],
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
    {
      id: 'lines',
      column: 1,
      bare: true,
      component: (context) => <ContractLinesEditor {...context} t={t} />,
    },
  ], [t])

  if (mode === 'edit') {
    if (!contractId) return null
    return <ContractEditForm contractId={contractId} fields={fields} groups={groups} />
  }
  return <ContractCreateForm fields={fields} groups={groups} />
}

type FormWiring = { fields: CrudField[]; groups: CrudFormGroup[] }

function ContractCreateForm({ fields, groups }: FormWiring) {
  const t = useT()
  const router = useRouter()

  const handleSubmit = React.useCallback(async (values: ContractFormValues) => {
    try {
      const created = await createCrud<{ id?: string }>(CONTRACTS_API_PATH, buildContractPayload(values))
      const createdId = typeof created.result?.id === 'string' ? created.result.id : null
      if (createdId) {
        // The detail page is the only surface that shows the two amount calibers, so the create
        // flow hands the operator straight to it.
        pushWithFlash(
          router,
          `${LIST_HREF}/${encodeURIComponent(createdId)}`,
          t('trade_docs.contracts.form.saved'),
          'success',
        )
        return
      }
      pushWithFlash(router, LIST_HREF, t('trade_docs.contracts.form.saved'), 'success')
    } catch (error) {
      flash(t('trade_docs.contracts.form.saveFailed'), 'error')
      throw error
    }
  }, [router, t])

  return (
    <CrudForm<ContractFormValues>
      title={t('trade_docs.contracts.form.createTitle')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      fields={fields}
      groups={groups}
      initialValues={{ ...EMPTY_CONTRACT_VALUES, lines: [{ ...EMPTY_LINE }] }}
      submitLabel={t('trade_docs.contracts.form.save')}
      cancelHref={LIST_HREF}
      onSubmit={handleSubmit}
    />
  )
}

function ContractEditForm({ contractId, fields, groups }: FormWiring & { contractId: string }) {
  const t = useT()
  const [initial, setInitial] = React.useState<ContractRecord | null>(null)
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
        const payload = await fetchCrudList<Record<string, unknown>>(CONTRACTS_API_PATH, {
          ids: contractId,
          pageSize: 1,
        })
        const item = payload?.items?.[0]
        if (!item) {
          if (!cancelled) setIsNotFound(true)
          return
        }
        const linePayload = await fetchCrudList<Record<string, unknown>>(CONTRACT_LINES_API_PATH, {
          contractId,
          pageSize: 500,
        })
        const lines = (linePayload.items ?? []).map(toContractLineValues)
        if (!cancelled) setInitial(toContractFormValues(item, lines))
      } catch (loadError: unknown) {
        if (!cancelled) {
          if ((loadError as { status?: number }).status === 404) {
            setIsNotFound(true)
          } else {
            setError(t('trade_docs.contracts.form.loadFailed'))
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
  }, [contractId, t])

  const fallbackInitialValues = React.useMemo<ContractFormValues>(
    () => ({ ...EMPTY_CONTRACT_VALUES, id: contractId, lines: [{ ...EMPTY_LINE }], updatedAt: null }),
    [contractId],
  )

  const handleSubmit = React.useCallback(async (values: ContractFormValues) => {
    try {
      await updateCrud(CONTRACTS_API_PATH, {
        id: initial?.id || contractId,
        ...buildContractPayload(values),
        updatedAt: initial?.updatedAt ?? null,
      })
    } catch (updateError) {
      flash(t('trade_docs.contracts.form.saveFailed'), 'error')
      throw updateError
    }
  }, [contractId, initial, t])

  if (isNotFound) {
    return <RecordNotFoundState label={t('trade_docs.contracts.form.notFound')} backHref={LIST_HREF} />
  }
  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<ContractFormValues>
      title={t('trade_docs.contracts.form.editTitle')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      fields={fields}
      groups={groups}
      initialValues={initial ?? fallbackInitialValues}
      submitLabel={t('trade_docs.contracts.form.save')}
      cancelHref={LIST_HREF}
      isLoading={loading}
      onSubmit={handleSubmit}
    />
  )
}

export { CONTRACT_STATUSES, PRICE_TIERS }
