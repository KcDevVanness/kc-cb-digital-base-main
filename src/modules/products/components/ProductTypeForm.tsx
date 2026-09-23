"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'

const API_PATH = 'products/types'
const LIST_HREF = '/backend/products/types'

export type ProductTypeFormValues = {
  id?: string
  code: string
  name: string
  nameEn: string
  /**
   * `CrudForm`'s number input commits a `number` and clears to `undefined`, while a value
   * mapped from a payload may still be a string; the payload builder accepts all three.
   */
  sortOrder?: string | number
  isActive: boolean
  /**
   * Carries the optimistic-lock version into `CrudForm`, which auto-derives the
   * expected-version header from `initialValues.updatedAt` for update.
   */
  updatedAt?: string | null
}

/** Product type as returned by `/api/products/types`; `id` is always present on a persisted row. */
export type ProductTypeRecord = Omit<ProductTypeFormValues, 'id'> & { id: string }

const EMPTY_PRODUCT_TYPE_VALUES: ProductTypeFormValues = {
  code: '',
  name: '',
  nameEn: '',
  sortOrder: 0,
  isActive: true,
}

const PRODUCT_TYPE_GROUPS: CrudFormGroup[] = [
  { id: 'details', column: 1, fields: ['code', 'name', 'nameEn', 'sortOrder'] },
  { id: 'settings', column: 2, fields: ['isActive'] },
]

function readText(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string') return value
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function readInteger(source: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return Math.trunc(parsed)
    }
  }
  return 0
}

/**
 * Maps a list/record payload into the form's initial values.
 *
 * Exported as a pure function so the optimistic-lock wiring stays testable: `CrudForm`
 * auto-derives the expected-version header from `initialValues.updatedAt`, so dropping
 * `updatedAt` here silently disables optimistic locking for the edit form.
 */
export function toProductTypeFormValues(item: Record<string, unknown>): ProductTypeRecord {
  const isActive = item.isActive ?? item.is_active
  const updatedAt = item.updatedAt ?? item.updated_at
  return {
    id: readText(item, 'id'),
    code: readText(item, 'code'),
    name: readText(item, 'name'),
    nameEn: readText(item, 'nameEn', 'name_en'),
    sortOrder: readInteger(item, 'sortOrder', 'sort_order'),
    isActive: isActive === undefined ? true : Boolean(isActive),
    updatedAt: typeof updatedAt === 'string' && updatedAt.length > 0 ? updatedAt : null,
  }
}

/** `sort_order` is a non-negative integer; a blank, cleared or negative entry falls back to 0. */
function normalizeSortOrder(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  const parsed = typeof value === 'number' ? value : Number(value.trim())
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0
}

/** Builds the create/update payload; keys are dropped to the contract field set. */
export function buildProductTypePayload(values: ProductTypeFormValues): Record<string, unknown> {
  // Optional text columns are nullable in the API contract: an emptied input clears the column
  // rather than storing an empty string beside real values.
  const nameEn = values.nameEn.trim()
  return {
    code: values.code.trim(),
    name: values.name.trim(),
    nameEn: nameEn.length > 0 ? nameEn : null,
    sortOrder: normalizeSortOrder(values.sortOrder),
    isActive: Boolean(values.isActive),
  }
}

function useProductTypeFields(t: TranslateFn): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    {
      id: 'code',
      label: t('products.types.form.field.code'),
      type: 'text',
      required: true,
    },
    {
      id: 'name',
      label: t('products.types.form.field.name'),
      type: 'text',
      required: true,
    },
    {
      id: 'nameEn',
      label: t('products.types.form.field.nameEn'),
      type: 'text',
    },
    {
      id: 'sortOrder',
      label: t('products.types.form.field.sortOrder'),
      type: 'number',
    },
    {
      id: 'isActive',
      label: t('products.types.form.field.isActive'),
      type: 'checkbox',
    },
  ], [t])
}

function ProductTypeCreateForm() {
  const t = useT()
  const fields = useProductTypeFields(t)
  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('products.types.form.saved'), 'success'),
    [t],
  )

  const handleSubmit = React.useCallback(async (values: ProductTypeFormValues) => {
    try {
      await createCrud(API_PATH, buildProductTypePayload(values))
    } catch (error) {
      // The rethrow hands the response to `CrudForm`, which surfaces the server's own
      // message — a duplicate `code` arrives as a 409 with an operator-readable text.
      flash(t('products.types.form.saveFailed'), 'error')
      throw error
    }
  }, [t])

  return (
    <CrudForm<ProductTypeFormValues>
      title={t('products.types.form.createTitle')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      fields={fields}
      groups={PRODUCT_TYPE_GROUPS}
      initialValues={EMPTY_PRODUCT_TYPE_VALUES}
      submitLabel={t('products.types.form.save')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={handleSubmit}
    />
  )
}

function ProductTypeEditForm({ typeId }: { typeId: string }) {
  const t = useT()
  const fields = useProductTypeFields(t)
  const [initial, setInitial] = React.useState<ProductTypeRecord | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)

  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('products.types.form.saved'), 'success'),
    [t],
  )

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setIsNotFound(false)
      try {
        const payload = await fetchCrudList<Record<string, unknown>>(API_PATH, { ids: typeId, pageSize: 1 })
        const item = payload?.items?.[0]
        if (!item) {
          if (!cancelled) setIsNotFound(true)
          return
        }
        if (!cancelled) setInitial(toProductTypeFormValues(item))
      } catch (loadError: unknown) {
        if (!cancelled) {
          const status = (loadError as { status?: number }).status
          if (status === 404) {
            setIsNotFound(true)
          } else if (status === 401 || status === 403) {
            setError(t('products.common.notAuthorized'))
          } else {
            setError(t('products.types.form.loadFailed'))
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [typeId, t])

  const fallbackInitialValues = React.useMemo<ProductTypeFormValues>(
    () => ({ ...EMPTY_PRODUCT_TYPE_VALUES, id: typeId, updatedAt: null }),
    [typeId],
  )

  const handleSubmit = React.useCallback(async (values: ProductTypeFormValues) => {
    try {
      await updateCrud(API_PATH, {
        id: initial?.id || typeId,
        ...buildProductTypePayload(values),
        updatedAt: initial?.updatedAt ?? null,
      })
    } catch (updateError) {
      flash(t('products.types.form.saveFailed'), 'error')
      throw updateError
    }
  }, [initial, typeId, t])

  if (isNotFound) {
    return (
      <RecordNotFoundState
        label={t('products.types.form.loadFailed')}
        backHref={LIST_HREF}
      />
    )
  }

  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<ProductTypeFormValues>
      title={t('products.types.form.editTitle')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      fields={fields}
      groups={PRODUCT_TYPE_GROUPS}
      initialValues={initial ?? fallbackInitialValues}
      submitLabel={t('products.types.form.save')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      isLoading={loading}
      onSubmit={handleSubmit}
    />
  )
}

export default function ProductTypeForm({ mode, typeId }: { mode: 'create' | 'edit'; typeId?: string }) {
  if (mode === 'edit' && typeId) return <ProductTypeEditForm typeId={typeId} />
  return <ProductTypeCreateForm />
}
