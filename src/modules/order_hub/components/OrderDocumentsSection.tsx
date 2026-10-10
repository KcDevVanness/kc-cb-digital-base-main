'use client'

import * as React from 'react'
import { Download, Trash2, Upload } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { formatAttachmentFileSize } from '@open-mercato/ui/backend/detail/AttachmentVisualPreview'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { RelatedSection, type RelatedSectionMessages } from '@/lib/related/RelatedSection'
import { AttachmentPreviewLink } from '@/lib/attachments/AttachmentPreview'
import { COMPANY_ORDER_DOCUMENT_SLOTS, type CompanyOrderDocumentSlot } from '../data/validators'
import type { CompanyOrderDocumentSlotGroup, CompanyOrderDocumentSourceKind } from '../lib/companyOrderFields'

/**
 * The hub's named document slots (REQ-024): one row per 35-column document field, each holding the
 * files this order filed for that slot plus the child-derived source of the same kind.
 *
 * The rows read through two module routes, never an installed one: the slot registry
 * (`GET /orders/documents`, root-visibility scoped, so a collaborating organization sees the
 * owner's files) and the shared summary (`GET /orders/fields`) for the child sources the projection
 * already computes. Uploads still post to the installed `attachments` route — the platform keeps
 * owning the bytes and its partition/quota/extension rules — but they file under
 * `entityId='order_hub:company_order_document'` with the freshly generated slot-row id, then register
 * the row. Delete removes the row first and the blob second: a failed blob delete leaves an orphan
 * the UI never references, never a row pointing at a missing file.
 *
 * Failure isolation follows the hub's other blocks — `RelatedSection` owns the loading/error/empty
 * state, so a failed slots read never takes the page down. `canManage` only hides the write
 * controls; a collaborator is refused server-side regardless.
 */
export type OrderDocumentsSectionProps = {
  companyOrderId: string
  /** Owner = true; a collaborating organization = false (the API gates the writes regardless). */
  canManage: boolean
  /** Section anchor id, so a page can link straight at the block. */
  id?: string
  title: string
  emptyLabel: string
  messages: RelatedSectionMessages
}

const DOCUMENTS_API_PATH = '/api/order_hub/orders/documents'
const FIELDS_API_PATH = '/api/order_hub/orders/fields'
const ATTACHMENTS_API_PATH = '/api/attachments'
/** The round-5 byte proxy, extended to slot attachments (REQ-022). */
const ATTACHMENT_BYTES_HREF = '/api/order_hub/orders/attachments'
const DOCUMENT_ENTITY_ID = 'order_hub:company_order_document'

/** The on-page anchor of each child block a source badge deep-links to. */
const SOURCE_ANCHOR: Record<CompanyOrderDocumentSourceKind, string> = {
  contract: '#contracts',
  shipment: '#shipments',
  collection: '#money',
  purchasing: '#purchasing',
}

type SlotFileRow = {
  /** The slot-row id (`order_hub_company_order_documents.id`), the delete target. */
  id: string
  slot: string
  attachmentId: string
  fileName: string
  fileSize: number | null
  createdAt: string | null
  /** The attachment row is gone while the slot row remains (REQ-021). */
  missing: boolean
}

function toSlotFileRow(item: Record<string, unknown>): SlotFileRow | null {
  const id = typeof item.id === 'string' ? item.id : ''
  const slot = typeof item.slot === 'string' ? item.slot : ''
  const attachmentId = typeof item.attachmentId === 'string' ? item.attachmentId : ''
  if (!id || !slot || !attachmentId) return null
  return {
    id,
    slot,
    attachmentId,
    fileName: typeof item.fileName === 'string' && item.fileName.length > 0 ? item.fileName : attachmentId,
    fileSize: typeof item.fileSize === 'number' && Number.isFinite(item.fileSize) ? item.fileSize : null,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : null,
    missing: item.missing === true,
  }
}

function newRowId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now()}-${Math.round(Math.random() * 1_000_000)}`
}

export function OrderDocumentsSection({
  companyOrderId,
  canManage,
  id,
  title,
  emptyLabel,
  messages,
}: OrderDocumentsSectionProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const pendingSlotRef = React.useRef<CompanyOrderDocumentSlot | null>(null)
  const [busySlot, setBusySlot] = React.useState<string | null>(null)

  const documentsQuery = useQuery({
    queryKey: ['order-hub-documents', companyOrderId],
    enabled: companyOrderId.length > 0,
    queryFn: async () => {
      const payload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
        `${DOCUMENTS_API_PATH}?companyOrderId=${encodeURIComponent(companyOrderId)}`,
        undefined,
        { errorMessage: t('order_hub.documents.loadFailed') },
      )
      return (payload.items ?? [])
        .map(toSlotFileRow)
        .filter((row): row is SlotFileRow => row !== null)
    },
  })

  // The child sources arrive with the shared summary; the section reads it and never writes it.
  const fieldsQuery = useQuery({
    queryKey: ['order-hub', 'fields', companyOrderId],
    enabled: companyOrderId.length > 0,
    queryFn: () =>
      readApiResultOrThrow<{ documents?: { bySlot?: CompanyOrderDocumentSlotGroup[] } }>(
        `${FIELDS_API_PATH}?companyOrderId=${encodeURIComponent(companyOrderId)}`,
        undefined,
        { errorMessage: t('order_hub.documents.loadFailed') },
      ),
  })

  const filesBySlot = React.useMemo(() => {
    const map = new Map<string, SlotFileRow[]>()
    for (const row of documentsQuery.data ?? []) {
      const list = map.get(row.slot)
      if (list) list.push(row)
      else map.set(row.slot, [row])
    }
    return map
  }, [documentsQuery.data])

  const sourcesBySlot = React.useMemo(() => {
    const map = new Map<string, CompanyOrderDocumentSlotGroup['childSources']>()
    for (const group of fieldsQuery.data?.documents?.bySlot ?? []) {
      map.set(group.slot, group.childSources ?? [])
    }
    return map
  }, [fieldsQuery.data])

  const reload = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['order-hub-documents', companyOrderId] })
    await queryClient.invalidateQueries({ queryKey: ['order-hub', 'fields', companyOrderId] })
  }, [queryClient, companyOrderId])

  const startUpload = React.useCallback((slot: CompanyOrderDocumentSlot) => {
    pendingSlotRef.current = slot
    inputRef.current?.click()
  }, [])

  const acceptFile = React.useCallback(
    async (list: FileList | null) => {
      const file = list?.[0]
      const slot = pendingSlotRef.current
      pendingSlotRef.current = null
      if (!file || !slot) return
      setBusySlot(slot)
      try {
        const rowId = newRowId()
        const body = new FormData()
        body.set('entityId', DOCUMENT_ENTITY_ID)
        body.set('recordId', rowId)
        body.set('file', file)
        const upload = await apiCall<{ item?: { id?: string } }>(
          ATTACHMENTS_API_PATH,
          { method: 'POST', body },
          { fallback: null },
        )
        const attachmentId = upload.ok && typeof upload.result?.item?.id === 'string' ? upload.result.item.id : ''
        if (!attachmentId) throw new Error(t('order_hub.documents.uploadFailed'))

        const registration = await apiCall<{ ok?: boolean; error?: string }>(
          DOCUMENTS_API_PATH,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: rowId, companyOrderId, slot, attachmentId }),
          },
          { fallback: null },
        )
        if (!registration.ok) {
          // The bytes landed but the row did not: drop the orphan rather than leave an unreferenced file.
          await apiCall(`${ATTACHMENTS_API_PATH}?id=${encodeURIComponent(attachmentId)}`, { method: 'DELETE' }, { fallback: null })
          throw new Error(registration.result?.error || t('order_hub.documents.uploadFailed'))
        }

        flash(t('order_hub.documents.uploaded'), 'success')
        await reload()
      } catch (error) {
        flash(
          error instanceof Error && error.message ? error.message : t('order_hub.documents.uploadFailed'),
          'error',
        )
      } finally {
        setBusySlot(null)
        if (inputRef.current) inputRef.current.value = ''
      }
    },
    [companyOrderId, reload, t],
  )

  const remove = React.useCallback(
    async (row: SlotFileRow) => {
      const confirmed = await confirm({
        title: t('order_hub.documents.delete'),
        text: t('order_hub.documents.deleteNamed', { name: row.fileName }),
        variant: 'destructive',
      })
      if (!confirmed) return
      setBusySlot(row.slot)
      try {
        const removal = await apiCall<{ ok?: boolean; error?: string }>(
          `${DOCUMENTS_API_PATH}?id=${encodeURIComponent(row.id)}`,
          { method: 'DELETE' },
          { fallback: null },
        )
        if (!removal.ok) throw new Error(removal.result?.error || t('order_hub.documents.deleteFailed'))
        flash(t('order_hub.documents.deleted'), 'success')
        // The row is gone, so the UI no longer references the blob; deleting it second means a failed
        // blob delete only leaves an orphan (recorded in the module README), never a dangling row.
        const blob = await apiCall(
          `${ATTACHMENTS_API_PATH}?id=${encodeURIComponent(row.attachmentId)}`,
          { method: 'DELETE' },
          { fallback: null },
        )
        if (!blob.ok) flash(t('order_hub.documents.deleteFailed'), 'error')
        await reload()
      } catch (error) {
        flash(
          error instanceof Error && error.message ? error.message : t('order_hub.documents.deleteFailed'),
          'error',
        )
      } finally {
        setBusySlot(null)
      }
    },
    [confirm, reload, t],
  )

  return (
    <>
      <RelatedSection
        id={id}
        title={title}
        isLoading={documentsQuery.isLoading || fieldsQuery.isLoading}
        failed={documentsQuery.isError || fieldsQuery.isError}
        isEmpty={false}
        emptyLabel={emptyLabel}
        onRetry={() => {
          void documentsQuery.refetch()
          void fieldsQuery.refetch()
        }}
        framed
        messages={messages}
      >
        <ul className="flex flex-col gap-3">
          {COMPANY_ORDER_DOCUMENT_SLOTS.map((slot) => {
            const files = filesBySlot.get(slot) ?? []
            const sources = sourcesBySlot.get(slot) ?? []
            const busy = busySlot === slot
            return (
              <li key={slot} className="flex flex-col gap-2 rounded-md border px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">{t(`order_hub.documents.slots.${slot}`)}</span>
                  {canManage ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy || companyOrderId.length === 0}
                      onClick={() => startUpload(slot)}
                    >
                      <Upload className="size-4" aria-hidden="true" />
                      {busy ? t('order_hub.documents.uploading') : t('order_hub.documents.upload')}
                    </Button>
                  ) : null}
                </div>

                {files.length === 0 && sources.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('order_hub.documents.noFiles')}</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {files.length > 0 ? (
                      <ul className="flex flex-wrap gap-2">
                        {files.map((row) => (
                          <li
                            key={row.id}
                            className="flex flex-wrap items-center gap-2 rounded border bg-muted/30 px-2 py-1 text-xs"
                          >
                            <span className="font-medium break-all">{row.fileName}</span>
                            {row.fileSize !== null ? (
                              <span className="text-muted-foreground">{formatAttachmentFileSize(row.fileSize)}</span>
                            ) : null}
                            {row.createdAt ? (
                              <span className="text-muted-foreground">{row.createdAt.slice(0, 10)}</span>
                            ) : null}
                            {row.missing ? (
                              <span className="text-destructive">{t('order_hub.documents.missing')}</span>
                            ) : (
                              <>
                                <AttachmentPreviewLink
                                  attachmentId={row.attachmentId}
                                  fileName={row.fileName}
                                  fileHref={ATTACHMENT_BYTES_HREF}
                                  label={t('order_hub.documents.preview')}
                                />
                                <Button asChild variant="ghost" size="sm">
                                  <a href={`${ATTACHMENT_BYTES_HREF}/${encodeURIComponent(row.attachmentId)}?download=1`}>
                                    <Download className="size-4" aria-hidden="true" />
                                    {t('order_hub.documents.download')}
                                  </a>
                                </Button>
                              </>
                            )}
                            {canManage ? (
                              <IconButton
                                type="button"
                                variant="ghost"
                                disabled={busy}
                                aria-label={t('order_hub.documents.deleteNamed', { name: row.fileName })}
                                onClick={() => void remove(row)}
                              >
                                <Trash2 className="size-4" aria-hidden="true" />
                              </IconButton>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {sources.length > 0 ? (
                      <ul className="flex flex-wrap items-center gap-2 text-xs">
                        {sources.map((source, index) => (
                          <li key={`${source.source}-${index}`}>
                            <a
                              href={SOURCE_ANCHOR[source.source]}
                              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-muted-foreground transition-colors hover:text-foreground"
                            >
                              <span>{t(`order_hub.documents.sources.${source.source}`)}</span>
                              {source.label ? <span className="font-medium text-foreground">{source.label}</span> : null}
                              {typeof source.count === 'number' ? (
                                <span>{t('order_hub.documents.sourceCount', { count: source.count })}</span>
                              ) : null}
                            </a>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </RelatedSection>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(event) => { void acceptFile(event.target.files) }}
      />
      {ConfirmDialogElement}
    </>
  )
}

export default OrderDocumentsSection
