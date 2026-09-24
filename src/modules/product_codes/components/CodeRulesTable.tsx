"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud, fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'

// The API segment is the module *directory* name (`product_codes`), while the page path drops the
// module id entirely (`/backend/product-codes/rules`).
const API_PATH = 'product_codes/rules'
const LIST_HREF = '/backend/product-codes/rules'
const PAGE_SIZE = 50
const QUERY_KEY_ROOT = 'product-code-rules'

export type CodeRuleRow = {
  id: string
  name: string
  mode: string
  segments: Record<string, unknown>[]
  separator: string
  serialLength: number
  serialScope: string
  enforce: string
  isActive: boolean
  updatedAt: string | null
}

const ACTIVE_VARIANT: StatusBadgeVariant = 'success'

/** `品牌 → 类别 → 序列(3)` — the shape in one line, so the list answers "what does this rule build". */
function shapeSummary(row: CodeRuleRow, t: TranslateFn): string {
  return row.segments
    .map((segment) => {
      const kind = segment.kind === 'serial' ? t('product_codes.list.segment.serial') : String(segment.key ?? '')
      const length = typeof segment.length === 'number' ? `(${segment.length})` : ''
      const join = segment.join === true ? t('product_codes.list.segment.joined') : ''
      return `${kind}${length}${join}`
    })
    .join(` ${row.separator || ''} `)
}

function buildColumns(t: TranslateFn): ColumnDef<CodeRuleRow>[] {
  return [
    { accessorKey: 'name', header: t('product_codes.list.columns.name'), meta: { priority: 1 } },
    {
      id: 'shape',
      accessorFn: (row) => shapeSummary(row, t),
      header: t('product_codes.list.columns.shape'),
      enableSorting: false,
      meta: { priority: 2, truncate: true, maxWidth: 320 },
    },
    {
      accessorKey: 'mode',
      header: t('product_codes.list.columns.mode'),
      enableSorting: false,
      meta: { priority: 3 },
      cell: ({ row }) => t(`product_codes.mode.${row.original.mode}`, row.original.mode),
    },
    {
      accessorKey: 'serialLength',
      header: t('product_codes.list.columns.serial'),
      enableSorting: false,
      meta: { priority: 4, align: 'right' },
      cell: ({ row }) =>
        `${row.original.serialLength} · ${t(`product_codes.scope.${row.original.serialScope}`, row.original.serialScope)}`,
    },
    {
      accessorKey: 'enforce',
      header: t('product_codes.list.columns.enforce'),
      enableSorting: false,
      meta: { priority: 5 },
      cell: ({ row }) => t(`product_codes.enforce.${row.original.enforce}`, row.original.enforce),
    },
    {
      accessorKey: 'isActive',
      header: t('product_codes.list.columns.status'),
      enableSorting: false,
      meta: { priority: 6 },
      cell: ({ row }) => (
        <StatusBadge variant={row.original.isActive ? ACTIVE_VARIANT : 'neutral'} dot>
          {t(`product_codes.status.${row.original.isActive ? 'active' : 'inactive'}`)}
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'updatedAt',
      header: t('product_codes.list.columns.updatedAt'),
      enableSorting: false,
      meta: { priority: 7 },
      cell: ({ getValue }) => {
        const value = getValue<string | null>()
        return value ? new Date(value).toLocaleString() : ''
      },
    },
  ]
}

export default function CodeRulesTable() {
  const t = useT()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const scopeVersion = useOrganizationScopeVersion()
  const [search, setSearch] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'created_at', desc: true }])
  const [page, setPage] = React.useState(1)

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    if (search.trim().length > 0) params.set('search', search.trim())
    const sort = sorting[0]
    if (sort) {
      params.set('sortField', sort.id)
      params.set('sortDir', sort.desc ? 'desc' : 'asc')
    }
    return params
  }, [page, search, sorting])

  const queryKey = React.useMemo(() => [QUERY_KEY_ROOT, queryParams.toString(), scopeVersion], [queryParams, scopeVersion])
  const columns = React.useMemo(() => buildColumns(t), [t])

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const payload = await fetchCrudList<CodeRuleRow>(API_PATH, Object.fromEntries(queryParams))
      return { ...payload, items: (payload.items ?? []) as CodeRuleRow[] }
    },
  })

  const rows = data?.items ?? []
  const listError = error
    ? error instanceof Error && error.message
      ? error.message
      : t('product_codes.list.loadFailed')
    : null

  const handleDelete = React.useCallback(
    async (row: CodeRuleRow) => {
      const confirmed = await confirm({
        title: t('product_codes.actions.deactivateConfirmTitle'),
        description: t('product_codes.actions.deactivateConfirmBody'),
        confirmText: t('product_codes.actions.deactivate'),
        variant: 'destructive',
      })
      if (!confirmed) return
      try {
        // The row carries its own version, so a list rendered before someone else edited the rule
        // fails with a 409 instead of deactivating a rule the operator never saw.
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
    },
    [confirm, queryClient, t],
  )

  return (
    <>
      <DataTable<CodeRuleRow>
        title={
          <div className="flex flex-col gap-1">
            <h1 className="text-base font-semibold leading-tight">{t('product_codes.page.title')}</h1>
            <p className="text-sm font-normal text-muted-foreground">{t('product_codes.page.description')}</p>
          </div>
        }
        entityId="product_codes:product_code_rule"
        extensionTableId="product-codes.rules"
        columns={columns}
        data={rows}
        actions={
          <Button asChild>
            <Link href={`${LIST_HREF}/create`}>{t('product_codes.actions.create')}</Link>
          </Button>
        }
        searchValue={search}
        onSearchChange={(value: string) => {
          setSearch(value)
          setPage(1)
        }}
        searchPlaceholder={t('product_codes.list.searchPlaceholder')}
        searchAlign="right"
        sorting={sorting}
        onSortingChange={(next: SortingState) => {
          setSorting(next)
          setPage(1)
        }}
        isLoading={isLoading}
        error={listError}
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          total: data?.total ?? rows.length,
          totalPages: Math.max(1, Math.ceil((data?.total ?? rows.length) / PAGE_SIZE)),
          onPageChange: setPage,
          onPageSizeChange: () => setPage(1),
        }}
        emptyState={
          <ListEmptyState
            title={t('product_codes.list.emptyTitle')}
            description={t('product_codes.list.empty')}
            createHref={`${LIST_HREF}/create`}
            createLabel={t('product_codes.actions.create')}
          />
        }
        rowActions={(row) => (
          <RowActions
            items={[
              { id: 'edit', label: t('product_codes.actions.edit'), onSelect: () => router.push(`${LIST_HREF}/${row.id}/edit`) },
              {
                id: 'deactivate',
                label: t('product_codes.actions.deactivate'),
                destructive: true,
                onSelect: () => void handleDelete(row),
              },
            ]}
          />
        )}
      />
      {ConfirmDialogElement}
    </>
  )
}
