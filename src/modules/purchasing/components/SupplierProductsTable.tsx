"use client"

import * as React from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { PackagePlus } from 'lucide-react'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud, fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import SupplierProductLinkDialog from './SupplierProductLinkDialog'
import type { SupplierProductListRow, SupplierProductPriceCell, SupplierProductStatus } from '../types'

const API_PATH = 'purchasing/supplier-products'
const PROMOTE_URL = '/api/purchasing/supplier-products/promote'
const PROMOTE_BATCH_URL = '/api/purchasing/supplier-products/promote-batch'
const LINK_URL = '/api/purchasing/supplier-products/link'
const SYNC_FIELDS_URL = '/api/purchasing/supplier-products/sync-fields'
const LIST_HREF = '/backend/purchasing/supplier-products'
/** Where the created product's 官方目录链接 lives — the step that actually unlocks shipping. */
const PRODUCT_EDIT_HREF = '/backend/products/items'
const SUPPLIERS_API_PATH = 'purchasing/suppliers'
/** Master-writing actions (create/update the product record) need `promote`, not just `manage`. */
const FEATURE_PROMOTE = 'purchasing.supplier-products.promote'
/** Link actions (assign / re-point / clear `product_id`) need the library's write feature. */
const FEATURE_MANAGE = 'purchasing.supplier-products.manage'
const PAGE_SIZE = 50
const QUERY_KEY_ROOT = 'purchasing-supplier-products'
const ALL = 'all'

const STATUS_MAP: StatusMap<SupplierProductStatus> = {
  active: 'success',
  inactive: 'neutral',
}

type FilterValues = { supplierId?: string; status?: string; linked?: string }

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

/**
 * The server's own message when it sent one (a 409/422 explains the fix), else the caller's fallback.
 */
function errorMessageOf(result: unknown, fallback: string): string {
  if (result && typeof result === 'object' && 'error' in result) {
    const message = result.error
    if (typeof message === 'string' && message.length > 0) return message
  }
  return fallback
}

function buildColumns(
  t: TranslateFn,
  renderProduct: (row: SupplierProductListRow) => React.ReactNode,
): ColumnDef<SupplierProductListRow>[] {
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
      header: t('purchasing.supplierProducts.list.columns.supplierCostPrice', 'Supplier cost'),
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
      header: t('purchasing.supplierProducts.list.columns.companyOfferPrice', 'Our offer'),
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
      id: 'product',
      accessorFn: (row) => row.productName ?? row.productSku ?? '',
      header: t('purchasing.supplierProducts.list.columns.product', 'Product'),
      enableSorting: false,
      meta: { priority: 9, truncate: true, maxWidth: 260 },
      cell: ({ row }) => renderProduct(row.original),
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
  // The server is the authority on every action's feature gate; these flags only decide whether the
  // button is worth showing. While the chrome payload is still loading nothing is hidden, so a
  // permitted operator never sees a control flicker in.
  const { payload: chromePayload, isReady: chromeReady } = useBackendChrome()
  const canManage = !chromeReady || hasFeature(chromePayload?.grantedFeatures, FEATURE_MANAGE)
  const canPromote = !chromeReady || hasFeature(chromePayload?.grantedFeatures, FEATURE_PROMOTE)

  // The supplier master links here with `?supplierId=`, so arriving from a supplier's row action
  // lands on that supplier's library instead of the whole organization's list.
  const initialSupplierId = searchParams?.get('supplierId') ?? ALL

  const [supplierId, setSupplierId] = React.useState<string>(initialSupplierId)
  const [status, setStatus] = React.useState<string>('active')
  const [linked, setLinked] = React.useState<string>(ALL)
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
    if (linked !== ALL) params.set('linked', linked)
    const term = search.trim()
    if (term) params.set('search', term)
    return params
  }, [page, search, sorting, status, supplierId, linked])

  const queryKey = React.useMemo(
    () => [QUERY_KEY_ROOT, queryParams.toString(), scopeVersion],
    [queryParams, scopeVersion],
  )
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

  const [linkTarget, setLinkTarget] = React.useState<SupplierProductListRow | null>(null)
  const [nextStep, setNextStep] = React.useState<{ productId: string; label: string } | null>(null)

  const refreshList = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [QUERY_KEY_ROOT] })
  }, [queryClient])

  /**
   * 建档 — create or update the master record and link it. The flash alone would end the task one
   * step early: the link is necessary but not sufficient, because shipping and stock receipt need
   * the product's 官方目录链接 (and a variant), so the row keeps that next step on screen.
   */
  const handlePromote = React.useCallback(
    async (row: SupplierProductListRow) => {
      const confirmed = await confirm({
        title: t('purchasing.supplierProducts.actions.promoteConfirmTitle', 'Create this item in the product master?'),
        description: t(
          'purchasing.supplierProducts.actions.promoteConfirmBody',
          'Creates or updates the product master record for this code and links the two — only then can the item be shipped and received. An existing product with the same SKU is updated, not duplicated. The supplier library keeps its own record.',
        ),
        confirmText: t('purchasing.supplierProducts.actions.promote', 'Create product record'),
      })
      if (!confirmed) return
      const response = await apiCall<{ action?: string; productId?: string }>(PROMOTE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id }),
      })
      if (!response.ok) {
        flash(
          errorMessageOf(response.result, t('purchasing.supplierProducts.promote.failed', 'Could not create the product record')),
          'error',
        )
        return
      }
      const productId = typeof response.result?.productId === 'string' ? response.result.productId : null
      if (response.result?.action === 'skipped') {
        flash(t('purchasing.supplierProducts.promote.skipped', 'Already has a product record — nothing to do'), 'info')
      } else {
        flash(t('purchasing.supplierProducts.promote.result', 'Product record created'), 'success')
        if (productId) setNextStep({ productId, label: row.nameZh ?? row.name })
      }
      refreshList()
    },
    [confirm, refreshList, t],
  )

  /**
   * 批量建商品档案 — one request, per-row isolation: the failures come back named and the rest are
   * written. A batch has no single product to open, so its result points at the list instead of
   * offering the single-row next-step link.
   */
  const handlePromoteBatch = React.useCallback(
    async (rows: SupplierProductListRow[]) => {
      const response = await apiCall<{
        created?: number
        updated?: number
        skipped?: number
        failed?: Array<{ id?: string; message?: string }>
      }>(PROMOTE_BATCH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: rows.map((row) => row.id) }),
      })
      if (!response.ok) {
        flash(
          errorMessageOf(response.result, t('purchasing.supplierProducts.promote.failed', 'Could not create the product record')),
          'error',
        )
        return
      }
      const created = Number(response.result?.created ?? 0)
      const updated = Number(response.result?.updated ?? 0)
      const skipped = Number(response.result?.skipped ?? 0)
      const failed = Array.isArray(response.result?.failed) ? response.result.failed : []
      const summary = t(
        'purchasing.supplierProducts.promote.batchSummary',
        'Created {created}, updated {updated}, skipped {skipped}, failed {failed}',
        { created, updated, skipped, failed: failed.length },
      )
      if (failed.length > 0) {
        const names = failed
          .slice(0, 3)
          .map((entry) => {
            const row = rows.find((candidate) => candidate.id === entry.id)
            const label = row?.itemNo ?? row?.supplierSku ?? String(entry.id ?? '')
            return `${label}: ${entry.message ?? ''}`
          })
          .join('; ')
        flash(`${summary} — ${names}`, 'warning')
      } else {
        flash(summary, 'success')
      }
      refreshList()
    },
    [refreshList, t],
  )

  /** 关联已有商品 / 换绑 — the dialog resolves the product, this writes the link. */
  const handleLinkSubmit = React.useCallback(
    async (productId: string) => {
      const row = linkTarget
      if (!row) return
      const response = await apiCall<{ productId?: string | null }>(LINK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, productId }),
      })
      if (!response.ok) {
        flash(errorMessageOf(response.result, t('purchasing.supplierProducts.link.failed', 'Could not link the product')), 'error')
        return
      }
      flash(t('purchasing.supplierProducts.link.linked', 'Linked to the product record'), 'success')
      refreshList()
    },
    [linkTarget, refreshList, t],
  )

  const handleUnlink = React.useCallback(
    async (row: SupplierProductListRow) => {
      const confirmed = await confirm({
        title: t('purchasing.supplierProducts.actions.unlinkConfirmTitle', 'Clear the link to this product?'),
        description: t(
          'purchasing.supplierProducts.actions.unlinkConfirmBody',
          'The row goes back to 未建档: it can still be ordered, but it cannot be shipped or received until it is linked again. Purchase orders already placed keep their own record.',
        ),
        confirmText: t('purchasing.supplierProducts.actions.unlink', 'Clear the link'),
        variant: 'destructive',
      })
      if (!confirmed) return
      const response = await apiCall(LINK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, productId: null }),
      })
      if (!response.ok) {
        flash(errorMessageOf(response.result, t('purchasing.supplierProducts.link.failed', 'Could not link the product')), 'error')
        return
      }
      flash(t('purchasing.supplierProducts.link.unlinked', 'Link cleared'), 'success')
      refreshList()
    },
    [confirm, refreshList, t],
  )

  /** 同步字段到商品 — reports what it actually wrote, because "synced" says nothing. */
  const handleSyncFields = React.useCallback(
    async (row: SupplierProductListRow) => {
      const confirmed = await confirm({
        title: t('purchasing.supplierProducts.actions.syncFieldsConfirmTitle', 'Push this row’s values to the product?'),
        description: t(
          'purchasing.supplierProducts.actions.syncFieldsConfirmBody',
          'Writes this row’s non-empty values (names, spec, HS code, unit, weight, size, Qty/Box) and its 供应商供货价 onto the linked product. The official catalog link, the internal/export prices and the variants are not touched.',
        ),
        confirmText: t('purchasing.supplierProducts.actions.syncFields', 'Push to the product'),
      })
      if (!confirmed) return
      const response = await apiCall<{ fieldsChanged?: string[]; priceChanged?: boolean }>(SYNC_FIELDS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id }),
      })
      if (!response.ok) {
        flash(
          errorMessageOf(response.result, t('purchasing.supplierProducts.syncFields.failed', 'Could not push the values')),
          'error',
        )
        return
      }
      const fields = Array.isArray(response.result?.fieldsChanged) ? response.result.fieldsChanged : []
      const priceChanged = response.result?.priceChanged === true
      if (fields.length === 0 && !priceChanged) {
        flash(t('purchasing.supplierProducts.syncFields.nothing', 'The product already matches this row — nothing to write'), 'info')
      } else {
        flash(
          t('purchasing.supplierProducts.syncFields.result', 'Updated: {fields} {price}', {
            fields: fields.length > 0 ? fields.join(', ') : t('purchasing.supplierProducts.syncFields.noFields', 'no fields'),
            price: priceChanged ? t('purchasing.supplierProducts.syncFields.price', '· supplier cost price') : '',
          }),
          'success',
        )
      }
      refreshList()
    },
    [confirm, refreshList, t],
  )

  /**
   * The 商品 column carries the state, so nobody has to know the rule to use it: linked rows name
   * the product (and open it), unlinked rows offer 建档 / 关联已有商品 right there, and a row whose
   * product was deleted says so and offers the only two ways out.
   */
  const renderProduct = React.useCallback(
    (row: SupplierProductListRow): React.ReactNode => {
      // The DataTable navigates on a row click, so every control in this cell stops the click from
      // reaching it — without that, clicking the product link or an inline action also opened the
      // library row's edit page.
      if (row.productId && !row.productDeleted) {
        return (
          <Link
            href={`${PRODUCT_EDIT_HREF}/${row.productId}/edit`}
            className="flex flex-col hover:underline"
            title={t('purchasing.supplierProducts.list.openProduct', 'Open the product record')}
            onClick={(event) => event.stopPropagation()}
          >
            <span>{row.productName ?? row.productSku ?? row.productId}</span>
            {row.productName && row.productSku ? (
              <span className="text-xs text-muted-foreground">{row.productSku}</span>
            ) : null}
          </Link>
        )
      }
      if (row.productId && row.productDeleted) {
        return (
          <div className="flex flex-col items-start gap-1">
            <span className="text-xs text-muted-foreground">
              {t('purchasing.supplierProducts.list.productDeleted', 'The linked product was deleted')}
            </span>
            {canManage ? (
              <Button
                type="button"
                variant="outline"
                size="2xs"
                onClick={(event) => {
                  event.stopPropagation()
                  setLinkTarget(row)
                }}
              >
                {t('purchasing.supplierProducts.actions.relink', 'Link another product')}
              </Button>
            ) : null}
          </div>
        )
      }
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge variant="warning" dot>
            {t('purchasing.supplierProducts.list.notLinked', 'Not in master')}
          </StatusBadge>
          {canPromote ? (
            <Button
              type="button"
              variant="outline"
              size="2xs"
              onClick={(event) => {
                event.stopPropagation()
                void handlePromote(row)
              }}
            >
              {t('purchasing.supplierProducts.actions.promote', 'Create product record')}
            </Button>
          ) : null}
          {canManage ? (
            <Button
              type="button"
              variant="ghost"
              size="2xs"
              onClick={(event) => {
                event.stopPropagation()
                setLinkTarget(row)
              }}
            >
              {t('purchasing.supplierProducts.actions.link', 'Link existing product')}
            </Button>
          ) : null}
        </div>
      )
    },
    [canManage, canPromote, handlePromote, t],
  )

  const columns = React.useMemo(() => buildColumns(t, renderProduct), [renderProduct, t])

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

  const filterValues = React.useMemo<FilterValues>(
    () => ({ supplierId, status, linked }),
    [linked, status, supplierId],
  )

  return (
    <>
      {nextStep ? (
        <Alert
          status="success"
          dismissible
          onDismiss={() => setNextStep(null)}
          footer={(
            <Link className="text-sm underline" href={`${PRODUCT_EDIT_HREF}/${nextStep.productId}/edit`}>
              {t(
                'purchasing.supplierProducts.promote.nextStepAction',
                'Open the product and fill its official catalog link',
              )}
            </Link>
          )}
        >
          {t('purchasing.supplierProducts.promote.nextStep', 'Product record ready for {name}. Shipping and stock receipt also need the product’s 官方目录链接.', {
            name: nextStep.label,
          })}
        </Alert>
      ) : null}
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
          {
            id: 'linked',
            label: t('purchasing.supplierProducts.list.filter.linked', 'Product record'),
            type: 'select',
            options: [
              { value: ALL, label: t('purchasing.supplierProducts.list.filter.all', 'All') },
              { value: 'unlinked', label: t('purchasing.supplierProducts.list.filter.unlinked', 'Not in master') },
              { value: 'linked', label: t('purchasing.supplierProducts.list.filter.linkedOnly', 'Linked') },
            ],
          },
        ]}
        filterValues={filterValues}
        onFiltersApply={(values: FilterValues) => {
          const nextSupplier = typeof values.supplierId === 'string' && values.supplierId.length > 0 ? values.supplierId : ALL
          const nextStatus = typeof values.status === 'string' && values.status.length > 0 ? values.status : 'active'
          const nextLinked = typeof values.linked === 'string' && values.linked.length > 0 ? values.linked : ALL
          setSupplierId(nextSupplier)
          setStatus(nextStatus)
          setLinked(nextLinked)
          setPage(1)
        }}
        onFiltersClear={() => {
          setSupplierId(ALL)
          setStatus('active')
          setLinked(ALL)
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
        bulkActions={canPromote ? [
          {
            id: 'promote-batch',
            label: t('purchasing.supplierProducts.actions.promoteBatch', 'Create product records'),
            icon: PackagePlus,
            onExecute: (selected: SupplierProductListRow[]) => handlePromoteBatch(selected),
          },
        ] : undefined}
        rowActions={(row) => (
          <RowActions
            items={[
              { id: 'edit', label: t('purchasing.supplierProducts.actions.edit', 'Edit'), href: `${LIST_HREF}/${row.id}/edit` },
              ...(row.productId
                ? [
                    {
                      id: 'open-product',
                      label: t('purchasing.supplierProducts.actions.openProduct', 'Open the product record'),
                      href: `${PRODUCT_EDIT_HREF}/${row.productId}/edit`,
                    },
                  ]
                : canPromote
                  ? [
                      {
                        id: 'promote',
                        label: t('purchasing.supplierProducts.actions.promote', 'Create product record'),
                        onSelect: () => {
                          void handlePromote(row)
                        },
                      },
                    ]
                  : []),
              ...(canManage
                ? [
                    {
                      id: 'link',
                      label: row.productId
                        ? t('purchasing.supplierProducts.actions.relink', 'Link another product')
                        : t('purchasing.supplierProducts.actions.link', 'Link existing product'),
                      onSelect: () => setLinkTarget(row),
                    },
                  ]
                : []),
              ...(row.productId && !row.productDeleted && canPromote
                ? [
                    {
                      id: 'sync-fields',
                      label: t('purchasing.supplierProducts.actions.syncFields', 'Push to the product'),
                      onSelect: () => {
                        void handleSyncFields(row)
                      },
                    },
                  ]
                : []),
              ...(row.productId && canManage
                ? [
                    {
                      id: 'unlink',
                      label: t('purchasing.supplierProducts.actions.unlink', 'Clear the link'),
                      onSelect: () => {
                        void handleUnlink(row)
                      },
                    },
                  ]
                : []),
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
      <SupplierProductLinkDialog
        open={linkTarget !== null}
        rowLabel={linkTarget ? `${linkTarget.itemNo ?? linkTarget.supplierSku} — ${linkTarget.nameZh ?? linkTarget.name}` : ''}
        currentProductId={linkTarget?.productId ?? null}
        onOpenChange={(open) => {
          if (!open) setLinkTarget(null)
        }}
        onSubmit={handleLinkSubmit}
      />
    </>
  )
}
