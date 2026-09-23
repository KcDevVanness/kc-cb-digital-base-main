"use client"

import * as React from 'react'
import {
  CrudForm,
  type CrudField,
  type CrudFieldOption,
  type CrudFormGroup,
} from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'

const API_PATH = 'products/categories'
const LIST_URL = '/api/products/categories'
const LIST_HREF = '/backend/products/categories'
/** One page holds the whole tree: both the picker and the list resolve paths from this set. */
const CATEGORY_PAGE_SIZE = 200

/**
 * Sentinel for the "top level" choice.
 *
 * `CrudForm` filters options whose value is the empty string — Radix forbids an empty
 * `SelectItem` value — so "no parent" needs an explicit token that the payload builder maps
 * back to `null`.
 */
export const ROOT_PARENT_VALUE = '__root__'

export type ProductCategoryFormValues = {
  id?: string
  code: string
  name: string
  nameEn: string
  /**
   * `ROOT_PARENT_VALUE` for a top-level category, otherwise the parent's id. The select's
   * clear affordance commits `undefined`, which the payload builder reads as "no parent".
   */
  parentId?: string
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

/** Category as returned by `/api/products/categories`; `id` is always present on a persisted row. */
export type ProductCategoryRecord = Omit<ProductCategoryFormValues, 'id'> & { id: string }

/**
 * A list row: the form-shaped values plus the hierarchy metadata the list renders.
 *
 * `pathLabel` is resolved client-side because the API sends ancestor **ids** only — a display
 * label on the wire would repeat every ancestor's name on every row.
 */
export type ProductCategoryListRow = ProductCategoryRecord & {
  depth: number
  ancestorIds: string[]
  descendantIds: string[]
  /** Ancestor names joined with ` / `, ending with this category's own name. */
  pathLabel: string
  parentName: string | null
}

const EMPTY_PRODUCT_CATEGORY_VALUES: ProductCategoryFormValues = {
  code: '',
  name: '',
  nameEn: '',
  parentId: ROOT_PARENT_VALUE,
  sortOrder: 0,
  isActive: true,
}

const PRODUCT_CATEGORY_GROUPS: CrudFormGroup[] = [
  { id: 'details', column: 1, fields: ['code', 'name', 'nameEn', 'parentId'] },
  { id: 'settings', column: 2, fields: ['sortOrder', 'isActive'] },
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

function readStringArray(source: Record<string, unknown>, key: string): string[] {
  const value = source[key]
  return Array.isArray(value) ? value.map((entry) => String(entry)) : []
}

/**
 * Maps a list/record payload into the form's initial values.
 *
 * Exported as a pure function so the optimistic-lock wiring stays testable: `CrudForm`
 * auto-derives the expected-version header from `initialValues.updatedAt`, so dropping
 * `updatedAt` here silently disables optimistic locking for the edit form.
 */
export function toProductCategoryFormValues(item: Record<string, unknown>): ProductCategoryRecord {
  const isActive = item.isActive ?? item.is_active
  const updatedAt = item.updatedAt ?? item.updated_at
  const parentId = readText(item, 'parentId', 'parent_id')
  return {
    id: readText(item, 'id'),
    code: readText(item, 'code'),
    name: readText(item, 'name'),
    nameEn: readText(item, 'nameEn', 'name_en'),
    parentId: parentId.length > 0 ? parentId : ROOT_PARENT_VALUE,
    sortOrder: readInteger(item, 'sortOrder', 'sort_order'),
    isActive: isActive === undefined ? true : Boolean(isActive),
    updatedAt: typeof updatedAt === 'string' && updatedAt.length > 0 ? updatedAt : null,
  }
}

/** Builds the rows the list renders, resolving path labels against the sibling rows. */
export function buildProductCategoryListRows(
  items: Record<string, unknown>[],
): ProductCategoryListRow[] {
  const nameById = new Map<string, string>()
  for (const item of items) {
    const id = readText(item, 'id')
    if (id) nameById.set(id, readText(item, 'name'))
  }

  return items.map((item) => {
    const values = toProductCategoryFormValues(item)
    const ancestorIds = readStringArray(item, 'ancestorIds')
    const rawParentId = readText(item, 'parentId', 'parent_id')
    const segments = [
      ...ancestorIds
        .map((ancestorId) => nameById.get(ancestorId))
        .filter((name): name is string => typeof name === 'string' && name.length > 0),
      values.name,
    ].filter((segment) => segment.length > 0)

    return {
      ...values,
      depth: readInteger(item, 'depth'),
      ancestorIds,
      descendantIds: readStringArray(item, 'descendantIds'),
      pathLabel: segments.length > 0 ? segments.join(' / ') : values.code,
      parentName: rawParentId ? nameById.get(rawParentId) ?? null : null,
    }
  })
}

/**
 * Options for the parent picker: a "top level" choice plus every category that cannot create
 * a cycle — the category being edited and its descendants are excluded, so an invalid parent
 * is not offered in the first place (the server still rejects it if it arrives some other way).
 */
export function buildProductCategoryParentOptions(
  items: Record<string, unknown>[],
  excludeIds: ReadonlySet<string>,
  rootLabel: string,
): CrudFieldOption[] {
  const options: CrudFieldOption[] = [{ value: ROOT_PARENT_VALUE, label: rootLabel }]
  const rows = buildProductCategoryListRows(items)
    .filter((row) => !excludeIds.has(row.id))
    .sort((left, right) => left.pathLabel.localeCompare(right.pathLabel))
  for (const row of rows) options.push({ value: row.id, label: row.pathLabel })
  return options
}

/** `sort_order` is a non-negative integer; a blank, cleared or negative entry falls back to 0. */
function normalizeSortOrder(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  const parsed = typeof value === 'number' ? value : Number(value.trim())
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0
}

/** Builds the create/update payload; keys are dropped to the contract field set. */
export function buildProductCategoryPayload(values: ProductCategoryFormValues): Record<string, unknown> {
  // An unset or cleared parent means "top level": the API stores `null` for a root category.
  const parentId = typeof values.parentId === 'string' ? values.parentId.trim() : ''
  // Optional text columns are nullable in the API contract: an emptied input clears the column
  // rather than storing an empty string beside real values.
  const nameEn = values.nameEn.trim()
  return {
    code: values.code.trim(),
    name: values.name.trim(),
    nameEn: nameEn.length > 0 ? nameEn : null,
    parentId: parentId.length > 0 && parentId !== ROOT_PARENT_VALUE ? parentId : null,
    sortOrder: normalizeSortOrder(values.sortOrder),
    isActive: Boolean(values.isActive),
  }
}

async function loadParentOptions(
  excludeIds: ReadonlySet<string>,
  rootLabel: string,
  errorMessage: string,
  organizationId?: string | null,
): Promise<CrudFieldOption[]> {
  // Same organization only: a category tree is per-organization, and the write command rejects a
  // parent from another organization even when the caller may see it.
  const scope = organizationId ? `&organizationId=${encodeURIComponent(organizationId)}` : ''
  const payload = await readApiResultOrThrow<{ items?: Record<string, unknown>[] }>(
    `${LIST_URL}?pageSize=${CATEGORY_PAGE_SIZE}${scope}`,
    undefined,
    { errorMessage },
  )
  return buildProductCategoryParentOptions(payload.items ?? [], excludeIds, rootLabel)
}

function useProductCategoryFields(
  t: TranslateFn,
  loadOptions: () => Promise<CrudFieldOption[]>,
): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    {
      id: 'code',
      label: t('products.categories.form.field.code'),
      type: 'text',
      required: true,
    },
    {
      id: 'name',
      label: t('products.categories.form.field.name'),
      type: 'text',
      required: true,
    },
    {
      id: 'nameEn',
      label: t('products.categories.form.field.nameEn'),
      type: 'text',
    },
    {
      id: 'parentId',
      label: t('products.categories.form.field.parent'),
      type: 'select',
      description: t('products.categories.form.parentHelp'),
      loadOptions,
    },
    {
      id: 'sortOrder',
      label: t('products.categories.form.field.sortOrder'),
      type: 'number',
    },
    {
      id: 'isActive',
      label: t('products.categories.form.field.isActive'),
      type: 'checkbox',
    },
  ], [t, loadOptions])
}

const NO_EXCLUSIONS: ReadonlySet<string> = new Set<string>()

function ProductCategoryCreateForm() {
  const t = useT()
  const { organizationId } = useOrganizationScopeDetail()
  const loadOptions = React.useCallback(
    () => loadParentOptions(
      NO_EXCLUSIONS,
      t('products.categories.form.parentRoot'),
      t('products.categories.form.loadFailed'),
      organizationId,
    ),
    [organizationId, t],
  )
  const fields = useProductCategoryFields(t, loadOptions)
  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('products.categories.form.saved'), 'success'),
    [t],
  )

  const handleSubmit = React.useCallback(async (values: ProductCategoryFormValues) => {
    try {
      await createCrud(API_PATH, buildProductCategoryPayload(values))
    } catch (error) {
      // The rethrow hands the response to `CrudForm`, which surfaces the server's own
      // message — a duplicate `code` arrives as a 409 with an operator-readable text.
      flash(t('products.categories.form.saveFailed'), 'error')
      throw error
    }
  }, [t])

  return (
    <CrudForm<ProductCategoryFormValues>
      title={t('products.categories.form.createTitle')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      fields={fields}
      groups={PRODUCT_CATEGORY_GROUPS}
      initialValues={EMPTY_PRODUCT_CATEGORY_VALUES}
      submitLabel={t('products.categories.form.save')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={handleSubmit}
    />
  )
}

type LoadedCategory = {
  values: ProductCategoryRecord
  descendantIds: string[]
}

function ProductCategoryEditForm({ categoryId }: { categoryId: string }) {
  const t = useT()
  const { organizationId } = useOrganizationScopeDetail()
  const [loaded, setLoaded] = React.useState<LoadedCategory | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)

  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('products.categories.form.saved'), 'success'),
    [t],
  )

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setIsNotFound(false)
      try {
        const payload = await fetchCrudList<Record<string, unknown>>(API_PATH, { ids: categoryId, pageSize: 1 })
        const item = payload?.items?.[0]
        if (!item) {
          if (!cancelled) setIsNotFound(true)
          return
        }
        if (!cancelled) {
          setLoaded({
            values: toProductCategoryFormValues(item),
            descendantIds: readStringArray(item, 'descendantIds'),
          })
        }
      } catch (loadError: unknown) {
        if (!cancelled) {
          const status = (loadError as { status?: number }).status
          if (status === 404) {
            setIsNotFound(true)
          } else if (status === 401 || status === 403) {
            setError(t('products.common.notAuthorized'))
          } else {
            setError(t('products.categories.form.loadFailed'))
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [categoryId, t])

  // The picker is built only once the record has arrived: the exclusion set feeds the
  // option loader, and an option list built before the row loaded could still offer the
  // category itself or one of its descendants.
  const excludedIds = React.useMemo<ReadonlySet<string>>(() => {
    const ids = new Set<string>()
    if (!loaded) return ids
    ids.add(loaded.values.id)
    for (const descendantId of loaded.descendantIds) ids.add(descendantId)
    return ids
  }, [loaded])

  const loadOptions = React.useCallback(
    () => loadParentOptions(
      excludedIds,
      t('products.categories.form.parentRoot'),
      t('products.categories.form.loadFailed'),
      organizationId,
    ),
    [excludedIds, organizationId, t],
  )

  const fields = useProductCategoryFields(t, loadOptions)

  const handleSubmit = React.useCallback(async (values: ProductCategoryFormValues) => {
    try {
      await updateCrud(API_PATH, {
        id: loaded?.values.id || categoryId,
        ...buildProductCategoryPayload(values),
        updatedAt: loaded?.values.updatedAt ?? null,
      })
    } catch (updateError) {
      flash(t('products.categories.form.saveFailed'), 'error')
      throw updateError
    }
  }, [categoryId, loaded, t])

  if (isNotFound) {
    return (
      <RecordNotFoundState
        label={t('products.categories.form.loadFailed')}
        backHref={LIST_HREF}
      />
    )
  }

  if (error) return <ErrorMessage label={error} />

  if (!loaded) {
    return <p className="text-sm text-muted-foreground">{t('products.common.loading')}</p>
  }

  return (
    <CrudForm<ProductCategoryFormValues>
      title={t('products.categories.form.editTitle')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      fields={fields}
      groups={PRODUCT_CATEGORY_GROUPS}
      initialValues={loaded.values}
      submitLabel={t('products.categories.form.save')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      isLoading={loading}
      onSubmit={handleSubmit}
    />
  )
}

export default function ProductCategoryForm({ mode, categoryId }: { mode: 'create' | 'edit'; categoryId?: string }) {
  if (mode === 'edit' && categoryId) return <ProductCategoryEditForm categoryId={categoryId} />
  return <ProductCategoryCreateForm />
}
