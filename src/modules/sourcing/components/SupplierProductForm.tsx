"use client"

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import {
  CrudForm,
  type CrudField,
  type CrudFieldOption,
  type CrudFormGroup,
  type CrudFormGroupComponentProps,
} from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrud, deleteCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { FieldLabel } from '@open-mercato/ui/primitives/label'
import { Input } from '@open-mercato/ui/primitives/input'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'

const API_PATH = 'sourcing/supplier-products'
const SUPPLIERS_API_PATH = 'purchasing/suppliers'
const LIST_HREF = '/backend/sourcing/supplier-products'
const ENTITY_ID = 'sourcing:sourcing_supplier_product'

/** Packing sizes are centimetres everywhere in this library, so only the three numbers vary. */
export type PackingValues = { length: string; width: string; height: string }

export type SupplierProductFormValues = {
  id?: string
  supplierId: string
  supplierName: string
  supplierSku: string
  itemNo: string
  name: string
  description: string
  unit: string
  hsCode: string
  moqQuantity: string
  cartonQuantity: string
  unitNetWeight: string
  cartonGrossWeight: string
  cartonNetWeight: string
  innerPacking: PackingValues
  outerPacking: PackingValues
  status: string
  notes: string
  /**
   * Carries the optimistic-lock version into `CrudForm`, which auto-derives the
   * expected-version header from `initialValues.updatedAt` for update and delete.
   */
  updatedAt?: string | null
}

const EMPTY_PACKING: PackingValues = { length: '', width: '', height: '' }

const EMPTY_VALUES: SupplierProductFormValues = {
  supplierId: '',
  supplierName: '',
  supplierSku: '',
  itemNo: '',
  name: '',
  description: '',
  unit: 'PCS',
  hsCode: '',
  moqQuantity: '',
  cartonQuantity: '',
  unitNetWeight: '',
  cartonGrossWeight: '',
  cartonNetWeight: '',
  innerPacking: EMPTY_PACKING,
  outerPacking: EMPTY_PACKING,
  status: 'active',
  notes: '',
}

function readText(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string') return value
  }
  return ''
}

function readNumberText(source: Record<string, unknown>, key: string): string {
  const value = source[key]
  if (value === null || value === undefined) return ''
  return typeof value === 'number' || typeof value === 'string' ? String(value) : ''
}

function readPacking(raw: unknown): PackingValues {
  if (!raw || typeof raw !== 'object') return EMPTY_PACKING
  const source = raw as Record<string, unknown>
  return {
    length: readNumberText(source, 'length'),
    width: readNumberText(source, 'width'),
    height: readNumberText(source, 'height'),
  }
}

/**
 * Maps a record onto the form's initial values.
 *
 * Exported as a pure function because dropping `updatedAt` here silently disables optimistic
 * locking for the edit form.
 */
export function toSupplierProductFormValues(item: Record<string, unknown>): SupplierProductFormValues {
  const updatedAt = item.updatedAt ?? item.updated_at
  return {
    id: readText(item, 'id'),
    supplierId: readText(item, 'supplierId', 'supplier_id'),
    supplierName: readText(item, 'supplierName', 'supplier_name_snapshot'),
    supplierSku: readText(item, 'supplierSku', 'supplier_sku'),
    itemNo: readText(item, 'itemNo', 'item_no'),
    name: readText(item, 'name'),
    description: readText(item, 'description'),
    unit: readText(item, 'unit') || 'PCS',
    hsCode: readText(item, 'hsCode', 'hs_code'),
    moqQuantity: readNumberText(item, 'moqQuantity') || readNumberText(item, 'moq_quantity'),
    cartonQuantity: readNumberText(item, 'cartonQuantity') || readNumberText(item, 'carton_quantity'),
    unitNetWeight: readNumberText(item, 'unitNetWeight') || readNumberText(item, 'unit_net_weight'),
    cartonGrossWeight: readNumberText(item, 'cartonGrossWeight') || readNumberText(item, 'carton_gross_weight'),
    cartonNetWeight: readNumberText(item, 'cartonNetWeight') || readNumberText(item, 'carton_net_weight'),
    innerPacking: readPacking(item.innerPacking ?? item.inner_packing),
    outerPacking: readPacking(item.outerPacking ?? item.outer_packing),
    status: readText(item, 'status') || 'active',
    notes: readText(item, 'notes'),
    updatedAt: typeof updatedAt === 'string' ? updatedAt : null,
  }
}

function nullableNumberText(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function nullableDecimalText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function packingPayload(packing: PackingValues): Record<string, unknown> | null {
  const length = nullableNumberText(packing.length)
  const width = nullableNumberText(packing.width)
  const height = nullableNumberText(packing.height)
  if (length === null && width === null && height === null) return null
  return { length, width, height, unit: 'cm' }
}

/**
 * Builds the create/update payload.
 *
 * `supplierId` is dropped on update: a code is only unique *per supplier*, so the owning supplier
 * is part of the row's identity and the server refuses to move it.
 */
export function buildSupplierProductPayload(values: SupplierProductFormValues): Record<string, unknown> {
  return {
    supplierSku: values.supplierSku.trim(),
    itemNo: values.itemNo.trim() || null,
    name: values.name.trim(),
    description: values.description.trim() || null,
    unit: values.unit.trim() || 'PCS',
    hsCode: values.hsCode.trim() || null,
    moqQuantity: nullableNumberText(values.moqQuantity),
    cartonQuantity: nullableNumberText(values.cartonQuantity),
    unitNetWeight: nullableDecimalText(values.unitNetWeight),
    cartonGrossWeight: nullableDecimalText(values.cartonGrossWeight),
    cartonNetWeight: nullableDecimalText(values.cartonNetWeight),
    innerPacking: packingPayload(values.innerPacking),
    outerPacking: packingPayload(values.outerPacking),
    status: values.status === 'inactive' ? 'inactive' : 'active',
    notes: values.notes.trim() || null,
  }
}

/**
 * CrudForm swallows a loader rejection, so a picker that cannot load would go blank with no
 * explanation; the failure is surfaced as a flash instead (silent for 401/403, where the page
 * itself already reports the permission problem).
 */
function reportSupplierLoadFailure(errorMessage: string, status: number | null): CrudFieldOption[] {
  if (status !== 401 && status !== 403) flash(errorMessage, 'error')
  return []
}

async function loadSupplierOptions(errorMessage: string): Promise<CrudFieldOption[]> {
  try {
    const payload = await fetchCrudList<Record<string, unknown>>(SUPPLIERS_API_PATH, {
      // 100 is the supplier list's `pageSize` cap — a larger value answers 400, not a bigger page.
      pageSize: 100,
      sortField: 'name',
      sortDir: 'asc',
      isActive: true,
    })
    return (payload.items ?? [])
      .map((item) => {
        const value = String(item.id ?? '')
        if (!value) return null
        const name = typeof item.name === 'string' && item.name.length > 0 ? item.name : String(item.code ?? '')
        const code = typeof item.code === 'string' ? item.code : ''
        return { value, label: code ? `${code} — ${name}` : name }
      })
      .filter((option): option is CrudFieldOption => option !== null)
  } catch (error) {
    const status = typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : null
    return reportSupplierLoadFailure(errorMessage, status)
  }
}

function PackingEditor({
  fieldId,
  label,
  values,
  setValue,
  t,
}: CrudFormGroupComponentProps & { fieldId: string; label: string; t: TranslateFn }) {
  const current = React.useMemo(() => readPacking(values[fieldId]), [fieldId, values])
  const parts: Array<{ part: keyof PackingValues; label: string }> = [
    { part: 'length', label: t('sourcing.supplierProducts.form.field.length', 'Length') },
    { part: 'width', label: t('sourcing.supplierProducts.form.field.width', 'Width') },
    { part: 'height', label: t('sourcing.supplierProducts.form.field.height', 'Height') },
  ]

  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-sm font-medium">
        {label}
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          {t('sourcing.supplierProducts.form.field.cm', 'cm')}
        </span>
      </p>
      <div className="mt-3 grid grid-cols-3 gap-3">
        {parts.map((part) => {
          const inputId = `supplier-product-${fieldId}-${part.part}`
          return (
            <div key={part.part} className="space-y-1.5">
              <FieldLabel htmlFor={inputId}>{part.label}</FieldLabel>
              <Input
                id={inputId}
                value={current[part.part]}
                inputMode="decimal"
                onChange={(event) => setValue(fieldId, { ...current, [part.part]: event.target.value })}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function useSupplierProductFields(t: TranslateFn, opts: { supplierEditable: boolean }): CrudField[] {
  return React.useMemo<CrudField[]>(() => {
    const supplierFields: CrudField[] = opts.supplierEditable
      ? [
          {
            id: 'supplierId',
            label: t('sourcing.supplierProducts.form.field.supplier', 'Supplier'),
            type: 'select',
            required: true,
            loadOptions: () => loadSupplierOptions(t('sourcing.supplierProducts.form.supplierLoadFailed', 'Suppliers could not be loaded')),
          },
        ]
      : [
          {
            id: 'supplierName',
            label: t('sourcing.supplierProducts.form.field.supplier', 'Supplier'),
            type: 'text',
            readOnly: true,
          },
        ]

    return [
      ...supplierFields,
      {
        id: 'supplierSku',
        label: t('sourcing.supplierProducts.form.field.supplierSku', 'Supplier code'),
        type: 'text',
        required: true,
        maxLength: 120,
      },
      { id: 'itemNo', label: t('sourcing.supplierProducts.form.field.itemNo', 'Item no.'), type: 'text', maxLength: 120 },
      { id: 'name', label: t('sourcing.supplierProducts.form.field.name', 'Name'), type: 'text', required: true, maxLength: 300 },
      {
        id: 'description',
        label: t('sourcing.supplierProducts.form.field.description', 'Spec / description'),
        type: 'textarea',
        rows: 4,
        maxLength: 2000,
      },
      { id: 'unit', label: t('sourcing.supplierProducts.form.field.unit', 'Unit'), type: 'text', maxLength: 24 },
      { id: 'hsCode', label: t('sourcing.supplierProducts.form.field.hsCode', 'HS code'), type: 'text', maxLength: 32 },
      {
        id: 'moqQuantity',
        label: t('sourcing.supplierProducts.form.field.moqQuantity', 'MOQ'),
        type: 'number',
      },
      {
        id: 'cartonQuantity',
        label: t('sourcing.supplierProducts.form.field.cartonQuantity', 'Units per carton'),
        type: 'number',
      },
      {
        id: 'unitNetWeight',
        label: t('sourcing.supplierProducts.form.field.unitNetWeight', 'Unit net weight'),
        type: 'number',
      },
      {
        id: 'cartonGrossWeight',
        label: t('sourcing.supplierProducts.form.field.cartonGrossWeight', 'Carton gross weight'),
        type: 'number',
      },
      {
        id: 'cartonNetWeight',
        label: t('sourcing.supplierProducts.form.field.cartonNetWeight', 'Carton net weight'),
        type: 'number',
      },
      {
        id: 'status',
        label: t('sourcing.supplierProducts.form.field.status', 'Status'),
        type: 'select',
        options: [
          { value: 'active', label: t('sourcing.supplierProducts.status.active', 'Active') },
          { value: 'inactive', label: t('sourcing.supplierProducts.status.inactive', 'Inactive') },
        ],
      },
      { id: 'notes', label: t('sourcing.supplierProducts.form.field.notes', 'Notes'), type: 'textarea', rows: 3, maxLength: 2000 },
    ]
  }, [opts.supplierEditable, t])
}

function useSupplierProductGroups(t: TranslateFn): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'details',
        column: 1,
        title: t('sourcing.supplierProducts.form.group.details', 'Goods'),
        fields: ['supplierId', 'supplierName', 'supplierSku', 'itemNo', 'name', 'description', 'unit', 'hsCode'],
      },
      {
        id: 'packing',
        column: 2,
        title: t('sourcing.supplierProducts.form.group.packing', 'Packing'),
        fields: ['moqQuantity', 'cartonQuantity', 'unitNetWeight', 'cartonGrossWeight', 'cartonNetWeight'],
      },
      {
        id: 'innerPacking',
        column: 2,
        bare: true,
        component: (context) => (
          <PackingEditor
            {...context}
            fieldId="innerPacking"
            label={t('sourcing.supplierProducts.form.field.innerPacking', 'Inner packing')}
            t={t}
          />
        ),
      },
      {
        id: 'outerPacking',
        column: 2,
        bare: true,
        component: (context) => (
          <PackingEditor
            {...context}
            fieldId="outerPacking"
            label={t('sourcing.supplierProducts.form.field.outerPacking', 'Outer packing')}
            t={t}
          />
        ),
      },
      {
        id: 'settings',
        column: 2,
        title: t('sourcing.supplierProducts.form.group.settings', 'Status'),
        fields: ['status', 'notes'],
      },
    ],
    [t],
  )
}

function SupplierProductCreateForm() {
  const t = useT()
  const searchParams = useSearchParams()
  const fields = useSupplierProductFields(t, { supplierEditable: true })
  const groups = useSupplierProductGroups(t)
  // The library list links here with `?supplierId=` when the operator came from a supplier row,
  // so the picker starts on that supplier instead of asking again.
  const initialValues = React.useMemo<SupplierProductFormValues>(
    () => ({ ...EMPTY_VALUES, supplierId: searchParams?.get('supplierId') ?? '' }),
    [searchParams],
  )
  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('sourcing.supplierProducts.form.saved', 'Product saved'), 'success'),
    [t],
  )

  const handleSubmit = React.useCallback(async (values: SupplierProductFormValues) => {
    try {
      await createCrud(API_PATH, { ...buildSupplierProductPayload(values), supplierId: values.supplierId })
    } catch (error) {
      flash(t('sourcing.supplierProducts.form.saveFailed', 'Saving failed'), 'error')
      throw error
    }
  }, [t])

  return (
    <CrudForm<SupplierProductFormValues>
      entityId={ENTITY_ID}
      title={t('sourcing.supplierProducts.form.createTitle', 'New supplier product')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      fields={fields}
      groups={groups}
      initialValues={initialValues}
      submitLabel={t('sourcing.supplierProducts.form.save', 'Save')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={handleSubmit}
    />
  )
}

function SupplierProductEditForm({ productId }: { productId: string }) {
  const t = useT()
  const fields = useSupplierProductFields(t, { supplierEditable: false })
  const groups = useSupplierProductGroups(t)
  const [initial, setInitial] = React.useState<SupplierProductFormValues | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)

  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('sourcing.supplierProducts.form.saved', 'Product saved'), 'success'),
    [t],
  )

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setIsNotFound(false)
      try {
        const payload = await fetchCrudList<Record<string, unknown>>(API_PATH, { id: productId, pageSize: 1 })
        const item = payload?.items?.[0]
        if (!item) {
          if (!cancelled) setIsNotFound(true)
          return
        }
        if (!cancelled) setInitial(toSupplierProductFormValues(item))
      } catch (loadError: unknown) {
        if (!cancelled) {
          if ((loadError as { status?: number }).status === 404) setIsNotFound(true)
          else setError(t('sourcing.supplierProducts.form.loadFailed', 'The product could not be loaded'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [productId, t])

  const fallbackInitialValues = React.useMemo<SupplierProductFormValues>(
    () => ({ ...EMPTY_VALUES, id: productId, updatedAt: null }),
    [productId],
  )

  const handleSubmit = React.useCallback(async (values: SupplierProductFormValues) => {
    try {
      await updateCrud(API_PATH, {
        id: initial?.id || productId,
        ...buildSupplierProductPayload(values),
        updatedAt: initial?.updatedAt ?? null,
      })
    } catch (updateError) {
      flash(t('sourcing.supplierProducts.form.saveFailed', 'Saving failed'), 'error')
      throw updateError
    }
  }, [initial, productId, t])

  const handleDelete = React.useCallback(async () => {
    await deleteCrud(API_PATH, { id: initial?.id || productId })
  }, [initial, productId])

  if (isNotFound) {
    return (
      <RecordNotFoundState
        label={t('sourcing.supplierProducts.form.loadFailed', 'The product could not be loaded')}
        backHref={LIST_HREF}
      />
    )
  }

  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<SupplierProductFormValues>
      entityId={ENTITY_ID}
      title={t('sourcing.supplierProducts.form.editTitle', 'Edit supplier product')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      fields={fields}
      groups={groups}
      initialValues={initial ?? fallbackInitialValues}
      submitLabel={t('sourcing.supplierProducts.form.save', 'Save')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      isLoading={loading}
      onSubmit={handleSubmit}
      onDelete={handleDelete}
      deleteRedirect={LIST_HREF}
    />
  )
}

export default function SupplierProductForm({
  mode,
  productId,
}: {
  mode: 'create' | 'edit'
  productId?: string
}) {
  if (mode === 'edit') {
    if (!productId) return null
    return <SupplierProductEditForm productId={productId} />
  }
  return <SupplierProductCreateForm />
} 