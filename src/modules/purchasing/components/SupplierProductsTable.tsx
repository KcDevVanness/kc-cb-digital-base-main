"use client"

import * as React from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud, fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { SupplierProductListRow, SupplierProductPriceCell, SupplierProductStatus } from '../types'

const API_PATH = 'purchasing/supplier-products'
const PROMOTE_URL = '/api/purchasing/supplier-products/promote'
const LIST_HREF = '/backend/purchasing/supplier-products'
const SUPPLIERS_API_PATH = 'purchasing/suppliers'
const PAGE_SIZE = 50
const QUERY_KEY_ROOT = 'purchasing-supplier-products'
const ALL = 'all'

const STATUS_MAP: StatusMap<SupplierProductStatus> = {
  active: 'success',
  inactive: 'neutral',
}

type FilterValues = { supplierId?: string; status?: string }

/** `CNY 12.50 (≥10)` — an unknown currency code falls back to `CODE amount` instead of throwing. */
function formatPriceCell(cell: SupplierProductPriceCell | null): string {
  if (!cell) return ''
  const numeric = Number(cell.unitPrice)
  const code = cell.currencyCode.trim().toUpperCase()
  const amount = Number.isFinite(numeric)
    ? (() => {
        try {
          return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(numeric)
        } catch {
          return `${code} ${numeric.toFixed(2)}`
        }
      })()
    : cell.unitPrice
  return cell.minQuantity > 1 ? `${amount} (≥${cell.minQuantity})` : amount
}

const EMPTY_CELL = <span className="text-xs text-muted-foreground">—</span>

function buildColumns(t: TranslateFn): ColumnDef<SupplierProductListRow>[] {
  return [
    {
      accessorKey: 'supplierName',
      header: t('purchasing.supplierProducts.list.columns.supplier', 'Supplier'),
      enableSorting: false,
      meta: { priority: 1, truncate: true, maxWidth: 220 },
      cell: ({ row }) =>
        row.original.supplierName ?? <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      id: 'supplier_sku',
      accessorFn: (row) => row.itemNo ?? row.supplierSku,
      header: t('purchasing.supplierProducts.list.columns.itemNo', 'Item no.'),
      meta: { priority: 2 },
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.original.itemNo ?? row.original.supplierSku}</span>
          {row.original.itemNo && row.original.itemNo !== row.original.supplierSku ? (
            <span className="text-xs text-muted-foreground">{row.original.supplierSku}</span>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: 'name',
      header: t('purchasing.supplierProducts.list.columns.name', 'Name'),
      meta: { priority: 3, truncate: true, maxWidth: 280 },
      // Our own Chinese name leads (it is the name the business uses); the supplier's original
      // wording and our English name stay visible underneath instead of being hidden in the form.
      cell: ({ row }) => {
        const { name, nameZh, nameEn } = row.original
        const secondary = [nameZh ? name : null, nameEn].filter((value): value is string => Boolean(value))
        return (
          <div className="flex flex-col">
            <span>{nameZh ?? name}</span>
            {secondary.map((value) => (
              <span key={value} className="text-xs text-muted-foreground">
                {value}
              </span>
            ))}
          </div>
        )
      },
    },
    {
      accessorKey: 'unit',
      header: t('purchasing.supplierProducts.list.columns.unit', 'Unit'),
      enableSorting: false,
      meta: { priority: 4 },
    },
    {
      id: 'supplierCostPrice',
      accessorFn: (row) => row.supplierCostPrice?.unitPrice ?? '',
      header: t('purchasing.supplierProducts.list.columns.supplierCostPrice', '供应商供货价'),
      enableSorting: false,
      meta: { priority: 5, align: 'right' },
      cell: ({ row }) => {
        const text = formatPriceCell(row.original.supplierCostPrice)
        return text ? <span className="tabular-nums">{text}</span> : EMPTY_CELL
      },
    },
    {
      id: 'companyOfferPrice',
      accessorFn: (row) => row.companyOfferPrice?.unitPrice ?? '',
      header: t('purchasing.supplierProducts.list.columns.companyOfferPrice', '本公司报价'),
      enableSorting: false,
      meta: { priority: 6, align: 'right' },
      cell: ({ row }) => {
        const text = formatPriceCell(row.original.companyOfferPrice)
        return text ? <span className="tabular-nums">{text}</span> : EMPTY_CELL
      },
    },
    {
      accessorKey: 'cartonQuantity',
      header: t('purchasing.supplierProducts.list.columns.cartonQuantity', 'Qty/Box'),
      enableSorting: false,
      meta: { priority: 7, align: 'right' },
      cell: ({ getValue }) => {
        const value = getValue()
        return value === null || value === undefined ? <span className="text-xs text-muted-foreground">—</span> : String(value)
      },
    },
    {
      accessorKey: 'moqQuantity',
      header: t('purchasing.supplierProducts.list.columns.moq', 'MOQ'),
      enableSorting: false,
      meta: { priority: 8, align: 'right' },
      cell: ({ getValue }) => {
        const value = getValue()
        return value === null || value === undefined ? <span className="text-xs text-muted-foreground">—</span> : String(value)
      },
    },
    {
      accessorKey: 'productSku',
      header: t('purchasing.supplierProducts.list.columns.product', 'Product'),
      enableSorting: false,
      meta: { priority: 9, truncate: true, maxWidth: 200 },
      cell: ({ row }) =>
        row.original.productSku ? (
          <span>{row.original.productSku}</span>
        ) : (
          <span className="text-xs text-muted-foreground">
            {t('purchasing.supplierProducts.list.notLinked', 'Not synced')}
          </span>
        ),
    },
    {
      accessorKey: 'status',
      header: t('purchasing.supplierProducts.list.columns.status', 'Status'),
      enableSorting: false,
      meta: { priority: 10 },
      cell: ({ row }) => (
        <StatusBadge variant={STATUS_MAP[row.original.status]} dot>
          {t(`purchasing.supplierProducts.status.${row.original.status}`, row.original.status)}
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'source',
      header: t('purchasing.supplierProducts.list.columns.source', 'Source'),
      enableSorting: false,
      meta: { priority: 11 },
      cell: ({ row }) => t(`purchasing.supplierProducts.source.${row.original.source}`, row.original.source),
    },
    {
      accessorKey: 'updatedAt',
      header: t('purchasing.supplierProducts.list.columns.updatedAt', 'Updated'),
      meta: { priority: 12 },
      cell: ({ getValue }) => {
        const value = getValue()
        return typeof value === 'string' && value.length > 0 ? value.slice(0, 19).replace('T', ' ') : '—'
      },
    },
  ]
}

export default function SupplierProductsTable() {
  const t = useT()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const scopeVersion = useOrganizationScopeVersion()

  // The supplier master links here with `?supplierId=`, so arriving from a supplier's row action
  // lands on that supplier's library instead of the whole organization's list.
  const initialSupplierId = searchParams?.get('supplierId') ?? ALL

  const [supplierId, setSupplierId] = React.useState<string>(initialSupplierId)
  const [status, setStatus] = React.useState<string>('active')
  const [search, setSearch] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'updated_at', desc: true }])
  const [page, setPage] = React.useState(1)

  const supplierOptions = useQuery({
    queryKey: ['purchasing-supplier-products-suppliers', scopeVersion],
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>(SUPPLIERS_API_PATH, {
        // 100 is the supplier list's `pageSize` cap; a larger value is a 400, not a bigger page.
        pageSize: 100,
        sortField: 'name',
        sortDir: 'asc',
        isActive: true,
      })
      return (payload.items ?? []).map((item) => ({
        value: String(item.id ?? ''),
        label: typeof item.name === 'string' && item.name.length > 0 ? item.name : String(item.code ?? ''),
      }))
    },
  })

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sortField: sorting[0]?.id ?? 'updated_at',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
      status,
    })
    if (supplierId !== ALL) params.set('supplierId', supplierId)
    const term = search.trim()
    if (term) params.set('search', term)
    return params
  }, [page, search, sorting, status, supplierId])

  const queryKey = React.useMemo(
    () => [QUERY_KEY_ROOT, queryParams.toString(), scopeVersion],
    [queryParams, scopeVersion],
  )
  const columns = React.useMemo(() => buildColumns(t), [t])

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => fetchCrudList<SupplierProductListRow>(API_PATH, Object.fromEntries(queryParams.entries())),
  })

  const rows = data?.items ?? []
  const listError = error
    ? (error instanceof Error && error.message ? error.message : t('purchasing.errors.loadFailed', 'Loading failed'))
    : null

  const handleSortingChange = React.useCallback((next: SortingState) => {
    setSorting(next)
    setPage(1)
  }, [])

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const handlePromote = React.useCallback(async (row: SupplierProductListRow) => {
    const confirmed = await confirm({
      title: t('purchasing.supplierProducts.actions.promoteConfirmTitle', 'Sync to the product master?'),
      description: t(
        'purchasing.supplierProducts.actions.promoteConfirmBody',
        'Creates or updates the product master row for this code and links it back. The supplier library keeps its own record.',
      ),
      confirmText: t('purchasing.supplierProducts.actions.promote', 'Sync to product'),
    })
    if (!confirmed) return
    const response = await apiCall<{ action?: string }>(PROMOTE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: row.id }),
    })
    if (!response.ok) {
      const message =
        typeof response.result === 'object' && response.result !== null && 'error' in response.result
          ? String((response.result as { error?: unknown }).error ?? '')
          : ''
      flash(message || t('purchasing.supplierProducts.promote.failed', 'Sync failed'), 'error')
      return
    }
    flash(
      response.result?.action === 'skipped'
        ? t('purchasing.supplierProducts.promote.skipped', 'Already synced — nothing to do')
        : t('purchasing.supplierProducts.promote.result', 'Synced'),
      'success',
    )
    void queryClient.invalidateQueries({ queryKey: [QUERY_KEY_ROOT] })
  }, [confirm, queryClient, t])

  const handleDelete = React.useCallback(async (row: SupplierProductListRow) => {
    const confirmed = await confirm({
      title: t('purchasing.supplierProducts.actions.deleteConfirmTitle', 'Delete this product?'),
      description: t(
        'purchasing.supplierProducts.actions.deleteConfirmBody',
        'The row is soft-deleted and the code stays reserved until it is restored. Purchase orders that already reference it keep their snapshot.',
      ),
      confirmText: t('purchasing.supplierProducts.actions.delete', 'Delete'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await withScopedApiRequestHeaders(buildOptimisticLockHeader(row.updatedAt), () =>
        deleteCrud(API_PATH, { id: row.id }),
      )
      flash(t('ui.forms.flash.deleteSuccess'), 'success')
      void queryClient.invalidateQueries({ queryKey: [QUERY_KEY_ROOT] })
    } catch (deleteError) {
      if (surfaceRecordConflict(deleteError, t)) {
        void queryClient.invalidateQueries({ queryKey: [QUERY_KEY_ROOT] })
        return
      }
      const message =
        deleteError instanceof Error && deleteError.message ? deleteError.message : t('ui.forms.flash.deleteError')
      flash(message, 'error')
    }
  }, [confirm, queryClient, t])

  const filterValues = React.useMemo<FilterValues>(() => ({ supplierId, status }), [status, supplierId])

  return (
    <>
      <DataTable<SupplierProductListRow>
        title={(
          <div className="flex flex-col gap-1">
            <h1 className="text-base font-semibold leading-tight">
              {t('purchasing.supplierProducts.page.title', 'Supplier products')}
            </h1>
            <p className="text-sm font-normal text-muted-foreground">
              {t(
                'purchasing.supplierProducts.page.description',
                'The goods each supplier offers: code, spec, packing and MOQ. Prices stay on quotations and purchase orders.',
              )}
            </p>
          </div>
        )}
        columns={columns}
        data={rows}
        actions={(
          <Button asChild>
            <Link href={`${LIST_HREF}/create${supplierId !== ALL ? `?supplierId=${encodeURIComponent(supplierId)}` : ''}`}>
              {t('purchasing.supplierProducts.actions.create', 'New product')}
            </Link>
          </Button>
        )}
        searchValue={search}
        onSearchChange={handleSearchChange}
        searchPlaceholder={t('purchasing.supplierProducts.list.searchPlaceholder', 'Search code or name')}
        searchAlign="right"
        filters={[
          {
            id: 'supplierId',
            label: t('purchasing.supplierProducts.list.filter.supplier', 'Supplier'),
            type: 'select',
            options: [
              { value: ALL, label: t('purchasing.supplierProducts.list.filter.all', 'All') },
              ...(supplierOptions.data ?? []),
            ],
          },
          {
            id: 'status',
            label: t('purchasing.supplierProducts.list.filter.status', 'Status'),
            type: 'select',
            options: [
              { value: 'active', label: t('purchasing.supplierProducts.status.active', 'Active') },
              { value: 'inactive', label: t('purchasing.supplierProducts.status.inactive', 'Inactive') },
              { value: ALL, label: t('purchasing.supplierProducts.list.filter.all', 'All') },
            ],
          },
        ]}
        filterValues={filterValues}
        onFiltersApply={(values: FilterValues) => {
          const nextSupplier = typeof values.supplierId === 'string' && values.supplierId.length > 0 ? values.supplierId : ALL
          const nextStatus = typeof values.status === 'string' && values.status.length > 0 ? values.status : 'active'
          setSupplierId(nextSupplier)
          setStatus(nextStatus)
          setPage(1)
        }}
        onFiltersClear={() => {
          setSupplierId(ALL)
          setStatus('active')
          setPage(1)
        }}
        sortable
        manualSorting
        sorting={sorting}
        onSortingChange={handleSortingChange}
        emptyState={(
          <ListEmptyState
            title={t('purchasing.supplierProducts.list.empty', 'No products in this library yet')}
            createHref={`${LIST_HREF}/create`}
            createLabel={t('purchasing.supplierProducts.actions.create', 'New product')}
          />
        )}
        rowActions={(row) => (
          <RowActions
            items={[
              { id: 'edit', label: t('purchasing.supplierProducts.actions.edit', 'Edit'), href: `${LIST_HREF}/${row.id}/edit` },
              ...(row.productId
                ? []
                : [
                    {
                      id: 'promote',
                      label: t('purchasing.supplierProducts.actions.promote', 'Sync to product'),
                      onSelect: () => {
                        void handlePromote(row)
                      },
                    },
                  ]),
              {
                id: 'delete',
                label: t('purchasing.supplierProducts.actions.delete', 'Delete'),
                destructive: true,
                onSelect: () => {
                  void handleDelete(row)
                },
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
      />
      {ConfirmDialogElement}
    </>
  )
}
