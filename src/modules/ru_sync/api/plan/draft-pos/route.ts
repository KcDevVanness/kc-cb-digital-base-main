import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { draftPosSchema } from '../../../commands/draftPos'
import { ruSyncTag } from '../../openapi'

const logger = createLogger('ru_sync').child({ component: 'draft-pos-route' })

const draftPosResponseSchema = z.object({
  purchaseOrderId: z.string().uuid().nullable(),
  number: z.string().nullable(),
  status: z.string(),
  lines: z.number(),
  planAsOf: z.string(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['ru_sync.view', 'purchasing.orders.manage'] },
}

/**
 * 缺口 → 采购单草稿。
 *
 * A hand-written action route: there is no entity of this module to bind the CRUD factory to (the
 * write lands in `purchasing`), so it follows the documented non-factory path — mutation guards
 * first, then the command bus, then the after-success callbacks once the write has committed.
 * `place` is deliberately not reachable from here: a plan recommendation becomes a **draft** and a
 * human places it through the purchase order's own flow.
 */
export async function POST(request: Request) {
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const container = await createRequestContainer()
  try {
    const body = (await request.json()) as Record<string, unknown>
    const parsed = draftPosSchema.parse(body)

    const guards = await runRouteMutationGuards({
      container,
      req: request,
      auth: {
        tenantId: auth.tenantId,
        organizationId: auth.orgId ?? null,
        userId: auth.sub,
      },
      input: {
        resourceKind: 'ru_sync.plan',
        resourceId: null,
        operation: 'create',
        mutationPayload: parsed as unknown as Record<string, unknown>,
      },
    })
    if (!guards.ok) return guards.response

    const input = { ...(parsed as unknown as Record<string, unknown>), ...(guards.modifiedPayload ?? {}) }
    const commandBus = container.resolve('commandBus') as {
      execute: (id: string, options: { input: unknown; ctx: unknown }) => Promise<{ result?: unknown }>
    }
    const envelope = await commandBus.execute('ru_sync.plan.draft-pos', {
      input,
      ctx: { container, auth, request, selectedOrganizationId: auth.orgId ?? null },
    })

    await guards.runAfterSuccess()
    return NextResponse.json(envelope.result ?? null, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: error.issues }, { status: 400 })
    }
    if (error instanceof CrudHttpError) return NextResponse.json(error.body, { status: error.status })
    const status = (error as { status?: number }).status
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return NextResponse.json({ error: (error as Error).message }, { status })
    }
    logger.error('Failed to draft a purchase order from the RU plan', { err: error })
    return NextResponse.json({ error: 'Failed to draft a purchase order from the RU plan' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: ruSyncTag,
  methods: {
    POST: {
      summary: 'Draft a purchase order from the RU plan rows (draft only, never placed)',
      tags: [ruSyncTag],
      requestBody: { schema: draftPosSchema },
      responses: [
        { status: 201, description: 'The draft purchase order that was created.', schema: draftPosResponseSchema },
        { status: 400, description: 'Invalid input' },
        { status: 409, description: 'No RU purchase plan has been pulled yet' },
        { status: 422, description: 'A selected SKU has no mapping decision or no plan row; nothing was created' },
        { status: 403, description: 'Missing ru_sync.view or purchasing.orders.manage' },
      ],
    },
  },
}
