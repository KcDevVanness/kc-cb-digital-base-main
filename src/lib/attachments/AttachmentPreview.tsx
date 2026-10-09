"use client"

import * as React from 'react'
import { Download, FileWarning } from 'lucide-react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { PdfPreview } from './PdfPreview'
import { ATTACHMENT_PREVIEW_MAX_BYTES, detectAttachmentPreview } from './previewKind'

/**
 * In-page viewer for an attachment already stored by the installed `attachments` module.
 *
 * Every app surface that references an attachment (a document row, a payment slip, a product photo)
 * shows a *preview* next to its download: the operator checks a scan against the record without
 * leaving the page. Authorization is not re-implemented here — the bytes come from the platform's
 * own file route, which applies the partition and assignment rules; a refusal simply renders the
 * error state with the download still available.
 *
 * The bytes are read through `apiCall` (never raw `fetch`) and turned into a same-origin Blob URL,
 * revoked when the dialog closes or the target changes.
 */

type PreviewRequest = {
  attachmentId: string
  fileName: string | null
}

type PreviewState =
  | { status: 'loading' }
  | { status: 'ready'; kind: 'image'; objectUrl: string }
  | { status: 'ready'; kind: 'pdf'; bytes: ArrayBuffer }
  | { status: 'unsupported' }
  | { status: 'tooLarge' }
  | { status: 'error' }

type PreviewPayload = { blob: Blob } | { tooLarge: true }

function AttachmentPreviewDialog({
  attachmentId,
  fileName,
  fileHref,
  onClose,
}: PreviewRequest & { fileHref: string; onClose: () => void }) {
  const t = useT()
  const [state, setState] = React.useState<PreviewState>({ status: 'loading' })

  React.useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | null = null
    setState({ status: 'loading' })

    const load = async () => {
      try {
        const call = await apiCall<PreviewPayload>(
          `${fileHref}/${encodeURIComponent(attachmentId)}`,
          {
            method: 'GET',
            credentials: 'same-origin',
            signal: controller.signal,
            // A 401/403 must surface as a failed preview, not as a followed redirect whose login
            // page would then be rendered as if it were the file.
            headers: { 'x-om-forbidden-redirect': '0', 'x-om-unauthorized-redirect': '0' },
          },
          {
            parse: async (response) => {
              const declaredLength = Number(response.headers.get('content-length') ?? Number.NaN)
              if (Number.isFinite(declaredLength) && declaredLength > ATTACHMENT_PREVIEW_MAX_BYTES) {
                return { tooLarge: true }
              }
              return { blob: await response.blob() }
            },
          },
        )
        if (controller.signal.aborted) return
        if (!call.ok || !call.result) {
          setState({ status: 'error' })
          return
        }
        if ('tooLarge' in call.result) {
          setState({ status: 'tooLarge' })
          return
        }

        const { blob } = call.result
        const bytes = new Uint8Array(await blob.arrayBuffer())
        if (controller.signal.aborted) return
        const descriptor = detectAttachmentPreview(bytes, blob.type || call.response.headers.get('content-type'))
        if (!descriptor) {
          setState({ status: 'unsupported' })
          return
        }
        if (descriptor.kind === 'pdf') {
          // PDF.js reads the bytes itself; no Blob URL is created (and none to revoke).
          setState({ status: 'ready', kind: 'pdf', bytes: bytes.buffer as ArrayBuffer })
          return
        }
        const typed = blob.type === descriptor.mimeType
          ? blob
          : new Blob([bytes], { type: descriptor.mimeType })
        objectUrl = URL.createObjectURL(typed)
        setState({ status: 'ready', kind: 'image', objectUrl })
      } catch {
        if (controller.signal.aborted) return
        setState({ status: 'error' })
      }
    }

    void load()
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [attachmentId, fileHref])

  const title = t('attachments.preview.title', 'File preview')
  const label = fileName ?? title
  const limitMb = Math.round(ATTACHMENT_PREVIEW_MAX_BYTES / (1024 * 1024))
  // Stable identity: `PdfPreview` re-loads the document when this changes.
  const handlePreviewError = React.useCallback(() => setState({ status: 'error' }), [])

  const stage = (children: React.ReactNode) => (
    <div className="attachment-preview-stage flex items-center justify-center overflow-hidden rounded-md border bg-muted/30">
      {children}
    </div>
  )

  let body: React.ReactNode
  if (state.status === 'loading') {
    body = stage(<Spinner />)
  } else if (state.status === 'ready' && state.kind === 'image') {
    body = stage(
      // A same-origin Blob URL of the operator's own file: `next/image` cannot optimize a Blob and
      // would need the session the attachments route authorizes, so a plain img is correct here.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={state.objectUrl} alt={label} className="h-full w-full object-contain" />,
    )
  } else if (state.status === 'ready') {
    body = <PdfPreview bytes={state.bytes} onError={handlePreviewError} />
  } else {
    const description = state.status === 'unsupported'
      ? t('attachments.preview.unsupported', 'This file type cannot be previewed. Download it to open it locally.')
      : state.status === 'tooLarge'
        ? t('attachments.preview.tooLarge', 'The file is larger than {limit} MB, so it is not previewed here. Download it instead.', { limit: limitMb })
        : t('attachments.preview.failed', 'The file preview could not be loaded.')
    body = (
      <EmptyState
        variant="subtle"
        icon={<FileWarning aria-hidden="true" />}
        title={title}
        description={description}
      />
    )
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {fileName ?? t('attachments.preview.description', 'Images and PDFs open in this dialog.')}
          </DialogDescription>
        </DialogHeader>
        {body}
        <DialogFooter>
          <Button variant="outline" asChild>
            <a href={`${fileHref}/${encodeURIComponent(attachmentId)}?download=1`}>
              <Download aria-hidden="true" />
              {t('attachments.preview.download', 'Download')}
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * One preview dialog per host component, driven from anywhere inside it — a table cell, a row
 * action menu, or a form field. Render `previewDialog` once and call `openPreview` from the
 * triggers.
 */
export function useAttachmentPreview(fileHref: string = '/api/attachments/file'): {
  openPreview: (attachmentId: string, fileName?: string | null) => void
  previewDialog: React.ReactNode
} {
  const [request, setRequest] = React.useState<PreviewRequest | null>(null)

  const openPreview = React.useCallback((attachmentId: string, fileName?: string | null) => {
    if (!attachmentId) return
    setRequest({ attachmentId, fileName: fileName?.trim() ? fileName : null })
  }, [])

  const previewDialog = request ? (
    <AttachmentPreviewDialog
      key={request.attachmentId}
      attachmentId={request.attachmentId}
      fileName={request.fileName}
      fileHref={fileHref}
      onClose={() => setRequest(null)}
    />
  ) : null

  return { openPreview, previewDialog }
}

/**
 * Trigger plus dialog for the common case: a link-shaped action inside a cell or a detail section.
 */
export function AttachmentPreviewLink({
  attachmentId,
  label,
  fileName,
  className,
  fileHref = '/api/attachments/file',
}: {
  attachmentId: string
  label: string
  fileName?: string | null
  className?: string
  /** Byte-route base path; defaults to the installed `/api/attachments/file`. */
  fileHref?: string
}) {
  const { openPreview, previewDialog } = useAttachmentPreview(fileHref)

  return (
    <>
      <Button
        type="button"
        variant="link"
        size="sm"
        className={className ?? 'h-auto px-0 text-sm font-normal'}
        onClick={() => openPreview(attachmentId, fileName)}
      >
        {label}
      </Button>
      {previewDialog}
    </>
  )
}
