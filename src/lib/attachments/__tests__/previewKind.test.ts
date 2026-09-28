import { describe, expect, it } from '@jest/globals'
import { detectAttachmentPreview, normalizeContentType } from '../previewKind'

/**
 * The viewer's type decision.
 *
 * What is pinned here is the asymmetry the platform forces on us: an image arrives with its own
 * content type, a PDF arrives as `application/octet-stream` because the installed attachments route
 * only serves images inline. The bytes therefore have to decide, and a wrong answer is visible as
 * either a download inside an `<iframe>` (PDF missed) or an empty frame (non-image accepted).
 */

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values)

const ascii = (text: string, prefix: number[] = []): Uint8Array =>
  new Uint8Array([...prefix, ...[...text].map((character) => character.charCodeAt(0))])

const PDF_HEADER = ascii('%PDF-1.7\n')

describe('detectAttachmentPreview', () => {
  it('recognises an image from its signature even when the response type is generic', () => {
    expect(detectAttachmentPreview(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), 'application/octet-stream'))
      .toEqual({ kind: 'image', mimeType: 'image/png' })
    expect(detectAttachmentPreview(bytes(0xff, 0xd8, 0xff, 0xe0), 'application/octet-stream'))
      .toEqual({ kind: 'image', mimeType: 'image/jpeg' })
    expect(detectAttachmentPreview(ascii('GIF89a'), null)).toEqual({ kind: 'image', mimeType: 'image/gif' })
    expect(detectAttachmentPreview(ascii('WEBP', [...ascii('RIFF'), 0x1a, 0x00, 0x00, 0x00]), null))
      .toEqual({ kind: 'image', mimeType: 'image/webp' })
    expect(detectAttachmentPreview(ascii('avif', [...ascii('ftyp', [...bytes(0, 0, 0, 0)])]), null))
      .toEqual({ kind: 'image', mimeType: 'image/avif' })
  })

  it('recognises a PDF that the platform served as a binary attachment', () => {
    expect(detectAttachmentPreview(PDF_HEADER, 'application/octet-stream'))
      .toEqual({ kind: 'pdf', mimeType: 'application/pdf' })
  })

  it('finds the PDF header inside the leading junk some scanners write', () => {
    expect(detectAttachmentPreview(ascii('%PDF-1.4', [...bytes(...new Array(600).fill(0x0a))]), null))
      .toEqual({ kind: 'pdf', mimeType: 'application/pdf' })
    expect(detectAttachmentPreview(ascii('%PDF-1.4', [...bytes(...new Array(2048).fill(0x0a))]), null)).toBeNull()
  })

  it('falls back to a declared image type the platform itself serves inline', () => {
    expect(detectAttachmentPreview(ascii('II*'), 'image/tiff')).toEqual({ kind: 'image', mimeType: 'image/tiff' })
    expect(detectAttachmentPreview(ascii('II*'), 'application/pdf')).toEqual({ kind: 'pdf', mimeType: 'application/pdf' })
  })

  it('refuses anything it cannot render, including active content', () => {
    expect(detectAttachmentPreview(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml')).toBeNull()
    expect(detectAttachmentPreview(ascii('PK'), 'application/octet-stream')).toBeNull()
    expect(detectAttachmentPreview(bytes(), null)).toBeNull()
  })
})

describe('normalizeContentType', () => {
  it('keeps the media type and drops parameters and case', () => {
    expect(normalizeContentType('image/png; charset=binary')).toBe('image/png')
    expect(normalizeContentType('  APPLICATION/PDF ')).toBe('application/pdf')
    expect(normalizeContentType(undefined)).toBe('')
  })
})
