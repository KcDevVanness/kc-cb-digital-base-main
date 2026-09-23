import { NextResponse } from 'next/server'
import { buildXlsx, XLSX_CONTENT_TYPE, type XlsxCell } from '@open-mercato/core/modules/staff/lib/timesheets-reports/xlsx'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { TEMPLATE_HEADERS } from '../../lib/columnMapping'
import { sourcingErrorSchema, sourcingTag } from '../openapi'

/**
 * The standard template suppliers can be asked to fill in.
 *
 * It is written with the platform's dependency-free XLSX writer, and its header row is the exact
 * one `isTemplateHeaderRow` recognizes — so a workbook that comes back with these labels imports
 * without any manual mapping. The example rows are shaped like real PetKit data (a UVC variant, a
 * pack-size variant, a `/` placeholder) so the supplier can see what the columns expect.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['sourcing.import.run'] },
}

const EXAMPLE_ROWS: XlsxCell[][] = [
  ['P4108', 'Eversweet 3 Pro (Wireless Pump)', 'DRINKING', 'Material: ABS, SUS304 stainless steel / Capacity: 1.8L', '8421219990', 'PCS', 230, 'CNY', 500, 8, 15, 1.28, 1.28, '46.5*46.5*40', '21.9*21.9*18.5'],
  ['P4108-UVC', 'Eversweet 3 Pro- UVC', 'DRINKING', 'With UVC sterilisation module', '8421219990', 'PCS', 270, 'CNY', 500, 8, 15, 1.28, 1.28, '46.5*46.5*40', '21.9*21.9*18.5'],
  ['PKCL10-4BAGS', 'Urine Monitor Cat Litter 4bags', 'CLEANING', 'Ingredients: Pea Residue, Corn Starch', '1404909090', 'SET', 95, 'CNY', 10, 4, 10.2, 2.4, 2.4, '39.5*14.4*29', '10*6.5*27'],
]

export async function GET() {
  const template: XlsxCell[][] = [[...TEMPLATE_HEADERS], ...EXAMPLE_ROWS]
  const buffer = buildXlsx({ name: '报价单模板', rows: template })
  const fileName = 'supplier-quotation-template.xlsx'
  const headers: Record<string, string> = {
    'Cache-Control': 'private, max-age=60',
    'Content-Type': XLSX_CONTENT_TYPE,
    'Content-Disposition': `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    'X-Content-Type-Options': 'nosniff',
  }
  return new NextResponse(new Uint8Array(buffer), { status: 200, headers })
}

export const openApi: OpenApiRouteDoc = {
  tag: sourcingTag,
  summary: 'Download the standard quotation template',
  methods: {
    GET: {
      summary: 'Download the standard quotation template',
      description:
        'Returns an XLSX with the canonical bilingual header row and three example lines. A workbook returned with this header row imports without a manual column mapping.',
      responses: [
        {
          status: 200,
          description: 'XLSX template',
          schema: z.string().describe('XLSX file bytes'),
        },
      ],
      errors: [
        { status: 401, description: 'Not authenticated', schema: sourcingErrorSchema },
        { status: 403, description: 'Missing feature', schema: sourcingErrorSchema },
      ],
    },
  },
}
