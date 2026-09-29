"use client"

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'

/**
 * RU 码 → 商品 的映射列表。
 *
 * The list is derived (codes seen in the snapshots joined with the decision recorded for them), so a
 * code that has never been decided shows up on its own with the endpoints it came from. Unmapped
 * rows sort first: deciding them is the page's whole job.
 */

type SkuMapStatus = 'mapped' | 'ignored' | 'unmapped'

type SkuMapRow = {
  ruSku: string
  status: SkuMapStatus
  productId: string | null
  productSku: string | null
  productName: string | null
  note: string | null
  updatedAt: string | null
  sources: Array<{ endpoint: string; count: number; lastAsOf: string | null }>
}

type SkuMapResponse = {
  items: SkuMapRow[]
  total: number
  counts: { mapped: number; ignored: number; unmapped: number }
  hasUnmapped: boolean
}

const SKU_MAP_API = '/api/ru_sync/sku-map'
const PAGE_SIZE = 50

const STATUS_VARIANTS: StatusMap<SkuMapStatus> = {
  mapped: 'success',
  ignored: 'neutral',
  unmapped: 'warning',
}

const STATUS_LABEL_KEYS: Record<SkuMapStatus, string> = {
  mapped: 'ru_sync.skuMap.status.mapped',
  ignored: 'ru_sync.skuMap.status.ignored',
  unmapped: 'ru_sync.skuMap.status.unmapped',
}

type ProductOption = { id: string; sku: string; name: string }

function columns(t: TranslateFn): ColumnDef<SkuMapRow>[] {
  return [
    {
      accessorKey: 'ruSku',
      header: t('ru_sync.skuMap.columns.ruSku'),
      meta: { priority: 1, truncate: true, maxWidth: 240 },
      cell: ({ row }) => <span className="font-medium">{row.original.ruSku}</span>,
    },
    {
      accessorKey: 'status',
      header: t('ru_sync.skuMap.columns.status'),
      meta: { priority: 2 },
      cell: ({ row }) => (
        <StatusBadge variant={STATUS_VARIANTS[row.original.status]} dot>
          {t(STATUS_LABEL_KEYS[row.original.status])}
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'productSku',
      header: t('ru_sync.skuMap.columns.product'),
      enableSorting: false,
      meta: { priority: 3, truncate: true, maxWidth: 280 },
      cell: ({ row }) =>
        row.original.productSku ? (
          <span>
            {row.original.productSku}
            {row.original.productName ? ` — ${row.original.productName}` : ''}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      accessorKey: 'sources',
      header: t('ru_sync.skuMap.columns.sources'),
      enableSorting: false,
      meta: { priority: 5, truncate: true, maxWidth: 240 },
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.sources.length > 0
            ? row.original.sources.map((source) => t(`ru_sync.endpoint.${source.endpoint}`)).join('、')
            : '—'}
        </span>
      ),
    },
    {
      accessorKey: 'note',
      header: t('ru_sync.skuMap.columns.note'),
      enableSorting: false,
      meta: { priority: 4, truncate: true, maxWidth: 220 },
      cell: ({ row }) => <span>{row.original.note ?? '—'}</span>,
    },
  ]
}

export default function SkuMapTable() {
  const t = useT()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const scopeVersion = useOrganizationScopeVersion()
  const [status, setStatus] = React.useState<SkuMapStatus | 'all'>('unmapped')
  const [search, setSearch] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [binding, setBinding] = React.useState<SkuMapRow | null>(null)
  const [productQuery, setProductQuery] = React.useState('')
  const [selectedProduct, setSelectedProduct] = React.useState<ProductOption | null>(null)
  const [saving, setSaving] = React.useState(false)

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), status })
    const term = search.trim()
    if (term) params.set('search', term)
    return params
  }, [page, search, status])

  const queryKey = React.useMemo(() => ['ru-sync-sku-map', queryParams.toString(), scopeVersion], [queryParams, scopeVersion])

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () =>
      (await apiCall<SkuMapResponse>(`${SKU_MAP_API}?${queryParams.toString()}`)).result ?? {
        items: [],
        total: 0,
        counts: { mapped: 0, ignored: 0, unmapped: 0 },
        hasUnmapped: false,
      },
  })

  const productQueryKey = React.useMemo(() => ['ru-sync-products', productQuery, scopeVersion], [productQuery, scopeVersion])
  const { data: products } = useQuery({
    queryKey: productQueryKey,
    enabled: binding !== null,
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>('products/items', {
        pageSize: 50,
        search: productQuery.trim() || undefined,
      })
      return (payload.items ?? []).map((item) => ({
        id: String(item.id ?? ''),
        sku: String(item.sku ?? ''),
        name: String(item.name ?? ''),
      }))
    },
  })

  const columnDefs = React.useMemo(() => columns(t), [t])

  const refresh = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['ru-sync-sku-map'] })
  }, [queryClient])

  const submitDecision = React.useCallback(
    async (row: SkuMapRow, next: { status: 'mapped' | 'ignored'; productId?: string | null }) => {
      setSaving(true)
      try {
        const call = await apiCall(SKU_MAP_API, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ruSku: row.ruSku, status: next.status, productId: next.productId ?? null }),
        })
        if (!call.ok) throw new Error(t('ru_sync.skuMap.saveFailed'))
        flash(t('ru_sync.skuMap.saved'), 'success')
        setBinding(null)
        setSelectedProduct(null)
        refresh()
      } catch (saveError) {
        const message = saveError instanceof Error && saveError.message ? saveError.message : t('ru_sync.skuMap.saveFailed')
        flash(message, 'error')
      } finally {
        setSaving(false)
      }
    },
    [refresh, t],
  )

  const handleIgnore = React.useCallback(
    async (row: SkuMapRow) => {
      const confirmed = await confirm({
        title: t('ru_sync.skuMap.actions.ignoreConfirmTitle'),
        description: t('ru_sync.skuMap.actions.ignoreConfirmBody'),
        confirmText: t('ru_sync.skuMap.actions.ignore'),
      })
      if (!confirmed) return
      await submitDecision(row, { status: 'ignored' })
    },
    [confirm, submitDecision, t],
  )

  const listError = error
    ? error instanceof Error && error.message
      ? error.message
      : t('ru_sync.skuMap.loadFailed')
    : null

  return (
    <>
      <DataTable<SkuMapRow>
        title={(
          <div className="flex flex-col gap-1">
            <h1 className="text-base font-semibold leading-tight">{t('ru_sync.skuMap.page.title')}</h1>
            <p className="text-sm font-normal text-muted-foreground">
              {t('ru_sync.skuMap.page.description', {
                mapped: String(data?.counts.mapped ?? 0),
                total: String(
                  (data?.counts.mapped ?? 0) + (data?.counts.ignored ?? 0) + (data?.counts.unmapped ?? 0),
                ),
              })}
            </p>
          </div>
        )}
        columns={columnDefs}
        data={data?.items ?? []}
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPage(1)
        }}
        searchPlaceholder={t('ru_sync.skuMap.list.searchPlaceholder')}
        searchAlign="right"
        toolbar={(
          <div className="flex w-56 flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t('ru_sync.skuMap.filter.status')}</span>
            <Select
              value={status}
              onValueChange={(next) => {
                setStatus(next as SkuMapStatus | 'all')
                setPage(1)
              }}
            >
              <SelectTrigger aria-label={t('ru_sync.skuMap.filter.status')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('ru_sync.skuMap.filter.all')}</SelectItem>
                <SelectItem value="unmapped">{t(STATUS_LABEL_KEYS.unmapped)}</SelectItem>
                <SelectItem value="mapped">{t(STATUS_LABEL_KEYS.mapped)}</SelectItem>
                <SelectItem value="ignored">{t(STATUS_LABEL_KEYS.ignored)}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        emptyState={<ListEmptyState title={t('ru_sync.skuMap.list.empty')} />}
        rowActions={(row) => (
          <RowActions
            items={[
              { id: 'bind', label: t('ru_sync.skuMap.actions.bind'), onSelect: () => setBinding(row) },
              {
                id: 'ignore',
                label: t('ru_sync.skuMap.actions.ignore'),
                destructive: true,
                onSelect: () => {
                  void handleIgnore(row)
                },
              },
            ]}
          />
        )}
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          total: data?.total ?? 0,
          totalPages: Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE)),
          onPageChange: setPage,
        }}
        isLoading={isLoading}
        error={listError}
      />

      <Dialog open={binding !== null} onOpenChange={(open) => (!open ? setBinding(null) : undefined)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('ru_sync.skuMap.bind.title')}</DialogTitle>
            <DialogDescription>
              {t('ru_sync.skuMap.bind.description', { code: binding?.ruSku ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="sku-map-product-search">{t('ru_sync.skuMap.bind.searchLabel')}</Label>
            <Input
              id="sku-map-product-search"
              value={productQuery}
              onChange={(event) => setProductQuery(event.target.value)}
              placeholder={t('ru_sync.skuMap.bind.searchPlaceholder')}
            />
            <div className="max-h-64 overflow-y-auto rounded-md border">
              {(products ?? []).length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">{t('ru_sync.skuMap.bind.noProducts')}</p>
              ) : (
                (products ?? []).map((product) => (
                  <Button
                    key={product.id}
                    type="button"
                    variant={selectedProduct?.id === product.id ? 'default' : 'ghost'}
                    className="w-full justify-start"
                    onClick={() => setSelectedProduct(product)}
                  >
                    {product.sku} — {product.name}
                  </Button>
                ))
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setBinding(null)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              disabled={saving || selectedProduct === null}
              onClick={() => {
                if (!binding || !selectedProduct) return
                void submitDecision(binding, { status: 'mapped', productId: selectedProduct.id })
              }}
            >
              {t('ru_sync.skuMap.bind.confirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {ConfirmDialogElement}
    </>
  )
}
