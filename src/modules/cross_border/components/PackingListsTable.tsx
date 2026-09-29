"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import {
  CrudForm,
  type CrudField,
  type CrudFormGroup,
} from '@open-mercato/ui/backend/CrudForm'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { createCrud, deleteCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { useLocale, useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { AttachmentPreviewLink } from '@/lib/attachments/AttachmentPreview'
import { toShipmentDocumentRecord, type ShipmentDocumentRecord } from './ShipmentDetail'
import {
  SHIPMENTS_API_PATH,
  SHIPMENTS_LIST_HREF,
  SHIPMENT_DOCUMENTS_API_PATH,
  buildDocumentPayload,
  formatShipmentDate,
  shipmentDisplayLabel,
  shipmentErrorMessage,
  toShipmentRecord,
  type ShipmentRecord,
} from './ShipmentForm'
import { ShipmentDocumentAttachmentField } from './shipmentDocumentAttachmentField'

/**
 * The packing-list (PL) ledger: every `packing_list` export document across shipments, with the
 * shipment it belongs to, its number, issue date and file.
 *
 * Why a page of its own: PL is one of the four trade documents the business names (PO / PI / CI /
 * PL) and its siblings PI and CI already have menu entries, while a packing list was only visible
 * inside the shipment it hangs on — "which shipments still have no PL" had no screen to answer it.
 * The write path is unchanged: a PL is still a shipment document, so registering one here picks the
 * shipment in the same form, and the file is filed against that shipment (see the attachment field).
 */

const PAGE_SIZE = 50
const SHIPMENT_OPTION_PAGE_SIZE = 20
const DEFAULT_PACKING_LIST_TYPE = 'packing_list'

type PackingListValues = {
  shipmentId: string
  documentNumber: string
  issuedAt: string
  attachmentId: string
  note: string
}

/** A ledger row: the document projection plus the shipment it points at. */
type PackingListRow = ShipmentDocumentRecord & {
  shipment: ShipmentRecord | null
}

const EMPTY_VALUES: PackingListValues = {
  shipmentId: '',
  documentNumber: '',
  issuedAt: '',
  attachmentId: '',
  note: '',
}

function EmptyCell() {
  return <span className="text-xs text-muted-foreground">—</span>
}

function buildColumns(
  t: TranslateFn,
  locale: string,
): ColumnDef<PackingListRow>[] {
  return [
    {
      accessorKey: 'documentNumber',
      header: t('cross_border.packingLists.list.columns.number'),
      enableSorting: false,
      meta: { priority: 1 },
      cell: ({ row }) => row.original.documentNumber ?? <EmptyCell />,
    },
    {
      accessorKey: 'shipment',
      header: t('cross_border.packingLists.list.columns.shipment'),
      enableSorting: false,
      meta: { priority: 2, truncate: true, maxWidth: 240 },
      cell: ({ row }) => (
        <Link
          href={`${SHIPMENTS_LIST_HREF}/${row.original.shipmentId}`}
          className="text-primary hover:underline"
        >
          {shipmentLinkLabel(t, row.original)}
        </Link>
      ),
    },
    {
      accessorKey: 'issuedAt',
      header: t('cross_border.shipments.documents.field.issuedAt'),
      enableSorting: false,
      meta: { priority: 3 },
      cell: ({ row }) => formatShipmentDate(row.original.issuedAt, locale) ?? <EmptyCell />,
    },
    {
      accessorKey: 'attachmentId',
      header: t('cross_border.shipments.documents.field.attachment'),
      enableSorting: false,
      meta: { priority: 4 },
      cell: ({ row }) => {
        const attachmentId = row.original.attachmentId
        if (!attachmentId) return <EmptyCell />
        return (
          <div className="flex flex-wrap items-center gap-3">
            <AttachmentPreviewLink
              attachmentId={attachmentId}
              label={t('cross_border.shipments.documents.preview')}
            />
            <Link
              href={`/api/attachments/file/${encodeURIComponent(attachmentId)}?download=1`}
              className="text-sm text-primary hover:underline"
            >
              {t('cross_border.shipments.documents.download')}
            </Link>
          </div>
        )
      },
    },
    {
      accessorKey: 'note',
      header: t('cross_border.shipments.documents.field.note'),
      enableSorting: false,
      meta: { priority: 5, truncate: true, maxWidth: 240 },
      cell: ({ row }) => row.original.note ?? <EmptyCell />,
    },
  ]
}

/**
 * A row's shipment naming: the shipment's own label once it is loaded, and until then the business
 * number is unknown — never the raw uuid, which is what the projection carries.
 */
function shipmentLinkLabel(t: TranslateFn, row: PackingListRow): string {
  if (row.shipment) return shipmentDisplayLabel(t, row.shipment)
  return `${t('cross_border.packingLists.list.columns.shipment')} · ${row.shipmentId.slice(0, 8)}`
}

export default function PackingListsTable() {
  const t = useT()
  const locale = useLocale()
  const scopeVersion = useOrganizationScopeVersion()
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [dialog, setDialog] = React.useState<{ mode: 'create' } | { mode: 'edit'; row: PackingListRow } | null>(null)
  const dialogContentRef = React.useRef<HTMLDivElement | null>(null)
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  // Write actions follow the role the server gates them by; nothing is hidden while the chrome
  // payload loads, so a permitted operator never sees flicker (same pattern as the sibling lists).
  const { payload: chromePayload, isReady: chromeReady } = useBackendChrome()
  const canManage = !chromeReady || hasFeature(chromePayload?.grantedFeatures, 'cross_border.documents.manage')

  const queryKey = React.useMemo(
    () => ['cross-border-packing-lists', page, search, scopeVersion],
    [page, scopeVersion, search],
  )

  const { data, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const params: Record<string, string> = {
        docType: DEFAULT_PACKING_LIST_TYPE,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      }
      const term = search.trim()
      if (term) params.search = term
      const payload = await fetchCrudList<Record<string, unknown>>(SHIPMENT_DOCUMENTS_API_PATH, params)
      const items = (payload.items ?? []).map(toShipmentDocumentRecord)
      return { items, total: payload.total ?? items.length }
    },
  })

  const documents = React.useMemo(() => data?.items ?? [], [data])
  const total = data?.total ?? 0

  /**
   * The documents projection carries `shipment_id` only, and a ledger that shows raw uuids answers
   * nothing. The shipments are fetched by exactly the ids on this page (the platform's `ids` filter
   * on every CRUD list) — one extra request, never a per-row read.
   */
  const shipmentIdsKey = React.useMemo(
    () => Array.from(new Set(documents.map((document) => document.shipmentId))).filter(Boolean).sort().join(','),
    [documents],
  )

  const { data: shipments } = useQuery({
    queryKey: ['cross-border-packing-list-shipments', shipmentIdsKey, scopeVersion],
    enabled: shipmentIdsKey.length > 0,
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>(SHIPMENTS_API_PATH, {
        ids: shipmentIdsKey,
        pageSize: String(shipmentIdsKey.split(',').length),
      })
      return (payload.items ?? []).map(toShipmentRecord)
    },
  })

  const shipmentsById = React.useMemo(() => {
    const map = new Map<string, ShipmentRecord>()
    for (const shipment of shipments ?? []) map.set(shipment.id, shipment)
    return map
  }, [shipments])

  const rows = React.useMemo<PackingListRow[]>(
    () => documents.map((document) => ({ ...document, shipment: shipmentsById.get(document.shipmentId) ?? null })),
    [documents, shipmentsById],
  )

  const columns = React.useMemo(() => buildColumns(t, locale), [locale, t])

  const loadShipmentOptions = React.useCallback(async (query?: string) => {
    const params: Record<string, string> = {
      page: '1',
      pageSize: String(SHIPMENT_OPTION_PAGE_SIZE),
      sortField: 'created_at',
      sortDir: 'desc',
    }
    const term = query?.trim()
    if (term) params.search = term
    const payload = await fetchCrudList<Record<string, unknown>>(SHIPMENTS_API_PATH, params)
    return (payload.items ?? []).map(toShipmentRecord).map((shipment) => ({
      value: shipment.id,
      label: shipmentDisplayLabel(t, shipment),
    }))
  }, [t])

  const dialogValues = React.useMemo<PackingListValues>(() => {
    if (!dialog || dialog.mode === 'create') return EMPTY_VALUES
    return {
      shipmentId: dialog.row.shipmentId,
      documentNumber: dialog.row.documentNumber ?? '',
      issuedAt: dialog.row.issuedAt ? dialog.row.issuedAt.slice(0, 10) : '',
      attachmentId: dialog.row.attachmentId ?? '',
      note: dialog.row.note ?? '',
    }
  }, [dialog])

  const dialogFields = React.useMemo<CrudField[]>(() => {
    // A document is filed against the shipment whose attachments it belongs to, so the shipment is
    // picked once, at registration, and never re-parented afterwards (the command would accept a
    // new id and strand the file); the edit form states the shipment instead of offering it.
    const shipmentField: CrudField = {
      id: 'shipmentId',
      label: t('cross_border.packingLists.form.field.shipment'),
      description: t('cross_border.packingLists.form.help.shipment'),
      type: 'combobox',
      required: true,
      allowCustomValues: false,
      loadOptions: loadShipmentOptions,
    }
    const attachmentField: CrudField = {
      id: 'attachmentId',
      label: t('cross_border.shipments.documents.field.attachment'),
      type: 'custom',
      rendersOwnError: true,
      component: (props) => (
        <ShipmentDocumentAttachmentField
          {...props}
          shipmentId={
            dialog?.mode === 'edit'
              ? dialog.row.shipmentId
              : (values) => (typeof values?.shipmentId === 'string' ? values.shipmentId : '')
          }
        />
      ),
    }
    const fields: CrudField[] = dialog?.mode === 'edit'
      ? [attachmentField]
      : [shipmentField, attachmentField]
    return [
      ...fields,
      {
        id: 'documentNumber',
        label: t('cross_border.shipments.documents.field.documentNumber'),
        type: 'text',
      },
      {
        id: 'issuedAt',
        label: t('cross_border.shipments.documents.field.issuedAt'),
        type: 'date',
      },
      {
        id: 'note',
        label: t('cross_border.shipments.documents.field.note'),
        type: 'textarea',
      },
    ]
  }, [dialog, loadShipmentOptions, t])

  const dialogGroups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'packingListDetails',
      column: 1,
      fields: dialog?.mode === 'edit'
        ? ['documentNumber', 'attachmentId']
        : ['shipmentId', 'documentNumber', 'attachmentId'],
    },
    { id: 'packingListStamp', column: 2, fields: ['issuedAt', 'note'] },
  ], [dialog])

  const handleSubmit = React.useCallback(async (values: PackingListValues) => {
    const shipmentId = dialog?.mode === 'edit' ? dialog.row.shipmentId : values.shipmentId
    const payload = buildDocumentPayload(shipmentId, {
      docType: DEFAULT_PACKING_LIST_TYPE,
      documentNumber: values.documentNumber,
      issuedAt: values.issuedAt,
      attachmentId: values.attachmentId,
      note: values.note,
    })
    try {
      if (dialog?.mode === 'edit') {
        await updateCrud(
          SHIPMENT_DOCUMENTS_API_PATH,
          { id: dialog.row.id, ...payload },
          { errorMessage: t('cross_border.shipments.documents.saveFailed') },
        )
      } else {
        await createCrud(
          SHIPMENT_DOCUMENTS_API_PATH,
          payload,
          { errorMessage: t('cross_border.shipments.documents.saveFailed') },
        )
      }
    } catch (cause) {
      // A stale version surfaces as a conflict with a refresh affordance instead of a dead form.
      surfaceRecordConflict(cause, t, { onRefresh: () => void refetch() })
      throw cause
    }
    flash(
      dialog?.mode === 'edit'
        ? t('cross_border.packingLists.form.updated')
        : t('cross_border.shipments.documents.saved'),
      'success',
    )
    setDialog(null)
    await refetch()
  }, [dialog, refetch, t])

  const handleRemove = React.useCallback(async (row: PackingListRow) => {
    const confirmed = await confirm({
      title: t('cross_border.shipments.documents.remove'),
      description: t('cross_border.packingLists.removeConfirmBody'),
      confirmText: t('cross_border.shipments.documents.remove'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await deleteCrud(SHIPMENT_DOCUMENTS_API_PATH, {
        id: row.id,
        errorMessage: t('cross_border.shipments.documents.saveFailed'),
      })
      await refetch()
    } catch (cause) {
      if (surfaceRecordConflict(cause, t, { onRefresh: () => void refetch() })) return
      flash(shipmentErrorMessage(cause, t('cross_border.shipments.documents.saveFailed')), 'error')
    }
  }, [confirm, refetch, t])

  const handleSubmitForm = React.useCallback(() => {
    dialogContentRef.current?.querySelector('form')?.requestSubmit()
  }, [])
  const handleDialogKeyDown = useDialogKeyHandler({
    onConfirm: handleSubmitForm,
    onCancel: () => setDialog(null),
  })

  const listError = error
    ? (error instanceof Error && error.message ? error.message : t('cross_border.packingLists.list.loadFailed'))
    : null

  return (
    <>
      <DataTable<PackingListRow>
        title={(
          <div className="flex flex-col gap-1">
            <h1 className="text-base font-semibold leading-tight">{t('cross_border.packingLists.page.title')}</h1>
            <p className="text-sm font-normal text-muted-foreground">
              {t('cross_border.packingLists.page.description')}
            </p>
          </div>
        )}
        columns={columns}
        data={rows}
        actions={canManage ? (
          <Button type="button" onClick={() => setDialog({ mode: 'create' })}>
            <Plus className="size-4" aria-hidden="true" />
            {t('cross_border.packingLists.actions.create')}
          </Button>
        ) : null}
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPage(1)
        }}
        searchPlaceholder={t('cross_border.packingLists.list.searchPlaceholder')}
        searchAlign="right"
        emptyState={(
          <ListEmptyState
            title={t('cross_border.packingLists.list.empty')}
            description={t('cross_border.packingLists.list.emptyHint')}
            createLabel={canManage ? t('cross_border.packingLists.actions.create') : undefined}
            onCreate={canManage ? () => setDialog({ mode: 'create' }) : undefined}
          />
        )}
        rowActions={canManage ? (row) => (
          <RowActions
            items={[
              {
                id: 'edit',
                label: t('cross_border.packingLists.actions.edit'),
                onSelect: () => setDialog({ mode: 'edit', row }),
              },
              {
                id: 'remove',
                label: t('cross_border.shipments.documents.remove'),
                destructive: true,
                onSelect: () => { void handleRemove(row) },
              },
            ]}
          />
        ) : undefined}
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          total,
          totalPages: total > 0 ? Math.ceil(total / PAGE_SIZE) : 0,
          onPageChange: setPage,
        }}
        isLoading={isLoading}
        error={listError}
      />

      <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open) setDialog(null) }}>
        <DialogContent ref={dialogContentRef} onKeyDown={handleDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === 'edit'
                ? t('cross_border.packingLists.form.editTitle')
                : t('cross_border.packingLists.form.createTitle')}
            </DialogTitle>
            <DialogDescription>
              {dialog?.mode === 'edit'
                ? t('cross_border.packingLists.form.editDescription', { shipment: shipmentLinkLabel(t, dialog.row) })
                : t('cross_border.packingLists.page.description')}
            </DialogDescription>
          </DialogHeader>
          <CrudForm<PackingListValues>
            // A fresh form per target: reusing one instance across two rows (or create → edit)
            // would keep the previous session's values, since `initialValues` only seed a mount.
            key={dialog?.mode === 'edit' ? dialog.row.id : 'create'}
            embedded
            fields={dialogFields}
            groups={dialogGroups}
            initialValues={dialogValues}
            submitLabel={t('cross_border.shipments.form.save')}
            onSubmit={handleSubmit}
          />
        </DialogContent>
      </Dialog>

      {ConfirmDialogElement}
    </>
  )
}
