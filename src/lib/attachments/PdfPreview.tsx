"use client"

import * as React from 'react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'

/**
 * PDF pages rendered with Mozilla's PDF.js (`pdfjs-dist`, Apache-2.0 — already a dependency of this
 * app) into canvases, inside the shared attachment preview.
 *
 * Why a renderer rather than the browser's built-in viewer: the platform deliberately serves PDFs
 * as `application/octet-stream` with an `attachment` disposition (only six image types are
 * `SAFE_INLINE_MIME_TYPES`), so nothing about the file says "PDF" to the browser. Handing the bytes
 * to PDF.js makes the preview independent of the viewer plugin, of the sandbox settings and of how
 * a given browser/embedding decides to handle a framed document — it renders the same everywhere and
 * the result is inspectable DOM (canvases), not an opaque plugin frame.
 *
 * Pages render sequentially, all of them up to `MAX_RENDERED_PAGES`, scaled to the stage width.
 */

/** Pages drawn in one preview; past this the file is downloaded instead of rendered. */
const MAX_RENDERED_PAGES = 30

export function PdfPreview({
  bytes,
  onError,
}: {
  bytes: ArrayBuffer
  onError: () => void
}) {
  const t = useT()
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const canvasRefs = React.useRef<Array<HTMLCanvasElement | null>>([])
  const [document, setDocument] = React.useState<PDFDocumentProxy | null>(null)
  const [pageCount, setPageCount] = React.useState(0)
  const [renderedCount, setRenderedCount] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    let task: PDFDocumentLoadingTask | null = null

    const load = async () => {
      try {
        // Loaded on demand, not statically: PDF.js is a ~1 MB renderer (plus its worker) and only
        // the operator who actually opens a PDF preview needs it — a static import would put it in
        // the client chunk of every backend page that renders an attachment link. The specifier is
        // a literal, so bundling and type checking still see it; `import.meta.url` below also has to
        // resolve from this chunk for the worker URL to be same-origin.
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString()
        // A fresh copy per attempt: `getDocument` transfers the buffer to the worker, and React's
        // development StrictMode remounts this effect — reusing one ArrayBuffer would hand the
        // second attempt a detached buffer.
        task = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) })
        const loaded = await task.promise
        if (cancelled) {
          void task.destroy()
          return
        }
        setDocument(loaded)
        setPageCount(Math.min(loaded.numPages, MAX_RENDERED_PAGES))
      } catch {
        if (!cancelled) onError()
      }
    }

    void load()
    return () => {
      cancelled = true
      setDocument(null)
      setPageCount(0)
      setRenderedCount(0)
      // `PDFDocumentProxy.destroy()` no longer exists in v6 — teardown goes through the task, which
      // releases the document and its worker resources.
      if (task) void task.destroy()
    }
  }, [bytes, onError])

  React.useEffect(() => {
    if (!document || pageCount === 0) return
    let cancelled = false

    const renderPages = async () => {
      const width = containerRef.current?.clientWidth ?? 0
      for (let index = 1; index <= pageCount; index += 1) {
        if (cancelled) return
        try {
          const page = await document.getPage(index)
          const canvas = canvasRefs.current[index - 1]
          const context = canvas?.getContext('2d')
          if (!canvas || !context) return
          const base = page.getViewport({ scale: 1 })
          const scale = width > 0 ? width / base.width : 1
          const viewport = page.getViewport({ scale })
          const ratio = Math.min(window.devicePixelRatio || 1, 2)
          canvas.width = Math.floor(viewport.width * ratio)
          canvas.height = Math.floor(viewport.height * ratio)
          await page.render({
            canvas,
            canvasContext: context,
            viewport,
            transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
          }).promise
          if (cancelled) return
          setRenderedCount(index)
        } catch {
          if (!cancelled) onError()
          return
        }
      }
    }

    void renderPages()
    return () => { cancelled = true }
  }, [document, pageCount, onError])

  return (
    <div className="attachment-preview-stage overflow-y-auto rounded-md border bg-muted/30 p-2">
      <div ref={containerRef} className="mx-auto flex w-full max-w-3xl flex-col items-center gap-3">
        {document === null ? <Spinner /> : null}
        {Array.from({ length: pageCount }, (_, index) => (
          <canvas
            key={index}
            ref={(node) => { canvasRefs.current[index] = node }}
            className={index < renderedCount ? 'h-auto w-full rounded-sm border bg-card shadow-xs' : 'hidden'}
          />
        ))}
        {pageCount > 0 && pageCount === renderedCount && document !== null && document.numPages > pageCount ? (
          <p className="pb-1 text-xs text-muted-foreground">
            {t(
              'attachments.preview.pageLimit',
              'Showing the first {shown} of {total} pages — download the file for the rest.',
              { shown: pageCount, total: document.numPages },
            )}
          </p>
        ) : null}
      </div>
    </div>
  )
}
