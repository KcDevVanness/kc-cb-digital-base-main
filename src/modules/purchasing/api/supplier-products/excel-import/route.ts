import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { PurchasingSupplierProduct } from '../../../data/entities'
import { supplierProductExcelImportSchema } from '../../../lib/supplierProductExcelImport/rows'
import { purchasingCommandErrors, purchasingTag } from '../../openapi'

const ENTITY_ID = 'purchasing:purchasing_supplier_product' as const

/** The CRUD factory always needs an ORM binding for scope resolution; this list is not a UI contract. */
const importListSchema = z.object({
  id: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(50).default(20),
})

/**
 * The confirmed rows plus the file they were read from.
 *
 * `attachmentId` is provenance, not data: the rows were already built from the confirmed mapping, and the
 * file is recorded on the audit entry so "which upload created these rows?" stays answerable. The
 * attachment is *not* re-read here — the parse route is the one place a workbook is opened.
 */
const importRequestSchema = supplierProductExcelImportSchema.extend({
  attachmentId: z.string().uuid(),
})

const importResponseSchema = z.object({
  created: z.number(),
  failed: z.array(z.object({ row: z.number(), reason: z.string() })),
})

export const { metadata, POST } = makeCrudRoute({
  metadata: {
    POST: { requireAuth: true, requireFeatures: ['purchasing.supplier-products.manage'] },
  },
  orm: {
    entity: PurchasingSupplierProduct,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: { schema: importListSchema, entityId: ENTITY_ID, fields: ['id', 'supplier_id'] },
  actions: {
    create: {
      commandId: 'purchasing.supplier-products.import-excel',
      schema: importRequestSchema,
      mapInput: ({ parsed }) => ({ supplierId: parsed.supplierId, rows: parsed.rows }),
      metadata: ({ parsed }) => ({ context: { attachmentId: parsed.attachmentId } }),
      response: ({ result }) => result as Record<string, unknown>,
      status: 200,
    },
  },
})

export const openApi: OpenApiRouteDoc = {
  tag: purchasingTag,
  summary: 'Import supplier products from a spreadsheet',
  methods: {
    POST: {
      summary: 'Import supplier products from a spreadsheet',
      description:
        'Creates one library row per submitted row for one supplier, through `purchasing.supplier-products.create` — the same contract, duplicate-code check and events the single-row form uses. Rows are isolated: a row without a code, a duplicate code or a value the contract refuses fails alone with its spreadsheet row number in `failed`, and the rest are written. The columns were mapped in the browser; the server only validates and creates.',
      requestBody: { schema: importRequestSchema },
      responses: [
        { status: 200, description: 'Import finished', schema: importResponseSchema },
      ],
      errors: [...purchasingCommandErrors],
    },
  },
}
