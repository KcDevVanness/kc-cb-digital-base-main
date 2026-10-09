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
import { AttachmentPreviewLink } from './AttachmentPreview'

/**
 * A generic "files of this record" block over the installed `attachments` module.
 *
 * Every app surface that hangs files off its own record (a payment slip, a purchase-order document,
 * and now a company order's unclassified paperwork) needs the same four things: the record's file
 * list, an upload, a preview/download and a delete. This is that block, once — the host supplies the
 * section's framing (`title`/`emptyLabel`/`messages`) and the entity id the files are filed under,
 * and the block supplies the states and the controls.
 *
 * It is a *shell*, not an authorization layer: the bytes and the rows come from the platform's own
 * attachment routes (`/api/attachments`), which apply `attachments.view`/`attachments.manage` and
 * the organization scope. `canManage` only hides the write controls; the API still decides.
 *
 * Failure isolation follows the hub's other blocks: the section renders its own loading/error/empty
 * state through `RelatedSection`, so a failed attachments read never takes the page down with it.
 */
export type AttachmentsSectionProps = {
  /** The installed `attachments` entity id, e.g. `order_hub:company_order`. */
  entityId: string
  /** The record the files are filed under; an empty value disables the read entirely. */
  recordId: string
  /** Section anchor id, so a page can link straight at the block. */
  id?: string
  title: string
  emptyLabel: string
  messages: RelatedSectionMessages
  /** Hide the upload/delete controls when false (the API gates the writes regardless). */
  canManage: boolean
}

type AttachmentRow = {
  id: string
  fileName: string
  fileSize: number | null
  createdAt: string | null
}

function toRow(item: Record<string, unknown>): AttachmentRow {
  return {
    id: String(item.id ?? ''),
    fileName: typeof item.fileName === 'string' && item.fileName.length > 0 ? item.fileName : String(item.id ?? ''),
    fileSize: typeof item.fileSize === 'number' && Number.isFinite(item.fileSize) ? item.fileSize : null,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : null,
  }
}

export function AttachmentsSection({
  entityId,
  recordId,
  id,
  title,
  emptyLabel,
  messages,
  canManage,
}: AttachmentsSectionProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const [isUploading, setIsUploading] = React.useState(false)
  const [isDeleting, setIsDeleting] = React.useState(false)

  const queryKey = React.useMemo(() => ['attachments', entityId, recordId], [entityId, recordId])
  const filesQuery = useQuery({
    queryKey,
    enabled: recordId.length > 0,
    queryFn: async () => {
      const params = new URLSearchParams({ entityId, recordId, pageSize: '100' })
      const payload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
        `/api/attachments?${params.toString()}`,
        undefined,
        { errorMessage: t('attachments.section.loadFailed', 'Failed to load the files') },
      )
      return (payload.items ?? []).map(toRow).filter((row) => row.id.length > 0)
    },
  })
  const rows = filesQuery.data ?? []

  const reload = React.useCallback(
    () => queryClient.invalidateQueries({ queryKey }),
    [queryClient, queryKey],
  )

  const acceptFile = React.useCallback(
    async (list: FileList | null) => {
      const file = list?.[0]
      if (!file) return
      setIsUploading(true)
      try {
        const body = new FormData()
        body.set('entityId', entityId)
        body.set('recordId', recordId)
        body.set('file', file)
        const call = await apiCall<{ ok?: boolean; item?: { id?: string }; error?: string }>(
          '/api/attachments',
          { method: 'POST', body },
          { fallback: null },
        )
        const uploadedId = call.ok && typeof call.result?.item?.id === 'string' ? call.result.item.id : ''
        if (!uploadedId) {
          throw new Error(call.result?.error || t('attachments.section.uploadFailed', 'The file could not be uploaded'))
        }
        flash(t('attachments.section.uploaded', 'File uploaded'), 'success')
        await reload()
      } catch (error) {
        flash(
          error instanceof Error && error.message
            ? error.message
            : t('attachments.section.uploadFailed', 'The file could not be uploaded'),
          'error',
        )
      } finally {
        setIsUploading(false)
        if (inputRef.current) inputRef.current.value = ''
      }
    },
    [entityId, recordId, reload, t],
  )

  const remove = React.useCallback(
    async (row: AttachmentRow) => {
      const confirmed = await confirm({
        title: t('attachments.section.delete', 'Delete'),
        text: t('attachments.section.deleteNamed', 'Delete {name}?', { name: row.fileName }),
        variant: 'destructive',
      })
      if (!confirmed) return
      setIsDeleting(true)
      try {
        const call = await apiCall<{ ok?: boolean; error?: string }>(
          `/api/attachments?id=${encodeURIComponent(row.id)}`,
          { method: 'DELETE' },
          { fallback: null },
        )
        if (!call.ok) {
          throw new Error(call.result?.error || t('attachments.section.deleteFailed', 'The file could not be deleted'))
        }
        flash(t('attachments.section.deleted', 'File removed'), 'success')
        await reload()
      } catch (error) {
        flash(
          error instanceof Error && error.message
            ? error.message
            : t('attachments.section.deleteFailed', 'The file could not be deleted'),
          'error',
        )
      } finally {
        setIsDeleting(false)
      }
    },
    [confirm, reload, t],
  )

  const busy = isUploading || isDeleting

  return (
    <>
      <RelatedSection
        id={id}
        title={title}
        action={canManage ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || recordId.length === 0}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="size-4" aria-hidden="true" />
            {isUploading
              ? t('attachments.section.uploading', 'Uploading…')
              : t('attachments.section.upload', 'Upload file')}
          </Button>
        ) : undefined}
        isLoading={filesQuery.isLoading}
        failed={filesQuery.isError}
        isEmpty={rows.length === 0}
        emptyLabel={emptyLabel}
        onRetry={() => void filesQuery.refetch()}
        framed
        messages={messages}
      >
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-medium break-all">{row.fileName}</span>
              {row.fileSize !== null ? (
                <span className="text-muted-foreground">{formatAttachmentFileSize(row.fileSize)}</span>
              ) : null}
              {row.createdAt ? (
                <span className="text-muted-foreground">{row.createdAt.slice(0, 10)}</span>
              ) : null}
              <AttachmentPreviewLink
                attachmentId={row.id}
                fileName={row.fileName}
                label={t('attachments.section.preview', 'Preview')}
              />
              <Button asChild variant="ghost" size="sm">
                <a href={`/api/attachments/file/${encodeURIComponent(row.id)}?download=1`}>
                  <Download className="size-4" aria-hidden="true" />
                  {t('attachments.section.download', 'Download')}
                </a>
              </Button>
              {canManage ? (
                <IconButton
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  aria-label={t('attachments.section.deleteNamed', 'Delete {name}?', { name: row.fileName })}
                  onClick={() => void remove(row)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </IconButton>
              ) : null}
            </li>
          ))}
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

export default AttachmentsSection
