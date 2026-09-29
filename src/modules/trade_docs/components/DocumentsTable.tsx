"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud, fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { formatDate } from '@open-mercato/ui/utils/format'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useLocale, useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { MoneyAmount } from '@/lib/money/MoneyAmount'

const DOCUMENTS_API_PATH = 'trade_docs/documents'
const CONTRACTS_API_PATH = 'trade_docs/contracts'
const PAGE_SIZE = 50
const QUERY_KEY_ROOT = 'trade-docs-documents'
const ALL = 'all'

export const DOCUMENT_KINDS = ['proforma', 'commercial'] as const
export type DocumentKind = (typeof DOCUMENT_KINDS)[number]

export const DOCUMENT_STATUSES = ['draft', 'issued', 'void'] as const
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number]

export const DOCUMENT_DIRECTIONS = ['sales', 'purchase'] as const
export type DocumentDirection = (typeof DOCUMENT_DIRECTIONS)[number]

export const DOCUMENT_SOURCE_KINDS = ['manual', 'sales_order', 'purchase_order', 'shipment'] as const
export type DocumentSourceKind = (typeof DOCUMENT_SOURCE_KINDS)[number]

const STATUS_VARIANT: StatusMap<DocumentStatus> = {
  draft: 'neutral',
  issued: 'info',
  void: 'error',
}

/** The list/create/edit hrefs for a document family — the one place the two routes are decided. */
export function documentListHref(kind: DocumentKind): string {
  return kind === 'commercial' ? '/backend/trade-docs/commercial-invoices' : '/backend/trade-docs/proformas'
}

export function documentKindLabel(t: TranslateFn, kind: string): string {
  return kind === 'commercial'
    ? t('trade_docs.documents.kind.commercial', '商业发票（CI）')
    : t('trade_docs.documents.kind.proforma', '形式发票（PI）')
}

export function documentStatusLabel(t: TranslateFn, status: string): string {
  switch (status) {
    case 'issued':
      return t('trade_docs.documents.status.issued', '已签发')
    case 'void':
      return t('trade_docs.documents.status.void', '已作废')
    default:
      return t('trade_docs.documents.status.draft', '草稿')
  }
}

export function documentDirectionLabel(t: TranslateFn, direction: string): string {
  return direction === 'purchase'
    ? t('trade_docs.documents.direction.purchase', '采购')
    : t('trade_docs.documents.direction.sales', '销售')
}

export function documentSourceKindLabel(t: TranslateFn, kind: string | null | undefined): string {
  switch (kind) {
    case 'sales_order':
      return t('trade_docs.documents.sourceKind.salesOrder', '内部销售订单')
    case 'purchase_order':
      return t('trade_docs.documents.sourceKind.purchaseOrder', '采购订单')
    case 'shipment':
      return t('trade_docs.documents.sourceKind.shipment', '发运单')
    case 'trade_document':
      return t('trade_docs.documents.sourceKind.tradeDocument', '单据复制')
    default:
      return t('trade_docs.documents.sourceKind.manual', '手工录入')
  }
}

export type DocumentRecord = {
  id: string
  kind: string
  number: string | null
  direction: string
  status: DocumentStatus
  counterpartyName: string | null
  currencyCode: string
  total: string
  validUntil: string | null
  issuedAt: string | null
  updatedAt: string | null
}

export function toDocumentRecord(item: Record<string, unknown>): DocumentRecord {
  const status = String(item.status ?? 'draft')
  return {
    id: String(item.id),
    kind: String(item.kind ?? 'proforma'),
    number: (item.number ?? null) as string | null,
    direction: String(item.direction ?? 'sales'),
    status: (DOCUMENT_STATUSES as readonly string[]).includes(status) ? (status as DocumentStatus) : 'draft',
    counterpartyName: (item.counterpartyName ?? null) as string | null,
    currencyCode: String(item.currencyCode ?? item.currency_code ?? 'CNY'),
    total: String(item.total ?? '0'),
    validUntil: (item.validUntil ?? item.valid_until ?? null) as string | null,
    issuedAt: (item.issuedAt ?? item.issued_at ?? null) as string | null,
    updatedAt: (item.updatedAt ?? item.updated_at ?? null) as string | null,
  }
}

/**
 * The list's money cell renders through the shared `MoneyAmount`, so a foreign-currency total
 * carries its `≈ ¥…` line; an empty total keeps the em dash and never invents a figure.
 */
function amountCell(value: string, currencyCode: string): React.ReactNode {
  const text = value.trim()
  if (!text || text === '0') return <span className="text-xs text-muted-foreground">—</span>
  return <MoneyAmount currencyCode={currencyCode} amount={text} />
}

function buildColumns(t: TranslateFn, locale: string): ColumnDef<DocumentRecord>[] {
  return [
    {
      accessorKey: 'number',
      header: t('trade_docs.documents.list.columns.number', '编号'),
      meta: { priority: 1 },
      cell: ({ row }) =>
        row.original.number ?? <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      accessorKey: 'direction',
      header: t('trade_docs.documents.list.columns.direction', '方向'),
      enableSorting: false,
      meta: { priority: 2 },
      cell: ({ row }) => documentDirectionLabel(t, row.original.direction),
    },
    {
      accessorKey: 'counterpartyName',
      header: t('trade_docs.documents.list.columns.counterparty', '对方'),
      enableSorting: false,
      meta: { priority: 3, truncate: true, maxWidth: 260 },
      cell: ({ row }) =>
        row.original.counterpartyName ?? <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      accessorKey: 'validUntil',
      header: t('trade_docs.documents.list.columns.validUntil', '有效期'),
      enableSorting: false,
      meta: { priority: 4 },
      cell: ({ row }) =>
        row.original.validUntil
          ? formatDate(row.original.validUntil, locale)
          : <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      accessorKey: 'currencyCode',
      header: t('trade_docs.documents.list.columns.currency', '币种'),
      enableSorting: false,
      meta: { priority: 5 },
    },
    {
      accessorKey: 'total',
      header: t('trade_docs.documents.list.columns.total', '合计'),
      meta: { priority: 6 },
      cell: ({ row }) => amountCell(row.original.total, row.original.currencyCode),
    },
    {
      accessorKey: 'status',
      header: t('trade_docs.documents.list.columns.status', '状态'),
      enableSorting: false,
      meta: { priority: 7 },
      cell: ({ row }) => (
        <StatusBadge variant={STATUS_VARIANT[row.original.status]} dot>
          {documentStatusLabel(t, row.original.status)}
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'issuedAt',
      header: t('trade_docs.documents.list.columns.issuedAt', '签发日'),
      enableSorting: false,
      meta: { priority: 8 },
      cell: ({ row }) =>
        row.original.issuedAt
          ? formatDate(row.original.issuedAt, locale)
          : <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      accessorKey: 'updatedAt',
      header: t('trade_docs.documents.list.columns.updatedAt', '更新时间'),
      meta: { priority: 9 },
      cell: ({ row }) => formatDate(row.original.updatedAt, locale) ?? '—',
    },
  ]
}

export default function DocumentsTable({ kind }: { kind: DocumentKind }) {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const scopeVersion = useOrganizationScopeVersion()
  const listHref = documentListHref(kind)
  const [search, setSearch] = React.useState('')
  const [status, setStatus] = React.useState<string>(ALL)
  const [direction, setDirection] = React.useState<string>(ALL)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'issued_at', desc: true }])
  const [page, setPage] = React.useState(1)
  const searchParams = useSearchParams()
  // Arriving from a contract's hub (`?contractId=`) narrows the ledger to that contract.
  const contractId = searchParams.get('contractId')?.trim() ?? ''

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams({
      kind,
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sortField: sorting[0]?.id ?? 'created_at',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    })
    const trimmed = search.trim()
    if (trimmed) params.set('search', trimmed)
    if (status !== ALL) params.set('status', status)
    if (direction !== ALL) params.set('direction', direction)
    if (contractId) params.set('contractId', contractId)
    return params
  }, [contractId, direction, kind, page, search, sorting, status])

  const queryKey = React.useMemo(
    () => [QUERY_KEY_ROOT, kind, queryParams.toString(), scopeVersion],
    [kind, queryParams, scopeVersion],
  )
  const columns = React.useMemo(() => buildColumns(t, locale), [locale, t])

  // Names the contract the banner pins, so the operator sees which one the list is filtered by.
  const contractLabel = useQuery({
    queryKey: ['trade-docs-contract-label', contractId],
    enabled: contractId.length > 0,
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>(CONTRACTS_API_PATH, {
        ids: contractId,
        pageSize: 1,
      })
      const item = payload.items?.[0]
      const number = item ? String(item.number ?? '').trim() : ''
      return number || contractId.slice(0, 8)
    },
  })

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>(
        DOCUMENTS_API_PATH,
        Object.fromEntries(queryParams),
      )
      return { ...payload, items: (payload.items ?? []).map(toDocumentRecord) }
    },
  })

  const rows = data?.items ?? []
  const listError = error
    ? (error instanceof Error && error.message ? error.message : t('trade_docs.documents.form.loadFailed', '单据加载失败'))
    : null

  const handleSortingChange = React.useCallback((next: SortingState) => {
    setSorting(next)
    setPage(1)
  }, [])

  const handleDelete = React.useCallback(
    async (row: DocumentRecord) => {
      const confirmed = await confirm({
        title: t('trade_docs.documents.actions.deleteConfirmTitle', '确认删除该单据？'),
        description: t('trade_docs.documents.actions.deleteConfirmBody', '只有草稿可以删除；已签发的单据请改为作废。'),
        confirmText: t('trade_docs.documents.actions.delete', '删除'),
        variant: 'destructive',
      })
      if (!confirmed) return
      try {
        await withScopedApiRequestHeaders(buildOptimisticLockHeader(row.updatedAt), () =>
          deleteCrud(DOCUMENTS_API_PATH, { id: row.id }),
        )
        flash(t('ui.forms.flash.deleteSuccess'), 'success')
        void queryClient.invalidateQueries({ queryKey: [QUERY_KEY_ROOT] })
      } catch (deleteError) {
        if (surfaceRecordConflict(deleteError, t)) {
          void queryClient.invalidateQueries({ queryKey: [QUERY_KEY_ROOT] })
          return
        }
        flash(
          deleteError instanceof Error && deleteError.message
            ? deleteError.message
            : t('ui.forms.flash.deleteError'),
          'error',
        )
      }
    },
    [confirm, queryClient, t],
  )

  return (
    <>
      {contractId ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            {t('trade_docs.documents.list.contractFilter', '按合同筛选')}
          </span>
          <span className="font-medium">{contractLabel.data ?? contractId.slice(0, 8)}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => router.replace(listHref)}>
            {t('trade_docs.documents.list.contractFilterClear', '清除合同筛选')}
          </Button>
        </div>
      ) : null}
      <DataTable<DocumentRecord>
        entityId="trade_docs:trade_docs_documents"
        extensionTableId="trade-docs.documents"
        title={(
          <div className="flex flex-col gap-1">
            <h1 className="text-base font-semibold leading-tight">
              {documentKindLabel(t, kind)}
            </h1>
            <p className="text-sm font-normal text-muted-foreground">
              {kind === 'commercial'
                ? t('trade_docs.documents.commercial.page.description', '商业发票（CI）台账；报关金额与分摊行逐行对账。')
                : t('trade_docs.documents.proforma.page.description', '形式发票（PI）台账；发货前签发并生成可打印文件。')}
            </p>
          </div>
        )}
        columns={columns}
        data={rows}
        actions={(
          <Button asChild>
            <Link href={`${listHref}/create`}>
              {kind === 'commercial'
                ? t('trade_docs.documents.actions.createCommercial', '新建 CI')
                : t('trade_docs.documents.actions.createProforma', '新建 PI')}
            </Link>
          </Button>
        )}
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPage(1)
        }}
        searchPlaceholder={t('trade_docs.documents.list.searchPlaceholder', '按编号搜索')}
        searchAlign="right"
        filters={[
          {
            id: 'direction',
            label: t('trade_docs.documents.list.filter.direction', '方向'),
            type: 'select',
            options: DOCUMENT_DIRECTIONS.map((value) => ({
              value,
              label: documentDirectionLabel(t, value),
            })),
          },
          {
            id: 'status',
            label: t('trade_docs.documents.list.filter.status', '状态'),
            type: 'select',
            options: DOCUMENT_STATUSES.map((value) => ({
              value,
              label: documentStatusLabel(t, value),
            })),
          },
        ]}
        filterValues={{
          ...(direction === ALL ? {} : { direction }),
          ...(status === ALL ? {} : { status }),
        }}
        onFiltersApply={(values: FilterValues) => {
          setDirection(typeof values.direction === 'string' && values.direction.length ? values.direction : ALL)
          setStatus(typeof values.status === 'string' && values.status.length ? values.status : ALL)
          setPage(1)
        }}
        onFiltersClear={() => {
          setDirection(ALL)
          setStatus(ALL)
          setPage(1)
        }}
        sortable
        manualSorting
        sorting={sorting}
        onSortingChange={handleSortingChange}
        emptyState={(
          <ListEmptyState
            title={t('trade_docs.documents.list.empty', '还没有单据。新建一张开始录入。')}
            createHref={`${listHref}/create`}
            createLabel={
              kind === 'commercial'
                ? t('trade_docs.documents.actions.createCommercial', '新建 CI')
                : t('trade_docs.documents.actions.createProforma', '新建 PI')
            }
          />
        )}
        rowActions={(row) => {
          const items: Array<{
            id: string
            label: string
            href?: string
            destructive?: boolean
            onSelect?: () => void
          }> = [
            { id: 'open', label: t('trade_docs.documents.actions.open', '打开'), href: `${listHref}/${row.id}` },
          ]
          if (row.status === 'draft') {
            items.push({
              id: 'edit',
              label: t('trade_docs.documents.actions.edit', '编辑'),
              href: `${listHref}/${row.id}/edit`,
            })
            items.push({
              id: 'delete',
              label: t('trade_docs.documents.actions.delete', '删除'),
              destructive: true,
              onSelect: () => {
                void handleDelete(row)
              },
            })
          }
          return <RowActions items={items} />
        }}
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
        onRowClick={(row) => router.push(`${listHref}/${row.id}`)}
      />
      {ConfirmDialogElement}
    </>
  )
}
