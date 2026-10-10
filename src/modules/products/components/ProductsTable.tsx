"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud, fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { formatDisplayDateTime } from '@open-mercato/ui/primitives/date-format'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useLocale, useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import DistributeProductsDialog from './DistributeProductsDialog'
import type { ProductStatus } from './productFormValues'

const API_PATH = 'products/items'
const LIST_HREF = '/backend/products/items'
const PAGE_SIZE = 50
const QUERY_KEY_ROOT = 'products-items'
const FEATURE_VIEW = 'products.items.view'
const FEATURE_MANAGE = 'products.items.manage'
/** "No filter" is an explicit option: the filter overlay drops an empty-valued option. */
const ALL_FILTER = 'all'

const STATUS_MAP: StatusMap<ProductStatus> = {
  active: 'success',
  inactive: 'neutral',
}

type ProductListRow = {
  id: string
  sku: string
  name: string
  nameEn?: string | null
  brand?: string | null
  unit?: string | null
  status: ProductStatus
  updatedAt?: string | null
  catalogProductId?: string
}

type FilterState = { status: string }

function EmptyCell() {
  return <span className="text-xs text-muted-foreground">—</span>
}

function buildColumns(t: TranslateFn, locale: string): ColumnDef<ProductListRow>[] {
  return [
    {
      accessorKey: 'sku',
      header: t('products.items.list.columns.sku', 'SKU'),
      enableSorting: false,
      meta: { priority: 1 },
      cell: ({ row }) => <span className="font-medium tabular-nums">{row.original.sku}</span>,
    },
    {
      accessorKey: 'name',
      header: t('products.items.list.columns.name', 'Name'),
      enableSorting: false,
      meta: { priority: 2, truncate: true, maxWidth: 320 },
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span>{row.original.name}</span>
          {row.original.nameEn ? (
            <span className="text-xs text-muted-foreground">{row.original.nameEn}</span>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: 'brand',
      header: t('products.items.list.columns.brand', 'Brand'),
      enableSorting: false,
      meta: { priority: 3, truncate: true, maxWidth: 180 },
      cell: ({ row }) => (row.original.brand ? row.original.brand : <EmptyCell />),
    },
    {
      accessorKey: 'unit',
      header: t('products.items.list.columns.unit', 'Unit'),
      enableSorting: false,
      meta: { priority: 4 },
      cell: ({ row }) => (row.original.unit ? row.original.unit : <EmptyCell />),
    },
    {
      accessorKey: 'status',
      header: t('products.items.list.columns.status', 'Status'),
      enableSorting: false,
      meta: { priority: 5 },
      cell: ({ row }) => (
        <StatusBadge variant={STATUS_MAP[row.original.status]} dot>
          {row.original.status === 'active'
            ? t('products.items.list.status.active', 'Active')
            : t('products.items.list.status.inactive', 'Inactive')}
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'updatedAt',
      header: t('products.items.list.columns.updatedAt', 'Updated'),
      enableSorting: false,
      meta: { priority: 6, truncate: false },
      cell: ({ row }) => {
        const updatedAt = formatDisplayDateTime(row.original.updatedAt, locale)
        return updatedAt ? updatedAt : <EmptyCell />
      },
    },
  ]
}

export default function ProductsTable() {
  const t = useT()
  const locale = useLocale()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const scopeVersion = useOrganizationScopeVersion()
  // The server is the authority on every action's feature gate; these flags only decide whether the
  // control is worth showing. While the chrome payload loads nothing is hidden, so a permitted
  // operator never sees a control flicker in.
  const { payload: chromePayload, isReady: chromeReady } = useBackendChrome()
  const canView = !chromeReady || hasFeature(chromePayload?.grantedFeatures, FEATURE_VIEW)
  const canManage = !chromeReady || hasFeature(chromePayload?.grantedFeatures, FEATURE_MANAGE)

  const [search, setSearch] = React.useState('')
  const [status, setStatus] = React.useState<string>('active')
  const [page, setPage] = React.useState(1)
  /**
   * The distribution dialog's subject: `null` = closed, `{}` = every product of the current
   * organization, `{ productIds: [id] }` = the given products.
   */
  const [distributeTarget, setDistributeTarget] = React.useState<{ productIds?: string[] } | null>(null)

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams()
    const term = search.trim()
    if (term) params.set('search', term)
    params.set('status', status)
    params.set('page', String(page))
    params.set('pageSize', String(PAGE_SIZE))
    return params
  }, [page, search, status])

  const queryKey = React.useMemo(
    () => [QUERY_KEY_ROOT, queryParams.toString(), scopeVersion],
    [queryParams, scopeVersion],
  )

  const { data, isLoading, error } = useQuery({
    queryKey,
    enabled: canView,
    queryFn: () => fetchCrudList<ProductListRow>(API_PATH, Object.fromEntries(queryParams)),
  })

  const rows = data?.items ?? []
  const listError = error
    ? error instanceof Error && error.message
      ? error.message
      : t('products.items.form.loadFailed', 'Could not load the products')
    : canView
      ? null
      : t('products.common.notAuthorized', 'You do not have permission for this feature.')

  const columns = React.useMemo(() => buildColumns(t, locale), [locale, t])

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const refreshList = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [QUERY_KEY_ROOT] })
  }, [queryClient])

  const handleDelete = React.useCallback(
    async (row: ProductListRow) => {
      const confirmed = await confirm({
        title: t('products.items.actions.deleteConfirmTitle', 'Delete this product?'),
        description: t(
          'products.items.actions.deleteConfirmBody',
          'The catalog row, its variants and its prices are removed; the code becomes free again. Contracts, orders and invoices that already reference it keep their own frozen snapshot.',
        ),
        confirmText: t('products.items.actions.delete', 'Delete'),
        variant: 'destructive',
      })
      if (!confirmed) return
      try {
        await withScopedApiRequestHeaders(buildOptimisticLockHeader(row.updatedAt ?? null), () =>
          deleteCrud(API_PATH, row.id),
        )
        flash(t('ui.forms.flash.deleteSuccess'), 'success')
        refreshList()
      } catch (deleteError) {
        if (surfaceRecordConflict(deleteError, t, { onRefresh: refreshList })) {
          refreshList()
          return
        }
        const message =
          deleteError instanceof Error && deleteError.message
            ? deleteError.message
            : t('ui.forms.flash.deleteError')
        flash(message, 'error')
      }
    },
    [confirm, refreshList, t],
  )

  const filterDefs = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'status',
        label: t('products.items.list.filter.status', 'Status'),
        type: 'select',
        options: [
          { value: 'active', label: t('products.items.list.status.active', 'Active') },
          { value: 'inactive', label: t('products.items.list.status.inactive', 'Inactive') },
          { value: ALL_FILTER, label: t('products.items.list.filter.all', 'All') },
        ],
      },
    ],
    [t],
  )

  const filterValues = React.useMemo<FilterValues>(() => ({ status }), [status])

  return (
    <>
      {!canView ? (
        <Alert status="error">
          <p>{t('products.common.notAuthorized', 'You do not have permission for this feature.')}</p>
        </Alert>
      ) : (
        <DataTable<ProductListRow>
          title={
            <div className="flex flex-col gap-1">
              <h1 className="text-base font-semibold leading-tight">
                {t('products.items.page.title', 'Products')}
              </h1>
              <p className="text-sm font-normal text-muted-foreground">
                {t(
                  'products.items.page.description',
                  'Own-product master: identity, SKU, customs and unit, packing and volume, variants and the three price tiers.',
                )}
              </p>
            </div>
          }
          columns={columns}
          data={rows}
          actions={
            canManage ? (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button asChild>
                  <Link href={`${LIST_HREF}/create`}>{t('products.items.actions.create', 'New product')}</Link>
                </Button>
                <Button type="button" variant="outline" onClick={() => setDistributeTarget({})}>
                  {t('products.items.actions.distribute', 'Distribute to organizations')}
                </Button>
              </div>
            ) : undefined
          }
          searchValue={search}
          onSearchChange={handleSearchChange}
          searchPlaceholder={t('products.items.list.searchPlaceholder', 'Search by SKU or name')}
          searchAlign="right"
          filters={filterDefs}
          filterValues={filterValues}
          onFiltersApply={(values: FilterValues) => {
            const next = typeof values.status === 'string' && values.status.length > 0 ? values.status : 'active'
            setStatus(next)
            setPage(1)
          }}
          onFiltersClear={() => {
            setStatus('active')
            setPage(1)
          }}
          emptyState={
            <ListEmptyState
              title={t('products.items.list.empty', 'No products yet')}
              description={t(
                'products.items.list.emptyHint',
                'Create the first product — its identity, SKUs and price tiers — to start building the own-product library.',
              )}
              createHref={canManage ? `${LIST_HREF}/create` : undefined}
              createLabel={t('products.items.actions.create', 'New product')}
            />
          }
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'edit',
                  label: t('products.items.actions.edit', 'Edit'),
                  href: `${LIST_HREF}/${row.id}/edit`,
                },
                ...(canManage
                  ? [
                      {
                        id: 'distribute',
                        label: t('products.items.actions.distribute', 'Distribute to organizations'),
                        onSelect: () => setDistributeTarget({ productIds: [row.id] }),
                      },
                    ]
                  : []),
                ...(canManage
                  ? [
                      {
                        id: 'delete',
                        label: t('products.items.actions.delete', 'Delete'),
                        destructive: true,
                        onSelect: () => {
                          void handleDelete(row)
                        },
                      },
                    ]
                  : []),
              ]}
            />
          )}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total: data?.total ?? 0,
            // The list route returns `{ items, total, page, pageSize }` (no `totalPages`), so the
            // page count is derived from the count the server did send.
            totalPages: Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE)),
            totalIsCapped: data?.totalIsCapped === true,
            onPageChange: setPage,
          }}
          isLoading={isLoading}
          error={listError}
        />
      )}
      {ConfirmDialogElement}
      <DistributeProductsDialog
        open={distributeTarget !== null}
        productIds={distributeTarget?.productIds}
        onOpenChange={(open) => {
          if (!open) setDistributeTarget(null)
        }}
        onDistributed={refreshList}
      />
    </>
  )
}
