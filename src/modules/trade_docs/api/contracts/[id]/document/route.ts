import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { Attachment, AttachmentPartition } from '@open-mercato/core/modules/attachments/data/entities'
import { StorageDriverFactory } from '@open-mercato/core/modules/attachments/lib/drivers'
import { XLSX_CONTENT_TYPE } from '@open-mercato/core/modules/staff/lib/timesheets-reports/xlsx'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { TradeDocsContract } from '../../../../data/entities'
import { tradeDocsErrorSchema, tradeDocsTag } from '../../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['trade_docs.contracts.view'] },
  POST: { requireAuth: true, requireFeatures: ['trade_docs.contracts.manage'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

/**
 * Streams the generated contract document.
 *
 * The route resolves the **contract** first (feature gate + organization scope), then reads the
 * attachment row inside that same scope, then reads the bytes through the platform's storage
 * driver. It does not redirect to `/api/attachments/file/...`: that route answers with
 * `application/octet-stream` for a spreadsheet, while a contract download must arrive as
 * `XLSX_CONTENT_TYPE` so the client can verify what it saved. Access is therefore checked twice —
 * the contract must be visible to the caller and the attachment must belong to the contract's own
 * organization.
 */
export async function GET(_req: Request, ctx: { params?: { id?: string } }) {
  const parse = paramsSchema.safeParse({ id: ctx.params?.id })
  if (!parse.success) return NextResponse.json({ error: 'Invalid contract id' }, { status: 400 })

  const auth = await getAuthFromRequest(_req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: _req })
  const tenantId = scope.tenantId ?? auth.tenantId ?? null
  if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const organizationIds = scope.filterIds && scope.filterIds.length > 0
    ? scope.filterIds
    : scope.selectedId
      ? [scope.selectedId]
      : []
  if (organizationIds.length === 0) {
    return NextResponse.json({ error: 'Select an organization to access this resource' }, { status: 400 })
  }

  const contract = await em.fork().findOne(TradeDocsContract, {
    id: parse.data.id,
    tenantId,
    organizationId: { $in: organizationIds },
    deletedAt: null,
  })
  if (!contract) return NextResponse.json({ error: 'Contract not found' }, { status: 404 })

  const attachmentId = contract.generatedAttachmentId
  if (!attachmentId) {
    return NextResponse.json({ error: 'No document has been generated for this contract yet' }, { status: 404 })
  }

  const attachment = await em.fork().findOne(Attachment, {
    id: attachmentId,
    tenantId: contract.tenantId,
    organizationId: contract.organizationId,
  })
  if (!attachment) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })

  const partition = await em.fork().findOne(AttachmentPartition, { code: attachment.partitionCode })
  if (!partition) return NextResponse.json({ error: 'Partition misconfigured' }, { status: 500 })

  const driver = await new StorageDriverFactory(em).resolveForPartition(attachment.partitionCode, {
    tenantId: contract.tenantId,
    organizationId: contract.organizationId,
  })

  let buffer: Buffer
  try {
    const result = await driver.read(attachment.partitionCode, attachment.storagePath)
    buffer = result.buffer
  } catch {
    return NextResponse.json({ error: 'File not available' }, { status: 404 })
  }

  const fileName = attachment.fileName || `${contract.number ?? 'contract'}.xlsx`
  const headers: Record<string, string> = {
    'Cache-Control': 'private, max-age=60',
    'Content-Type': XLSX_CONTENT_TYPE,
    'Content-Disposition': `attachment; filename="${fileName.replace(/["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    'X-Content-Type-Options': 'nosniff',
  }
  if (attachment.fileSize > 0) headers['Content-Length'] = String(attachment.fileSize)

  return new NextResponse(new Uint8Array(buffer), { status: 200, headers })
}

/**
 * Generates (or regenerates) the contract document.
 *
 * The command owns the render and the attachment write; this handler only resolves the caller's
 * scope and hands the command its runtime context, exactly like the transitions route does through
 * the CRUD factory.
 */
export async function POST(req: Request, ctx: { params?: { id?: string } }) {
  const parse = paramsSchema.safeParse({ id: ctx.params?.id })
  if (!parse.success) return NextResponse.json({ error: 'Invalid contract id' }, { status: 400 })

  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const tenantId = scope.tenantId ?? auth.tenantId ?? null
  if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationIds = scope.filterIds && scope.filterIds.length > 0
    ? scope.filterIds
    : scope.selectedId
      ? [scope.selectedId]
      : []
  const organizationId = scope.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    return NextResponse.json(
      { error: 'Select an organization to access this resource', code: 'organization_scope_required' },
      { status: 400 },
    )
  }

  const commandBus = container.resolve('commandBus') as CommandBus
  try {
    const { result } = await commandBus.execute<Record<string, unknown>, { attachmentId: string; fileName: string }>(
      'trade_docs.contracts.generate-document',
      {
        input: { id: parse.data.id },
        ctx: {
          container,
          auth,
          organizationScope: scope,
          selectedOrganizationId: organizationId,
          organizationIds: scope.filterIds ?? (auth.orgId ? [auth.orgId] : null),
          request: req,
        },
      },
    )
    return NextResponse.json({ ok: true, attachmentId: result.attachmentId, fileName: result.fileName })
  } catch (error) {
    const status = typeof (error as { status?: number }).status === 'number' ? (error as { status: number }).status : 400
    // A parent-organization user sees its subsidiaries' contracts in the list but acts only in the
    // organization it selected. Without this check the answer would be a bare "Contract not found",
    // which reads like the contract vanished; say what actually has to change.
    if (status === 404) {
      const visibleElsewhere = await (container.resolve('em') as EntityManager).fork().findOne(TradeDocsContract, {
        id: parse.data.id,
        tenantId,
        organizationId: { $in: organizationIds.filter((id) => id !== organizationId) },
        deletedAt: null,
      })
      if (visibleElsewhere) {
        return NextResponse.json(
          {
            error: 'This contract belongs to another organization; switch to that organization to generate its document',
            code: 'contract_in_another_organization',
          },
          { status: 403 },
        )
      }
    }
    const body = (error as { body?: unknown }).body ?? (error as { message?: string }).message ?? 'Could not generate the document'
    return NextResponse.json(body as Record<string, unknown>, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: tradeDocsTag,
  summary: 'Download the generated contract document',
  methods: {
    GET: {
      summary: 'Download contract document',
      description:
        'Streams the XLSX document generated for a contract. The contract must be visible to the caller, and the file must have been generated first.',
      responses: [
        {
          status: 200,
          description: 'XLSX document',
          schema: z.any().describe('Binary XLSX content'),
        },
      ],
      errors: [
        { status: 400, description: 'Invalid contract id or no organization selected', schema: tradeDocsErrorSchema },
        { status: 401, description: 'Unauthorized', schema: tradeDocsErrorSchema },
        { status: 404, description: 'Contract not found, or no document generated yet', schema: tradeDocsErrorSchema },
      ],
    },
    POST: {
      summary: 'Generate the contract document',
      description:
        'Renders the contract to XLSX, stores it as an attachment on the contract and points the contract at it. An issued, signed or closed contract can produce a document.',
      responses: [
        {
          status: 200,
          description: 'Generated document reference',
          schema: z.object({ ok: z.literal(true), attachmentId: z.string().uuid(), fileName: z.string() }),
        },
      ],
      errors: [
        { status: 400, description: 'Invalid contract id or no organization selected', schema: tradeDocsErrorSchema },
        { status: 401, description: 'Unauthorized', schema: tradeDocsErrorSchema },
        { status: 404, description: 'Contract not found', schema: tradeDocsErrorSchema },
        { status: 422, description: 'The contract is a draft or was cancelled', schema: tradeDocsErrorSchema },
      ],
    },
  },
}
