/**
 * What the attachment viewer can render, decided from the bytes the server actually returned.
 *
 * The platform serves only images inline (`SAFE_INLINE_MIME_TYPES` in the installed attachments
 * security module, `node_modules/@open-mercato/core/src/modules/attachments/lib/security.ts`); every
 * other type — PDF included — arrives as `application/octet-stream` with an `attachment`
 * disposition, so a PDF in an `<iframe src="/api/attachments/file/…">` downloads instead of
 * rendering. Sniffing the payload is what lets the viewer know it is holding a PDF and rebuild the
 * Blob type client-side, without touching the platform's active-content policy.
 *
 * Signature first, response `Content-Type` second: a stored row whose `mime_type` is wrong (a legacy
 * upload, an operator's `.jfif` scan) still previews, while the declared type only ever widens the
 * set to formats the platform itself already serves inline.
 */

/** Largest file the viewer holds in memory. Past this the bytes are not read at all. */
export const ATTACHMENT_PREVIEW_MAX_BYTES = 25 * 1024 * 1024

export type AttachmentPreviewKind = 'image' | 'pdf'

export type AttachmentPreviewDescriptor = {
  kind: AttachmentPreviewKind
  mimeType: string
}

type ImageSignature = {
  mimeType: string
  matches: (bytes: Uint8Array) => boolean
}

const bytesAt = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  signature.length + offset <= bytes.length && signature.every((value, index) => bytes[offset + index] === value)

const asciiAt = (bytes: Uint8Array, text: string, offset = 0): boolean =>
  bytesAt(bytes, [...text].map((character) => character.charCodeAt(0)), offset)

const IMAGE_SIGNATURES: readonly ImageSignature[] = [
  { mimeType: 'image/png', matches: (bytes) => bytesAt(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { mimeType: 'image/jpeg', matches: (bytes) => bytesAt(bytes, [0xff, 0xd8, 0xff]) },
  { mimeType: 'image/gif', matches: (bytes) => asciiAt(bytes, 'GIF87a') || asciiAt(bytes, 'GIF89a') },
  { mimeType: 'image/webp', matches: (bytes) => asciiAt(bytes, 'RIFF') && asciiAt(bytes, 'WEBP', 8) },
  { mimeType: 'image/bmp', matches: (bytes) => asciiAt(bytes, 'BM') },
  {
    mimeType: 'image/avif',
    matches: (bytes) =>
      asciiAt(bytes, 'ftyp', 4) && (asciiAt(bytes, 'avif', 8) || asciiAt(bytes, 'avis', 8)),
  },
]

const PDF_MIME_TYPE = 'application/pdf'
const PDF_HEADER = '%PDF-'
/** The PDF specification allows the header anywhere in the first 1024 bytes. */
const PDF_HEADER_SEARCH_BYTES = 1024

function hasPdfHeader(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, PDF_HEADER_SEARCH_BYTES) - PDF_HEADER.length
  for (let offset = 0; offset <= limit; offset += 1) {
    if (asciiAt(bytes, PDF_HEADER, offset)) return true
  }
  return false
}

/** `image/png; charset=binary` → `image/png`. */
export function normalizeContentType(contentType: string | null | undefined): string {
  return String(contentType ?? '').split(';', 1)[0]!.trim().toLowerCase()
}

/**
 * The viewer to use for a payload, or `null` when the file cannot be shown inline (the caller then
 * says so and keeps the download entry point).
 */
export function detectAttachmentPreview(
  bytes: Uint8Array,
  contentType: string | null | undefined,
): AttachmentPreviewDescriptor | null {
  for (const signature of IMAGE_SIGNATURES) {
    if (signature.matches(bytes)) return { kind: 'image', mimeType: signature.mimeType }
  }
  if (hasPdfHeader(bytes)) return { kind: 'pdf', mimeType: PDF_MIME_TYPE }

  const declared = normalizeContentType(contentType)
  // SVG stays out on purpose: the platform classifies it as active content and never serves it
  // inline, and it is the one image format whose rendering is worth not re-enabling by accident.
  if (declared.startsWith('image/') && declared !== 'image/svg+xml') {
    return { kind: 'image', mimeType: declared }
  }
  if (declared === PDF_MIME_TYPE) return { kind: 'pdf', mimeType: PDF_MIME_TYPE }
  return null
}
