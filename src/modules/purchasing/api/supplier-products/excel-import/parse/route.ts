import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { AttachmentService } from '@open-mercato/core/modules/attachments'
import { WorkbookReadError, readWorkbook, type ParsedWorkbook } from '@/lib/workbook'
import { detectHeaderRow } from '../../../../lib/supplierProductExcelImport/columns'
import { MAX_IMPORT_ROWS, cellToText } from '../../../../lib/supplierProductExcelImport/rows'
import { purchasingErrorSchema, purchasingTag } from '../../../openapi'

/**
 * `POST /api/purchasing/supplier-products/excel-import/parse` — open an uploaded spreadsheet.
 *
 * A hand-written read route, not a CRUD action: nothing is written and no command is dispatched, so
 * there is no audit entry to leave behind. It resolves its own scope from the session (the file's owner
 * check below is what actually guards the read) and returns the sheet as the mapping table needs it —
 * the header row, one column descriptor per cell, and the raw data rows. The mapping and the row
 * building happen in the browser through the pure functions in `lib/supplierProductExcelImport/`, so a mapping
 * change never costs another upload.
 *
 * Only the first worksheet is read: a supplier file with several sheets needs a sheet picker, and this
 * round's skeleton deliberately has none — the operator is told which sheet it read.
 */

const SUPPLIER_ATTACHMENT_ENTITY_ID = 'purchasing:purchasing_supplier' as const

const parseRequestSchema = z.object({
  supplierId: z.string().uuid(),
  attachmentId: z.string().uuid(),
})

const parseResponseSchema = z.object({
  sheetName: z.string(),
  headerRowIndex: z.number(),
  headerCells: z.array(z.string()),
  matchedTargets: z.number(),
  columns: z.array(
    z.object({
      index: z.number(),
      header: z.string(),
      target: z.string().nullable(),
      confidence: z.number(),
      matchLevel: z.enum(['exact', 'alias', 'none']),
      duplicateOf: z.number().optional(),
      unsupported: z.enum(['price']).optional(),
    }),
  ),
  /** The raw cells below the header, already text — the client rebuilds the preview from these. */
  rows: z.array(z.array(z.string())),
})

const WORKBOOK_ERROR_CODES: Record<WorkbookReadError['reason'], string> = {
  unreadable: 'unreadable_workbook',
  too_many_sheets: 'too_many_sheets',
  sheet_too_large: 'sheet_too_large',
}

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['purchasing.supplier-products.manage'] },
}

export async function POST(request: Request) {
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const parsed = parseRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'A supplierId and an attachmentId are required', code: 'invalid_request' },
      { status: 400 },
    )
  }

  const container = await createRequestContainer()
  // Attachments are stored under the *selected* organization (the upload route resolves it the same
  // way), not under the caller's home organization, so the read has to use it too.
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    return NextResponse.json(
      { error: 'Select an organization to access this resource', code: 'organization_scope_required' },
      { status: 400 },
    )
  }

  const attachmentService = container.resolve('attachmentService') as AttachmentService
  let buffer: Buffer
  try {
    const file = await attachmentService.readScoped({
      attachmentId: parsed.data.attachmentId,
      auth: { ...auth, orgId: organizationId },
      // The attachments contract is the authority on ownership: the file must be filed under *this*
      // supplier, so an id from another record or another organization is a 422, never a read.
      expectedOwner: { entityId: SUPPLIER_ATTACHMENT_ENTITY_ID, recordId: parsed.data.supplierId },
    })
    buffer = file.buffer
  } catch {
    return NextResponse.json(
      { error: 'The uploaded file could not be read back from storage', code: 'attachment_unreadable' },
      { status: 422 },
    )
  }

  let workbook: ParsedWorkbook
  try {
    workbook = readWorkbook(buffer)
  } catch (error) {
    if (error instanceof WorkbookReadError) {
      return NextResponse.json({ error: error.message, code: WORKBOOK_ERROR_CODES[error.reason] }, { status: 422 })
    }
    throw error
  }

  const sheet = workbook.sheets[0]
  const detection = detectHeaderRow(sheet.rows)
  if (!detection.ok) {
    const error =
      detection.reason === 'empty_sheet'
        ? 'The worksheet is empty'
        : 'No header row was found in the first rows of the worksheet: name the columns as the supplier sheet does (供应商货号, 品名（中文）, 单位, …)'
    return NextResponse.json({ error, code: detection.reason }, { status: 422 })
  }

  return NextResponse.json({
    sheetName: sheet.name,
    headerRowIndex: detection.headerRowIndex,
    headerCells: detection.headerCells,
    matchedTargets: detection.matchedTargets,
    columns: detection.columns,
    rows: sheet.rows
      .slice(detection.headerRowIndex + 1, detection.headerRowIndex + 1 + MAX_IMPORT_ROWS)
      .map((row) => row.map((cell) => cellToText(cell))),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: purchasingTag,
  summary: 'Parse an uploaded supplier product spreadsheet',
  methods: {
    POST: {
      summary: 'Read an uploaded spreadsheet for the supplier product import',
      description:
        'Reads the attachment that is filed under the supplier (`entityId=purchasing:purchasing_supplier`, `recordId=<supplierId>`), detects the header row with the import alias dictionary and returns one descriptor per column (`target`, `confidence`, and why an unmatched column is unmatched). Read-only: nothing is persisted, and the raw data rows come back so the browser can rebuild the preview after a mapping change without uploading again. Only the first worksheet is read.',
      requestBody: { schema: parseRequestSchema },
      responses: [
        { status: 200, description: 'The sheet, its header row and its suggested mapping', schema: parseResponseSchema },
        { status: 400, description: 'Missing supplierId or attachmentId, or no organization selected', schema: purchasingErrorSchema },
        { status: 401, description: 'Not authenticated', schema: purchasingErrorSchema },
        { status: 403, description: 'Missing purchasing.supplier-products.manage', schema: purchasingErrorSchema },
        {
          status: 422,
          description:
            'The attachment is not readable under this supplier (`attachment_unreadable`), the file is not a workbook the reader accepts (`unreadable_workbook`, `too_many_sheets`, `sheet_too_large`), or no header row was found (`header_not_found`, `empty_sheet`)',
          schema: purchasingErrorSchema,
        },
      ],
    },
  },
}
