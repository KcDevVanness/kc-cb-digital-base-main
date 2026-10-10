/**
 * The root order's 「单据与文件」 slots, as the hub's summary projects them
 * (`GET /api/order_hub/orders/fields`, `documents.bySlot`).
 *
 * The purchase order files no documents of its own any more (REQ-055), so its 单证 section mirrors
 * the root's slots read-only instead (REQ-056). The parse is pure and lives outside the component,
 * because the payload is a **cross-module HTTP contract**: a shape drift has to drop rows, never
 * render garbage or a blank section that looks like "no documents".
 *
 * The slot vocabulary (labels, sources) stays the hub's, reused through the merged app dictionary
 * exactly as the trade-docs dialogs reuse `order_hub.detail.documents.*` keys.
 */
export type RootDocumentFile = {
  attachmentId: string
  fileName: string
  /** ISO-8601 registration timestamp; `''` when the summary carries none. */
  createdAt: string
}

/** One child-document signal of a slot (`contract`/`shipment`/`collection`/`purchasing`). */
export type RootDocumentSource = {
  source: string
  /** The source artifact's number, or `''` when it carries none. */
  label: string
  count: number | null
}

/** One slot that carries anything at all; empty slots are dropped rather than rendered as noise. */
export type RootDocumentSlot = {
  slot: string
  files: RootDocumentFile[]
  childSources: RootDocumentSource[]
}

export const ROOT_DOCUMENTS_API_PATH = '/api/order_hub/orders/fields'
/** The root's byte proxy: it resolves a slot attachment through its row to the root's visibility. */
export const ROOT_ATTACHMENT_BYTES_HREF = '/api/order_hub/orders/attachments'
/** Where each child source's own block sits on the root page, the chip's deep link. */
export const ROOT_SOURCE_ANCHOR: Record<string, string> = {
  contract: '#contracts',
  shipment: '#shipments',
  collection: '#money',
  purchasing: '#purchasing',
}

function toRootDocumentSlot(item: Record<string, unknown>): RootDocumentSlot | null {
  const slot = typeof item.slot === 'string' ? item.slot : ''
  if (!slot) return null
  const files: RootDocumentFile[] = []
  for (const raw of Array.isArray(item.files) ? item.files : []) {
    const file = (raw ?? {}) as Record<string, unknown>
    const attachmentId = typeof file.attachmentId === 'string' ? file.attachmentId : ''
    if (!attachmentId) continue
    files.push({
      attachmentId,
      fileName: typeof file.fileName === 'string' && file.fileName.length > 0 ? file.fileName : attachmentId,
      createdAt: typeof file.createdAt === 'string' ? file.createdAt : '',
    })
  }
  const childSources: RootDocumentSource[] = []
  for (const raw of Array.isArray(item.childSources) ? item.childSources : []) {
    const source = (raw ?? {}) as Record<string, unknown>
    const kind = typeof source.source === 'string' ? source.source : ''
    if (!kind) continue
    childSources.push({
      source: kind,
      label: typeof source.label === 'string' ? source.label : '',
      count: typeof source.count === 'number' && Number.isFinite(source.count) ? source.count : null,
    })
  }
  if (files.length === 0 && childSources.length === 0) return null
  return { slot, files, childSources }
}

/** The slots of a `documents.bySlot` payload that carry something, in the payload's own order. */
export function toRootDocumentSlots(bySlot: unknown): RootDocumentSlot[] {
  if (!Array.isArray(bySlot)) return []
  return bySlot
    .map((item) => toRootDocumentSlot((item ?? {}) as Record<string, unknown>))
    .filter((slot): slot is RootDocumentSlot => slot !== null)
}
