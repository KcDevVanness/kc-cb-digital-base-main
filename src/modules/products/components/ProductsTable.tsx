"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileDown } from 'lucide-react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud, fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { Button } from '@open-mercato/ui/primitives/button'
import { formatDisplayDateTime } from '@open-mercato/ui/primitives/date-format'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { PRODUCT_TABLE_COLUMNS, type ProductTableColumn } from '../lib/formLayout'
import { useLocale, useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import {
  OPTION_PAGE_SIZE,
  PRODUCTS_API_PATH,
  PRODUCTS_CATEGORIES_API_PATH,
  PRODUCTS_LIST_HREF,
  PRODUCTS_TYPES_API_PATH,
  buildProductCategoryLabels,
  buildProductCategoryOptions,
  buildProductTypeOptions,
  toProductFormValues,
  type ProductLookupOption,
  type ProductRecord,
  type ProductStatus,
} from './ProductForm'

const PAGE_SIZE = 50
const QUERY_KEY_ROOT = 'products-items'
const OPTION_QUERY_KEY_ROOT = 'products-items-options'
/** "No filter" is an explicit option: the filter overlay drops an empty-valued option. */
const ALL_FILTER = 'all'
const DEFAULT_SORT_FIELD = 'sku'

/**
 * Stable empty fallbacks: a fresh `[]`/`Map` on every render would change identity and defeat the
 * label memos that depend on them.
 */
const EMPTY_LOOKUP_OPTIONS: ProductLookupOption[] = []
const EMPTY_CATEGORY_LABELS: Map<string, string> = new Map()

const PRODUCT_STATUS_MAP: StatusMap<ProductStatus> = {
  active: 'success',
  inactive: 'neutral',
}

/** Sentinel row value used where a product carries no value yet. */
function EmptyCell() {
  return <span className="text-xs text-muted-foreground">—</span>
}

/**
 * Columns are declared per id and then projected through `PRODUCT_TABLE_COLUMNS`, so which columns
 * the list shows is decided in `lib/formLayout.ts` — the same file that owns the form's steps.
 */
function buildColumns(
  t: TranslateFn,
  locale: string,
  typeLabels: Map<string, string>,
  categoryLabels: Map<string, string>,
): ColumnDef<ProductRecord>[] {
  const declared: Record<ProductTableColumn, ColumnDef<ProductRecord>> = {
    sku: {
      accessorKey: 'sku',
      header: t('products.items.list.columns.sku'),
      meta: { priority: 1 },
    },
    name: {
      accessorKey: 'name',
      header: t('products.items.list.columns.name'),
      meta: { priority: 2, truncate: true, maxWidth: 320 },
    },
    typeId: {
      id: 'typeId',
      accessorKey: 'typeId',
      header: t('products.items.list.columns.type'),
      enableSorting: false,
      meta: { priority: 3, truncate: true, maxWidth: 240 },
      cell: ({ row }) => {
        const label = typeLabels.get(row.original.typeId)
        return label ? label : <EmptyCell />
      },
    },
    categoryId: {
      id: 'categoryId',
      accessorKey: 'categoryId',
      header: t('products.items.list.columns.category'),
      enableSorting: false,
      meta: { priority: 4, truncate: true, maxWidth: 320 },
      cell: ({ row }) => {
        const label = categoryLabels.get(row.original.categoryId)
        return label ? label : <EmptyCell />
      },
    },
    unit: {
      accessorKey: 'unit',
      header: t('products.items.list.columns.unit'),
      enableSorting: false,
      meta: { priority: 5 },
      cell: ({ row }) => {
        const unit = row.original.unit
        return unit ? unit : <EmptyCell />
      },
    },
    status: {
      accessorKey: 'status',
      header: t('products.items.list.columns.status'),
      meta: { priority: 6 },
      cell: ({ row }) => (
        <StatusBadge variant={PRODUCT_STATUS_MAP[row.original.status]} dot>
          {row.original.status === 'active'
            ? t('products.items.list.status.active')
            : t('products.items.list.status.inactive')}
        </StatusBadge>
      ),
    },
    updatedAt: {
      // The column is addressed by its API sort field (`updated_at`): the list contract validates
      // `sortField` against that spelling, so a local `updatedAt` id would be rejected.
      id: 'updated_at',
      accessorKey: 'updatedAt',
      header: t('products.items.list.columns.updatedAt'),
      meta: { priority: 7 },
      cell: ({ row }) => {
        const updatedAt = formatDisplayDateTime(row.original.updatedAt, locale)
        return updatedAt ? updatedAt : <EmptyCell />
      },
    },
  }

  return PRODUCT_TABLE_COLUMNS.map((column) => declared[column])
}

function filenameFromDisposition(disposition: string | null, fallback: string): string {
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  if (encoded) {
    try {
      return decodeURIComponent(encoded)
    } catch {
      // A malformed RFC 5987 value falls through to the quoted form below.
    }
  }
  const quoted = disposition?.match(/filename="([^"]+)"/i)?.[1]
  return quoted || fallback
}

export default function ProductsTable() {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const scopeVersion = useOrganizationScopeVersion()
  const [search, setSearch] = React.useState('')
  const [status, setStatus] = React.useState<ProductStatus | typeof ALL_FILTER>('active')
  const [typeId, setTypeId] = React.useState<string>(ALL_FILTER)
  const [categoryId, setCategoryId] = React.useState<string>(ALL_FILTER)
  const [isExporting, setIsExporting] = React.useState(false)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: DEFAULT_SORT_FIELD, desc: false }])
  const [page, setPage] = React.useState(1)

  const filterParams = React.useMemo(() => {
    const params = new URLSearchParams()
    const term = search.trim()
    if (term) params.set('search', term)
    params.set('status', status)
    if (typeId !== ALL_FILTER) params.set('typeId', typeId)
    if (categoryId !== ALL_FILTER) params.set('categoryId', categoryId)
    params.set('sortField', sorting[0]?.id ?? DEFAULT_SORT_FIELD)
    params.set('sortDir', sorting[0]?.desc ? 'desc' : 'asc')
    return params
  }, [categoryId, search, sorting, status, typeId])

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams(filterParams)
    params.set('page', String(page))
    params.set('pageSize', String(PAGE_SIZE))
    return params
  }, [filterParams, page])

  const queryKey = React.useMemo(
    () => [QUERY_KEY_ROOT, queryParams.toString(), scopeVersion],
    [queryParams, scopeVersion],
  )

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>(
        PRODUCTS_API_PATH,
        Object.fromEntries(queryParams),
      )
      return { ...payload, items: (payload.items ?? []).map(toProductFormValues) }
    },
  })

  const rows = data?.items ?? []
  const listError = error
    ? (error instanceof Error && error.message ? error.message : t('products.items.form.loadFailed'))
    : null

  /**
   * Type and category rows back the two label columns and the two filter selects. They are a
   * separate, independent query: a lookup that fails degrades to "no options" (the columns show a
   * dash, the filters keep only 全部) instead of blanking the product list the operator came for.
   */
  const { data: optionData } = useQuery({
    queryKey: [OPTION_QUERY_KEY_ROOT, scopeVersion],
    queryFn: async () => {
      const [types, categories] = await Promise.all([
        fetchCrudList<Record<string, unknown>>(PRODUCTS_TYPES_API_PATH, {
          pageSize: OPTION_PAGE_SIZE,
          isActive: 'true',
        }),
        fetchCrudList<Record<string, unknown>>(PRODUCTS_CATEGORIES_API_PATH, { pageSize: OPTION_PAGE_SIZE }),
      ])
      return {
        typeOptions: buildProductTypeOptions(types.items ?? []),
        categoryOptions: buildProductCategoryOptions(categories.items ?? []),
        categoryLabels: buildProductCategoryLabels(categories.items ?? []),
      }
    },
  })

  const typeOptions = optionData?.typeOptions ?? EMPTY_LOOKUP_OPTIONS
  const categoryOptions = optionData?.categoryOptions ?? EMPTY_LOOKUP_OPTIONS
  const typeLabels = React.useMemo(
    () => new Map(typeOptions.map((option): [string, string] => [option.id, option.label])),
    [typeOptions],
  )
  const categoryLabels = optionData?.categoryLabels ?? EMPTY_CATEGORY_LABELS

  const columns = React.useMemo(
    () => buildColumns(t, locale, typeLabels, categoryLabels),
    [categoryLabels, locale, t, typeLabels],
  )

  const handleSortingChange = React.useCallback((next: SortingState) => {
    setSorting(next)
    setPage(1)
  }, [])

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const filterDefs = React.useMemo<FilterDef[]>(() => [
    {
      id: 'status',
      label: t('products.items.list.filter.status'),
      type: 'select',
      options: [
        { value: ALL_FILTER, label: t('products.items.list.filter.all') },
        { value: 'active', label: t('products.items.list.status.active') },
        { value: 'inactive', label: t('products.items.list.status.inactive') },
      ],
    },
    {
      id: 'typeId',
      label: t('products.items.list.filter.type'),
      type: 'select',
      options: [
        { value: ALL_FILTER, label: t('products.items.list.filter.all') },
        ...typeOptions.map((option) => ({ value: option.id, label: option.label })),
      ],
    },
    {
      id: 'categoryId',
      label: t('products.items.list.filter.category'),
      type: 'select',
      options: [
        { value: ALL_FILTER, label: t('products.items.list.filter.all') },
        ...categoryOptions.map((option) => ({ value: option.id, label: option.label })),
      ],
    },
  ], [categoryOptions, t, typeOptions])

  /**
   * Only the filters that actually narrow the query are published to the toolbar: a sentinel
   * "全部" is the absence of a filter, and reporting it as one would put a chip labelled "全部"
   * next to the chips that do narrow something. Status is always published because the list is
   * always scoped by it (the API default is `active`).
   */
  const filterValues = React.useMemo<FilterValues>(() => ({
    status,
    ...(typeId === ALL_FILTER ? {} : { typeId }),
    ...(categoryId === ALL_FILTER ? {} : { categoryId }),
  }), [categoryId, status, typeId])

  const handleFiltersApply = React.useCallback((values: FilterValues) => {
    const nextStatus = values.status
    if (nextStatus === 'active' || nextStatus === 'inactive') setStatus(nextStatus)
    else setStatus(ALL_FILTER)
    const nextType = values.typeId
    setTypeId(typeof nextType === 'string' && nextType.length ? nextType : ALL_FILTER)
    const nextCategory = values.categoryId
    setCategoryId(typeof nextCategory === 'string' && nextCategory.length ? nextCategory : ALL_FILTER)
    setPage(1)
  }, [])

  const handleFiltersClear = React.useCallback(() => {
    setStatus(ALL_FILTER)
    setTypeId(ALL_FILTER)
    setCategoryId(ALL_FILTER)
    setPage(1)
  }, [])

  const handleExport = React.useCallback(async () => {
    setIsExporting(true)
    try {
      const params = new URLSearchParams(filterParams)
      params.set('format', 'csv')
      const call = await apiCallOrThrow<Blob>(
        `/api/${PRODUCTS_API_PATH}?${params.toString()}`,
        {
          method: 'GET',
          credentials: 'same-origin',
          headers: {
            'x-om-forbidden-redirect': '0',
            'x-om-unauthorized-redirect': '0',
          },
        },
        { parse: (response) => response.blob(), errorMessage: t('products.items.actions.exportFailed') },
      )
      const contentType = call.response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (contentType !== 'text/csv' || !call.result) throw new Error(t('products.items.actions.exportFailed'))

      // The download is handed to an object URL and revoked immediately after the click: the blob
      // is never uploaded anywhere, and no viewer for a CSV is assumed.
      const objectUrl = URL.createObjectURL(call.result)
      try {
        const link = document.createElement('a')
        link.href = objectUrl
        link.download = filenameFromDisposition(
          call.response.headers.get('content-disposition'),
          'products.csv',
        )
        document.body.append(link)
        link.click()
        link.remove()
      } finally {
        URL.revokeObjectURL(objectUrl)
      }
    } catch (exportError) {
      flash(
        exportError instanceof Error && exportError.message
          ? exportError.message
          : t('products.items.actions.exportFailed'),
        'error',
      )
    } finally {
      setIsExporting(false)
    }
  }, [filterParams, t])

  const handleDelete = React.useCallback(async (row: ProductRecord) => {
    const confirmed = await confirm({
      title: t('products.items.actions.deleteConfirmTitle'),
      description: t('products.items.actions.deleteConfirmBody'),
      confirmText: t('products.items.actions.delete'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      // Row deletes carry the row's own optimistic-lock version, so a list rendered before
      // someone else edited the record fails with a 409 instead of deleting a row the user
      // never saw.
      await withScopedApiRequestHeaders(
        buildOptimisticLockHeader(row.updatedAt),
        () => deleteCrud(PRODUCTS_API_PATH, { id: row.id }),
      )
      flash(t('ui.forms.flash.deleteSuccess'), 'success')
      void queryClient.invalidateQueries({ queryKey: [QUERY_KEY_ROOT] })
    } catch (deleteError) {
      if (surfaceRecordConflict(deleteError, t)) {
        void queryClient.invalidateQueries({ queryKey: [QUERY_KEY_ROOT] })
        return
      }
      const message = deleteError instanceof Error && deleteError.message
        ? deleteError.message
        : t('ui.forms.flash.deleteError')
      flash(message, 'error')
    }
  }, [confirm, queryClient, t])

  return (
    <>
      <DataTable<ProductRecord>
        title={(
          <div className="flex flex-col gap-1">
            <h1 className="text-base font-semibold leading-tight">{t('products.items.page.title')}</h1>
            <p className="text-sm font-normal text-muted-foreground">{t('products.items.page.description')}</p>
          </div>
        )}
        columns={columns}
        data={rows}
        actions={(
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => { void handleExport() }} disabled={isExporting}>
              <FileDown className="size-4" aria-hidden="true" />
              {t('products.items.actions.export')}
            </Button>
            <Button asChild>
              <Link href={`${PRODUCTS_LIST_HREF}/create`}>{t('products.items.actions.create')}</Link>
            </Button>
          </div>
        )}
        searchValue={search}
        onSearchChange={handleSearchChange}
        searchPlaceholder={t('products.items.list.searchPlaceholder')}
        searchAlign="right"
        filters={filterDefs}
        filterValues={filterValues}
        onFiltersApply={handleFiltersApply}
        onFiltersClear={handleFiltersClear}
        sortable
        sorting={sorting}
        onSortingChange={handleSortingChange}
        emptyState={(
          <ListEmptyState
            title={t('products.items.list.empty')}
            createHref={`${PRODUCTS_LIST_HREF}/create`}
            createLabel={t('products.items.actions.create')}
          />
        )}
        rowActions={(row) => (
          <RowActions
            items={[
              { id: 'edit', label: t('products.items.actions.edit'), href: `${PRODUCTS_LIST_HREF}/${row.id}/edit` },
              {
                id: 'delete',
                label: t('products.items.actions.delete'),
                destructive: true,
                onSelect: () => { void handleDelete(row) },
              },
            ]}
          />
        )}
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          total: data?.total ?? 0,
          totalPages: data?.totalPages ?? 0,
          totalIsCapped: data?.totalIsCapped === true,
          onPageChange: setPage,
        }}
        isLoading={isLoading}
        error={listError}
        onRowClick={(row) => router.push(`${PRODUCTS_LIST_HREF}/${row.id}/edit`)}
      />
      {ConfirmDialogElement}
    </>
  )
}
