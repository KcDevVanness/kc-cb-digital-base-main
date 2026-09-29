/**
 * Client-facing shapes of the sourcing module.
 *
 * They mirror the API projections (camelCase) rather than the entity columns, so a component never
 * has to remember which side of the wire it is looking at. `updatedAt` is present on every editable
 * row because the review grid and the list both send it back as the optimistic-lock version.
 */

export type QuoteStatus = 'draft' | 'approved' | 'archived' | 'cancelled'
export type QuoteLineStatus = 'staged' | 'ready' | 'invalid' | 'skipped' | 'promoted'
export type MappingConfidence = 'exact' | 'alias' | 'fuzzy' | 'none'
export type MappingStatus = 'mapped' | 'ignored' | 'unmapped'

export type QuoteListRow = {
  id: string
  number: string | null
  supplierId: string | null
  supplierNameSnapshot: string | null
  quoteDate: string | null
  currencyCode: string
  status: QuoteStatus
  sourceKind: string
  sourceFileName: string | null
  sourceSheetName: string | null
  lineCount: number
  promotedCount: number
  updatedAt: string | null
}

export type QuoteDetail = QuoteListRow & {
  validUntil: string | null
  sourceAttachmentId: string | null
  sourceLayoutSignature: string | null
  sourceProfileId: string | null
  headerRowIndex: number | null
  notes: string | null
  approvedAt: string | null
}

export type QuoteLineRow = {
  id: string
  quoteId: string
  lineNumber: number
  sourceRowNumber: number | null
  sectionLabel: string | null
  itemNo: string | null
  productName: string | null
  variantLabel: string | null
  derivedSku: string | null
  hsCode: string | null
  unit: string
  unitCost: string | null
  currencyCode: string | null
  suggestedRsp: string | null
  moqRaw: string | null
  moqQuantity: number | null
  cartonQuantity: number | null
  unitNetWeight: string | null
  innerPacking: Record<string, unknown> | null
  warnings: string[]
  rowStatus: QuoteLineStatus
  selected: boolean
  promotedProductId: string | null
  updatedAt: string | null
}

export type MappingColumn = {
  sourceIndex: number
  sourceHeader: string
  targetField: string | null
  confidence: MappingConfidence
  status: MappingStatus
  matchedOn?: string
  reason?: string
  duplicateOfField?: string
}

export type ParseOutcome = {
  quote: QuoteDetail
  sheets: {
    name: string
    index: number
    rowCount: number
    filledRowCount: number
    headerCandidates: number[]
    sampleRows: string[][]
  }[]
  sheetName: string
  headerRowIndex: number
  unitRowIndex: number | null
  headerCells: string[]
  sampleRows: string[][]
  columns: MappingColumn[]
  duplicateTargets: string[]
  unmappedColumns: number[]
  sections: { rowIndex: number; label: string }[]
  rejectedRows: { rowIndex: number; reason: string; preview?: string }[]
  structureWarnings: string[]
  dataRowCount: number
  lineCount: number
  warnings: string[]
  templateMatched: boolean
  matchedProfileId: string | null
  matchedProfileName: string | null
  layoutSignature: string
  detectedCurrency: string | null
}

export type PromotionResult = {
  created: number
  updated: number
  skipped: number
  failed: { lineId: string; lineNumber: number; message: string }[]
}

export type AiStatus = { available: boolean; provider: string | null; model: string | null }

/** One row of the review grid as the operator edits it, before it is saved. */
export type LineDraft = {
  id: string
  updatedAt: string
  selected: boolean
  derivedSku: string
  productName: string
  moqQuantity: number | null
  unitCost: string
  sectionLabel: string
  dirty: boolean
}

export type QuoteChangeKind =
  | 'added'
  | 'removed'
  | 'up'
  | 'down'
  | 'currency_mismatch'
  | 'no_price'
  | 'same'

export type QuoteVersionRef = {
  quoteId: string
  number: string | null
  status: string
  signature: string | null
  supplierId: string | null
  quoteDate: string | null
  createdAt: string
  fileName: string | null
  lineCount: number
  promotedCount: number
  day?: string
  collapsedCount?: number
}

export type QuoteChangeRow = {
  key: string | null
  itemNo: string | null
  name: string | null
  kind: QuoteChangeKind
  baseLineId: string | null
  targetLineId: string | null
  baseUnitCost: string | null
  targetUnitCost: string | null
  baseCurrencyCode: string | null
  targetCurrencyCode: string | null
  deltaAmount: string | null
  deltaPercent: number | null
  library: { supplierProductId: string; supplierSku: string; productId: string | null } | null
  purchase: { productId: string; productSku: string; unitPrice: string; currencyCode: string } | null
}

export type QuoteChangeSummary = {
  added: number
  removed: number
  up: number
  down: number
  same: number
  currencyMismatch: number
  noPrice: number
  total: number
  unmatched: number
  duplicateKeys: number
}

export type QuoteChangesResponse = {
  target: QuoteVersionRef
  base: QuoteVersionRef | null
  candidates: QuoteVersionRef[]
  summary: QuoteChangeSummary
  items: QuoteChangeRow[]
  totalCount: number
  page: number
  pageSize: number
}

export type QuoteVersionRow = {
  quoteId: string
  number: string | null
  status: string
  signature: string | null
  supplierId: string | null
  quoteDate: string | null
  createdAt: string
  fileName: string | null
  lineCount: number
  promotedCount: number
  day: string
  collapsedCount: number
  baseQuoteId: string | null
  summary: QuoteChangeSummary | null
}

export type ItemTimelinePoint = {
  quoteId: string
  number: string | null
  day: string
  signature: string | null
  itemNo: string | null
  name: string | null
  unitCost: string | null
  currencyCode: string | null
  moqQuantity: number | null
  promotedProductId: string | null
  kind: QuoteChangeKind
  deltaAmount: string | null
  deltaPercent: number | null
  first: boolean
}

export type ItemTimelineResponse = {
  item: {
    key: string
    itemNo: string | null
    name: string | null
    library: { supplierProductId: string; supplierSku: string; productId: string | null } | null
    purchase: { productId: string; productSku: string; unitPrice: string; currencyCode: string } | null
  }
  points: ItemTimelinePoint[]
  versionCount: number
  latestVersionDay: string | null
  reportedInLatestVersion: boolean
}
