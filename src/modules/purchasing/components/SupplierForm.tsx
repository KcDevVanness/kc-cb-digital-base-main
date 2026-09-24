"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFieldOption, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'

const API_PATH = 'purchasing/suppliers'
const LIST_HREF = '/backend/purchasing/suppliers'

export type SupplierFormValues = {
  id?: string
  name: string
  code: string
  contactName: string
  phone: string
  email: string
  address: string
  defaultCurrencyCode: string
  isActive: boolean
  notes: string
  /**
   * Carries the optimistic-lock version into `CrudForm`, which auto-derives the
   * expected-version header from `initialValues.updatedAt` for update.
   */
  updatedAt?: string | null
}

/** Supplier as returned by `/api/purchasing/suppliers`; `id` is always present on a persisted row. */
export type SupplierRecord = Omit<SupplierFormValues, 'id'> & { id: string }

const EMPTY_SUPPLIER_VALUES: SupplierFormValues = {
  name: '',
  code: '',
  contactName: '',
  phone: '',
  email: '',
  address: '',
  defaultCurrencyCode: '',
  isActive: true,
  notes: '',
}

const SUPPLIER_GROUPS_SETTINGS: CrudFormGroup = {
  id: 'settings',
  column: 2,
  fields: ['defaultCurrencyCode', 'brandValue', 'isActive', 'notes'],
}

/**
 * The create form has no code field: `purchasing.suppliers.create` issues the next `SUP-####`
 * (see `.ai/specs/2026-09-24-supplier-code-issuance.md`). The edit form shows it read-only —
 * the number is an identity that already sits in purchase-order snapshots, so nobody edits it.
 */
function supplierGroups(mode: 'create' | 'edit'): CrudFormGroup[] {
  return [
    {
      id: 'details',
      column: 1,
      fields: mode === 'create'
        ? ['name', 'contactName', 'phone', 'email', 'address']
        : ['name', 'code', 'contactName', 'phone', 'email', 'address'],
    },
    SUPPLIER_GROUPS_SETTINGS,
  ]
}

function readText(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string') return value
  }
  return ''
}

/**
 * Maps a list/record payload into the form's initial values.
 *
 * Exported as a pure function so the optimistic-lock wiring stays testable: `CrudForm`
 * auto-derives the expected-version header from `initialValues.updatedAt`, so dropping
 * `updatedAt` here silently disables optimistic locking for the edit form.
 */
export function toSupplierFormValues(item: Record<string, unknown>): SupplierRecord {
  const isActive = item.isActive ?? item.is_active
  const updatedAt = item.updatedAt ?? item.updated_at
  return {
    id: readText(item, 'id'),
    name: readText(item, 'name'),
    code: readText(item, 'code'),
    contactName: readText(item, 'contactName', 'contact_name'),
    phone: readText(item, 'phone'),
    email: readText(item, 'email'),
    address: readText(item, 'address'),
    defaultCurrencyCode: readText(item, 'defaultCurrencyCode', 'default_currency_code'),
    isActive: isActive === undefined ? true : Boolean(isActive),
    notes: readText(item, 'notes'),
    updatedAt: typeof updatedAt === 'string' ? updatedAt : null,
  }
}

/** Builds the create/update payload; keys are dropped to the contract field set. */
export function buildSupplierPayload(values: SupplierFormValues): Record<string, unknown> {
  const code = values.code.trim()
  return {
    name: values.name.trim(),
    // A blank code means "let the command issue one" (the create form has no code field); the edit
    // form sends its read-only value back unchanged, which the update command accepts as a no-op.
    ...(code.length > 0 ? { code } : {}),
    contactName: values.contactName.trim(),
    phone: values.phone.trim(),
    email: values.email.trim(),
    address: values.address.trim(),
    defaultCurrencyCode: values.defaultCurrencyCode.trim().toUpperCase(),
    isActive: Boolean(values.isActive),
    notes: values.notes.trim(),
  }
}

const CURRENCY_DICTIONARY_URL = '/api/currency_policy/currencies'

/**
 * Options come from the seeded currency dictionary — the same store every platform currency
 * picker reads — so the select can only offer codes the rest of the app understands. The FX
 * master is deliberately not used here: it drives exchange rates, not pickers.
 */
async function loadCurrencyOptions(errorMessage: string): Promise<CrudFieldOption[]> {
  const payload = await readApiResultOrThrow<{ entries?: Array<{ value?: string; label?: string }> }>(
    CURRENCY_DICTIONARY_URL,
    undefined,
    { errorMessage },
  )
  return (payload.entries ?? [])
    .map((entry) => {
      const value = typeof entry.value === 'string' ? entry.value.trim().toUpperCase() : ''
      if (!value) return null
      const label = typeof entry.label === 'string' && entry.label.trim().length ? entry.label.trim() : value
      return { value, label: `${value} — ${label}` }
    })
    .filter((option): option is CrudFieldOption => option !== null)
    .sort((left, right) => left.value.localeCompare(right.value))
}

function useSupplierFields(t: TranslateFn, mode: 'create' | 'edit'): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    {
      id: 'name',
      label: t('purchasing.suppliers.form.field.name'),
      type: 'text',
      required: true,
    },
    // Only the edit form renders the code, and only as a read-only value: the command issues it on
    // create, and it is already frozen into purchase-order snapshots by the time anyone sees it.
    ...(mode === 'edit'
      ? [{
          id: 'code',
          label: t('purchasing.suppliers.form.field.code'),
          type: 'text' as const,
          readOnly: true,
          description: t('purchasing.suppliers.form.help.code'),
        }]
      : []),
    {
      id: 'contactName',
      label: t('purchasing.suppliers.form.field.contactName'),
      type: 'text',
    },
    {
      id: 'phone',
      label: t('purchasing.suppliers.form.field.phone'),
      type: 'text',
    },
    {
      id: 'email',
      label: t('purchasing.suppliers.form.field.email'),
      type: 'text',
    },
    {
      id: 'address',
      label: t('purchasing.suppliers.form.field.address'),
      type: 'textarea',
    },
    {
      id: 'defaultCurrencyCode',
      label: t('purchasing.suppliers.form.field.defaultCurrencyCode'),
      type: 'select',
      required: true,
      loadOptions: () => loadCurrencyOptions(t('purchasing.suppliers.form.currencyLoadFailed')),
    },
    {
      id: 'isActive',
      label: t('purchasing.suppliers.form.field.isActive'),
      type: 'checkbox',
    },
    {
      id: 'notes',
      label: t('purchasing.suppliers.form.field.notes'),
      type: 'textarea',
    },
  ], [t, mode])
}

function SupplierCreateForm() {
  const t = useT()
  const fields = useSupplierFields(t, 'create')
  const groups = React.useMemo(() => supplierGroups('create'), [])
  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('purchasing.suppliers.form.saved'), 'success'),
    [t],
  )

  const handleSubmit = React.useCallback(async (values: SupplierFormValues) => {
    try {
      await createCrud(API_PATH, buildSupplierPayload(values))
    } catch (error) {
      flash(t('purchasing.suppliers.form.saveFailed'), 'error')
      throw error
    }
  }, [t])

  return (
    <CrudForm<SupplierFormValues>
      title={t('purchasing.suppliers.form.createTitle')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      fields={fields}
      groups={groups}
      initialValues={EMPTY_SUPPLIER_VALUES}
      submitLabel={t('purchasing.suppliers.form.save')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={handleSubmit}
    />
  )
}

function SupplierEditForm({ supplierId }: { supplierId: string }) {
  const t = useT()
  const fields = useSupplierFields(t, 'edit')
  const groups = React.useMemo(() => supplierGroups('edit'), [])
  const [initial, setInitial] = React.useState<SupplierRecord | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)

  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('purchasing.suppliers.form.saved'), 'success'),
    [t],
  )

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setIsNotFound(false)
      try {
        const payload = await fetchCrudList<Record<string, unknown>>(API_PATH, { ids: supplierId, pageSize: 1 })
        const item = payload?.items?.[0]
        if (!item) {
          if (!cancelled) setIsNotFound(true)
          return
        }
        if (!cancelled) setInitial(toSupplierFormValues(item))
      } catch (loadError: unknown) {
        if (!cancelled) {
          if ((loadError as { status?: number }).status === 404) {
            setIsNotFound(true)
          } else {
            setError(t('purchasing.suppliers.form.loadFailed'))
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [supplierId, t])

  const fallbackInitialValues = React.useMemo<SupplierFormValues>(
    () => ({ ...EMPTY_SUPPLIER_VALUES, id: supplierId, updatedAt: null }),
    [supplierId],
  )

  const handleSubmit = React.useCallback(async (values: SupplierFormValues) => {
    try {
      await updateCrud(API_PATH, {
        id: initial?.id || supplierId,
        ...buildSupplierPayload(values),
        updatedAt: initial?.updatedAt ?? null,
      })
    } catch (updateError) {
      flash(t('purchasing.suppliers.form.saveFailed'), 'error')
      throw updateError
    }
  }, [initial, supplierId, t])

  if (isNotFound) {
    return (
      <RecordNotFoundState
        label={t('purchasing.suppliers.form.loadFailed')}
        backHref={LIST_HREF}
      />
    )
  }

  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<SupplierFormValues>
      title={t('purchasing.suppliers.form.editTitle')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      fields={fields}
      groups={groups}
      initialValues={initial ?? fallbackInitialValues}
      submitLabel={t('purchasing.suppliers.form.save')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      isLoading={loading}
      onSubmit={handleSubmit}
    />
  )
}

export default function SupplierForm({ mode, supplierId }: { mode: 'create' | 'edit'; supplierId?: string }) {
  if (mode === 'edit') {
    if (!supplierId) return null
    return <SupplierEditForm supplierId={supplierId} />
  }
  return <SupplierCreateForm />
}
