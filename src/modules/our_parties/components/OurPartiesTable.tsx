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
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud, fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { Button } from '@open-mercato/ui/primitives/button'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationNames } from '../../products/components/useOrganizationNames'
import type { OurPartyProfileRecord } from './OurPartyForm'

const API_PATH = 'our_parties/profiles'
const LIST_HREF = '/backend/our-parties'
const PAGE_SIZE = 50
const QUERY_KEY_ROOT = 'our-parties-list'

function buildColumns(
  t: TranslateFn,
  organizationName: (id: string | null | undefined) => string | null,
): ColumnDef<OurPartyProfileRecord>[] {
  return [
    {
      accessorKey: 'organizationId',
      header: t('our_parties.list.columns.company'),
      enableSorting: false,
      meta: { priority: 1, truncate: true, maxWidth: 320 },
      cell: ({ row }) => organizationName(row.original.organizationId) ?? row.original.organizationId,
    },
    {
      accessorKey: 'city',
      header: t('our_parties.list.columns.city'),
      enableSorting: false,
      meta: { priority: 2 },
      cell: ({ getValue }) => {
        const value = typeof getValue() === 'string' ? (getValue() as string) : ''
        return value.length > 0 ? value : <span className="text-xs text-muted-foreground">—</span>
      },
    },
    {
      accessorKey: 'contactName',
      header: t('our_parties.list.columns.contact'),
      enableSorting: false,
      meta: { priority: 3, truncate: true, maxWidth: 240 },
      cell: ({ row }) => {
        const contact = row.original.contactName
        const phone = row.original.contactPhone
        if (contact.length === 0 && phone.length === 0) {
          return <span className="text-xs text-muted-foreground">—</span>
        }
        return (
          <span className="flex flex-col">
            {contact.length > 0 ? <span>{contact}</span> : null}
            {phone.length > 0 ? <span className="text-xs text-muted-foreground">{phone}</span> : null}
          </span>
        )
      },
    },
    {
      accessorKey: 'email',
      header: t('our_parties.list.columns.email'),
      enableSorting: false,
      meta: { priority: 4, truncate: true, maxWidth: 240 },
      cell: ({ getValue }) => {
        const value = typeof getValue() === 'string' ? (getValue() as string) : ''
        return value.length > 0 ? value : <span className="text-xs text-muted-foreground">—</span>
      },
    },
  ]
}

export default function OurPartiesTable() {
  const t = useT()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const organizationName = useOrganizationNames()
  const scopeVersion = useOrganizationScopeVersion()
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'updated_at', desc: true }])
  const [page, setPage] = React.useState(1)

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sortField: 'updated_at',
      sortDir: 'desc',
    })
    return params
  }, [page])

  const query = useQuery({
    queryKey: [QUERY_KEY_ROOT, scopeVersion, queryParams.toString()],
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>(API_PATH, Object.fromEntries(queryParams))
      return payload
    },
  })

  const columns = React.useMemo(() => buildColumns(t, organizationName), [organizationName, t])

  const rows: OurPartyProfileRecord[] = React.useMemo(
    () =>
      (query.data?.items ?? []).map((item) => ({
        id: String(item.id ?? ''),
        organizationId: String(item.organizationId ?? item.organization_id ?? ''),
        addressLine1: typeof item.addressLine1 === 'string' ? item.addressLine1 : '',
        addressLine2: typeof item.addressLine2 === 'string' ? item.addressLine2 : '',
        city: typeof item.city === 'string' ? item.city : '',
        countryCode: typeof item.countryCode === 'string' ? item.countryCode : '',
        contactName: typeof item.contactName === 'string' ? item.contactName : '',
        contactPhone: typeof item.contactPhone === 'string' ? item.contactPhone : '',
        email: typeof item.email === 'string' ? item.email : '',
        notes: typeof item.notes === 'string' ? item.notes : '',
        bankAccounts: [],
        updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
      })),
    [query.data],
  )

  const handleDelete = React.useCallback(
    async (row: OurPartyProfileRecord) => {
      const proceed = await confirm({
        title: t('our_parties.list.deleteConfirmTitle'),
        description: t('our_parties.list.deleteConfirmBody', 'This removes the profile. Documents that already printed it keep their snapshot.'),
        confirmText: t('ui.actions.delete'),
        variant: 'destructive',
      })
      if (!proceed) return
      try {
        // The row carries its own version so a list rendered before someone else edited the profile
        // fails with a 409 instead of deleting a row the user never saw.
        await withScopedApiRequestHeaders(
          buildOptimisticLockHeader(row.updatedAt),
          () => deleteCrud(API_PATH, { id: row.id }),
        )
        flash(t('our_parties.list.deleted', 'Profile deleted'), 'success')
        void queryClient.invalidateQueries({ queryKey: [QUERY_KEY_ROOT] })
      } catch (error) {
        flash(
          error instanceof Error && error.message
            ? error.message
            : t('our_parties.list.deleteFailed', 'Could not delete the profile'),
          'error',
        )
        void query.refetch()
      }
    },
    [confirm, query, queryClient, t],
  )

  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        title={t('our_parties.list.title')}
        sorting={sorting}
        onSortingChange={setSorting}
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          total: query.data?.total ?? rows.length,
          totalPages: query.data?.totalPages ?? 0,
          totalIsCapped: query.data?.totalIsCapped === true,
          onPageChange: setPage,
        }}
        isLoading={query.isLoading}
        error={query.error ? t('our_parties.list.loadFailed') : null}
        actions={
          <Button asChild>
            <Link href={`${LIST_HREF}/create`}>{t('our_parties.list.add')}</Link>
          </Button>
        }
        emptyState={
          <ListEmptyState
            title={t('our_parties.list.emptyTitle')}
            description={t('our_parties.list.emptyBody')}
            createHref={`${LIST_HREF}/create`}
            createLabel={t('our_parties.list.add')}
          />
        }
        rowActions={(row) => (
          <RowActions
            items={[
              {
                id: 'edit',
                label: t('ui.actions.edit'),
                onSelect: () => router.push(`${LIST_HREF}/${row.id}/edit`),
              },
              {
                id: 'delete',
                label: t('ui.actions.delete'),
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
