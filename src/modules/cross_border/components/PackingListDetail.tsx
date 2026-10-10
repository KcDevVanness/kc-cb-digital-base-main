"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud, fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { AttachmentPreviewLink } from '@/lib/attachments/AttachmentPreview'
import { useBackHref } from '@/lib/navigation/returnTo'
import {
  PACKING_LISTS_LIST_HREF,
  SHIPMENT_DOCUMENTS_API_PATH,
  SHIPMENTS_API_PATH,
  SHIPMENTS_LIST_HREF,
  formatShipmentDate,
  shipmentDisplayLabel,
  toShipmentRecord,
  type ShipmentRecord,
} from './ShipmentForm'
import { toShipmentDocumentRecord, type ShipmentDocumentRecord } from './ShipmentDetail'
import { readPackingListLines, type PackingListLineValues } from './PackingListForm'

const LINE_PAGE_SIZE = 500
const EMPTY_CELL = '—'

function buildLineColumns(t: TranslateFn): ColumnDef<PackingListLineValues>[] {
  return [
    {
      accessorKey: 'name',
      header: t('cross_border.packingLists.form.lines.name'),
      enableSorting: false,
      meta: { priority: 1, truncate: true, maxWidth: 260 },
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span>{row.original.name || EMPTY_CELL}</span>
          {row.original.sourceSnapshot ? (
            <span className="text-xs text-muted-foreground">
              {t('cross_border.packingLists.form.lines.fromContract')}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: 'sku',
      header: t('cross_border.packingLists.form.lines.sku'),
      enableSorting: false,
      meta: { priority: 2 },
      cell: ({ row }) => row.original.sku || EMPTY_CELL,
    },
    {
      accessorKey: 'unit',
      header: t('cross_border.packingLists.form.lines.unit'),
      enableSorting: false,
      meta: { priority: 3 },
      cell: ({ row }) => row.original.unit || EMPTY_CELL,
    },
    {
      accessorKey: 'quantity',
      header: t('cross_border.packingLists.form.lines.quantity'),
      enableSorting: false,
      meta: { priority: 4, align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.quantity || EMPTY_CELL}</span>,
    },
    {
      accessorKey: 'cartons',
      header: t('cross_border.packingLists.form.lines.cartons'),
      enableSorting: false,
      meta: { priority: 5, align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.cartons || EMPTY_CELL}</span>,
    },
    {
      accessorKey: 'grossWeight',
      header: t('cross_border.packingLists.form.lines.grossWeight'),
      enableSorting: false,
      meta: { priority: 6, align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.grossWeight || EMPTY_CELL}</span>,
    },
    {
      accessorKey: 'netWeight',
      header: t('cross_border.packingLists.form.lines.netWeight'),
      enableSorting: false,
      meta: { priority: 7, align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.netWeight || EMPTY_CELL}</span>,
    },
    {
      accessorKey: 'volume',
      header: t('cross_border.packingLists.form.lines.volume'),
      enableSorting: false,
      meta: { priority: 8, align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.volume || EMPTY_CELL}</span>,
    },
    {
      accessorKey: 'note',
      header: t('cross_border.packingLists.form.lines.note'),
      enableSorting: false,
      meta: { priority: 9, truncate: true, maxWidth: 200 },
      cell: ({ row }) => row.original.note || EMPTY_CELL,
    },
  ]
}

/**
 * The packing-list detail: the head (shipment, number, issue date, file) and the line items the
 * document measures. Lines are written through the edit surface, never here — this page is the
 * read side of the same document the ledger lists.
 */
export default function PackingListDetail({ documentId }: { documentId: string }) {
  const t = useT()
  const router = useRouter()
  const backHref = useBackHref(PACKING_LISTS_LIST_HREF)
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [document, setDocument] = React.useState<ShipmentDocumentRecord | null>(null)
  const [shipment, setShipment] = React.useState<ShipmentRecord | null>(null)
  const [lines, setLines] = React.useState<PackingListLineValues[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)

  const load = React.useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    setNotFound(false)
    try {
      const [documentPayload, linePayload] = await Promise.all([
        fetchCrudList<Record<string, unknown>>(SHIPMENT_DOCUMENTS_API_PATH, { id: documentId, pageSize: 1 }),
        fetchCrudList<Record<string, unknown>>(`${SHIPMENT_DOCUMENTS_API_PATH}/lines`, {
          documentId,
          pageSize: String(LINE_PAGE_SIZE),
        }),
      ])
      const item = documentPayload.items?.[0]
      if (!item) {
        setDocument(null)
        setShipment(null)
        setLines([])
        setNotFound(true)
        return
      }
      const record = toShipmentDocumentRecord(item)
      setDocument(record)
      setLines(readPackingListLines(linePayload.items ?? []))
      try {
        const shipmentPayload = await readApiResultOrThrow<{ items?: Record<string, unknown>[] }>(
          `/api/${SHIPMENTS_API_PATH}?ids=${encodeURIComponent(record.shipmentId)}&pageSize=1`,
        )
        setShipment(shipmentPayload?.items?.[0] ? toShipmentRecord(shipmentPayload.items[0]) : null)
      } catch {
        setShipment(null)
      }
    } catch {
      setLoadError(t('cross_border.packingLists.detail.loadFailed'))
    } finally {
      setIsLoading(false)
    }
  }, [documentId, t])

  React.useEffect(() => {
    void load()
  }, [load])

  const handleRemove = React.useCallback(async () => {
    if (!document) return
    const confirmed = await confirm({
      title: t('cross_border.shipments.documents.remove'),
      description: t('cross_border.packingLists.removeConfirmBody'),
      confirmText: t('cross_border.shipments.documents.remove'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await deleteCrud(SHIPMENT_DOCUMENTS_API_PATH, {
        id: document.id,
        errorMessage: t('cross_border.shipments.documents.saveFailed'),
      })
      flash(t('cross_border.packingLists.form.removed'), 'success')
      router.push(PACKING_LISTS_LIST_HREF)
    } catch (cause) {
      if (surfaceRecordConflict(cause, t, { onRefresh: () => void load() })) return
      flash(t('cross_border.shipments.documents.saveFailed'), 'error')
    }
  }, [confirm, document, load, router, t])

  const columns = React.useMemo(() => buildLineColumns(t), [t])

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{t('cross_border.packingLists.detail.loading')}</p>
  }
  if (loadError) {
    return (
      <p className="text-sm text-status-error-text" role="alert">
        {loadError}
      </p>
    )
  }
  if (notFound || !document) {
    return <p className="text-sm text-muted-foreground">{t('cross_border.packingLists.detail.notFound')}</p>
  }

  return (
    <>
      <FormHeader
        mode="detail"
        backHref={backHref}
        entityTypeLabel={t('cross_border.packingLists.page.title')}
        title={document.documentNumber ?? t('cross_border.packingLists.detail.untitled')}
        actionsContent={(
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <Link href={`${PACKING_LISTS_LIST_HREF}/${encodeURIComponent(document.id)}/edit`}>
                {t('cross_border.packingLists.actions.edit')}
              </Link>
            </Button>
            <Button type="button" variant="destructive" onClick={() => void handleRemove()}>
              {t('cross_border.shipments.documents.remove')}
            </Button>
          </div>
        )}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {t('cross_border.packingLists.form.field.shipment')}
          </p>
          <p className="text-sm">
            {shipment ? (
              <Link className="text-primary hover:underline" href={`${SHIPMENTS_LIST_HREF}/${encodeURIComponent(shipment.id)}`}>
                {shipmentDisplayLabel(t, shipment)}
              </Link>
            ) : (
              document.shipmentId.slice(0, 8)
            )}
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {t('cross_border.shipments.documents.field.issuedAt')}
          </p>
          <p className="text-sm">{formatShipmentDate(document.issuedAt) ?? EMPTY_CELL}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {t('cross_border.shipments.documents.field.attachment')}
          </p>
          <p className="text-sm">
            {document.attachmentId ? (
              <span className="flex flex-wrap items-center gap-3">
                <AttachmentPreviewLink
                  attachmentId={document.attachmentId}
                  label={t('cross_border.shipments.documents.preview')}
                />
                <Link
                  href={`/api/attachments/file/${encodeURIComponent(document.attachmentId)}?download=1`}
                  className="text-primary hover:underline"
                >
                  {t('cross_border.shipments.documents.download')}
                </Link>
              </span>
            ) : (
              EMPTY_CELL
            )}
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {t('cross_border.shipments.documents.field.note')}
          </p>
          <p className="text-sm">{document.note ?? EMPTY_CELL}</p>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
        <SectionHeader title={t('cross_border.packingLists.form.lines.title')} count={lines.length} />
        <DataTable<PackingListLineValues> embedded columns={columns} data={lines} disableRowClick />
      </div>

      {ConfirmDialogElement}
    </>
  )
}
